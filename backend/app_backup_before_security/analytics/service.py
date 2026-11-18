"""Analytics computed from persisted records only (no sample or synthetic values)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import Date, Text, and_, case, cast, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.evaluation.metrics import SPECS
from app.models import (
    BenchmarkRun,
    Conversation,
    Document,
    DocumentChunk,
    EvaluationMetricResult,
    EvaluationResult,
    Feedback,
    Message,
    PerformanceMetric,
    RetrievalEvent,
)
from app.schemas.analytics import (
    AnalyticsOverview,
    EvaluationAnalytics,
    LatencyPoint,
    LatencyStats,
    MetricAverage,
    MetricPoint,
    ModelUsage,
    PerformanceAnalytics,
    QualityStats,
    RetrievalStats,
    TokenStats,
    Totals,
)


@dataclass
class Filters:
    workspace_id: uuid.UUID
    date_from: date | None = None
    date_to: date | None = None
    model: str | None = None
    collection_id: uuid.UUID | None = None

    def as_dict(self) -> dict:
        return {"date_from": self.date_from.isoformat() if self.date_from else None,
                "date_to": self.date_to.isoformat() if self.date_to else None,
                "model": self.model, "collection_id": str(self.collection_id) if self.collection_id else None}

    @property
    def start(self) -> datetime | None:
        return datetime.combine(self.date_from, time.min, tzinfo=UTC) if self.date_from else None

    @property
    def end(self) -> datetime | None:
        return datetime.combine(self.date_to + timedelta(days=1), time.min, tzinfo=UTC) if self.date_to else None


def _round(v, digits=2):
    return None if v is None else round(float(v), digits)


async def _collection_message_ids(db: AsyncSession, f: Filters) -> list[uuid.UUID] | None:
    """Assistant messages whose retrieval used at least one document of the selected collection."""
    if not f.collection_id:
        return None
    doc_ids = [str(r[0]) for r in (await db.execute(select(Document.id).where(
        Document.workspace_id == f.workspace_id, Document.collection_id == f.collection_id))).all()]
    if not doc_ids:
        return []
    rows = (await db.execute(select(RetrievalEvent.message_id).where(
        RetrievalEvent.workspace_id == f.workspace_id,
        RetrievalEvent.document_ids.op("?|")(literal(doc_ids, type_=ARRAY(Text)))))).all()
    return [r[0] for r in rows]


async def _message_conditions(db: AsyncSession, f: Filters):
    conds = [Message.workspace_id == f.workspace_id, Message.role == "assistant"]
    if f.start:
        conds.append(Message.created_at >= f.start)
    if f.end:
        conds.append(Message.created_at < f.end)
    if f.model:
        conds.append(Message.model == f.model)
    ids = await _collection_message_ids(db, f)
    if ids is not None:
        conds.append(Message.id.in_(ids) if ids else Message.id.is_(None))
    return and_(*conds)


async def overview(db: AsyncSession, f: Filters) -> AnalyticsOverview:
    mc = await _message_conditions(db, f)
    doc_conds = [Document.workspace_id == f.workspace_id]
    if f.collection_id:
        doc_conds.append(Document.collection_id == f.collection_id)
    doc_row = (await db.execute(select(
        func.count(Document.id),
        func.count(case((Document.status == "indexed", 1))),
        func.count(case((Document.status == "failed", 1))),
    ).where(*doc_conds))).one()
    chunks = await db.scalar(select(func.count(DocumentChunk.id)).join(Document, Document.id == DocumentChunk.document_id)
                             .where(*doc_conds, DocumentChunk.chunk_type != "parent")) or 0

    conv_conds = [Conversation.workspace_id == f.workspace_id]
    if f.start:
        conv_conds.append(Conversation.created_at >= f.start)
    if f.end:
        conv_conds.append(Conversation.created_at < f.end)
    conversations = await db.scalar(select(func.count(Conversation.id)).where(*conv_conds)) or 0

    msg_row = (await db.execute(select(
        func.count(Message.id),
        func.count(case((Message.status == "failed", 1))),
        func.count(case((Message.status == "insufficient_context", 1))),
    ).where(mc))).one()

    perf = (await db.execute(select(
        func.avg(PerformanceMetric.total_ms),
        func.percentile_cont(0.5).within_group(PerformanceMetric.total_ms),
        func.percentile_cont(0.95).within_group(PerformanceMetric.total_ms),
        func.avg(PerformanceMetric.time_to_first_token_ms),
        func.avg((PerformanceMetric.stages_ms["dense_retrieval"].as_float()
                  + PerformanceMetric.stages_ms["bm25_retrieval"].as_float())),
        func.avg(PerformanceMetric.stages_ms["llm_generation"].as_float()),
        func.coalesce(func.sum(PerformanceMetric.prompt_tokens), 0),
        func.coalesce(func.sum(PerformanceMetric.completion_tokens), 0),
        func.sum(PerformanceMetric.estimated_cost_usd),
    ).join(Message, Message.id == PerformanceMetric.message_id).where(mc, Message.status != "failed"))).one()

    quality = await _quality(db, f, mc)
    retrieval = (await db.execute(select(
        func.count(RetrievalEvent.id),
        func.avg(case((RetrievalEvent.retrieval_success, 1.0), else_=0.0)),
        func.avg(RetrievalEvent.attempts),
    ).join(Message, Message.id == RetrievalEvent.message_id).where(mc))).one()

    fb = (await db.execute(select(func.count(case((Feedback.rating > 0, 1))), func.count(case((Feedback.rating < 0, 1))))
                           .join(Message, Message.id == Feedback.message_id).where(mc))).one()
    models = [r[0] for r in (await db.execute(select(Message.model).where(
        Message.workspace_id == f.workspace_id, Message.role == "assistant", Message.model.is_not(None))
        .distinct())).all()]
    pricing_configured = bool(get_settings().model_pricing)
    return AnalyticsOverview(
        filters=f.as_dict(),
        totals=Totals(documents_total=doc_row[0], documents_indexed=doc_row[1], documents_failed=doc_row[2],
                      chunks_indexed=chunks, conversations=conversations,
                      questions_answered=msg_row[0] - msg_row[1], failed_queries=msg_row[1],
                      insufficient_context_answers=msg_row[2]),
        latency=LatencyStats(avg_total_ms=_round(perf[0]), p50_total_ms=_round(perf[1]), p95_total_ms=_round(perf[2]),
                             avg_ttft_ms=_round(perf[3]), avg_retrieval_ms=_round(perf[4]),
                             avg_generation_ms=_round(perf[5])),
        quality=QualityStats(**quality, thumbs_up=fb[0], thumbs_down=fb[1]),
        retrieval=RetrievalStats(events=retrieval[0], success_rate=_round(retrieval[1], 4),
                                 avg_attempts=_round(retrieval[2], 2)),
        tokens=TokenStats(prompt_tokens=int(perf[6]), completion_tokens=int(perf[7]),
                          total_tokens=int(perf[6]) + int(perf[7]),
                          estimated_cost_usd=_round(perf[8], 6) if pricing_configured and perf[8] is not None else None,
                          pricing_configured=pricing_configured),
        models=sorted(m for m in models if m),
    )


async def _quality(db: AsyncSession, f: Filters, mc) -> dict:
    rows = (await db.execute(select(EvaluationMetricResult.metric_name, func.avg(EvaluationMetricResult.score))
                             .join(EvaluationResult, EvaluationResult.id == EvaluationMetricResult.evaluation_id)
                             .join(Message, Message.id == EvaluationResult.message_id)
                             .where(mc, EvaluationResult.framework == "ragas", EvaluationResult.status == "completed",
                                    EvaluationMetricResult.status == "completed")
                             .group_by(EvaluationMetricResult.metric_name))).all()
    avgs = {name: v for name, v in rows}
    evaluated = await db.scalar(select(func.count(func.distinct(EvaluationResult.message_id)))
                                .join(Message, Message.id == EvaluationResult.message_id)
                                .where(mc, EvaluationResult.framework == "ragas",
                                       EvaluationResult.status == "completed")) or 0
    latest = (await db.execute(select(BenchmarkRun).where(
        BenchmarkRun.workspace_id == f.workspace_id, BenchmarkRun.status == "completed",
        BenchmarkRun.framework.in_(["deepeval", "all"])).order_by(BenchmarkRun.created_at.desc()).limit(1))).scalar()
    rate, source = None, None
    if latest is not None:
        h = ((latest.summary or {}).get("deepeval") or {}).get("hallucination") or {}
        if h.get("hallucination_rate") is not None:
            rate = h["hallucination_rate"]
            source = (f"DeepEval HallucinationMetric on dataset '{(latest.config or {}).get('dataset')}' "
                      f"(run {str(latest.id)[:8]}, {latest.created_at:%Y-%m-%d})")
    return {"evaluated_answers": evaluated, "avg_faithfulness": _round(avgs.get("faithfulness"), 4),
            "avg_answer_relevancy": _round(avgs.get("answer_relevancy"), 4),
            "avg_context_precision": _round(avgs.get("context_precision"), 4),
            "hallucination_rate": rate, "hallucination_rate_source": source}


async def performance(db: AsyncSession, f: Filters) -> PerformanceAnalytics:
    mc = await _message_conditions(db, f)
    day = cast(func.date_trunc("day", PerformanceMetric.created_at), Date)
    series_rows = (await db.execute(select(
        day, func.count(PerformanceMetric.id), func.avg(PerformanceMetric.total_ms),
        func.percentile_cont(0.95).within_group(PerformanceMetric.total_ms),
        func.avg(PerformanceMetric.time_to_first_token_ms))
        .join(Message, Message.id == PerformanceMetric.message_id).where(mc, Message.status != "failed")
        .group_by(day).order_by(day))).all()
    stage_rows = (await db.execute(select(PerformanceMetric.stages_ms)
                                   .join(Message, Message.id == PerformanceMetric.message_id)
                                   .where(mc, Message.status != "failed")
                                   .order_by(PerformanceMetric.created_at.desc()).limit(2000))).scalars().all()
    sums: dict[str, list[float]] = {}
    for stages in stage_rows:
        for k, v in (stages or {}).items():
            sums.setdefault(k, []).append(float(v))
    stage_avgs = {k: round(sum(v) / len(v), 2) for k, v in sums.items() if v}
    model_rows = (await db.execute(select(
        PerformanceMetric.model, func.count(PerformanceMetric.id), func.avg(PerformanceMetric.total_ms),
        func.coalesce(func.sum(PerformanceMetric.total_tokens), 0))
        .join(Message, Message.id == PerformanceMetric.message_id).where(mc)
        .group_by(PerformanceMetric.model))).all()
    return PerformanceAnalytics(
        filters=f.as_dict(),
        series=[LatencyPoint(date=d.isoformat(), count=c, avg_total_ms=_round(a), p95_total_ms=_round(p),
                             avg_ttft_ms=_round(t)) for d, c, a, p, t in series_rows],
        stage_averages_ms=stage_avgs,
        by_model=[ModelUsage(model=m or "unknown", count=c, avg_total_ms=_round(a), total_tokens=int(t))
                  for m, c, a, t in model_rows],
    )


async def evaluations(db: AsyncSession, f: Filters) -> EvaluationAnalytics:
    from app.services.benchmark_views import run_to_out

    mc = await _message_conditions(db, f)
    day = cast(func.date_trunc("day", EvaluationResult.created_at), Date)
    base = (select(day, EvaluationMetricResult.metric_name, EvaluationResult.framework,
                   func.avg(EvaluationMetricResult.score), func.count(EvaluationMetricResult.id))
            .join(EvaluationResult, EvaluationResult.id == EvaluationMetricResult.evaluation_id)
            .join(Message, Message.id == EvaluationResult.message_id)
            .where(mc, EvaluationMetricResult.status == "completed"))
    series = (await db.execute(base.group_by(day, EvaluationMetricResult.metric_name, EvaluationResult.framework)
                               .order_by(day))).all()
    avg_rows = (await db.execute(select(
        EvaluationMetricResult.metric_name, EvaluationResult.framework, EvaluationResult.mode,
        func.avg(EvaluationMetricResult.score), func.count(EvaluationMetricResult.id))
        .join(EvaluationResult, EvaluationResult.id == EvaluationMetricResult.evaluation_id)
        .join(Message, Message.id == EvaluationResult.message_id)
        .where(mc, EvaluationMetricResult.status == "completed")
        .group_by(EvaluationMetricResult.metric_name, EvaluationResult.framework, EvaluationResult.mode))).all()
    status_rows = (await db.execute(select(EvaluationResult.status, func.count(EvaluationResult.id))
                                    .join(Message, Message.id == EvaluationResult.message_id).where(mc)
                                    .group_by(EvaluationResult.status))).all()
    run_conds = [BenchmarkRun.workspace_id == f.workspace_id]
    if f.start:
        run_conds.append(BenchmarkRun.created_at >= f.start)
    if f.end:
        run_conds.append(BenchmarkRun.created_at < f.end)
    runs = (await db.execute(select(BenchmarkRun).where(*run_conds).order_by(BenchmarkRun.created_at.desc())
                             .limit(25))).scalars().all()

    def spec(fw, key):
        return SPECS.get((fw, key))

    return EvaluationAnalytics(
        filters=f.as_dict(),
        series=[MetricPoint(date=d.isoformat(), metric=m, framework=fw, avg=_round(a, 4), count=c)
                for d, m, fw, a, c in series],
        averages=[MetricAverage(metric=m, display_name=spec(fw, m).display_name if spec(fw, m) else m, framework=fw,
                                mode=mode, avg=_round(a, 4), count=c,
                                higher_is_better=spec(fw, m).higher_is_better if spec(fw, m) else True)
                  for m, fw, mode, a, c in avg_rows],
        status_counts={s: c for s, c in status_rows},
        benchmark_runs=[run_to_out(r) for r in runs],
    )
