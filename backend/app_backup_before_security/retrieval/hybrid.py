"""Hybrid retrieval pipeline.

    query → dense (pgvector) ┐
                             ├→ RRF fusion → de-duplication → cross-encoder rerank → context selection
    query → BM25 (Postgres)  ┘

Each stage is timed with a monotonic clock and traced to LangSmith when enabled.
"""

from __future__ import annotations

import asyncio
import time
import uuid

from sqlalchemy import select

from app.core.timing import StageTimer
from app.database.session import get_sessionmaker
from app.embeddings.provider import embed_query, embedding_model_id
from app.models import Document, DocumentChunk
from app.observability.tracing import traceable
from app.retrieval.bm25 import bm25_search
from app.retrieval.dense import dense_search
from app.retrieval.fusion import reciprocal_rank_fusion
from app.retrieval.reranker import get_reranker
from app.retrieval.types import Candidate, Hit, RetrievalOutcome, RetrievalScope
from app.schemas.settings import RetrievalSettings


RERANK_MAX_CHARS = 1200


async def _timed(coro_factory) -> tuple[list[Hit], float]:
    t0 = time.perf_counter()
    async with get_sessionmaker()() as session:
        async with session.begin():
            hits = await coro_factory(session)
    return hits, time.perf_counter() - t0


@traceable(name="embed_query", run_type="embedding")
async def _embed_queries(queries: list[str]) -> list[list[float]]:
    return list(await asyncio.gather(*(embed_query(q) for q in queries)))


@traceable(name="dense_retrieval", run_type="retriever")
async def _dense(scope: RetrievalScope, vectors: list[list[float]], k: int) -> tuple[dict[str, list[Hit]], float]:
    model = embedding_model_id()
    results = await asyncio.gather(*(
        _timed(lambda s, v=v: dense_search(s, scope, v, k, model)) for v in vectors))
    return {f"dense#{i}": hits for i, (hits, _) in enumerate(results)}, max((t for _, t in results), default=0.0)


@traceable(name="bm25_retrieval", run_type="retriever")
async def _bm25(scope: RetrievalScope, queries: list[str], k: int) -> tuple[dict[str, list[Hit]], float]:
    results = await asyncio.gather(*(_timed(lambda s, q=q: bm25_search(s, scope, q, k)) for q in queries))
    return {f"bm25#{i}": hits for i, (hits, _) in enumerate(results)}, max((t for _, t in results), default=0.0)


async def _load_candidates(ids: list[uuid.UUID]) -> dict[uuid.UUID, Candidate]:
    if not ids:
        return {}
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(DocumentChunk.id, DocumentChunk.document_id, DocumentChunk.content, DocumentChunk.section_title,
                   DocumentChunk.page_number, DocumentChunk.page_end, DocumentChunk.chunk_type,
                   DocumentChunk.parent_id, DocumentChunk.content_hash, DocumentChunk.chunk_metadata,
                   Document.title, Document.filename)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.id.in_(ids))
        )).all()
    return {
        r.id: Candidate(chunk_id=r.id, document_id=r.document_id, document_name=r.title or r.filename,
                        content=r.content, section_title=r.section_title, page_number=r.page_number,
                        page_end=r.page_end, chunk_type=r.chunk_type, parent_id=r.parent_id,
                        content_hash=r.content_hash, metadata=r.chunk_metadata or {})
        for r in rows
    }


async def _load_parent_texts(parent_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, int | None, int | None]]:
    if not parent_ids:
        return {}
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(DocumentChunk.id, DocumentChunk.content, DocumentChunk.page_number, DocumentChunk.page_end)
            .where(DocumentChunk.id.in_(parent_ids)))).all()
    return {r.id: (r.content, r.page_number, r.page_end) for r in rows}


def deduplicate(candidates: list[Candidate]) -> list[Candidate]:
    """Drop exact/near-exact duplicates (same normalised content) and sibling children of one parent."""
    seen_hash: dict[str, uuid.UUID] = {}
    seen_parent: dict[uuid.UUID, uuid.UUID] = {}
    unique: list[Candidate] = []
    for c in candidates:
        if c.content_hash and c.content_hash in seen_hash:
            c.duplicate_of = seen_hash[c.content_hash]
            continue
        if c.parent_id is not None and c.parent_id in seen_parent:
            c.duplicate_of = seen_parent[c.parent_id]
            continue
        if c.content_hash:
            seen_hash[c.content_hash] = c.chunk_id
        if c.parent_id is not None:
            seen_parent[c.parent_id] = c.chunk_id
        unique.append(c)
    return unique


