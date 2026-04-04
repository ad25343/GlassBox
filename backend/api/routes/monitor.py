"""Monitor routes — production conformance status, verdicts, alerts."""
from __future__ import annotations

from fastapi import APIRouter

from backend.api.schemas import Envelope, MonitorStatus, VerdictResponse
from backend.core import db
from backend.core.logging import get_logger

router = APIRouter(prefix="/api/v1/monitor", tags=["monitor"])
logger = get_logger(__name__)


@router.get("/status", response_model=Envelope[MonitorStatus])
async def get_monitor_status() -> Envelope[MonitorStatus]:
    verdicts = db.get_recent_verdicts(limit=50)

    if not verdicts:
        status = MonitorStatus(
            overall_conformance_rate=0.0,
            category_breakdown={},
            alert_count=0,
            total_verdicts=0,
        )
        return Envelope(data=status, meta={})

    overall_rate = round(
        sum(v["overall_score"] for v in verdicts) / len(verdicts), 4
    )

    # Aggregate per-property averages across recent verdicts
    property_accumulator: dict[str, list[float]] = {}
    for verdict in verdicts:
        for prop_id, score in verdict.get("property_scores", {}).items():
            property_accumulator.setdefault(prop_id, []).append(score)

    category_breakdown: dict[str, float] = {
        prop_id: round(sum(scores) / len(scores), 4)
        for prop_id, scores in property_accumulator.items()
    }

    alert_count = sum(1 for v in verdicts if v.get("alert_triggered"))

    status = MonitorStatus(
        overall_conformance_rate=overall_rate,
        category_breakdown=category_breakdown,
        alert_count=alert_count,
        total_verdicts=len(verdicts),
    )
    return Envelope(data=status, meta={"window": "last_50"})


@router.get("/verdicts", response_model=Envelope[list[VerdictResponse]])
async def get_verdicts() -> Envelope[list[VerdictResponse]]:
    verdicts = db.get_recent_verdicts(limit=50)
    items = [VerdictResponse(**v) for v in verdicts]
    return Envelope(data=items, meta={"count": len(items)})


@router.get("/alerts", response_model=Envelope[list[VerdictResponse]])
async def get_alerts() -> Envelope[list[VerdictResponse]]:
    verdicts = db.get_recent_verdicts(limit=50)
    alert_items = [VerdictResponse(**v) for v in verdicts if v.get("alert_triggered")]
    return Envelope(data=alert_items, meta={"count": len(alert_items)})
