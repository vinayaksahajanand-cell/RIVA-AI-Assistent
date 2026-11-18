from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MetricOut(BaseModel):
    name: str
    display_name: str
    score: float | None  # raw framework score (0..1); None = not computed (shown as N/A, never 0)
    score_100: int | None  # score scaled to 0..100 for display
    higher_is_better: bool
    status: str  # completed | not_applicable | failed
    reason: str | None = None
    requires_reference: bool = False
    threshold: float | None = None
    passed: bool | None = None


class EvaluationOut(BaseModel):
    id: uuid.UUID
    framework: str  # ragas | deepeval
    mode: str  # online | reference | offline
    mode_label: str
    status: str  # pending | running | completed | failed | not_available
    reference_available: bool
    evaluator_model: str | None
    framework_version: str | None
    started_at: datetime | None
    completed_at: datetime | None
    duration_ms: float | None
    error: str | None
    methodology: str
    metrics: list[MetricOut]
    created_at: datetime


class MessageEvaluations(BaseModel):
    message_id: uuid.UUID
    evaluations: list[EvaluationOut]


class RawEvaluation(BaseModel):
    evaluation_id: uuid.UUID
    framework: str
    inputs: dict
    raw: dict


class ReferenceAnswerRequest(BaseModel):
    reference_answer: str = Field(min_length=1, max_length=20000)


class BenchmarkRunRequest(BaseModel):
    dataset: str = Field(default="sample_benchmark", max_length=200,
                         description="Dataset file name (without .json) inside evaluation/datasets/")
    limit: int | None = Field(default=None, ge=1, le=500)
    label: str = Field(default="", max_length=200)
    retrieval_modes: list[Literal["dense", "bm25", "hybrid", "hybrid_rerank"]] = Field(
        default_factory=lambda: ["dense", "bm25", "hybrid", "hybrid_rerank"])
    set_baseline: bool = False


class BenchmarkRunOut(BaseModel):
    id: uuid.UUID
    framework: str
    status: str
    label: str
    config: dict
    summary: dict
    item_count: int
    duration_ms: float | None
    error: str | None
    report_paths: dict
    is_baseline: bool
    created_at: datetime
    completed_at: datetime | None


class RegressionItem(BaseModel):
    metric: str
    baseline: float | None
    candidate: float | None
    delta: float | None
    higher_is_better: bool
    regressed: bool


class RegressionReport(BaseModel):
    framework: str
    baseline_run_id: uuid.UUID | None
    candidate_run_id: uuid.UUID
    threshold: float
    regressed: bool
    items: list[RegressionItem]


class EvaluationReports(BaseModel):
    runs: list[BenchmarkRunOut]
    datasets: list[str]
    regressions: list[RegressionReport]
