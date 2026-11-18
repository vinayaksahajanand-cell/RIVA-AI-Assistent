"""RIVA AI FastAPI application."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import admin, analytics, auth, chat, conversations, documents, evaluations, health, settings
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.database.session import dispose_engine
from app.evaluation.env import configure_evaluation_env
from app.observability.tracing import configure_tracing

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    configure_logging(s.log_level, s.log_json)
    configure_evaluation_env()
    configure_tracing()
    if s.environment == "production" and "change-me" in s.secret_key.get_secret_value():
        raise RuntimeError("SECRET_KEY must be set to a strong random value in production.")
    s.storage_dir.mkdir(parents=True, exist_ok=True)
    stop = asyncio.Event()
    worker_task = None
    if s.embedded_worker and s.environment != "test":
        from app.worker import run_worker

        worker_task = asyncio.create_task(run_worker(stop))
    if s.reranker_provider != "none" and s.environment != "test":
        from app.retrieval.reranker import warm_up_reranker

        asyncio.get_running_loop().run_in_executor(None, warm_up_reranker)
    log.info("RIVA AI %s started (env=%s, llm_configured=%s, embeddings=%s:%s)", __version__, s.environment,
             s.llm_configured, s.embedding_provider, s.embedding_model)
    yield
    stop.set()
    if worker_task:
        worker_task.cancel()
        try:
            await worker_task
        except (asyncio.CancelledError, Exception):
            pass
    await dispose_engine()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="RIVA AI API",
        description="RIVA — Research, Intelligence & Virtual Assistant. Document intelligence with hybrid search, "
                    "corrective RAG, RAGAS/DeepEval evaluation and LangSmith observability.",
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Workspace-Id", "X-Request-Id"],
        expose_headers=["X-Request-Id", "Content-Disposition"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

    register_exception_handlers(app)
    for module in (health, auth, settings, documents, chat, conversations, evaluations, analytics, admin):
        app.include_router(module.router)

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"name": "RIVA AI API", "version": __version__, "docs": "/docs", "health": "/api/health"}

    return app


app = create_app()
