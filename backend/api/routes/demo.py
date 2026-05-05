"""Demo reset route — re-seeds synthetic history and clears live run data."""
from __future__ import annotations

from fastapi import APIRouter

from backend.api.schemas import Envelope
from backend.core import db
from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.services.drift import DriftEngine

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])
logger = get_logger(__name__)


@router.post("/reset", response_model=Envelope[dict[str, str]])
async def reset_demo() -> Envelope[dict[str, str]]:
    """Reset all live run data and re-seed synthetic history.

    Clears: runs, conformance_results, sessions, production_verdicts,
    chat_logs, baseline_snapshots, snapshot_examples.
    Then re-seeds 14 days of synthetic drift history and refreshes support data.
    Safe to call multiple times — fully idempotent.
    """
    logger.info("demo reset requested")
    db.reset_demo_data()

    config = get_settings()
    drift = DriftEngine(config)
    drift.seed_synthetic_history()

    logger.info("demo reset complete")
    return Envelope(data={"status": "ok", "message": "Demo data reset successfully"}, meta={})
