"""Runs routes — baseline snapshots, trigger test suite, incidents."""
from __future__ import annotations

import anthropic
from fastapi import APIRouter, HTTPException, Response

from backend.api.schemas import (
    Envelope,
    ExampleDiffEntry,
    IncidentResponse,
    SnapshotDiffResponse,
    SnapshotExampleItem,
    SnapshotResponse,
    TriggerSnapshotRequest,
)
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.services.drift import DriftEngine, compute_example_diff

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])
logger = get_logger(__name__)


def _get_drift_engine() -> DriftEngine:
    return DriftEngine(get_settings())


@router.get("/snapshots", response_model=Envelope[list[SnapshotResponse]])
async def get_snapshots(run_type: str | None = None) -> Envelope[list[SnapshotResponse]]:
    from backend.core import db as _db
    rows = _db.get_snapshots(run_type=run_type)
    items = [SnapshotResponse(**row) for row in rows]
    return Envelope(data=items, meta={"count": len(items)})


@router.post("/snapshot", response_model=Envelope[SnapshotResponse], status_code=201)
async def trigger_snapshot(body: TriggerSnapshotRequest) -> Envelope[SnapshotResponse]:
    engine = _get_drift_engine()
    try:
        snapshot = await engine.run_test_suite(model=body.model, run_type=body.run_type)
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


@router.delete("/snapshot/{snapshot_id}")
async def delete_snapshot(snapshot_id: int) -> Response:
    from backend.core import db as _db
    _db.delete_snapshot(snapshot_id)
    return Response(status_code=204)


@router.get("/snapshots/{snapshot_id}/examples", response_model=Envelope[list[SnapshotExampleItem]])
async def get_snapshot_examples(snapshot_id: int) -> Envelope[list[SnapshotExampleItem]]:
    from backend.core import db as _db
    rows = _db.get_snapshot_examples(snapshot_id)
    items = [SnapshotExampleItem(**row) for row in rows]
    return Envelope(data=items, meta={"snapshot_id": snapshot_id, "count": len(items)})



@router.get("/snapshots/{snapshot_id}/diff", response_model=Envelope[SnapshotDiffResponse])
async def get_snapshot_diff(snapshot_id: int) -> Envelope[SnapshotDiffResponse]:
    from backend.core import db as _db
    engine = _get_drift_engine()
    history = engine.get_history()  # ASC order

    target_idx = next((i for i, s in enumerate(history) if s.id == snapshot_id), None)
    if target_idx is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found")
    if target_idx == 0:
        raise HTTPException(status_code=409, detail="No previous snapshot to diff against — this is the earliest snapshot.")

    current_snap = history[target_idx]
    previous_snap = history[target_idx - 1]

    current_examples = {e["corpus_example_id"]: e for e in _db.get_snapshot_examples(snapshot_id)}
    previous_examples = {e["corpus_example_id"]: e for e in _db.get_snapshot_examples(previous_snap.id)}  # type: ignore[arg-type]

    if not current_examples:
        raise HTTPException(status_code=409, detail="Snapshot has no per-example data — it predates this feature.")

    raw = compute_example_diff(previous_examples, current_examples)
    newly_failed  = [ExampleDiffEntry(**e) for e in raw[0]]
    newly_recovered = [ExampleDiffEntry(**e) for e in raw[1]]
    degraded      = [ExampleDiffEntry(**e) for e in raw[2]]
    improved      = [ExampleDiffEntry(**e) for e in raw[3]]
    total_changed = len(newly_failed) + len(newly_recovered) + len(degraded) + len(improved)

    diff = SnapshotDiffResponse(
        snapshot_id=snapshot_id,
        previous_snapshot_id=previous_snap.id,  # type: ignore[arg-type]
        snapshot_created_at=current_snap.created_at,
        previous_snapshot_created_at=previous_snap.created_at,
        newly_failed=newly_failed,
        newly_recovered=newly_recovered,
        degraded=degraded,
        improved=improved,
        total_changed=total_changed,
        summary={
            "newly_failed": len(newly_failed),
            "newly_recovered": len(newly_recovered),
            "degraded": len(degraded),
            "improved": len(improved),
        },
    )
    return Envelope(data=diff, meta={"snapshot_id": snapshot_id})


@router.get("/incidents", response_model=Envelope[list[IncidentResponse]])
async def get_incidents() -> Envelope[list[IncidentResponse]]:
    engine = _get_drift_engine()
    history = engine.get_history()
    incidents = engine.detect_incidents(history)
    items = [IncidentResponse(**inc.model_dump()) for inc in incidents]
    return Envelope(data=items, meta={"count": len(items)})
