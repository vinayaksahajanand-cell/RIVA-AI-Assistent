"""Chat request/response contracts, including the SSE event payloads.

SSE stream (POST /api/chat/stream) emits, in order:
  event: meta       {conversation_id, user_message_id, assistant_message_id, run_id}
  event: status     {stage, label}                    (0..n, pipeline progress)
  event: retrieval  RetrievalInfo                     (once retrieval is final)
  event: token      {delta}                           (0..n, streamed answer text)
  event: done       {message: MessageOut}             (final persisted assistant message)
  event: error      {code, message}                   (terminal failure)
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.evaluation import EvaluationOut
from app.schemas.settings import RetrievalMode


class RetrievalOverrides(BaseModel):
    mode: RetrievalMode | None = None
    top_k: int | None = Field(default=None, ge=1, le=50)
    final_k: int | None = Field(default=None, ge=1, le=12)
    reranker_enabled: bool | None = None
    rrf_k: int | None = Field(default=None, ge=1, le=500)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=200)
    collection_id: uuid.UUID | None = None
    model: str | None = Field(default=None, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=64, le=8192)
    grounded_only: bool | None = None
    retrieval: RetrievalOverrides | None = None
    reference_answer: str | None = Field(default=None, max_length=20000)
    regenerate: bool = False  # re-answer the last user message of conversation_id


class CitationOut(BaseModel):
    index: int  # the [n] marker used in the answer text
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    page_number: int | None
    page_end: int | None
    section_title: str | None
    snippet: str


class RetrievedSourceOut(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    page_number: int | None
    page_end: int | None
    section_title: str | None
    snippet: str
    content: str | None = None  # full text of the context actually given to the LLM (selected only)
    dense_rank: int | None
    dense_score: float | None  # cosine similarity
    bm25_rank: int | None
    bm25_score: float | None  # Okapi BM25 score
    fused_rank: int | None
    rrf_score: float | None
    rerank_score: float | None  # cross-encoder logit, when reranking ran
    final_rank: int | None
    selected: bool
    relevant: bool | None = None  # LLM relevance grade, when grading ran
    context_index: int | None = None  # [n] number in the prompt, when selected


class RetrievalInfo(BaseModel):
    query: str
    search_queries: list[str]
    mode: str
    config: dict
    attempts: int
    retrieval_success: bool
    grade: dict
    sources: list[RetrievedSourceOut]


class PerformanceOut(BaseModel):
    stages_ms: dict[str, float]
    time_to_first_token_ms: float | None
    total_ms: float
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    estimated_cost_usd: float | None
    llm_calls: int
    model: str | None


class VerificationOut(BaseModel):
    status: str = "not_run"  # completed | skipped | failed | not_run
    grounded: bool | None = None
    supported_claims: int | None = None
    total_claims: int | None = None
    unsupported_claims: list[str] = []
    contradictions: list[str] = []
    notes: str | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    status: str  # streaming | completed | insufficient_context | failed
    model: str | None
    created_at: datetime
    reply_to_id: uuid.UUID | None
    citations: list[CitationOut] = []
    verification: VerificationOut | None = None
    performance: PerformanceOut | None = None
    retrieval: RetrievalInfo | None = None
    evaluations: list[EvaluationOut] = []
    feedback_rating: int | None = None
    reference_answer: str | None = None
    error_message: str | None = None
    metadata: dict = {}


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    user_message: MessageOut
    assistant_message: MessageOut


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    last_message_preview: str | None = None


class ConversationDetail(ConversationOut):
    scope: dict = {}
    messages: list[MessageOut] = []


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class FeedbackRequest(BaseModel):
    rating: int = Field(description="+1 (thumbs up) or -1 (thumbs down)")
    comment: str | None = Field(default=None, max_length=2000)


class SuggestedQuestions(BaseModel):
    questions: list[str]
