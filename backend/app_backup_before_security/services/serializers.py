"""Convert persisted chat records into API models."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.evaluation.evaluation_service import evaluations_for_messages
from app.models import Feedback, Message, PerformanceMetric, RetrievalEvent
from app.schemas.chat import (
    CitationOut,
    MessageOut,
    PerformanceOut,
    RetrievalInfo,
    RetrievedSourceOut,
    VerificationOut,
)


def retrieval_info(event: RetrievalEvent) -> RetrievalInfo:
    return RetrievalInfo(
        query=event.query, search_queries=event.rewritten_queries or [event.query],
        mode=(event.config or {}).get("mode", "hybrid"), config=event.config or {}, attempts=event.attempts,
        retrieval_success=event.retrieval_success, grade=event.grade or {},
        sources=[RetrievedSourceOut.model_validate({k: v for k, v in c.items() if k != "duplicate_of"})
                 for c in (event.candidates or [])],
    )


def performance_out(p: PerformanceMetric) -> PerformanceOut:
    return PerformanceOut(stages_ms=p.stages_ms or {}, time_to_first_token_ms=p.time_to_first_token_ms,
                          total_ms=p.total_ms, prompt_tokens=p.prompt_tokens, completion_tokens=p.completion_tokens,
                          total_tokens=p.total_tokens, estimated_cost_usd=p.estimated_cost_usd, llm_calls=p.llm_calls,
                          model=p.model)


async def messages_to_out(db: AsyncSession, messages: list[Message], user_id: uuid.UUID | None = None) -> list[MessageOut]:
    ids = [m.id for m in messages if m.role == "assistant"]
    perf = {p.message_id: p for p in (await db.execute(
        select(PerformanceMetric).where(PerformanceMetric.message_id.in_(ids)))).scalars()} if ids else {}
    events = {e.message_id: e for e in (await db.execute(
        select(RetrievalEvent).where(RetrievalEvent.message_id.in_(ids)))).scalars()} if ids else {}
    feedback = {}
    if ids and user_id:
        feedback = {f.message_id: f.rating for f in (await db.execute(
            select(Feedback).where(Feedback.message_id.in_(ids), Feedback.user_id == user_id))).scalars()}
    evaluations = await evaluations_for_messages(db, ids)
    out = []
    for m in messages:
        out.append(MessageOut(
            id=m.id, conversation_id=m.conversation_id, role=m.role, content=m.content, status=m.status,
            model=m.model, created_at=m.created_at, reply_to_id=m.reply_to_id,
            citations=[CitationOut.model_validate(c) for c in (m.citations or [])],
            verification=VerificationOut.model_validate(m.verification) if m.verification else None,
            performance=performance_out(perf[m.id]) if m.id in perf else None,
            retrieval=retrieval_info(events[m.id]) if m.id in events else None,
            evaluations=evaluations.get(m.id, []),
            feedback_rating=feedback.get(m.id), reference_answer=m.reference_answer,
            error_message=m.error_message, metadata=m.msg_metadata or {},
        ))
    return out
