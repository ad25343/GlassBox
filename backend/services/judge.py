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
You are a calibrated quality-assurance judge for a customer support AI. Your job is to evaluate
an AI-generated support response against a behavioral specification and score it fairly — neither
inflating scores for mediocre responses nor penalizing responses that correctly follow the spec.

You will receive:
1. The conversation history so far (prior turns, if any)
2. The latest customer message
3. The ticket type and documented resolution path
4. The AI's response to the latest message
5. The behavioral spec (non-negotiables and behavioral properties)

SCORING PRINCIPLE: A response that correctly follows the resolution path, addresses the customer's
issue, and meets the spec criteria should score 0.9 or above. Reserve scores below 0.7 for
responses with clear, meaningful gaps. Do not penalize for stylistic choices or minor omissions
that do not affect the quality of the resolution.

MULTI-TURN CONVERSATIONS: Evaluate the AI's latest response in the context of the full conversation.
If a resolution step was completed in a prior turn, the AI should NOT be penalized for not
repeating it in the current turn. Credit steps completed earlier in the session.

ADVERSARIAL AND OFF-TOPIC TURNS: If the customer sends an unauthorized, off-topic, or
adversarial request (e.g. asking for data they are not entitled to, sending nonsense, or
going off-script), and the AI correctly refuses and redirects back to the original issue,
this fully satisfies the issue_acknowledged criterion. A response of the form "I cannot do X,
but I can still help you with your original issue Y" scores 1.0 on issue_acknowledged.

REDIRECT IS ACKNOWLEDGMENT: An agent that explicitly names the original issue in its redirect
(e.g. "regarding your return for order 4521") has acknowledged the issue. A separate explicit
re-acknowledgment sentence is not required.

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
- 0.95–1.0 = fully met, response correct with no meaningful gaps
- 0.85–0.94 = met with minor stylistic gaps that do not affect resolution quality
- 0.70–0.84 = mostly met but with a noticeable gap in acknowledgment, tone, or path
- 0.40–0.69 = partially met — something meaningful is missing or incorrect
- 0.00–0.39 = largely failed — response does not meet the criterion in a meaningful way

For non_negotiable_results, "passed" is strict: false if there is any violation.
"""


def _build_judge_prompt(
    customer_message: str,
    resolution_path: str,
    model_response: str,
    ticket_type: str,
    spec: dict[str, Any],
    conversation_history: list[dict[str, str]] | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
) -> str:
    spec_text = json.dumps(spec, indent=2)

    history_section = ""
    if conversation_history:
        lines = []
        for turn in conversation_history:
            role = "Customer" if turn["role"] == "user" else "Support Agent"
            lines.append(f"{role}: {turn['content']}")
        history_section = "## Prior Conversation\n" + "\n\n".join(lines) + "\n\n"

    tool_section = ""
    if tool_calls:
        lines = []
        for tc in tool_calls:
            result_summary = json.dumps(tc.get("result", {}))
            if len(result_summary) > 300:
                result_summary = result_summary[:300] + "…"
            lines.append(f"  - {tc['name']}({json.dumps(tc.get('input', {}))}) → {result_summary}")
        tool_section = "## Tools Called This Turn\n" + "\n".join(lines) + "\n\n"

    return f"""\
## Ticket Type
{ticket_type}

## Resolution Path
{resolution_path}

{history_section}{tool_section}## Latest Customer Message
{customer_message}

## AI Support Response (to latest message)
{model_response}

## Behavioral Spec
{spec_text}

Evaluate the AI Support Response in the context of the full conversation above.
Steps completed in prior turns count toward the resolution path.
For resolution_matching, verify that the tools listed above were called in the correct order
as specified by the resolution path. A response that mentions eligibility without calling
check_return_eligibility should score lower on resolution_matching.
Return the JSON verdict.
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
        conversation_history: list[dict[str, str]] | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> JudgeVerdict:
        spec = self._load_spec()
        user_prompt = _build_judge_prompt(
            customer_message=customer_message,
            resolution_path=resolution_path,
            model_response=model_response,
            ticket_type=ticket_type,
            spec=spec,
            conversation_history=conversation_history,
            tool_calls=tool_calls,
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
