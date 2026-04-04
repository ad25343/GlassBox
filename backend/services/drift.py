"""Drift detection engine — synthetic history, test suite runs, delta computation."""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel

from backend.core import db
from backend.core.config import Settings
from backend.core.logging import get_logger

logger = get_logger(__name__)

CORPUS_VERSION = "1.0.0"
PROMPT_VERSION = "1.0.0"


class SnapshotResult(BaseModel):
    model_config = {"extra": "ignore"}

    id: int | None = None
    created_at: str
    model: str
    prompt_version: str
    corpus_version: str
    overall_conformance: float
    property_scores: dict[str, float]
    non_negotiable_results: dict[str, Any]


class DriftDelta(BaseModel):
    model_config = {"extra": "ignore"}

    property_id: str
    baseline_score: float
    current_score: float
    delta: float
    direction: str  # "up" | "down" | "stable"


class Incident(BaseModel):
    model_config = {"extra": "ignore"}

    snapshot_id: int | None
    created_at: str
    model: str
    property_id: str
    score: float
    alert_threshold: float
    delta_from_baseline: float | None = None


def _load_spec() -> dict[str, Any]:
    with open("spec.json") as fh:
        return json.load(fh)


def _load_corpus() -> list[dict[str, Any]]:
    with open("corpus.json") as fh:
        return json.load(fh)


# Synthetic history parameters
# Each entry: (day_offset, overall, issue_ack, resolution, tone, concise)
_SYNTHETIC_DAYS: list[tuple[int, float, float, float, float, float]] = [
    (1, 0.912, 0.960, 0.910, 0.890, 0.830),
    (2, 0.914, 0.958, 0.912, 0.891, 0.832),
    (3, 0.910, 0.962, 0.908, 0.888, 0.828),
    (4, 0.913, 0.961, 0.911, 0.890, 0.831),
    (5, 0.915, 0.963, 0.913, 0.892, 0.834),
    (6, 0.911, 0.959, 0.909, 0.889, 0.829),
    (7, 0.912, 0.960, 0.910, 0.891, 0.830),
    # Day 8: escalation behavior simulated — resolution drops to 0.74
    (8, 0.852, 0.955, 0.740, 0.885, 0.828),
    # Days 9-11: partial recovery
    (9, 0.868, 0.957, 0.790, 0.887, 0.829),
    (10, 0.877, 0.959, 0.810, 0.889, 0.830),
    (11, 0.882, 0.960, 0.820, 0.890, 0.831),
    # Day 12: dip again
    (12, 0.871, 0.958, 0.790, 0.888, 0.828),
    # Days 13-14: stabilize near baseline
    (13, 0.899, 0.960, 0.895, 0.890, 0.830),
    (14, 0.908, 0.961, 0.905, 0.891, 0.831),
]


def _jitter(value: float, magnitude: float = 0.005) -> float:
    """Add tiny random jitter to a value while keeping it in [0, 1]."""
    return round(min(1.0, max(0.0, value + random.uniform(-magnitude, magnitude))), 4)


