from __future__ import annotations

import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, get_auth_context, require_permission
from app.core.errors import ForbiddenError
from app.core.rbac import Permission
from app.api.routes.conversations import owned_message
from app.core.config import BACKEND_DIR
from app.core.errors import NotFoundError, ValidationFailed
from app.database.session import get_db
from app.evaluation import benchmark as bench
from app.evaluation.evaluation_service import evaluation_to_out, new_online_evaluation, queue_reference_evaluation
from app.models import BenchmarkRun, EvaluationResult
from app.schemas.evaluation import (
    BenchmarkRunOut,
    BenchmarkRunRequest,
    EvaluationReports,
    MessageEvaluations,
    RawEvaluation,
    ReferenceAnswerRequest,
    RegressionReport,
)
from app.services.benchmark_views import run_to_out
from app.worker import wake_worker

router = APIRouter(prefix="/api", tags=["evaluation"])


def _require_diagnostics(ctx: AuthContext) -> None:
    if not ctx.sees_diagnostics:
        raise ForbiddenError("Evaluation details are only available in the admin portal.")


async def _message_evaluations(db: AsyncSession, message_id: uuid.UUID) -> MessageEvaluations:
    rows = (await db.execute(select(EvaluationResult).options(selectinload(EvaluationResult.metrics))
                             .where(EvaluationResult.message_id == message_id)
                             .order_by(EvaluationResult.created_at.desc()))).scalars().all()
    return MessageEvaluations(message_id=message_id, evaluations=[evaluation_to_out(e) for e in rows])


@router.get("/evaluations/{message_id}", response_model=MessageEvaluations)
async def get_evaluations(message_id: uuid.UUID, ctx: AuthContext = Depends(get_auth_context),
                          db: AsyncSession = Depends(get_db)):
    _require_diagnostics(ctx)
    await owned_message(db, ctx, message_id)
    return await _message_evaluations(db, message_id)


@router.get("/evaluations/{message_id}/raw", response_model=list[RawEvaluation])
async def get_raw_evaluations(message_id: uuid.UUID, ctx: AuthContext = Depends(get_auth_context),
                              db: AsyncSession = Depends(get_db)):
    _require_diagnostics(ctx)
    await owned_message(db, ctx, message_id)
    rows = (await db.execute(select(EvaluationResult).where(EvaluationResult.message_id == message_id)
                             .order_by(EvaluationResult.created_at.desc()))).scalars().all()
    return [RawEvaluation(evaluation_id=e.id, framework=e.framework, inputs=e.inputs or {}, raw=e.raw or {})
            for e in rows]


@router.post("/evaluations/{message_id}/reference", response_model=MessageEvaluations)
async def add_reference(message_id: uuid.UUID, body: ReferenceAnswerRequest,
                        ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    _require_diagnostics(ctx)
    msg = await owned_message(db, ctx, message_id)
    if msg.role != "assistant" or msg.status != "completed":
        raise ValidationFailed("Reference answers can only be added to completed document-grounded answers.")
    msg.reference_answer = body.reference_answer.strip()
    try:
        await queue_reference_evaluation(db, msg, msg.reference_answer)
    except ValueError as exc:
        raise ValidationFailed(str(exc)) from exc
    await db.commit()
    wake_worker()
    return await _message_evaluations(db, message_id)


@router.post("/evaluations/{message_id}/rerun", response_model=MessageEvaluations)
async def rerun_evaluation(message_id: uuid.UUID, ctx: AuthContext = Depends(get_auth_context),
                           db: AsyncSession = Depends(get_db)):
    _require_diagnostics(ctx)
    msg = await owned_message(db, ctx, message_id)
    latest = (await db.execute(select(EvaluationResult).where(
        EvaluationResult.message_id == msg.id, EvaluationResult.framework == "ragas")
        .order_by(EvaluationResult.created_at.desc()))).scalars().first()
    if latest is None or not (latest.inputs or {}).get("contexts"):
        raise ValidationFailed("This answer has no retrieved context to evaluate.")
    inputs = latest.inputs
    db.add(new_online_evaluation(msg, question=inputs.get("question", ""), answer=inputs.get("answer", msg.content),
                                 contexts=inputs["contexts"], reference=inputs.get("reference") or msg.reference_answer,
                                 run_id=inputs.get("run_id"), skip_reason=None))
    await db.commit()
    wake_worker()
    return await _message_evaluations(db, message_id)


async def _queue_benchmark(ctx: AuthContext, framework: str, body: BenchmarkRunRequest) -> BenchmarkRunOut:
    if body.dataset not in bench.list_datasets():
        raise NotFoundError(f"Dataset '{body.dataset}' not found. Available: {bench.list_datasets()}")
    run = await bench.create_run(ctx.workspace_id, framework, body.dataset, limit=body.limit, label=body.label,
                                 retrieval_modes=list(body.retrieval_modes), set_baseline=body.set_baseline)
    wake_worker()
    return run_to_out(run)


@router.post("/evaluation/ragas/run", response_model=BenchmarkRunOut, status_code=202)
async def run_ragas(body: BenchmarkRunRequest,
                    ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_RUN))):
    return await _queue_benchmark(ctx, "ragas", body)


