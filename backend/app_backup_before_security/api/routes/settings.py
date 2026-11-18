from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.api.deps import AuthContext, get_auth_context, require_writer
from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.database.session import get_db
from app.evaluation.evaluation_service import evaluator_unavailable_reason
from app.ingestion.validators import SUPPORTED_EXTENSIONS
from app.models import Workspace
from app.observability.tracing import tracing_enabled
from app.schemas.settings import SystemInfo, WorkspaceSettings

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/system", response_model=SystemInfo)
async def system_info(_: AuthContext = Depends(get_auth_context)) -> SystemInfo:
    s = get_settings()
    return SystemInfo(
        app_name=s.app_name, version=__version__, available_models=s.model_list, default_model=s.llm_model,
        embedding_provider=s.embedding_provider, embedding_model=s.embedding_model,
        embedding_dimensions=s.embedding_dimensions,
        reranker_model=s.reranker_model if s.reranker_provider != "none" else None,
        llm_configured=s.llm_configured, langsmith_enabled=tracing_enabled(),
        langsmith_project=s.langsmith_project if s.langsmith_enabled else None, ocr_enabled=s.ocr_enabled,
        max_upload_mb=s.max_upload_mb, supported_extensions=SUPPORTED_EXTENSIONS,
        online_evaluation_available=evaluator_unavailable_reason() is None,
    )


@router.get("/settings", response_model=WorkspaceSettings)
async def get_workspace_settings(ctx: AuthContext = Depends(get_auth_context)) -> WorkspaceSettings:
    return WorkspaceSettings.from_stored(ctx.workspace.settings)


@router.put("/settings", response_model=WorkspaceSettings)
async def update_workspace_settings(body: WorkspaceSettings, ctx: AuthContext = Depends(require_writer),
                                    db: AsyncSession = Depends(get_db)) -> WorkspaceSettings:
    if body.generation.model not in get_settings().model_list:
        raise ValidationFailed(f"Model '{body.generation.model}' is not enabled on this server.")
    ws = await db.get(Workspace, ctx.workspace_id)
    ws.settings = body.model_dump()
    await db.commit()
    return body
