"""Cost and latency routes — aggregate token usage and response time stats."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.api.schemas import Envelope
from backend.core import db
from backend.core.logging import get_logger

router = APIRouter(prefix="/api/v1/cost", tags=["cost"])
logger = get_logger(__name__)


@router.get("/summary", response_model=Envelope[dict[str, Any]])
async def get_cost_summary() -> Envelope[dict[str, Any]]:
    """Return aggregate cost and latency stats from all runs.

    Includes overall stats, per-model breakdown, and a 14-day daily series.
    Token prices are read from INPUT_TOKEN_PRICE / OUTPUT_TOKEN_PRICE in config
    (set via .env — defaults to Sonnet pricing).
    """
    summary = db.get_cost_summary()
    return Envelope(data=summary, meta={})
