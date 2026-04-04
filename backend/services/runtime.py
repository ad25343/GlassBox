"""Customer support runtime — constructs prompts, calls the model, validates against spec."""
from __future__ import annotations

import json
import time
from typing import Any

import anthropic
from pydantic import BaseModel

from backend.core import db
from backend.core.config import Settings
from backend.core.logging import get_logger
from backend.services.judge import JudgeService, JudgeVerdict

logger = get_logger(__name__)

PROMPT_VERSION = "1.0.0"

RESOLUTION_PATHS: dict[str, str] = {
    "order_status": (
        "Check order status in system. Provide current status and estimated delivery date. "
        "If the order is delayed by more than 3 days, proactively offer an update and an "
        "escalation option to a human agent."
    ),
    "refund_request": (
        "Verify eligibility: check purchase date against return window, reason for return, "
        "and item condition. If eligible, initiate refund and provide processing timeline. "
        "If ineligible, explain the policy clearly and offer alternatives such as exchange "
        "or store credit."
    ),
    "billing_dispute": (
        "Verify the charge against the customer account details provided in context. "
        "Explain clearly what the charge is for. If the charge is valid, explain it. "
        "If the dispute appears legitimate, escalate to the billing team. "
        "Never share account details that are not in the provided context."
    ),
    "escalation": (
        "Acknowledge the customer's frustration empathetically. If the customer has expressed "
        "frustration more than once or explicitly requests a human, transfer immediately to a "
        "human agent and provide an estimated wait time. Do not attempt to resolve the underlying "
        "issue without human review."
    ),
}

_SYSTEM_TEMPLATE = """\
You are a professional customer support agent. Your role is to assist customers with their
support requests in a helpful, empathetic, and efficient manner.

## Behavioral Rules (Non-Negotiable)
{non_negotiables}

## Resolution Path for This Ticket Type
{resolution_path}

## Customer Context
{context}

Always acknowledge the customer's issue before offering a resolution. Keep your response concise
and professional. Do not repeat information unnecessarily.
"""

_RETRY_ADDENDUM = """\

IMPORTANT CORRECTION: Your previous response violated one or more non-negotiable rules.
Please revise your response to strictly comply with ALL non-negotiable rules listed above.
Do NOT promise refunds without checking eligibility, do NOT share unauthorized account details,
and DO escalate to a human agent if the customer has expressed frustration more than once.
"""


class RunResult(BaseModel):
    model_config = {"extra": "ignore"}

    run_id: int
    model: str
    ticket_type: str
    customer_message: str
    context: dict[str, Any]
    response: str
    verdict: JudgeVerdict
    latency_ms: int
    total_tokens: int
    retried: bool
    prompt_version: str = PROMPT_VERSION
    system_prompt: str
    resolution_path: str


