from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import __version__
from app.core.cache import get_cache
from app.core.config import get_settings
from app.database.session import get_engine
from app.evaluation.deepeval_evaluator import deepeval_version
from app.evaluation.ragas_evaluator import ragas_version
from app.observability.tracing import tracing_enabled

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health() -> JSONResponse:
    s = get_settings()
    checks: dict = {"database": "unknown", "pgvector": "unknown"}
    ok = True
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
            checks["database"] = "ok"
            version = await conn.scalar(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
            checks["pgvector"] = f"ok ({version})" if version else "missing"
            ok = ok and bool(version)
            checks["migrations"] = await conn.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))
    except Exception as exc:
        checks["database"] = f"error: {exc.__class__.__name__}"
        ok = False
    cache = get_cache()
    checks["cache"] = f"{cache.backend_name}: {'ok' if await cache.ping() else 'unreachable'}"
    body = {
        "status": "ok" if ok else "degraded",
        "version": __version__,
        "environment": s.environment,
        **checks,
        "worker": "embedded" if s.embedded_worker else "external",
        "llm_configured": s.llm_configured,
        "embedding": {"provider": s.embedding_provider, "model": s.embedding_model, "dimensions": s.embedding_dimensions},
        "reranker": s.reranker_model if s.reranker_provider != "none" else None,
        "langsmith": {"enabled": tracing_enabled(), "project": s.langsmith_project if s.langsmith_enabled else None,
                      "document_content_traced": s.trace_document_content},
        "evaluation": {"ragas": ragas_version(), "deepeval": deepeval_version(),
                       "online_enabled": s.online_evaluation_enabled},
    }
    return JSONResponse(status_code=200 if ok else 503, content=body)
