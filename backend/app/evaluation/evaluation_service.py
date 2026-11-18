"""Online (per-answer) evaluation lifecycle and serialisation.

An evaluation row is created as ``pending`` when an answer is persisted; the worker claims it,
runs RAGAS asynchronously (so answer latency is never inflated), stores every metric — including
N/A ones with their reason — and attaches scores to the LangSmith run as feedback.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.logging import get_logger
from app.database.session import session_scope
from app.evaluation.metrics import DEEPEVAL_METHODOLOGY, MODE_LABELS, RAGAS_METHODOLOGY, RAGAS_METRICS
from app.evaluation.types import MetricOutcome
from app.models import EvaluationMetricResult, EvaluationResult, Message
from app.observability.tracing import log_feedback
from app.schemas.evaluation import EvaluationOut, MetricOut

log = get_logger(__name__)


def evaluator_unavailable_reason() -> str | None:
    settings = get_settings()
    if not settings.online_evaluation_enabled:
        return "Online evaluation is disabled (ONLINE_EVALUATION_ENABLED=false)."
    if not settings.llm_configured:
        return "Evaluator LLM is not configured: set OPENAI_API_KEY in backend/.env to enable RAGAS scoring."
    return None


def metric_rows(evaluation_id: uuid.UUID, outcomes: list[MetricOutcome]) -> list[EvaluationMetricResult]:
    return [EvaluationMetricResult(
        evaluation_id=evaluation_id, metric_name=o.key, display_name=o.display_name, position=i, score=o.score,
        higher_is_better=o.higher_is_better, status=o.status, reason=o.reason, requires_reference=o.requires_reference,
        threshold=o.threshold, passed=o.passed) for i, o in enumerate(outcomes)]


def not_available_outcomes(reason: str) -> list[MetricOutcome]:
    return [MetricOutcome(key=s.key, display_name=s.display_name, higher_is_better=s.higher_is_better,
                          requires_reference=s.requires_reference, status="not_applicable", reason=reason)
            for s in RAGAS_METRICS]


def new_online_evaluation(message: Message, *, question: str, answer: str, contexts: list[str],
                          reference: str | None, run_id: str | None, skip_reason: str | None) -> EvaluationResult:
    """Build (not persist) the RAGAS evaluation row for an assistant message."""
    from app.evaluation.ragas_evaluator import ragas_version

    settings = get_settings()
    reason = skip_reason or evaluator_unavailable_reason()
    evaluation = EvaluationResult(
        id=uuid.uuid4(), workspace_id=message.workspace_id, message_id=message.id, framework="ragas",
        mode="reference" if reference else "online", status="not_available" if reason else "pending",
        reference_available=bool(reference), evaluator_model=settings.evaluation_llm_model,
        framework_version=ragas_version(), error=reason,
        inputs={"question": question, "answer": answer, "contexts": contexts, "reference": reference,
                "run_id": run_id},
    )
    if reason:
        evaluation.metrics = metric_rows(evaluation.id, not_available_outcomes(reason))
        evaluation.completed_at = datetime.now(UTC)
    return evaluation


async def run_online_evaluation(evaluation_id: uuid.UUID) -> None:
    """Execute a claimed (status=running) evaluation row. Never raises."""
    from app.evaluation.ragas_evaluator import RagasEvaluator, ragas_version

    async with session_scope() as s:
        evaluation = await s.get(EvaluationResult, evaluation_id)
        if evaluation is None:
            return
        inputs = dict(evaluation.inputs or {})
    t0 = time.perf_counter()
    outcomes: list[MetricOutcome] = []
    error = None
    try:
        evaluator = RagasEvaluator()
        outcomes = await evaluator.evaluate(inputs.get("question", ""), inputs.get("answer", ""),
                                            inputs.get("contexts") or [], inputs.get("reference"))
    except Exception as exc:
        error = f"{exc.__class__.__name__}: {str(exc)[:500]}"
        log.warning("Online evaluation %s failed: %s", evaluation_id, error)
    duration_ms = round((time.perf_counter() - t0) * 1000, 1)
    completed = [o for o in outcomes if o.status == "completed"]
    status = "completed" if completed else "failed"
    if not outcomes:
        outcomes = not_available_outcomes(error or "Evaluation failed.")
        for o in outcomes:
            o.status = "failed"
    elif not completed and error is None:
        error = "No metric could be computed; see per-metric reasons."

    async with session_scope() as s:
        evaluation = await s.get(EvaluationResult, evaluation_id, options=[selectinload(EvaluationResult.metrics)])
        if evaluation is None:
            return
        evaluation.metrics.clear()
        await s.flush()
        for row in metric_rows(evaluation.id, outcomes):
            s.add(row)
        evaluation.status = status
        evaluation.error = error
        evaluation.duration_ms = duration_ms
        evaluation.completed_at = datetime.now(UTC)
        evaluation.framework_version = ragas_version()
        evaluation.locked_by = None
        evaluation.raw = {"metrics": {o.key: {"status": o.status, "score": o.score, "reason": o.reason, **o.raw}
                                      for o in outcomes}, "duration_ms": duration_ms}
    for o in completed:
        log_feedback(inputs.get("run_id"), f"ragas.{o.key}", o.score, o.reason)


async def queue_reference_evaluation(db: AsyncSession, message: Message, reference: str) -> EvaluationResult:
    """Create a new reference-based RAGAS evaluation for an existing answer."""
    previous = (await db.execute(select(EvaluationResult).where(
        EvaluationResult.message_id == message.id, EvaluationResult.framework == "ragas")
        .order_by(EvaluationResult.created_at.desc()))).scalars().first()
    inputs = dict(previous.inputs) if previous else {}
    if not inputs:
        raise ValueError("This answer has no stored evaluation inputs.")
    evaluation = new_online_evaluation(
        message, question=inputs.get("question", ""), answer=inputs.get("answer", message.content),
        contexts=inputs.get("contexts") or [], reference=reference, run_id=inputs.get("run_id"),
        skip_reason=None if inputs.get("contexts") else "No retrieved context to evaluate.")
    db.add(evaluation)
    return evaluation


def _metric_out(row: EvaluationMetricResult) -> MetricOut:
    return MetricOut(name=row.metric_name, display_name=row.display_name, score=row.score,
                     score_100=None if row.score is None else int(round(row.score * 100)),
                     higher_is_better=row.higher_is_better, status=row.status, reason=row.reason,
                     requires_reference=row.requires_reference, threshold=row.threshold, passed=row.passed)


def evaluation_to_out(e: EvaluationResult) -> EvaluationOut:
    settings = get_settings()
    if e.framework == "deepeval":
        methodology = DEEPEVAL_METHODOLOGY.format(version=e.framework_version or "?", model=e.evaluator_model or "?",
                                                  threshold=settings.deepeval_threshold)
    else:
        methodology = RAGAS_METHODOLOGY.format(version=e.framework_version or "?", model=e.evaluator_model or "?",
                                               ref=" and the reference answer" if e.reference_available else "")
    return EvaluationOut(
        id=e.id, framework=e.framework, mode=e.mode, mode_label=MODE_LABELS.get(e.mode, e.mode), status=e.status,
        reference_available=e.reference_available, evaluator_model=e.evaluator_model,
        framework_version=e.framework_version, started_at=e.started_at, completed_at=e.completed_at,
        duration_ms=e.duration_ms, error=e.error, methodology=methodology,
        metrics=[_metric_out(m) for m in sorted(e.metrics, key=lambda m: m.position)], created_at=e.created_at,
    )


async def evaluations_for_messages(db: AsyncSession, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[EvaluationOut]]:
    if not message_ids:
        return {}
    rows = (await db.execute(select(EvaluationResult).options(selectinload(EvaluationResult.metrics))
                             .where(EvaluationResult.message_id.in_(message_ids))
                             .order_by(EvaluationResult.created_at.desc()))).scalars().all()
    out: dict[uuid.UUID, list[EvaluationOut]] = {}
    for e in rows:
        out.setdefault(e.message_id, []).append(evaluation_to_out(e))
    return out
