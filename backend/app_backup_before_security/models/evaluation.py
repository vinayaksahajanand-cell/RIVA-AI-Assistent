from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, Timestamped, UUIDPk


class EvaluationResult(UUIDPk, Timestamped, Base):
    """One evaluation run of one framework over one answer (online) or one benchmark item (offline).

    ``status``: pending | running | completed | failed | not_available
    ``mode``:   online (no reference) | reference (reference answer supplied) | offline (benchmark)
    """

    __tablename__ = "evaluation_results"
    __table_args__ = (
        Index("ix_evaluation_results_status", "status"),
        Index("ix_evaluation_results_message", "message_id", "framework"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True),
                                                         ForeignKey("messages.id", ondelete="CASCADE"))
    benchmark_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("benchmark_runs.id", ondelete="CASCADE"), index=True)
    framework: Mapped[str] = mapped_column(String(20), nullable=False, default="ragas")  # ragas | deepeval
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="online")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reference_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    evaluator_model: Mapped[str | None] = mapped_column(String(100))
    framework_version: Mapped[str | None] = mapped_column(String(40))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_by: Mapped[str | None] = mapped_column(String(100))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    # Snapshot of the exact inputs evaluated (question, answer, contexts, reference) for reproducibility.
    inputs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    metrics: Mapped[list[EvaluationMetricResult]] = relationship(back_populates="evaluation",
                                                                 cascade="all, delete-orphan",
                                                                 order_by="EvaluationMetricResult.position")


class EvaluationMetricResult(UUIDPk, Timestamped, Base):
    __tablename__ = "evaluation_metric_results"
    __table_args__ = (Index("ix_metric_results_name", "metric_name"),)

    evaluation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evaluation_results.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(String(80), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Raw framework score (usually 0..1). NULL means not computed — never coerced to zero.
    score: Mapped[float | None] = mapped_column(Float)
    higher_is_better: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # completed | not_applicable | failed
    reason: Mapped[str | None] = mapped_column(Text)
    requires_reference: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    threshold: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)

    evaluation: Mapped[EvaluationResult] = relationship(back_populates="metrics")


class BenchmarkDataset(UUIDPk, Timestamped, Base):
    __tablename__ = "benchmark_datasets"

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # [{"id","question","expected_answer","expected_document","expected_context"}]
    items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    source_path: Mapped[str | None] = mapped_column(String(1024))
    langsmith_dataset_id: Mapped[str | None] = mapped_column(String(100))


class BenchmarkRun(UUIDPk, Timestamped, Base):
    __tablename__ = "benchmark_runs"

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("benchmark_datasets.id", ondelete="SET NULL"), index=True)
    framework: Mapped[str] = mapped_column(String(20), nullable=False)  # ragas | deepeval | retrieval | all
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    report_paths: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[float | None] = mapped_column(Float)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_baseline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    git_sha: Mapped[str | None] = mapped_column(String(64))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
