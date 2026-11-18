"""LangSmith tracing with privacy-conscious redaction.

When ``LANGSMITH_TRACING``/``LANGCHAIN_TRACING_V2`` is true and an API key is configured,
the whole RAG lifecycle (query analysis, embedding, dense + BM25 retrieval, fusion,
reranking, generation, verification) is traced. Unless ``TRACE_DOCUMENT_CONTENT=true``,
document text is redacted from every run before it leaves the process:

* values under content-bearing keys (``content``, ``contexts``, ``page_content`` ...) and
* anything between ``<passage>`` tags inside prompts sent to the LLM.

Questions and generated answers are traced (they are needed to debug the assistant) unless
``TRACE_QA_CONTENT=false``, which hides all inputs/outputs and keeps only span names, timings,
token usage and metadata.
"""

from __future__ import annotations

import dataclasses
import os
import re
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from functools import wraps
from typing import Any

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)

_CONTENT_KEYS = {"content", "page_content", "context", "contexts", "retrieved_contexts", "context_text",
                 "documents", "passages", "chunks", "snippet", "reference_contexts"}
_PASSAGE_RE = re.compile(r"(<passage\b[^>]*>)(.*?)(</passage>)", re.DOTALL)
_client = None
_configured = False


def _redact_string(value: str) -> str:
    return _PASSAGE_RE.sub(lambda m: f"{m.group(1)}[redacted {len(m.group(2))} chars]{m.group(3)}", value)


def _to_plain(obj: Any) -> Any:
    """Turn dataclasses / pydantic models (LangGraph state, LangChain messages) into dicts so they can be
    redacted *before* the SDK serialises them."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: getattr(obj, f.name) for f in dataclasses.fields(obj)}
    if isinstance(obj, BaseModel):
        try:
            return obj.model_dump()
        except Exception:
            return str(obj)
    return obj


def redact(obj: Any, _key: str | None = None, _depth: int = 0) -> Any:
    """Mask document text: passage bodies inside prompts and values under content-bearing keys."""
    if _depth > 14:
        return "[truncated]"
    obj = _to_plain(obj)
    if isinstance(obj, dict):
        return {k: redact(v, str(k).lower(), _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [redact(v, _key, _depth + 1) for v in obj]
    if isinstance(obj, str):
        if "<passage" in obj:
            return _redact_string(obj)
        if _key in _CONTENT_KEYS and obj:
            return f"[redacted {len(obj)} chars]"
        return obj
    return obj


def hide_all(obj: Any) -> dict:
    """Strict mode (TRACE_QA_CONTENT=false): no inputs/outputs at all; spans keep names, timings, metadata."""
    return {"redacted": True}


def configure_tracing() -> None:
    """Configure LangSmith from settings. Safe to call more than once."""
    global _client, _configured
    settings = get_settings()
    if not settings.langsmith_enabled:
        os.environ["LANGSMITH_TRACING"] = "false"
        os.environ["LANGCHAIN_TRACING_V2"] = "false"
        _configured = True
        return
    api_key = settings.langsmith_api_key.get_secret_value()
    os.environ.update({
        "LANGSMITH_TRACING": "true",
        "LANGCHAIN_TRACING_V2": "true",
        "LANGSMITH_API_KEY": api_key,
        "LANGSMITH_PROJECT": settings.langsmith_project,
        "LANGSMITH_ENDPOINT": settings.langsmith_endpoint,
    })
    try:
        import langsmith
        from langsmith import Client

        hide = hide_all if not settings.trace_qa_content else (None if settings.trace_document_content else redact)
        _client = Client(api_key=api_key, api_url=settings.langsmith_endpoint, hide_inputs=hide, hide_outputs=hide)
        langsmith.configure(client=_client, enabled=True, project_name=settings.langsmith_project)
        log.info("LangSmith tracing enabled (project=%s, document content %s, questions/answers %s)",
                 settings.langsmith_project, "INCLUDED" if settings.trace_document_content else "redacted",
                 "included" if settings.trace_qa_content else "hidden")
    except Exception as exc:  # pragma: no cover - SDK/config problem must never break the app
        log.warning("LangSmith configuration failed: %s", exc)
        _client = None
    _configured = True


def tracing_enabled() -> bool:
    return get_settings().langsmith_enabled and _client is not None


def get_client():
    return _client


def traceable(name: str, run_type: str = "chain") -> Callable:
    """``langsmith.traceable`` that degrades to a no-op wrapper when the SDK is missing."""
    try:
        from langsmith import traceable as ls_traceable

        return ls_traceable(name=name, run_type=run_type)
    except Exception:  # pragma: no cover
        def decorator(fn):
            @wraps(fn)
            async def wrapper(*args, **kwargs):
                return await fn(*args, **kwargs)
            return wrapper
        return decorator


@contextmanager
def trace_request(*, run_name: str, metadata: dict, tags: list[str] | None = None):
    """Attach request metadata (session id, model, retrieval config...) to every nested run."""
    if not tracing_enabled():
        yield
        return
    from langsmith import tracing_context

    with tracing_context(enabled=True, project_name=get_settings().langsmith_project, metadata=metadata,
                         tags=tags or [run_name]):
        yield


def log_feedback(run_id: str | uuid.UUID | None, key: str, score: float | None, comment: str | None = None) -> None:
    """Attach an evaluation score to a LangSmith run (no-op when tracing is disabled)."""
    if not run_id or score is None or not tracing_enabled():
        return
    try:
        _client.create_feedback(run_id=run_id, key=key, score=float(score), comment=(comment or "")[:2000])
    except Exception as exc:
        log.warning("LangSmith feedback failed for run %s: %s", run_id, exc)


def flush() -> None:
    if _client is not None:
        try:
            _client.flush()
        except Exception:  # pragma: no cover
            pass
