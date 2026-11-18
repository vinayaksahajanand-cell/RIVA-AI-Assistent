from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, chat_rate_limit, get_auth_context, require_permission
from app.core.rbac import Permission
from app.database.session import get_db
from app.models import Document, Message
from app.schemas.chat import ChatRequest, ChatResponse, SuggestedQuestions
from app.services.chat_service import chat_service
from app.services.serializers import messages_to_out

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, ctx: AuthContext = Depends(require_permission(Permission.CHAT)),
               _rl: None = Depends(chat_rate_limit),
               db: AsyncSession = Depends(get_db)) -> ChatResponse:
    prepared = await chat_service.prepare(db, ctx, req)
    assistant = await chat_service.execute(prepared)
    user_msg = await db.get(Message, prepared.user_message_id)
    user_out = (await messages_to_out(db, [user_msg], ctx.user_id, diagnostics=ctx.sees_diagnostics))[0]
    return ChatResponse(conversation_id=prepared.conversation_id, user_message=user_out, assistant_message=assistant)


@router.post("/stream", responses={200: {"content": {"text/event-stream": {}},
                                         "description": "Server-Sent Events: meta, status, retrieval, token, done, error"}})
async def chat_stream(req: ChatRequest, ctx: AuthContext = Depends(require_permission(Permission.CHAT)),
                      _rl: None = Depends(chat_rate_limit), db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    prepared = await chat_service.prepare(db, ctx, req)
    await db.close()  # release the request connection; streaming uses its own sessions
    return StreamingResponse(chat_service.stream(prepared), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})


@router.get("/suggestions", response_model=SuggestedQuestions)
async def suggestions(ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    """Question starters derived from the user's indexed document titles (no LLM call)."""
    titles = [r[0] for r in (await db.execute(
        select(Document.title).where(Document.workspace_id == ctx.workspace_id, Document.status == "indexed",
                                     Document.classification.in_(ctx.allowed_classifications))
        .order_by(Document.indexed_at.desc()).limit(4))).all()]
    questions: list[str] = []
    if titles:
        questions.append(f"Summarize the key points of “{titles[0]}”.")
    if len(titles) >= 2:
        questions.append(f"Compare “{titles[0]}” and “{titles[1]}”. Where do they agree or differ?")
    if len(titles) >= 3:
        questions.append(f"What are the most important dates, figures or obligations in “{titles[2]}”?")
    return SuggestedQuestions(questions=questions)

