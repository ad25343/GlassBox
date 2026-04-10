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
    "SnapshotExampleItem",
    "ExampleDiffEntry",
    "SnapshotDiffResponse",
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
    "ToolCall",
]


class Envelope(BaseModel, Generic[T]):
    model_config = {"arbitrary_types_allowed": True}

    data: T
    meta: dict[str, Any] = Field(default_factory=dict)


class ConversationTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ToolCall(BaseModel):
    model_config = {"extra": "ignore"}

    name: str
    input: dict[str, Any]
    result: dict[str, Any]
    tool_use_id: str


class SubmitTicketRequest(BaseModel):
    model_config = {"extra": "ignore"}

    customer_message: str
    ticket_type: str
    context: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    conversation_history: list[ConversationTurn] = Field(default_factory=list)
    session_id: str | None = None       # None → backend creates a new session
    scenario_id: str = ""


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
    session_id: str
    turn_number: int
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
    tool_calls: list[ToolCall] = Field(default_factory=list)


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
    category_scores: dict[str, dict[str, float]] = Field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0
    run_type: str = "baseline"


class SnapshotExampleItem(BaseModel):
    model_config = {"extra": "ignore"}

    id: int
    snapshot_id: int
    corpus_example_id: str
    ticket_type: str
    customer_message_truncated: str
    overall_score: float
    property_scores: dict[str, float]
    non_negotiables_passed: bool


class ExampleDiffEntry(BaseModel):
    model_config = {"extra": "ignore"}

    corpus_example_id: str
    ticket_type: str
    customer_message_truncated: str
    previous_overall_score: float
    current_overall_score: float
    score_delta: float
    status: str  # "newly_failed" | "newly_recovered" | "degraded" | "improved"
    changed_properties: dict[str, float]  # prop_id → delta (current - previous)


class SnapshotDiffResponse(BaseModel):
    model_config = {"extra": "ignore"}

    snapshot_id: int
    previous_snapshot_id: int
    snapshot_created_at: str
    previous_snapshot_created_at: str
    newly_failed: list[ExampleDiffEntry]
    newly_recovered: list[ExampleDiffEntry]
    degraded: list[ExampleDiffEntry]
    improved: list[ExampleDiffEntry]
    total_changed: int
    summary: dict[str, int]


class TriggerSnapshotRequest(BaseModel):
    model: str = "claude-haiku-4-5"
    run_type: str = "test"  # "test" | "baseline" | "compare"


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
