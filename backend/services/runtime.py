"""Customer support runtime — orchestrates the agent loop, judge scoring, and persistence."""
from __future__ import annotations

import json
import time
from typing import Any, Callable

import anthropic
from pydantic import BaseModel

from backend.core import db
from backend.core.config import Settings
from backend.core.logging import get_logger
from backend.services.agent import AgentService
from backend.services.judge import JudgeService, JudgeVerdict
from backend.services.log_writer import ChatLogWriter

logger = get_logger(__name__)

PROMPT_VERSION = "2.0.0"

_SYSTEM_TEMPLATE = """\
You are a {agent_role}.
{agent_task}

## Non-Negotiable Rules
{non_negotiables}

## Resolution Path for This Ticket Type
{resolution_path}

## Your Tools
You have access to real-time tools that query the support database. Always use tools to look
up customer and order information — never guess, assume, or fabricate details.

Available tools:
{tools}

## Conversation Style
{conversation_style}
{context_note}\
"""


class RunResult(BaseModel):
    model_config = {"extra": "ignore"}

    run_id: int
    session_id: str
    turn_number: int
    model: str
    ticket_type: str
    customer_message: str
    context: dict[str, Any]
    response: str
    verdict: JudgeVerdict
    latency_ms: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    retried: bool
    prompt_version: str = PROMPT_VERSION
    system_prompt: str
    resolution_path: str
    tool_calls: list[dict[str, Any]] = []


