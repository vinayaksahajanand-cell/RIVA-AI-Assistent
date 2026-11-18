"""Background worker: ingestion jobs, online evaluations and benchmark runs.

Queues live in PostgreSQL and are claimed with ``FOR UPDATE SKIP LOCKED`` so any number of
workers (embedded in the API process and/or ``python -m app.worker``) can run safely.
Failed ingestion jobs are retried with exponential backoff up to ``JOB_MAX_ATTEMPTS``.

Run standalone:  python -m app.worker
"""

from __future__ import annotations

import asyncio
import os
import socket
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text, update

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.database.session import session_scope
from app.models import BenchmarkRun, Document, EvaluationResult, IngestionJob

log = get_logger(__name__)

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
STALE_AFTER = timedelta(minutes=30)

_wake = asyncio.Event()


def wake_worker() -> None:
    """Signal the embedded worker that new work is available (no-op for external workers)."""
    try:
        _wake.set()
    except RuntimeError:  # pragma: no cover - no running loop
        pass


_CLAIM_JOB = text("""
UPDATE ingestion_jobs SET status = 'running', locked_by = :worker, started_at = now(),
       attempts = attempts + 1, stage = 'starting', progress = 5
WHERE id = (
    SELECT id FROM ingestion_jobs
    WHERE status = 'queued' AND is_active AND next_run_at <= now()
    ORDER BY next_run_at, created_at
    FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING id, document_id, attempts, max_attempts
""")

_CLAIM_EVAL = text("""
UPDATE evaluation_results SET status = 'running', locked_by = :worker, started_at = now(), attempts = attempts + 1
WHERE id = (
    SELECT id FROM evaluation_results
    WHERE status = 'pending' AND message_id IS NOT NULL
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING id
""")

_CLAIM_BENCH = text("""
UPDATE benchmark_runs SET status = 'running'
WHERE id = (
    SELECT id FROM benchmark_runs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING id
""")


def _is_permanent(exc: Exception) -> bool:
    """Errors that will fail identically on retry (bad file content, configuration mismatch)."""
    from app.core.errors import AppError
    from app.embeddings.provider import EmbeddingDimensionMismatch
    from app.ingestion.extractors import ExtractionError

    return isinstance(exc, (ValueError, ExtractionError, EmbeddingDimensionMismatch, AppError))


def _short_error(exc: Exception) -> str:
    return f"{exc.__class__.__name__}: {str(exc)[:900]}"


async def process_next_ingestion() -> bool:
    from app.ingestion.pipeline import run_ingestion

    async with session_scope() as s:
        row = (await s.execute(_CLAIM_JOB, {"worker": WORKER_ID})).first()
    if row is None:
        return False
    job_id, document_id, attempts, max_attempts = row
    try:
        stats = await run_ingestion(job_id)
        async with session_scope() as s:
            await s.execute(update(IngestionJob).where(IngestionJob.id == job_id).values(
                status="completed", stage="completed", progress=100, finished_at=func.now(), last_error=None,
                stats=stats, locked_by=None))
    except Exception as exc:
        error = _short_error(exc)
        retry = attempts < max_attempts and not _is_permanent(exc)
        log.warning("Ingestion job %s failed (attempt %s/%s): %s", job_id, attempts, max_attempts, error)
        async with session_scope() as s:
            if retry:
                delay = timedelta(seconds=15 * 2 ** (attempts - 1))
                await s.execute(update(IngestionJob).where(IngestionJob.id == job_id).values(
                    status="queued", stage="retry_scheduled", last_error=error, locked_by=None,
                    next_run_at=datetime.now(UTC) + delay))
                await s.execute(update(Document).where(Document.id == document_id).values(
                    error_message=f"Attempt {attempts} failed; retrying automatically. ({error[:300]})"))
            else:
                await s.execute(update(IngestionJob).where(IngestionJob.id == job_id).values(
                    status="failed", stage="failed", last_error=error, finished_at=func.now(), locked_by=None))
                doc = await s.get(Document, document_id)
                if doc is not None:
                    # Keep the previous index searchable if a re-index fails.
                    doc.status = "indexed" if doc.chunk_count else "failed"
                    doc.error_message = (f"Re-index failed: {error}" if doc.chunk_count else error)
    return True


async def process_next_evaluation() -> bool:
    from app.evaluation.evaluation_service import run_online_evaluation

    async with session_scope() as s:
        row = (await s.execute(_CLAIM_EVAL, {"worker": WORKER_ID})).first()
    if row is None:
        return False
    await run_online_evaluation(row[0])
    return True


async def process_next_benchmark() -> bool:
    from app.evaluation.benchmark import execute_benchmark_run

    async with session_scope() as s:
        row = (await s.execute(_CLAIM_BENCH)).first()
    if row is None:
        return False
    await execute_benchmark_run(row[0])
    return True


async def recover_stale() -> None:
    cutoff = datetime.now(UTC) - STALE_AFTER
    async with session_scope() as s:
        await s.execute(update(IngestionJob).where(IngestionJob.status == "running",
                                                   IngestionJob.started_at < cutoff)
                        .values(status="queued", stage="recovered", locked_by=None))
        await s.execute(update(EvaluationResult).where(EvaluationResult.status == "running",
                                                       EvaluationResult.started_at < cutoff)
                        .values(status="pending", locked_by=None))
        await s.execute(update(BenchmarkRun).where(BenchmarkRun.status == "running",
                                                   BenchmarkRun.created_at < cutoff - timedelta(hours=2))
                        .values(status="failed", error="Worker stopped before completion."))


async def _loop(name: str, handler, stop: asyncio.Event) -> None:
    poll = get_settings().worker_poll_seconds
    while not stop.is_set():
        try:
            worked = await handler()
        except Exception:
            log.exception("%s loop error", name)
            worked = False
        if not worked:
            try:
                _wake.clear()
                await asyncio.wait_for(_wake.wait(), timeout=poll)
            except TimeoutError:
                pass


async def run_worker(stop: asyncio.Event | None = None) -> None:
    stop = stop or asyncio.Event()
    try:
        await recover_stale()
    except Exception as exc:
        log.warning("Stale job recovery skipped: %s", exc)
    log.info("Worker %s started", WORKER_ID)
    await asyncio.gather(
        _loop("ingestion", process_next_ingestion, stop),
        _loop("evaluation", process_next_evaluation, stop),
        _loop("benchmark", process_next_benchmark, stop),
    )


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    from app.evaluation.env import configure_evaluation_env
    from app.observability.tracing import configure_tracing

    configure_evaluation_env()
    configure_tracing()
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        log.info("Worker stopped")


if __name__ == "__main__":
    main()