class CustomerSupportRuntime:
    def __init__(self, config: Settings, judge: JudgeService) -> None:
        self._config = config
        self._judge = judge
        self._client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
        self._spec: dict[str, Any] | None = None

    def _load_spec(self) -> dict[str, Any]:
        if self._spec is None:
            with open("spec.json") as fh:
                self._spec = json.load(fh)
        return self._spec

    def _build_system_prompt(
        self, ticket_type: str, context: dict[str, Any], extra_addendum: str = ""
    ) -> str:
        spec = self._load_spec()
        non_neg_lines = []
        for nn in spec.get("non_negotiables", []):
            non_neg_lines.append(f"- [{nn['id']}] {nn['name']}: {nn['description']}")
        non_negotiables_text = "\n".join(non_neg_lines)

        resolution_path = RESOLUTION_PATHS.get(
            ticket_type,
            "Assist the customer with their request following standard support procedures.",
        )

        context_text = json.dumps(context, indent=2)

        prompt = _SYSTEM_TEMPLATE.format(
            non_negotiables=non_negotiables_text,
            resolution_path=resolution_path,
            context=context_text,
        )
        if extra_addendum:
            prompt += extra_addendum
        return prompt

    async def _call_model(
        self,
        model: str,
        system_prompt: str,
        customer_message: str,
    ) -> tuple[str, int, int]:
        """Return (response_text, input_tokens, output_tokens)."""
        message = await self._client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": customer_message}],
        )
        response_text = message.content[0].text
        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens
        return response_text, input_tokens, output_tokens

    async def _normalise_message(self, raw: str) -> str:
        """Fix spelling and grammar using Haiku before anything else sees the message.

        Returns the corrected text, or the original if the call fails.
        Only fixes typos/grammar — never changes meaning or intent.
        """
        try:
            msg = await self._client.messages.create(
                model=self._config.JUDGE_MODEL,  # Haiku — fast and cheap
                max_tokens=512,
                system=(
                    "You are a text normaliser. Fix spelling mistakes and grammar errors "
                    "in the customer message below. Preserve the original meaning, tone, "
                    "and intent exactly. Do not add, remove, or rephrase content — only "
                    "correct errors. Return ONLY the corrected text, nothing else."
                ),
                messages=[{"role": "user", "content": raw}],
            )
            corrected = msg.content[0].text.strip()
            if corrected:
                logger.debug("message normalised", original=raw, corrected=corrected)
                return corrected
        except anthropic.APIError as exc:
            logger.warning("normalisation failed — using raw message", error=str(exc))
        return raw

    async def handle_ticket(
        self,
        customer_message: str,
        ticket_type: str,
        context: dict[str, Any],
        model: str | None = None,
    ) -> RunResult:
        effective_model = model or self._config.PRODUCTION_MODEL
        resolution_path = RESOLUTION_PATHS.get(ticket_type, "Standard support resolution.")
        log = logger.bind(model=effective_model, ticket_type=ticket_type)
        log.info("handling ticket")

        # Silently fix typos/grammar — the model and judge always see clean text
        customer_message = await self._normalise_message(customer_message)

        system_prompt = self._build_system_prompt(ticket_type, context)

        start_ts = time.monotonic()
        try:
            response, input_tokens, output_tokens = await self._call_model(
                effective_model, system_prompt, customer_message
            )
        except anthropic.APIError as exc:
            log.error("model api error on first attempt", error=str(exc))
            raise

        verdict = await self._judge.score(
            customer_message=customer_message,
            resolution_path=resolution_path,
            model_response=response,
            ticket_type=ticket_type,
        )

        retried = False
        if verdict.any_non_negotiable_failed:
            log.warning(
                "non-negotiable violation detected — retrying with correction",
                failed_properties=[
                    pid
                    for pid, r in verdict.non_negotiable_results.items()
                    if not r.passed
                ],
            )
            retry_system_prompt = self._build_system_prompt(
                ticket_type, context, extra_addendum=_RETRY_ADDENDUM
            )
            try:
                response, retry_input, retry_output = await self._call_model(
                    effective_model, retry_system_prompt, customer_message
                )
                input_tokens += retry_input
                output_tokens += retry_output
                retried = True
                verdict = await self._judge.score(
                    customer_message=customer_message,
                    resolution_path=resolution_path,
                    model_response=response,
                    ticket_type=ticket_type,
                )
            except anthropic.APIError as exc:
                log.error("model api error on retry", error=str(exc))
                # Keep original response and verdict on retry failure

        elapsed_ms = int((time.monotonic() - start_ts) * 1000)
        total_tokens = input_tokens + output_tokens

        run_id = db.insert_run(
            model=effective_model,
            ticket_type=ticket_type,
            customer_message=customer_message,
            context=context,
            response=response,
            prompt_version=PROMPT_VERSION,
            latency_ms=elapsed_ms,
            total_tokens=total_tokens,
        )

        # Persist conformance results
        conformance_rows: list[dict[str, Any]] = []
        for prop_id, result in verdict.non_negotiable_results.items():
            conformance_rows.append(
                {
                    "property_name": prop_id,
                    "property_type": "negotiable",
                    "score": None,
                    "passed": result.passed,
                    "verdict_json": {"reasoning": result.reasoning},
                }
            )
        for prop_id, score_obj in verdict.behavioral_scores.items():
            conformance_rows.append(
                {
                    "property_name": prop_id,
                    "property_type": "behavioral",
                    "score": score_obj.score,
                    "passed": score_obj.score >= 0.5,
                    "verdict_json": {"reasoning": score_obj.reasoning},
                }
            )
        db.insert_conformance_results(run_id, conformance_rows)

        # Compute alert threshold violations
        spec = self._load_spec()
        alert_triggered = False
        property_scores = {
            prop_id: s.score for prop_id, s in verdict.behavioral_scores.items()
        }
        for bp in spec.get("behavioral_properties", []):
            prop_id = bp["id"]
            score_val = property_scores.get(prop_id, 1.0)
            if score_val < bp.get("alert_threshold", 0.0):
                alert_triggered = True
                break
        if verdict.any_non_negotiable_failed:
            alert_triggered = True

        db.insert_production_verdict(
            run_id=run_id,
            overall_score=verdict.overall_conformance,
            property_scores=property_scores,
            alert_triggered=alert_triggered,
        )

        log.info(
            "ticket handled",
            run_id=run_id,
            latency_ms=elapsed_ms,
            overall_conformance=verdict.overall_conformance,
            retried=retried,
            alert_triggered=alert_triggered,
        )

        return RunResult(
            run_id=run_id,
            model=effective_model,
            ticket_type=ticket_type,
            customer_message=customer_message,
            context=context,
            response=response,
            verdict=verdict,
            latency_ms=elapsed_ms,
            total_tokens=total_tokens,
            retried=retried,
            system_prompt=system_prompt,
            resolution_path=resolution_path,
        )
