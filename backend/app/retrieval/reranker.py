"""Cross-encoder reranking (local ONNX model via fastembed)."""

from __future__ import annotations

import asyncio
import threading
from typing import Protocol

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


class Reranker(Protocol):
    name: str

    async def score(self, query: str, documents: list[str]) -> list[float]: ...


class CrossEncoderReranker:
    _models: dict[str, object] = {}
    _lock = threading.Lock()

    def __init__(self, model_name: str) -> None:
        self.name = model_name

    def _model(self):
        with self._lock:
            if self.name not in self._models:
                from fastembed.rerank.cross_encoder import TextCrossEncoder

                self._models[self.name] = TextCrossEncoder(self.name)
            return self._models[self.name]

    def _score_sync(self, query: str, documents: list[str]) -> list[float]:
        return [float(s) for s in self._model().rerank(query, documents)]

    async def score(self, query: str, documents: list[str]) -> list[float]:
        if not documents:
            return []
        return await asyncio.to_thread(self._score_sync, query, documents)


_override: Reranker | None = None


def set_reranker_override(reranker: Reranker | None) -> None:
    global _override
    _override = reranker


def get_reranker() -> Reranker | None:
    if _override is not None:
        return _override
    settings = get_settings()
    if settings.reranker_provider == "none":
        return None
    return CrossEncoderReranker(settings.reranker_model)


def warm_up_reranker() -> None:
    reranker = get_reranker()
    if isinstance(reranker, CrossEncoderReranker):
        try:
            reranker._model()
        except Exception as exc:  # pragma: no cover - model download failure
            log.warning("Reranker warm-up failed: %s", exc)