@traceable(name="rerank", run_type="chain")
async def _rerank(query: str, candidates: list[Candidate]) -> bool:
    reranker = get_reranker()
    if reranker is None or not candidates:
        return False
    # ~250 tokens per passage keeps CPU cross-encoder latency low with little quality loss.
    docs = [(f"{c.section_title}\n{c.content}" if c.section_title else c.content)[:RERANK_MAX_CHARS]
            for c in candidates]
    scores = await reranker.score(query, docs)
    for c, s in zip(candidates, scores, strict=True):
        c.rerank_score = s
    return True


class HybridRetriever:
    async def retrieve(self, *, query: str, search_queries: list[str], scope: RetrievalScope,
                       cfg: RetrievalSettings, timer: StageTimer) -> RetrievalOutcome:
        queries = list(dict.fromkeys(q.strip() for q in [*search_queries] if q and q.strip())) or [query]
        mode = cfg.mode
        lists: dict[str, list[Hit]] = {}
        tasks = []

        if mode in ("hybrid", "dense"):
            async with timer.astage("embedding"):
                vectors = await _embed_queries(queries)
            tasks.append(("dense_retrieval", _dense(scope, vectors, cfg.top_k)))
        if mode in ("hybrid", "bm25"):
            tasks.append(("bm25_retrieval", _bm25(scope, queries, cfg.top_k)))
        results = await asyncio.gather(*(t for _, t in tasks))
        for (stage, _), (hit_lists, seconds) in zip(tasks, results, strict=True):
            timer.add(stage, seconds)
            lists.update(hit_lists)

        async with timer.astage("fusion"):
            weights = {k: (cfg.dense_weight if k.startswith("dense") else cfg.sparse_weight) for k in lists}
            fused = reciprocal_rank_fusion(lists, k=cfg.rrf_k, weights=weights)[: cfg.top_k * 2]
            loaded = await _load_candidates([f.chunk_id for f in fused])
            candidates: list[Candidate] = []
            for f in fused:
                c = loaded.get(f.chunk_id)
                if c is None:  # deleted between search and load
                    continue
                c.dense_rank, c.dense_score = f.ranks.get("dense"), f.scores.get("dense")
                c.bm25_rank, c.bm25_score = f.ranks.get("bm25"), f.scores.get("bm25")
                c.rrf_score, c.fused_rank = f.rrf_score, f.fused_rank
                candidates.append(c)

        async with timer.astage("deduplication"):
            unique = deduplicate(candidates)

        reranked = False
        pool, tail = unique[: cfg.top_k], unique[cfg.top_k:]  # rerank the fused top-k only (latency)
        if cfg.reranker_enabled and pool:
            async with timer.astage("reranking"):
                reranked = await _rerank(query, pool)
        ordered = (sorted(pool, key=lambda c: -c.rerank_score) + tail) if reranked else unique
        for i, c in enumerate(ordered, start=1):
            c.final_rank = i
        selected = ordered[: cfg.final_k]

        async with timer.astage("context_preparation"):
            parents = await _load_parent_texts([c.parent_id for c in selected if c.parent_id])
            for i, c in enumerate(selected, start=1):
                c.selected = True
                c.context_index = i
                if c.parent_id and c.parent_id in parents:
                    text, p0, p1 = parents[c.parent_id]
                    c.context_text = text
                    c.page_number = c.page_number or p0
                    c.page_end = c.page_end or p1
                else:
                    c.context_text = c.content

        config = {**cfg.model_dump(), "reranker_applied": reranked,
                  "reranker_model": getattr(get_reranker(), "name", None) if reranked else None,
                  "embedding_model": embedding_model_id() if mode != "bm25" else None}
        return RetrievalOutcome(query=query, search_queries=queries, mode=mode, config=config,
                                candidates=candidates, selected=selected)
