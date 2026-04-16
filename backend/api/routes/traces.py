"""Traces routes — list runs, get individual run detail, submit tickets."""
from __future__ import annotations

import anthropic
from fastapi import APIRouter, HTTPException

from backend.api.schemas import (
    Envelope,
    RunDetailResponse,
    RunListItem,
    RunResponse,
    SubmitTicketRequest,
)
from backend.core import db
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.services.alerts import send_alert
from backend.services.judge import JudgeService
from backend.services.runtime import CustomerSupportRuntime

router = APIRouter(prefix="/api/v1/traces", tags=["traces"])
logger = get_logger(__name__)


def _get_runtime() -> CustomerSupportRuntime:
    config = get_settings()
    judge = JudgeService(config)
    return CustomerSupportRuntime(config, judge)


@router.get("/", response_model=Envelope[list[RunListItem]])
async def list_traces() -> Envelope[list[RunListItem]]:
    rows = db.get_recent_runs(limit=50)
    items = [RunListItem(**row) for row in rows]
    return Envelope(data=items, meta={"count": len(items)})


@router.get("/{run_id}", response_model=Envelope[RunDetailResponse])
async def get_trace(run_id: int) -> Envelope[RunDetailResponse]:
    row = db.get_run_by_id(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    detail = RunDetailResponse(**row)
    return Envelope(data=detail, meta={})


@router.post("/", response_model=Envelope[RunResponse], status_code=201)
async def submit_ticket(body: SubmitTicketRequest) -> Envelope[RunResponse]:
    runtime = _get_runtime()
    try:
        result = await runtime.handle_ticket(
            customer_message=body.customer_message,
            ticket_type=body.ticket_type,
            context=body.context,
            model=body.model,
            conversation_history=[t.model_dump() for t in body.conversation_history],
            session_id=body.session_id,
            scenario_id=body.scenario_id,
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
        logger.error("unexpected error handling ticket", error=str(exc), traceback=tb.format_exc())
        raise HTTPException(status_code=500, detail="Unexpected error. Check server logs for details.") from exc

    # Fire alert if any threshold was breached — non-blocking, never raises
    if result.verdict.any_non_negotiable_failed or any(
        s.score < 0.8 for s in result.verdict.behavioral_scores.values()
    ):
        worst_prop = min(
            result.verdict.behavioral_scores.items(),
            key=lambda kv: kv[1].score,
            default=None,
        )
        alert_message = (
            f"Ticket type: {result.ticket_type} | "
            f"Overall conformance: {result.verdict.overall_conformance:.2%} | "
            f"Run #{result.run_id}"
        )
        if worst_prop:
            alert_message += f" | Lowest property: {worst_prop[0]} ({worst_prop[1].score:.2%})"
        alert_severity = "critical" if result.verdict.any_non_negotiable_failed else "warning"
        await send_alert(
            title=f"GlassBox conformance alert — {result.ticket_type}",
            message=alert_message,
            severity=alert_severity,
        )

    from backend.api.schemas import ToolCall

    run_response = RunResponse(
        run_id=result.run_id,
        session_id=result.session_id,
        turn_number=result.turn_number,
        model=result.model,
        ticket_type=result.ticket_type,
        customer_message=result.customer_message,
        response=result.response,
        verdict=result.verdict,
        latency_ms=result.latency_ms,
        total_tokens=result.total_tokens,
        retried=result.retried,
        prompt_version=result.prompt_version,
        system_prompt=result.system_prompt,
        resolution_path=result.resolution_path,
        tool_calls=[ToolCall(**tc) for tc in result.tool_calls],
    )
    return Envelope(data=run_response, meta={"model": result.model, "session_id": result.session_id})
