"""Pydantic v2 schemas for all request/response bodies."""
from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

from backend.services.judge import BehavioralScore, JudgeVerdict, NonNegotiableResult

T = TypeVar("T")

__all__ = [
    "Envelope",
    "SubmitTicketRequest",
    "RunResponse",
    "RunDetailResponse",
    "ConformanceResultItem",
    "SnapshotResponse",
    "TriggerSnapshotRequest",
    "IncidentResponse",
    "CompareRequest",
    "ModelCompareResult",
    "CompareResponse",
    "MonitorStatus",
    "VerdictResponse",
    "BehavioralScore",
    "NonNegotiableResult",
    "JudgeVerdict",
]


class Envelope(BaseModel, Generic[T]):
    model_config = {"arbitrary_types_allowed": True}

    data: T
    meta: dict[str, Any] = Field(default_factory=dict)


class SubmitTicketRequest(BaseModel):
    model_config = {"extra": "ignore"}

    customer_message: str
    ticket_type: str
    context: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None


class ConformanceResultItem(BaseModel):
    model_config = {"extra": "ignore"}

    id: int
    run_id: int
    property_name: str
    property_type: str
    score: float | None
    passed: bool | None
    verdict_json: dict[str, Any]


class RunResponse(BaseModel):
    model_config = {"extra": "ignore"}

    run_id: int
    created_at: str | None = None
    model: str
    ticket_type: str
    customer_message: str
    response: str
    verdict: JudgeVerdict
    latency_ms: int
    total_tokens: int
    retried: bool
    prompt_version: str
    system_prompt: str
    resolution_path: str


class RunDetailResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: int
    created_at: str
    model: str
    ticket_type: str
    customer_message: str
    context: dict[str, Any]
    response: str
    prompt_version: str
    latency_ms: int
    total_tokens: int
    conformance_results: list[ConformanceResultItem] = Field(default_factory=list)


class RunListItem(BaseModel):
    model_config = {"extra": "ignore"}

    id: int
    created_at: str
    model: str
    ticket_type: str
    customer_message: str
    prompt_version: str
    latency_ms: int
    total_tokens: int


class SnapshotResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: int | None
    created_at: str
    model: str
    prompt_version: str
    corpus_version: str
    overall_conformance: float
    property_scores: dict[str, float]
    non_negotiable_results: dict[str, Any]


class TriggerSnapshotRequest(BaseModel):
    model: str = "claude-haiku-4-5"


class IncidentResponse(BaseModel):
    model_config = {"extra": "ignore"}

    snapshot_id: int | None
    created_at: str
    model: str
    property_id: str
    score: float
    alert_threshold: float
    delta_from_baseline: float | None = None


class CompareRequest(BaseModel):
    models: list[str] = Field(
        default_factory=lambda: ["claude-sonnet-4-5", "claude-haiku-4-5"]
    )


class CostEstimate(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_usd: float


class ModelCompareResult(BaseModel):
    model_config = {"extra": "ignore"}

    model: str
    overall_conformance: float
    property_scores: dict[str, float]
    non_negotiable_pass_rates: dict[str, float]
    cost_estimate: CostEstimate
    snapshot: SnapshotResponse


class CompareResponse(BaseModel):
    models: list[ModelCompareResult]
    winner: str | None = None
    winner_reason: str | None = None


class MonitorStatus(BaseModel):
    model_config = {"extra": "ignore"}

    overall_conformance_rate: float
    category_breakdown: dict[str, float]
    alert_count: int
    total_verdicts: int


class VerdictResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: int
    created_at: str
    run_id: int
    overall_score: float
    property_scores: dict[str, float]
    alert_triggered: bool
