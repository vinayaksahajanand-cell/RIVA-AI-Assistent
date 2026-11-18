from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_auth_context
from app.core.errors import NotFoundError, ValidationFailed
from app.database.session import get_db
from app.models import Conversation, Feedback, Message
from app.schemas.chat import ConversationDetail, ConversationOut, ConversationUpdate, FeedbackRequest, MessageOut
from app.schemas.common import OkResponse
from app.services.serializers import messages_to_out

router = APIRouter(prefix="/api", tags=["conversations"])


async def _owned_conversation(db: AsyncSession, ctx: AuthContext, conversation_id: uuid.UUID) -> Conversation:
    conv = await db.get(Conversation, conversation_id)
    if conv is None or conv.workspace_id != ctx.workspace_id or conv.user_id != ctx.user_id:
        raise NotFoundError("Conversation not found.")
    return conv


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(q: str | None = Query(default=None, max_length=200), limit: int = Query(default=50, le=200),
                             ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    count_sq = (select(Message.conversation_id, func.count(Message.id).label("n"))
                .group_by(Message.conversation_id).subquery())
    stmt = (select(Conversation, func.coalesce(count_sq.c.n, 0))
            .outerjoin(count_sq, count_sq.c.conversation_id == Conversation.id)
            .where(Conversation.workspace_id == ctx.workspace_id, Conversation.user_id == ctx.user_id)
            .order_by(Conversation.updated_at.desc()).limit(limit))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Conversation.title.ilike(like) | Conversation.id.in_(
            select(Message.conversation_id).where(Message.workspace_id == ctx.workspace_id,
                                                  Message.content.ilike(like))))
    rows = (await db.execute(stmt)).all()
    previews = {}
    if rows:
        ids = [c.id for c, _ in rows]
        latest = (select(Message.conversation_id, func.max(Message.created_at).label("ts"))
                  .where(Message.conversation_id.in_(ids)).group_by(Message.conversation_id).subquery())
        previews = {cid: content for cid, content in (await db.execute(
            select(Message.conversation_id, Message.content).join(
                latest, (latest.c.conversation_id == Message.conversation_id) & (latest.c.ts == Message.created_at))
        )).all()}
    return [ConversationOut(id=c.id, title=c.title, created_at=c.created_at, updated_at=c.updated_at, message_count=n,
                            last_message_preview=(previews.get(c.id) or "")[:160] or None) for c, n in rows]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(conversation_id: uuid.UUID, ctx: AuthContext = Depends(get_auth_context),
                           db: AsyncSession = Depends(get_db)):
    conv = await _owned_conversation(db, ctx, conversation_id)
    messages = (await db.execute(select(Message).where(Message.conversation_id == conv.id)
                                 .order_by(Message.created_at))).scalars().all()
    out = await messages_to_out(db, list(messages), ctx.user_id, diagnostics=ctx.sees_diagnostics)
    return ConversationDetail(id=conv.id, title=conv.title, created_at=conv.created_at, updated_at=conv.updated_at,
                              message_count=len(out), scope=conv.scope or {}, messages=out)


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(conversation_id: uuid.UUID, body: ConversationUpdate,
                              ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    conv = await _owned_conversation(db, ctx, conversation_id)
    conv.title = body.title.strip()
    await db.commit()
    return ConversationOut(id=conv.id, title=conv.title, created_at=conv.created_at, updated_at=conv.updated_at)


@router.delete("/conversations/{conversation_id}", response_model=OkResponse)
async def delete_conversation(conversation_id: uuid.UUID, ctx: AuthContext = Depends(get_auth_context),
                              db: AsyncSession = Depends(get_db)):
    conv = await _owned_conversation(db, ctx, conversation_id)
    await db.execute(delete(Conversation).where(Conversation.id == conv.id))
    await db.commit()
    return OkResponse()


def _markdown_export(detail: ConversationDetail) -> str:
    lines = [f"# {detail.title}", "", f"_Exported from RIVA AI · {detail.updated_at:%Y-%m-%d %H:%M} UTC_", ""]
    for m in detail.messages:
        lines.append(f"## {'You' if m.role == 'user' else 'RIVA'}  ·  {m.created_at:%Y-%m-%d %H:%M}")
        lines.append("")
        lines.append(m.content or (f"_({m.error_message})_" if m.error_message else ""))
        if m.citations:
            lines += ["", "**Sources**", ""]
            for c in m.citations:
                page = f", p. {c.page_number}" + (f"–{c.page_end}" if c.page_end and c.page_end != c.page_number else "") \
                    if c.page_number else ""
                lines.append(f"- [{c.index}] {c.document_name}{page}" + (f" — {c.section_title}" if c.section_title else ""))
        if m.performance:
            lines += ["", f"_Response time: {m.performance.total_ms / 1000:.2f} s_"]
        lines.append("")
    return "\n".join(lines)


@router.get("/conversations/{conversation_id}/export")
async def export_conversation(conversation_id: uuid.UUID, format: Literal["markdown", "json"] = "markdown",
                              ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    detail = await get_conversation(conversation_id, ctx, db)
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in detail.title)[:60].strip() or "conversation"
    if format == "json":
        return Response(detail.model_dump_json(indent=2), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{safe}.json"'})
    return Response(_markdown_export(detail), media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.md"'})


async def owned_message(db: AsyncSession, ctx: AuthContext, message_id: uuid.UUID) -> Message:
    msg = await db.get(Message, message_id)
    if msg is None or msg.workspace_id != ctx.workspace_id:
        raise NotFoundError("Message not found.")
    conv = await db.get(Conversation, msg.conversation_id)
    if conv is None or conv.user_id != ctx.user_id:
        raise NotFoundError("Message not found.")
    return msg


@router.get("/messages/{message_id}", response_model=MessageOut)
async def get_message(message_id: uuid.UUID, ctx: AuthContext = Depends(get_auth_context),
                      db: AsyncSession = Depends(get_db)):
    msg = await owned_message(db, ctx, message_id)
    return (await messages_to_out(db, [msg], ctx.user_id, diagnostics=ctx.sees_diagnostics))[0]


@router.post("/messages/{message_id}/feedback", response_model=OkResponse)
async def message_feedback(message_id: uuid.UUID, body: FeedbackRequest, ctx: AuthContext = Depends(get_auth_context),
                           db: AsyncSession = Depends(get_db)):
    if body.rating not in (1, -1):
        raise ValidationFailed("rating must be 1 or -1.")
    msg = await owned_message(db, ctx, message_id)
    if msg.role != "assistant":
        raise ValidationFailed("Feedback can only be given on assistant answers.")
    existing = (await db.execute(select(Feedback).where(Feedback.message_id == msg.id,
                                                        Feedback.user_id == ctx.user_id))).scalar_one_or_none()
    if existing:
        existing.rating, existing.comment = body.rating, body.comment
    else:
        db.add(Feedback(message_id=msg.id, user_id=ctx.user_id, rating=body.rating, comment=body.comment))
    await db.commit()
    run_id = (msg.msg_metadata or {}).get("langsmith_run_id")
    if run_id:
        from app.observability.tracing import log_feedback

        log_feedback(run_id, "user_feedback", 1.0 if body.rating > 0 else 0.0, body.comment)
    return OkResponse()

