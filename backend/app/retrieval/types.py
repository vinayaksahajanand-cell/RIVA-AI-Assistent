from __future__ import annotations

import uuid
from dataclasses import dataclass, field


@dataclass
class Hit:
    chunk_id: uuid.UUID
    score: float
    rank: int  # 1-based


@dataclass
class Candidate:
    chunk_id: uuid.UUID
    document_id: uuid.UUID | None = None
    document_name: str = ""
    content: str = ""
    section_title: str | None = None
    page_number: int | None = None
    page_end: int | None = None
    chunk_type: str = "standard"
    parent_id: uuid.UUID | None = None
    content_hash: str = ""
    metadata: dict = field(default_factory=dict)
    dense_rank: int | None = None
    dense_score: float | None = None
    bm25_rank: int | None = None
    bm25_score: float | None = None
    rrf_score: float = 0.0
    fused_rank: int | None = None
    rerank_score: float | None = None
    final_rank: int | None = None
    selected: bool = False
    relevant: bool | None = None
    context_text: str | None = None  # text handed to the LLM (parent content for child chunks)
    context_index: int | None = None
    duplicate_of: uuid.UUID | None = None

    def snippet(self, length: int = 280) -> str:
        text = " ".join(self.content.split())
        return text if len(text) <= length else text[: length - 1].rstrip() + "…"


@dataclass
class RetrievalScope:
    workspace_id: uuid.UUID
    document_ids: list[uuid.UUID] | None = None  # None = all documents in the workspace
    # RBAC: classifications the caller may retrieve (None = no restriction, e.g. offline benchmarks)
    classifications: list[str] | None = None


@dataclass
class RetrievalOutcome:
    query: str
    search_queries: list[str]
    mode: str
    config: dict
    candidates: list[Candidate]
    selected: list[Candidate]

    @property
    def contexts(self) -> list[str]:
        return [c.context_text or c.content for c in self.selected]
