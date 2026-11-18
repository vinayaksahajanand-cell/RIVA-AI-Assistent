from __future__ import annotations

from typing import TypedDict

from app.retrieval.types import RetrievalOutcome


class RAGState(TypedDict, total=False):
    question: str
    standalone_query: str
    query_type: str
    needs_retrieval: bool
    is_ambiguous: bool
    search_queries: list[str]
    attempts: int
    outcome: RetrievalOutcome | None
    grade: dict
    sufficient: bool
    answer: str
    status: str  # completed | insufficient_context
    citations: list[dict]
    verification: dict
