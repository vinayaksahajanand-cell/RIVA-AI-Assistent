"""JSON-friendly views of retrieval candidates (used for SSE events and retrieval_events rows)."""

from __future__ import annotations

from app.retrieval.types import Candidate, RetrievalOutcome


def _r(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def candidate_to_dict(c: Candidate) -> dict:
    return {
        "chunk_id": str(c.chunk_id), "document_id": str(c.document_id), "document_name": c.document_name,
        "page_number": c.page_number, "page_end": c.page_end, "section_title": c.section_title,
        "snippet": c.snippet(), "content": (c.context_text or c.content) if c.selected else None,
        "dense_rank": c.dense_rank, "dense_score": _r(c.dense_score, 5),
        "bm25_rank": c.bm25_rank, "bm25_score": _r(c.bm25_score, 5),
        "fused_rank": c.fused_rank, "rrf_score": round(c.rrf_score, 6),
        "rerank_score": _r(c.rerank_score, 5), "final_rank": c.final_rank, "selected": c.selected,
        "relevant": c.relevant, "context_index": c.context_index,
        "duplicate_of": str(c.duplicate_of) if c.duplicate_of else None,
    }


def outcome_candidates(outcome: RetrievalOutcome) -> list[dict]:
    ordered = sorted(outcome.candidates, key=lambda c: (c.final_rank is None, c.final_rank or 0, c.fused_rank or 0))
    return [candidate_to_dict(c) for c in ordered]


def retrieval_payload(outcome: RetrievalOutcome, *, query: str, attempts: int, success: bool, grade: dict) -> dict:
    """Shape matches ``schemas.chat.RetrievalInfo``."""
    return {
        "query": query, "search_queries": outcome.search_queries, "mode": outcome.mode, "config": outcome.config,
        "attempts": attempts, "retrieval_success": success, "grade": grade,
        "sources": [{k: v for k, v in c.items() if k != "duplicate_of"} for c in outcome_candidates(outcome)],
    }
