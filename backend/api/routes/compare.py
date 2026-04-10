"""Compare routes — side-by-side model comparison with cost estimates."""
from __future__ import annotations

import anthropic
import asyncio

from fastapi import APIRouter, HTTPException

from backend.api.schemas import (
    CompareRequest,
    CompareResponse,
    CostEstimate,
    Envelope,
    ModelCompareResult,
    SnapshotResponse,
)
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.services.drift import DriftEngine

router = APIRouter(prefix="/api/v1/compare", tags=["compare"])
logger = get_logger(__name__)

# Token pricing per 1M tokens (USD)
_PRICING: dict[str, dict[str, float]] = {
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5": {"input": 0.25, "output": 1.25},
    # Fallback for unknown models — treat as Haiku pricing
    "__default__": {"input": 0.25, "output": 1.25},
}


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> CostEstimate:
    pricing = _PRICING.get(model, _PRICING["__default__"])
    cost = (input_tokens / 1_000_000) * pricing["input"] + (
        output_tokens / 1_000_000
    ) * pricing["output"]
    return CostEstimate(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        estimated_cost_usd=round(cost, 6),
    )


async def _run_suite_for_model(engine: DriftEngine, model: str) -> ModelCompareResult:
    snapshot = await engine.run_test_suite(model=model, run_type="compare")

    # Derive non-negotiable pass rates from snapshot non_neg summary
    non_neg_pass_rates: dict[str, float] = {}
    for prop_id, summary in snapshot.non_negotiable_results.items():
        if isinstance(summary, dict) and "pass_rate" in summary:
            non_neg_pass_rates[prop_id] = summary["pass_rate"]

    cost_estimate = _estimate_cost(model, snapshot.input_tokens, snapshot.output_tokens)

    return ModelCompareResult(
        model=model,
        overall_conformance=snapshot.overall_conformance,
        property_scores=snapshot.property_scores,
        non_negotiable_pass_rates=non_neg_pass_rates,
        cost_estimate=cost_estimate,
        snapshot=SnapshotResponse(**snapshot.model_dump()),
    )


@router.post("/", response_model=Envelope[CompareResponse])
async def compare_models(body: CompareRequest) -> Envelope[CompareResponse]:
    if not body.models:
        raise HTTPException(status_code=422, detail="At least one model must be specified")

    config = get_settings()
    engine = DriftEngine(config)

    logger.info("starting model comparison", models=body.models)
    try:
        results: list[ModelCompareResult] = await asyncio.gather(
            *[_run_suite_for_model(engine, m) for m in body.models]
        )
    except anthropic.AuthenticationError:
        logger.error("anthropic authentication error — check ANTHROPIC_API_KEY")
        raise HTTPException(status_code=500, detail="Authentication failed — check your API key configuration.")
    except anthropic.RateLimitError:
        logger.warning("anthropic rate limit hit")
        raise HTTPException(status_code=429, detail="Rate limit reached. Please wait a moment and try again.")
    except anthropic.APIStatusError as exc:
        logger.error("anthropic api error", status_code=exc.status_code, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Model API error ({exc.status_code}). Please try again.")
    except ValueError as exc:
        logger.error("validation error", error=str(exc))
        raise HTTPException(status_code=422, detail=f"Invalid request: {exc}")
    except Exception as exc:
        import traceback as tb
        logger.error("unexpected error during model comparison", error=str(exc), traceback=tb.format_exc())
        raise HTTPException(status_code=500, detail="Unexpected error. Check server logs for details.") from exc

    # Determine winner by overall conformance
    winner: str | None = None
    winner_reason: str | None = None
    if results and len(results) >= 2:
        best = max(results, key=lambda r: r.overall_conformance)
        other = min(results, key=lambda r: r.overall_conformance)
        winner = best.model
        overall_delta = round((best.overall_conformance - other.overall_conformance) * 100, 1)

        # Find the property with the largest gap
        prop_deltas = {
            prop: round((best.property_scores.get(prop, 0) - other.property_scores.get(prop, 0)) * 100, 1)
            for prop in best.property_scores
        }
        biggest_prop = max(prop_deltas, key=lambda p: abs(prop_deltas[p]), default=None)
        prop_names = {
            "issue_acknowledged": "Issue Acknowledged",
            "resolution_matching": "Resolution Matching",
            "professional_tone": "Professional Tone",
            "concise_response": "Concise Response",
        }

        winner_model_short = best.model.split("-")[1].capitalize() if "-" in best.model else best.model

        reason = (
            f"{winner_model_short} leads by {overall_delta}pp overall "
            f"({best.overall_conformance * 100:.1f}% vs {other.overall_conformance * 100:.1f}%)."
        )
        if biggest_prop:
            gap = prop_deltas[biggest_prop]
            prop_label = prop_names.get(biggest_prop, biggest_prop)
            reason += f" Biggest gap: {prop_label} (+{abs(gap):.1f}pp)."
        winner_reason = reason

    compare_response = CompareResponse(models=list(results), winner=winner, winner_reason=winner_reason)
    return Envelope(
        data=compare_response,
        meta={"models_compared": body.models},
    )
