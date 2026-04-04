"""Runs routes — baseline snapshots, trigger test suite, incidents."""
from __future__ import annotations

import anthropic
from fastapi import APIRouter, HTTPException

from backend.api.schemas import (
    Envelope,
    IncidentResponse,
    SnapshotResponse,
    TriggerSnapshotRequest,
)
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.services.drift import DriftEngine

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])
logger = get_logger(__name__)


def _get_drift_engine() -> DriftEngine:
    return DriftEngine(get_settings())


@router.get("/snapshots", response_model=Envelope[list[SnapshotResponse]])
async def get_snapshots() -> Envelope[list[SnapshotResponse]]:
    engine = _get_drift_engine()
    history = engine.get_history()
    items = [SnapshotResponse(**s.model_dump()) for s in history]
    return Envelope(data=items, meta={"count": len(items)})


@router.post("/snapshot", response_model=Envelope[SnapshotResponse], status_code=201)
async def trigger_snapshot(body: TriggerSnapshotRequest) -> Envelope[SnapshotResponse]:
    engine = _get_drift_engine()
    try:
        snapshot = await engine.run_test_suite(model=body.model)
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
        logger.error("unexpected error running test suite", error=str(exc), traceback=tb.format_exc())
        raise HTTPException(status_code=500, detail="Unexpected error. Check server logs for details.") from exc
    return Envelope(
        data=SnapshotResponse(**snapshot.model_dump()),
        meta={"model": body.model},
    )


@router.get("/incidents", response_model=Envelope[list[IncidentResponse]])
async def get_incidents() -> Envelope[list[IncidentResponse]]:
    engine = _get_drift_engine()
    history = engine.get_history()
    incidents = engine.detect_incidents(history)
    items = [IncidentResponse(**inc.model_dump()) for inc in incidents]
    return Envelope(data=items, meta={"count": len(items)})
