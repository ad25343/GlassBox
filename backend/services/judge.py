"""Judge model — scores responses against the behavioral spec."""
from __future__ import annotations

import json
import re
from typing import Any

import anthropic
from pydantic import BaseModel

from backend.core.config import Settings
from backend.core.logging import get_logger

logger = get_logger(__name__)


class NonNegotiableResult(BaseModel):
    model_config = {"extra": "ignore"}

    passed: bool
    reasoning: str


class BehavioralScore(BaseModel):
    model_config = {"extra": "ignore"}

    score: float
    reasoning: str


class JudgeVerdict(BaseModel):
    model_config = {"extra": "ignore"}

    non_negotiable_results: dict[str, NonNegotiableResult]
    behavioral_scores: dict[str, BehavioralScore]
    overall_conformance: float
    any_non_negotiable_failed: bool


_JUDGE_SYSTEM = """\
You are a strict quality-assurance judge for a customer support AI. Your job is to evaluate
an AI-generated support response against a behavioral specification.

You will receive:
1. The customer message
2. The ticket type and documented resolution path
3. The AI's response
4. The behavioral spec (non-negotiables and behavioral properties)

You must return ONLY a valid JSON object — no commentary, no markdown fences.

JSON schema:
{
  "non_negotiable_results": {
    "<property_id>": {
      "passed": true | false,
      "reasoning": "<1-2 sentence explanation>"
    }
  },
  "behavioral_scores": {
    "<property_id>": {
      "score": <0.0 to 1.0>,
      "reasoning": "<1-2 sentence explanation>"
    }
  }
}

Scoring guidance for behavioral_scores:
- 1.0 = fully met
- 0.7-0.9 = mostly met with minor gaps
- 0.4-0.6 = partially met
- 0.0-0.3 = largely failed

For non_negotiable_results, "passed" is strict: false if there is any violation.
"""


def _build_judge_prompt(
    customer_message: str,
    resolution_path: str,
    model_response: str,
    ticket_type: str,
    spec: dict[str, Any],
) -> str:
    spec_text = json.dumps(spec, indent=2)
    return f"""\
## Ticket Type
{ticket_type}

## Resolution Path
{resolution_path}

## Customer Message
{customer_message}

## AI Support Response
{model_response}

## Behavioral Spec
{spec_text}

Evaluate the AI Support Response against the spec and return the JSON verdict.
"""


def _extract_json(text: str) -> dict[str, Any]:
    """Strip markdown fences if present and parse JSON."""
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ``` wrappers
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


class JudgeService:
    def __init__(self, config: Settings) -> None:
        self._config = config
        self._client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
        self._model = config.JUDGE_MODEL
        self._spec: dict[str, Any] | None = None

    def _load_spec(self) -> dict[str, Any]:
        if self._spec is None:
            with open("spec.json") as fh:
                self._spec = json.load(fh)
        return self._spec

    async def score(
        self,
        customer_message: str,
        resolution_path: str,
        model_response: str,
        ticket_type: str,
    ) -> JudgeVerdict:
        spec = self._load_spec()
        user_prompt = _build_judge_prompt(
            customer_message=customer_message,
            resolution_path=resolution_path,
            model_response=model_response,
            ticket_type=ticket_type,
            spec=spec,
        )
        log = logger.bind(ticket_type=ticket_type, judge_model=self._model)
        log.debug("sending request to judge model")

        try:
            message = await self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=_JUDGE_SYSTEM,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except anthropic.APIError as exc:
            log.error("judge api error", error=str(exc))
            raise

        raw_text = message.content[0].text
        log.debug("received judge response", raw_length=len(raw_text))

        try:
            payload = _extract_json(raw_text)
        except (json.JSONDecodeError, ValueError) as exc:
            log.error("failed to parse judge response", error=str(exc), raw_text=raw_text)
            raise ValueError(f"Judge returned unparseable response: {exc}") from exc

        non_neg_raw: dict[str, Any] = payload.get("non_negotiable_results", {})
        behavioral_raw: dict[str, Any] = payload.get("behavioral_scores", {})

        # Fill in any missing spec properties with default passing values so we
        # don't crash on partial judge responses.
        non_neg_results: dict[str, NonNegotiableResult] = {}
        for nn in spec.get("non_negotiables", []):
            prop_id = nn["id"]
            if prop_id in non_neg_raw:
                non_neg_results[prop_id] = NonNegotiableResult(**non_neg_raw[prop_id])
            else:
                log.warning("judge missing non_negotiable result", property_id=prop_id)
                non_neg_results[prop_id] = NonNegotiableResult(
                    passed=True, reasoning="Not evaluated by judge"
                )

        behavioral_scores: dict[str, BehavioralScore] = {}
        for bp in spec.get("behavioral_properties", []):
            prop_id = bp["id"]
            if prop_id in behavioral_raw:
                behavioral_scores[prop_id] = BehavioralScore(**behavioral_raw[prop_id])
            else:
                log.warning("judge missing behavioral score", property_id=prop_id)
                behavioral_scores[prop_id] = BehavioralScore(
                    score=0.5, reasoning="Not evaluated by judge"
                )

        overall = (
            sum(bs.score for bs in behavioral_scores.values()) / len(behavioral_scores)
            if behavioral_scores
            else 0.0
        )
        any_failed = any(not r.passed for r in non_neg_results.values())

        verdict = JudgeVerdict(
            non_negotiable_results=non_neg_results,
            behavioral_scores=behavioral_scores,
            overall_conformance=round(overall, 4),
            any_non_negotiable_failed=any_failed,
        )
        log.info(
            "judge verdict",
            overall_conformance=verdict.overall_conformance,
            any_non_negotiable_failed=verdict.any_non_negotiable_failed,
        )
        return verdict
