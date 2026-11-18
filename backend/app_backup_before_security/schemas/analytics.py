from __future__ import annotations

from pydantic import BaseModel

from app.schemas.evaluation import BenchmarkRunOut


class Totals(BaseModel):
    documents_total: int
    documents_indexed: int
    documents_failed: int
    chunks_indexed: int
    conversations: int
    questions_answered: int
    failed_queries: int
    insufficient_context_answers: int


class LatencyStats(BaseModel):
    avg_total_ms: float | None
    p50_total_ms: float | None
    p95_total_ms: float | None
    avg_ttft_ms: float | None
    avg_retrieval_ms: float | None
    avg_generation_ms: float | None


class QualityStats(BaseModel):
    evaluated_answers: int
    avg_faithfulness: float | None  # 0..1, RAGAS online
    avg_answer_relevancy: float | None
    avg_context_precision: float | None
    hallucination_rate: float | None  # share of DeepEval benchmark cases failing HallucinationMetric
    hallucination_rate_source: str | None
    thumbs_up: int
    thumbs_down: int


class RetrievalStats(BaseModel):
    events: int
    success_rate: float | None
    avg_attempts: float | None


class TokenStats(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_usd: float | None
    pricing_configured: bool


class AnalyticsOverview(BaseModel):
    filters: dict
    totals: Totals
    latency: LatencyStats
    quality: QualityStats
    retrieval: RetrievalStats
    tokens: TokenStats
    models: list[str]


class LatencyPoint(BaseModel):
    date: str
    count: int
    avg_total_ms: float | None
    p95_total_ms: float | None
    avg_ttft_ms: float | None


class ModelUsage(BaseModel):
    model: str
    count: int
    avg_total_ms: float | None
    total_tokens: int


class PerformanceAnalytics(BaseModel):
    filters: dict
    series: list[LatencyPoint]
    stage_averages_ms: dict[str, float]
    by_model: list[ModelUsage]


class MetricPoint(BaseModel):
    date: str
    metric: str
    framework: str
    avg: float | None
    count: int


class MetricAverage(BaseModel):
    metric: str
    display_name: str
    framework: str
    mode: str
    avg: float | None
    count: int
    higher_is_better: bool


class EvaluationAnalytics(BaseModel):
    filters: dict
    series: list[MetricPoint]
    averages: list[MetricAverage]
    status_counts: dict[str, int]
    benchmark_runs: list[BenchmarkRunOut]