class CustomerSupportRuntime:
    def __init__(self, config: Settings, judge: JudgeService) -> None:
        self._config = config
        self._judge = judge
        self._agent = AgentService(config)
        self._log_writer = ChatLogWriter()
        self._client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
        self._spec: dict[str, Any] | None = None

    def _load_spec(self) -> dict[str, Any]:
        if self._spec is None:
            with open("spec.json") as fh:
                self._spec = json.load(fh)
        return self._spec

    def _get_resolution_path(self, spec: dict[str, Any], ticket_type: str) -> str:
        """Return the resolution path for a ticket type from spec, with a safe fallback."""
        return spec.get("resolution_paths", {}).get(
            ticket_type,
            "Assist the customer with their request following standard support procedures.",
        )

    def _build_system_prompt(
        self,
        ticket_type: str,
        context: dict[str, Any],
        use_tools: bool = True,
        extra_addendum: str = "",
    ) -> str:
        spec = self._load_spec()

        # Non-negotiables from spec
        non_neg_lines = []
        for nn in spec.get("non_negotiables", []):
            non_neg_lines.append(f"- [{nn['id']}] {nn['name']}: {nn['description']}")
        non_negotiables_text = "\n".join(non_neg_lines)

        # Resolution path from spec (per ticket type)
        resolution_path = self._get_resolution_path(spec, ticket_type)

        # Explicit escalation flag — injected when context signals a repeat contact
        # so the model doesn't have to parse the JSON and infer the rule itself.
        escalation_flag = ""
        if context.get("previous_contacts", 0) >= 1:
            escalation_flag = (
                "\n⚠️  ESCALATION ALERT: This customer has contacted support before "
                f"(previous_contacts = {context['previous_contacts']}). "
                "If they express ANY frustration or urgency, escalate to a human agent immediately "
                "— do NOT attempt to resolve the issue yourself.\n"
            )

        # Context block
        if use_tools and not context:
            context_note = "\n## Pre-loaded Context\nNone — use your tools to look up customer information.\n"
        elif context:
            context_note = f"{escalation_flag}\n## Pre-loaded Context\n{json.dumps(context, indent=2)}\n"
        else:
            context_note = escalation_flag

        # Agent persona from spec
        agent = spec.get("agent", {})
        agent_role = agent.get("role", "professional customer support agent")
        agent_task = agent.get("task", "Help customers with their support requests.")

        if use_tools:
            # Tool list from spec
            tool_lines = []
            for t in spec.get("tools", []):
                tool_lines.append(f"- {t['signature']} — {t['description']}")
            tools_text = "\n".join(tool_lines) if tool_lines else "No tools configured."

            # Conversation style from spec
            style_items = agent.get("conversation_style", [])
            style_text = "\n".join(f"- {s}" for s in style_items) if style_items else ""

            prompt = _SYSTEM_TEMPLATE.format(
                agent_role=agent_role,
                agent_task=agent_task,
                non_negotiables=non_negotiables_text,
                resolution_path=resolution_path,
                tools=tools_text,
                conversation_style=style_text,
                context_note=context_note,
            )
        else:
            # Simpler prompt for test suite / drift (no tool invocation)
            prompt = (
                f"You are a {agent_role}.\n\n"
                f"## Behavioral Rules (Non-Negotiable)\n{non_negotiables_text}\n\n"
                f"## Resolution Path for This Ticket Type\n{resolution_path}\n\n"
                f"## Customer Context\n{json.dumps(context, indent=2)}\n\n"
                f"Always acknowledge the customer's issue before offering a resolution. "
                f"Keep your response concise and professional.\n"
            )

        if extra_addendum:
            prompt += extra_addendum
        return prompt

    async def _call_model(
        self,
        model: str,
        system_prompt: str,
        customer_message: str,
        conversation_history: list[dict[str, str]] | None = None,
    ) -> tuple[str, int, int]:
        """Direct model call (no tools) — used by test suite / drift detection."""
        messages: list[dict[str, str]] = []
        if conversation_history:
            messages.extend(conversation_history)
        messages.append({"role": "user", "content": customer_message})

        message = await self._client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        )
        response_text = message.content[0].text
        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens
        return response_text, input_tokens, output_tokens

    async def _normalise_message(self, raw: str) -> str:
        """Fix spelling and grammar using Haiku — preserves meaning, only fixes errors."""
        try:
            msg = await self._client.messages.create(
                model=self._config.JUDGE_MODEL,
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
        conversation_history: list[dict[str, str]] | None = None,
        session_id: str | None = None,
        scenario_id: str = "",
        use_tools: bool = True,
        tool_executor: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
    ) -> RunResult:
        effective_model = model or self._config.PRODUCTION_MODEL
        spec = self._load_spec()
        resolution_path = self._get_resolution_path(spec, ticket_type)

        # Resolve or create session
        if session_id and db.get_session(session_id) is not None:
            turn_number = db.get_session_turn_count(session_id) + 1
        else:
            session_id = db.create_session(
                ticket_type=ticket_type,
                scenario_id=scenario_id,
                context=context,
            )
            turn_number = 1

        log = logger.bind(
            model=effective_model,
            ticket_type=ticket_type,
            session_id=session_id,
            turn=turn_number,
            use_tools=use_tools,
        )
        log.info("handling ticket")

        # Silently fix typos/grammar — model and judge always see clean text
        customer_message = await self._normalise_message(customer_message)

        system_prompt = self._build_system_prompt(ticket_type, context, use_tools=use_tools)
        tool_calls: list[dict[str, Any]] = []

        start_ts = time.monotonic()
        try:
            if use_tools:
                response, tool_calls, input_tokens, output_tokens = await self._agent.run_turn(
                    model=effective_model,
                    system_prompt=system_prompt,
                    customer_message=customer_message,
                    conversation_history=conversation_history,
                    tool_executor=tool_executor,
                )
            else:
                response, input_tokens, output_tokens = await self._call_model(
                    effective_model, system_prompt, customer_message, conversation_history
                )
        except anthropic.APIError as exc:
            log.error("model api error on first attempt", error=str(exc))
            raise

        verdict = await self._judge.score(
            customer_message=customer_message,
            resolution_path=resolution_path,
            model_response=response,
            ticket_type=ticket_type,
            conversation_history=conversation_history,
            tool_calls=tool_calls,
        )

        retried = False
        if verdict.any_non_negotiable_failed:
            log.warning(
                "non-negotiable violation — retrying with correction",
                failed=[pid for pid, r in verdict.non_negotiable_results.items() if not r.passed],
            )
            retry_addendum = "\n\n" + spec.get("retry_addendum", "IMPORTANT: Revise your response to comply with all non-negotiable rules.")
            retry_system_prompt = self._build_system_prompt(
                ticket_type, context, use_tools=use_tools, extra_addendum=retry_addendum
            )
            try:
                if use_tools:
                    response, retry_tool_calls, retry_input, retry_output = (
                        await self._agent.run_turn(
                            model=effective_model,
                            system_prompt=retry_system_prompt,
                            customer_message=customer_message,
                            conversation_history=conversation_history,
                            tool_executor=tool_executor,
                        )
                    )
                    tool_calls = tool_calls + retry_tool_calls
                else:
                    response, retry_input, retry_output = await self._call_model(
                        effective_model, retry_system_prompt, customer_message, conversation_history
                    )
                input_tokens += retry_input
                output_tokens += retry_output
                retried = True
                verdict = await self._judge.score(
                    customer_message=customer_message,
                    resolution_path=resolution_path,
                    model_response=response,
                    ticket_type=ticket_type,
                    conversation_history=conversation_history,
                    tool_calls=tool_calls,
                )
            except anthropic.APIError as exc:
                log.error("model api error on retry", error=str(exc))

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
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            retried=retried,
            conversation_history=conversation_history,
            session_id=session_id,
            turn_number=turn_number,
        )

        # Conformance results
        conformance_rows: list[dict[str, Any]] = []
        for prop_id, result in verdict.non_negotiable_results.items():
            conformance_rows.append({
                "property_name": prop_id,
                "property_type": "negotiable",
                "score": None,
                "passed": result.passed,
                "verdict_json": {"reasoning": result.reasoning},
            })
        for prop_id, score_obj in verdict.behavioral_scores.items():
            conformance_rows.append({
                "property_name": prop_id,
                "property_type": "behavioral",
                "score": score_obj.score,
                "passed": score_obj.score >= 0.5,
                "verdict_json": {"reasoning": score_obj.reasoning},
            })
        db.insert_conformance_results(run_id, conformance_rows)

        # Alert threshold
        alert_triggered = verdict.any_non_negotiable_failed
        property_scores = {pid: s.score for pid, s in verdict.behavioral_scores.items()}
        for bp in spec.get("behavioral_properties", []):
            if property_scores.get(bp["id"], 1.0) < bp.get("alert_threshold", 0.0):
                alert_triggered = True
                break

        db.insert_production_verdict(
            run_id=run_id,
            overall_score=verdict.overall_conformance,
            property_scores=property_scores,
            alert_triggered=alert_triggered,
        )

        # Async chat log hydration — non-blocking, fires after response is returned
        if use_tools:
            verdict_summary = {
                "overall_conformance": verdict.overall_conformance,
                "any_non_negotiable_failed": verdict.any_non_negotiable_failed,
                "property_scores": property_scores,
                "non_negotiable_results": {
                    k: {"passed": v.passed, "reasoning": v.reasoning}
                    for k, v in verdict.non_negotiable_results.items()
                },
                "behavioral_scores": {
                    k: {"score": v.score, "reasoning": v.reasoning}
                    for k, v in verdict.behavioral_scores.items()
                },
            }
            self._log_writer.schedule_write(
                session_id=session_id,
                run_id=run_id,
                turn_number=turn_number,
                ticket_type=ticket_type,
                customer_message=customer_message,
                tool_calls=tool_calls,
                response=response,
                verdict_summary=verdict_summary,
            )

        log.info(
            "ticket handled",
            run_id=run_id,
            latency_ms=elapsed_ms,
            overall_conformance=verdict.overall_conformance,
            tool_call_count=len(tool_calls),
            retried=retried,
            alert_triggered=alert_triggered,
        )

        return RunResult(
            run_id=run_id,
            session_id=session_id,
            turn_number=turn_number,
            model=effective_model,
            ticket_type=ticket_type,
            customer_message=customer_message,
            context=context,
            response=response,
            verdict=verdict,
            latency_ms=elapsed_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            retried=retried,
            system_prompt=system_prompt,
            resolution_path=resolution_path,
            tool_calls=tool_calls,
        )