@router.post("/evaluation/deepeval/run", response_model=BenchmarkRunOut, status_code=202)
async def run_deepeval(body: BenchmarkRunRequest,
                       ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_RUN))):
    return await _queue_benchmark(ctx, "deepeval", body)


@router.post("/evaluation/retrieval/run", response_model=BenchmarkRunOut, status_code=202)
async def run_retrieval(body: BenchmarkRunRequest,
                        ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_RUN))):
    return await _queue_benchmark(ctx, "retrieval", body)


def _visible_runs(ctx: AuthContext):
    # Global admins also see CLI runs recorded under the shared benchmark workspaces.
    cond = BenchmarkRun.workspace_id == ctx.workspace_id
    if ctx.user.role == "admin":
        from app.models import User, Workspace

        bench_ws = select(Workspace.id).join(User, User.id == Workspace.owner_id).where(User.email == bench.BENCHMARK_EMAIL)
        cond = or_(cond, BenchmarkRun.workspace_id.in_(bench_ws))
    return cond


@router.get("/evaluation/reports", response_model=EvaluationReports)
async def reports(ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_VIEW)),
                  db: AsyncSession = Depends(get_db)):
    runs = (await db.execute(select(BenchmarkRun).where(_visible_runs(ctx))
                             .order_by(BenchmarkRun.created_at.desc()).limit(50))).scalars().all()
    regressions = []
    seen = set()
    for r in runs:
        reg = (r.summary or {}).get("regression")
        if r.status == "completed" and reg and r.framework not in seen:
            seen.add(r.framework)
            regressions.append(RegressionReport.model_validate(reg))
    return EvaluationReports(runs=[run_to_out(r) for r in runs], datasets=bench.list_datasets(),
                             regressions=regressions)


async def _visible_run(db: AsyncSession, ctx: AuthContext, run_id: uuid.UUID) -> BenchmarkRun:
    run = (await db.execute(select(BenchmarkRun).where(BenchmarkRun.id == run_id, _visible_runs(ctx)))).scalar_one_or_none()
    if run is None:
        raise NotFoundError("Benchmark run not found.")
    return run


@router.get("/evaluation/runs/{run_id}", response_model=BenchmarkRunOut)
async def get_run(run_id: uuid.UUID, ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_VIEW)),
                  db: AsyncSession = Depends(get_db)):
    return run_to_out(await _visible_run(db, ctx, run_id))


@router.post("/evaluation/runs/{run_id}/baseline", response_model=BenchmarkRunOut)
async def set_baseline(run_id: uuid.UUID, ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_RUN)),
                       db: AsyncSession = Depends(get_db)):
    run = await _visible_run(db, ctx, run_id)
    if run.status != "completed":
        raise ValidationFailed("Only completed runs can be a baseline.")
    others = (await db.execute(select(BenchmarkRun).where(BenchmarkRun.workspace_id == run.workspace_id,
                                                          BenchmarkRun.framework == run.framework,
                                                          BenchmarkRun.is_baseline.is_(True)))).scalars().all()
    for o in others:
        o.is_baseline = False
    run.is_baseline = True
    await db.commit()
    return run_to_out(run)


@router.get("/evaluation/runs/{run_id}/export")
async def export_run(run_id: uuid.UUID, format: Literal["json", "csv"] = "json",
                     ctx: AuthContext = Depends(require_permission(Permission.EVALUATION_VIEW)),
                     db: AsyncSession = Depends(get_db)):
    run = await _visible_run(db, ctx, run_id)
    rel = (run.report_paths or {}).get(format)
    if not rel:
        raise NotFoundError("No report has been written for this run yet.")
    path = (BACKEND_DIR / rel).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
    if bench.RESULTS_DIR.resolve() not in path.parents or not path.exists():
        raise NotFoundError("Report file not found.")
    return FileResponse(path, filename=Path(rel).name,
                        media_type="application/json" if format == "json" else "text/csv")