class DriftEngine:
    def __init__(self, config: Settings) -> None:
        self._config = config
        # Lazy import to avoid circular dependency at module load time
        self._runtime: Any | None = None

    def _get_runtime(self) -> Any:
        if self._runtime is None:
            from backend.services.judge import JudgeService
            from backend.services.runtime import CustomerSupportRuntime

            judge = JudgeService(self._config)
            self._runtime = CustomerSupportRuntime(self._config, judge)
        return self._runtime

    def seed_synthetic_history(self) -> None:
        """Insert 14 days of synthetic snapshots if no history exists."""
        existing = db.get_snapshots()
        if existing:
            logger.info("synthetic history already present — skipping seed", count=len(existing))
            return

        logger.info("seeding synthetic history", days=len(_SYNTHETIC_DAYS))
        base_date = datetime.utcnow() - timedelta(days=14)

        for day_offset, overall, issue_ack, resolution, tone, concise in _SYNTHETIC_DAYS:
            snapshot_date = (base_date + timedelta(days=day_offset)).isoformat()
            property_scores = {
                "issue_acknowledged": _jitter(issue_ack),
                "resolution_matching": _jitter(resolution),
                "professional_tone": _jitter(tone),
                "concise_response": _jitter(concise),
            }
            overall_jittered = _jitter(overall)

            db.insert_snapshot(
                model=self._config.PRODUCTION_MODEL,
                prompt_version=PROMPT_VERSION,
                corpus_version=CORPUS_VERSION,
                overall_conformance=overall_jittered,
                property_scores=property_scores,
                non_negotiable_results={},
                created_at=snapshot_date,
            )

        logger.info("synthetic history seeded")

    async def run_test_suite(self, model: str) -> SnapshotResult:
        """Run the full corpus through the runtime and store a snapshot."""
        runtime = self._get_runtime()
        corpus = _load_corpus()
        spec = _load_spec()

        logger.info("starting test suite", model=model, corpus_size=len(corpus))

        all_behavioral: dict[str, list[float]] = {
            bp["id"]: [] for bp in spec.get("behavioral_properties", [])
        }
        all_non_neg: dict[str, list[bool]] = {
            nn["id"]: [] for nn in spec.get("non_negotiables", [])
        }

        for example in corpus:
            try:
                result = await runtime.handle_ticket(
                    customer_message=example["customer_message"],
                    ticket_type=example["ticket_type"],
                    context=example.get("context", {}),
                    model=model,
                )
                for prop_id, score_obj in result.verdict.behavioral_scores.items():
                    if prop_id in all_behavioral:
                        all_behavioral[prop_id].append(score_obj.score)
                for prop_id, nn_result in result.verdict.non_negotiable_results.items():
                    if prop_id in all_non_neg:
                        all_non_neg[prop_id].append(nn_result.passed)
            except Exception as exc:  # noqa: BLE001 — catch-all for corpus iteration
                logger.error(
                    "error processing corpus example",
                    example_id=example.get("id"),
                    error=str(exc),
                )

        property_scores: dict[str, float] = {}
        for prop_id, scores in all_behavioral.items():
            property_scores[prop_id] = round(sum(scores) / len(scores), 4) if scores else 0.0

        overall = (
            sum(property_scores.values()) / len(property_scores) if property_scores else 0.0
        )

        non_neg_summary: dict[str, Any] = {}
        for prop_id, results in all_non_neg.items():
            pass_rate = sum(results) / len(results) if results else 1.0
            non_neg_summary[prop_id] = {"pass_rate": round(pass_rate, 4), "total": len(results)}

        snapshot_id = db.insert_snapshot(
            model=model,
            prompt_version=PROMPT_VERSION,
            corpus_version=CORPUS_VERSION,
            overall_conformance=round(overall, 4),
            property_scores=property_scores,
            non_negotiable_results=non_neg_summary,
        )

        logger.info(
            "test suite complete",
            snapshot_id=snapshot_id,
            model=model,
            overall_conformance=round(overall, 4),
        )

        return SnapshotResult(
            id=snapshot_id,
            created_at=datetime.utcnow().isoformat(),
            model=model,
            prompt_version=PROMPT_VERSION,
            corpus_version=CORPUS_VERSION,
            overall_conformance=round(overall, 4),
            property_scores=property_scores,
            non_negotiable_results=non_neg_summary,
        )

    def get_history(self) -> list[SnapshotResult]:
        rows = db.get_snapshots()
        return [
            SnapshotResult(
                id=row["id"],
                created_at=row["created_at"],
                model=row["model"],
                prompt_version=row["prompt_version"],
                corpus_version=row["corpus_version"],
                overall_conformance=row["overall_conformance"],
                property_scores=row["property_scores"],
                non_negotiable_results=row["non_negotiable_results"],
            )
            for row in rows
        ]

    def compute_deltas(self, snapshots: list[SnapshotResult]) -> list[DriftDelta]:
        if len(snapshots) < 2:
            return []
        baseline = snapshots[0]
        latest = snapshots[-1]
        deltas: list[DriftDelta] = []
        all_props = set(baseline.property_scores) | set(latest.property_scores)
        for prop_id in sorted(all_props):
            base_val = baseline.property_scores.get(prop_id, 0.0)
            curr_val = latest.property_scores.get(prop_id, 0.0)
            delta = curr_val - base_val
            if abs(delta) < 0.005:
                direction = "stable"
            elif delta > 0:
                direction = "up"
            else:
                direction = "down"
            deltas.append(
                DriftDelta(
                    property_id=prop_id,
                    baseline_score=round(base_val, 4),
                    current_score=round(curr_val, 4),
                    delta=round(delta, 4),
                    direction=direction,
                )
            )
        return deltas

    def detect_incidents(self, snapshots: list[SnapshotResult]) -> list[Incident]:
        spec = _load_spec()
        thresholds: dict[str, float] = {
            bp["id"]: bp["alert_threshold"]
            for bp in spec.get("behavioral_properties", [])
        }
        baseline_scores: dict[str, float] = (
            snapshots[0].property_scores if snapshots else {}
        )
        incidents: list[Incident] = []

        for snapshot in snapshots:
            for prop_id, threshold in thresholds.items():
                score = snapshot.property_scores.get(prop_id)
                if score is not None and score < threshold:
                    baseline = baseline_scores.get(prop_id)
                    delta = round(score - baseline, 4) if baseline is not None else None
                    incidents.append(
                        Incident(
                            snapshot_id=snapshot.id,
                            created_at=snapshot.created_at,
                            model=snapshot.model,
                            property_id=prop_id,
                            score=round(score, 4),
                            alert_threshold=threshold,
                            delta_from_baseline=delta,
                        )
                    )
        return incidents
