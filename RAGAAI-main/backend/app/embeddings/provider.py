"""Embedding providers (OpenAI or local FastEmbed/ONNX) with batching, retries and query caching."""

from __future__ import annotations

import asyncio
import hashlib
import threading
from collections.abc import Awaitable, Callable

import orjson
from langchain_core.embeddings import Embeddings
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.errors import ServiceUnavailable
from app.core.logging import get_logger

log = get_logger(__name__)

ProgressCallback = Callable[[int, int], Awaitable[None]]


class EmbeddingDimensionMismatch(Exception):
    pass


class FastEmbedEmbeddings(Embeddings):
    """LangChain-compatible wrapper around fastembed's ONNX models (CPU, fully local)."""

    _models: dict[str, object] = {}
    _lock = threading.Lock()

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    def _model(self):
        with self._lock:
            if self.model_name not in self._models:
                from fastembed import TextEmbedding

                self._models[self.model_name] = TextEmbedding(self.model_name)
            return self._models[self.model_name]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [v.tolist() for v in self._model().passage_embed(texts)]

    def embed_query(self, text: str) -> list[float]:
        return next(iter(self._model().query_embed([text]))).tolist()

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self.embed_documents, texts)

    async def aembed_query(self, text: str) -> list[float]:
        return await asyncio.to_thread(self.embed_query, text)


_embeddings: Embeddings | None = None
_override: Embeddings | None = None


def set_embeddings_override(embeddings: Embeddings | None) -> None:
    """Test hook: inject a deterministic embeddings model."""
    global _override, _embeddings
    _override = embeddings
    _embeddings = None


def get_embeddings() -> Embeddings:
    global _embeddings
    if _override is not None:
        return _override
    if _embeddings is None:
        settings = get_settings()
        if settings.embedding_provider == "fastembed":
            _embeddings = FastEmbedEmbeddings(settings.embedding_model)
        else:
            if settings.openai_api_key is None and not settings.openai_base_url:
                raise ServiceUnavailable("Embeddings are not configured: set OPENAI_API_KEY "
                                         "(or EMBEDDING_PROVIDER=fastembed for local embeddings).")
            from langchain_openai import OpenAIEmbeddings

            kwargs = {}
            if settings.embedding_model.startswith("text-embedding-3"):
                kwargs["dimensions"] = settings.embedding_dimensions
            _embeddings = OpenAIEmbeddings(
                model=settings.embedding_model,
                api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else "not-needed",
                base_url=settings.openai_base_url,
                chunk_size=settings.embedding_batch_size,
                max_retries=3,
                **kwargs,
            )
    return _embeddings


def embedding_model_id() -> str:
    s = get_settings()
    return f"{s.embedding_provider}:{s.embedding_model}:{s.embedding_dimensions}"


def _check_dims(vectors: list[list[float]]) -> None:
    expected = get_settings().embedding_dimensions
    for v in vectors:
        if len(v) != expected:
            raise EmbeddingDimensionMismatch(
                f"Embedding model returned {len(v)} dimensions but EMBEDDING_DIMENSIONS={expected}. "
                "Update EMBEDDING_DIMENSIONS and run `python -m app.cli reset-embeddings`.")


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=1, min=1, max=20),
       retry=retry_if_exception_type((TimeoutError, ConnectionError, OSError)), reraise=True)
async def _embed_batch(texts: list[str]) -> list[list[float]]:
    return await get_embeddings().aembed_documents(texts)


async def embed_texts(texts: list[str], progress: ProgressCallback | None = None) -> list[list[float]]:
    batch = get_settings().embedding_batch_size
    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch):
        part = await _embed_batch(texts[start:start + batch])
        _check_dims(part)
        vectors.extend(part)
        if progress:
            await progress(min(start + batch, len(texts)), len(texts))
    return vectors


async def embed_query(text: str) -> list[float]:
    cache = get_cache()
    key = "riva:qemb:" + hashlib.sha256(f"{embedding_model_id()}|{text}".encode()).hexdigest()
    cached = await cache.get(key)
    if cached:
        return orjson.loads(cached)
    vector = await get_embeddings().aembed_query(text)
    _check_dims([vector])
    await cache.set(key, orjson.dumps(vector), ttl=24 * 3600)
    return vector
