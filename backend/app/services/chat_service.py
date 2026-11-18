"""Chat orchestration: request preparation, RAG execution, streaming events and persistence."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext
from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError, ServiceUnavailable, ValidationFailed
from app.core.logging import get_logger
from app.core.timing import StageTimer
from app.database.session import session_scope
from app.evaluation.evaluation_service import new_online_evaluation
from app.models import Conversation, Message, PerformanceMetric, RetrievalEvent
from app.observability.tracing import flush as flush_traces
from app.observability.tracing import trace_request, tracing_enabled
from app.rag.context import RAGContext
from app.rag.graph import run_rag
from app.retrieval.types import RetrievalScope
from app.schemas.chat import ChatRequest, MessageOut
from app.schemas.settings import WorkspaceSettings
from app.services.document_service import resolve_scope
from app.retrieval.serialize import outcome_candidates
from app.services.audit import audit_event
from app.services.serializers import messages_to_out
from app.worker import wake_worker

log = get_logger(__name__)
_background_tasks: set[asyncio.Task] = set()


@dataclass
class PreparedChat:
    conversation_id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    user_message_id: uuid.UUID
    assistant_message_id: uuid.UUID
    question: str
    history: list[tuple[str, str]]
    scope: RetrievalScope
    indexed_documents: int
    settings: WorkspaceSettings
    reference_answer: str | None
    timer: StageTimer
    role: str = "admin"
    actor_email: str | None = None
    redact_output: bool = False
    diagnostics: bool = True
    run_id: uuid.UUID = field(default_factory=uuid.uuid4)


def friendly_error(exc: Exception) -> tuple[str, str]:
    name = exc.__class__.__name__
    if isinstance(exc, AppError):
        return exc.code, exc.message
    mapping = {
        "AuthenticationError": ("llm_auth_error", "The OpenAI API key was rejected. Check OPENAI_API_KEY."),
        "PermissionDeniedError": ("llm_permission_error", "The API key does not have access to the selected model."),
        "RateLimitError": ("llm_rate_limited", "The language model rate limit was reached. Please retry shortly."),
        "APITimeoutError": ("llm_timeout", "The language model did not respond in time. Please retry."),
        "APIConnectionError": ("llm_unreachable", "Could not reach the language model service."),
        "NotFoundError": ("llm_model_not_found", "The selected model is not available for this API key."),
        "BadRequestError": ("llm_bad_request", "The language model rejected the request."),
        "EmbeddingDimensionMismatch": ("embedding_dimension_mismatch", str(exc)),
    }
    return mapping.get(name, ("generation_failed", "The assistant could not complete this answer."))


class ChatService:
    async def prepare(self, db: AsyncSession, ctx: AuthContext, req: ChatRequest) -> PreparedChat:
        timer = StageTimer()
        app_settings = get_settings()
        if not app_settings.llm_configured and _llm_required():
            raise ServiceUnavailable("The language model is not configured. Set OPENAI_API_KEY in backend/.env "
                                     "and restart the API.")
        ws = WorkspaceSettings.from_stored(ctx.workspace.settings)
        if req.retrieval:
            ws.retrieval = ws.retrieval.model_validate(
                {**ws.retrieval.model_dump(), **req.retrieval.model_dump(exclude_none=True)})
        gen_updates = {k: v for k, v in {"model": req.model, "temperature": req.temperature,
                                         "max_tokens": req.max_tokens, "grounded_only": req.grounded_only}.items()
                       if v is not None}
        ws.generation = ws.generation.model_validate({**ws.generation.model_dump(), **gen_updates})
        if ws.generation.model not in app_settings.model_list:
            raise ValidationFailed(f"Model '{ws.generation.model}' is not enabled. "
                                   f"Available: {', '.join(app_settings.model_list)}")

        with timer.stage("request_setup"):
            if req.conversation_id:
                conv = await db.get(Conversation, req.conversation_id)
                if conv is None or conv.workspace_id != ctx.workspace_id or conv.user_id != ctx.user_id:
                    raise NotFoundError("Conversation not found.")
            else:
                if req.regenerate:
                    raise ValidationFailed("regenerate requires conversation_id.")
                conv = Conversation(workspace_id=ctx.workspace_id, user_id=ctx.user_id,
                                    title=_title_from(req.message), scope={})
                db.add(conv)
                await db.flush()

            question = req.message.strip()
            if req.regenerate:
                last_user = (await db.execute(select(Message).where(
                    Message.conversation_id == conv.id, Message.role == "user")
                    .order_by(Message.created_at.desc()).limit(1))).scalar_one_or_none()
                if last_user is None:
                    raise ValidationFailed("There is no question to regenerate.")
                question = last_user.content
                await db.execute(delete(Message).where(Message.conversation_id == conv.id,
                                                       Message.role == "assistant",
                                                       Message.reply_to_id == last_user.id))
                user_message = last_user
            else:
                user_message = Message(conversation_id=conv.id, workspace_id=ctx.workspace_id, role="user",
                                       content=question, status="completed")
                db.add(user_message)
                await db.flush()

            history_rows = (await db.execute(select(Message).where(
                Message.conversation_id == conv.id, Message.id != user_message.id,
                Message.status.in_(["completed", "insufficient_context"]))
                .order_by(Message.created_at.desc()).limit(app_settings.conversation_memory_turns * 2))).scalars().all()
            history = [(m.role, m.content) for m in reversed(history_rows)]

            doc_ids, indexed = await resolve_scope(db, ctx, req.document_ids, req.collection_id)
            assistant = Message(conversation_id=conv.id, workspace_id=ctx.workspace_id, role="assistant",
                                content="", status="streaming", model=ws.generation.model, reply_to_id=user_message.id,
                                reference_answer=(req.reference_answer or "").strip() or None)
            db.add(assistant)
            conv.scope = {"document_ids": [str(d) for d in (req.document_ids or [])],
                          "collection_id": str(req.collection_id) if req.collection_id else None}
            conv.updated_at = datetime.now(UTC)
            await db.commit()

        return PreparedChat(
            conversation_id=conv.id, workspace_id=ctx.workspace_id, user_id=ctx.user_id,
            user_message_id=user_message.id, assistant_message_id=assistant.id, question=question,
            history=history,
            scope=RetrievalScope(workspace_id=ctx.workspace_id, document_ids=doc_ids,
                                 classifications=ctx.allowed_classifications),
            indexed_documents=indexed, settings=ws, reference_answer=assistant.reference_answer, timer=timer,
            role=ctx.role, actor_email=ctx.user.email, redact_output=ctx.redact_output,
            diagnostics=ctx.sees_diagnostics)

    async def execute(self, p: PreparedChat, emit=None) -> MessageOut:
        """Run the RAG graph and persist everything. Always persists, even on failure."""
        rag_ctx = RAGContext(scope=p.scope, retrieval=p.settings.retrieval, generation=p.settings.generation,
                             history=p.history, timer=p.timer, emit=emit, has_documents=p.indexed_documents > 0,
                             security=p.settings.security, role=p.role, redact_output=p.redact_output,
                             emit_diagnostics=p.diagnostics)
        metadata = {"session_id": str(p.conversation_id), "conversation_id": str(p.conversation_id),
                    "message_id": str(p.assistant_message_id), "workspace_id": str(p.workspace_id),
                    "model": p.settings.generation.model, "retrieval_config": p.settings.retrieval.model_dump(),
                    "document_scope": [str(d) for d in p.scope.document_ids] if p.scope.document_ids else "all"}
        state: dict = {}
        error: tuple[str, str] | None = None
        try:
            with trace_request(run_name="riva_chat", metadata=metadata, tags=["riva", "chat"]):
                state = await run_rag(p.question, rag_ctx, run_id=p.run_id, run_name="riva_chat", metadata=metadata)
        except Exception as exc:
            log.exception("RAG execution failed for message %s", p.assistant_message_id)
            error = friendly_error(exc)
        total_s = p.timer.elapsed()
        message = await self._persist(p, rag_ctx, state, error, total_s)
        if tracing_enabled():
            await asyncio.to_thread(flush_traces)
        return message

    async def _persist(self, p: PreparedChat, rag_ctx: RAGContext, state: dict, error: tuple[str, str] | None,
                       total_s: float) -> MessageOut:
        outcome = state.get("outcome")
        usage = rag_ctx.usage
        ttft = p.timer.marks.get("first_token")
        async with session_scope() as s:
            msg = await s.get(Message, p.assistant_message_id)
            if msg is None:  # conversation deleted mid-flight
                raise NotFoundError("Message no longer exists.")
            if error:
                msg.status = "failed"
                msg.error_message = error[1]
                msg.content = state.get("answer", "") or ""
            else:
                msg.status = state.get("status", "completed")
                msg.content = state.get("answer", "")
                msg.citations = state.get("citations", [])
                msg.verification = state.get("verification", {})
            msg.msg_metadata = {
                "query_type": state.get("query_type"), "standalone_query": state.get("standalone_query"),
                "langsmith_run_id": str(p.run_id) if tracing_enabled() else None, "run_id": str(p.run_id),
                "indexed_documents_in_scope": p.indexed_documents,
                "grounded_only": p.settings.generation.grounded_only,
                "role": p.role,
                "clearance": (p.scope.classifications or ["restricted"])[-1],
                **({"guardrail": state["guardrail"]} if state.get("guardrail") else {}),
                **({"error_code": error[0]} if error else {}),
            }
            for event in rag_ctx.guardrail_events:
                details = {k: v for k, v in event.items() if k not in ("event_type", "severity", "summary")}
                s.add(audit_event(workspace_id=p.workspace_id, user_id=p.user_id, actor_email=p.actor_email,
                                  event_type=event["event_type"], severity=event.get("severity", "warning"),
                                  summary=event.get("summary", ""), message_id=msg.id,
                                  details={**details, "question": p.question[:500], "role": p.role}))
            if outcome is not None:
                s.add(RetrievalEvent(
                    message_id=msg.id, workspace_id=p.workspace_id, query=state.get("standalone_query", p.question),
                    rewritten_queries=outcome.search_queries, config=outcome.config,
                    candidates=outcome_candidates(outcome), selected_chunk_ids=[str(c.chunk_id) for c in outcome.selected],
                    document_ids=sorted({str(c.document_id) for c in outcome.selected}),
                    retrieval_success=bool(outcome.selected) and bool(state.get("sufficient", False)),
                    attempts=state.get("attempts", 0) + 1, grade=state.get("grade", {})))
            s.add(PerformanceMetric(
                message_id=msg.id, workspace_id=p.workspace_id, model=p.settings.generation.model,
                stages_ms={**p.timer.as_ms()}, time_to_first_token_ms=None if ttft is None else round(ttft * 1000, 2),
                total_ms=round(total_s * 1000, 2),
                prompt_tokens=usage.prompt_tokens if usage.saw_usage else None,
                completion_tokens=usage.completion_tokens if usage.saw_usage else None,
                total_tokens=usage.total_tokens if usage.saw_usage else None,
                estimated_cost_usd=usage.estimated_cost(), llm_calls=usage.calls))
            if not error:
                contexts = outcome.contexts if outcome is not None else []
                skip = None
                if msg.status == "blocked":
                    skip = "The request was blocked by guardrails, so there is nothing to evaluate."
                elif msg.status != "completed":
                    skip = "No document-grounded answer was generated, so there is nothing to evaluate."
                elif not contexts:
                    skip = "No retrieved context (conversational reply)."
                elif not p.settings.evaluation.online_enabled:
                    skip = "Online evaluation is disabled in workspace settings."
                s.add(new_online_evaluation(msg, question=state.get("standalone_query", p.question), answer=msg.content,
                                            contexts=contexts, reference=p.reference_answer,
                                            run_id=str(p.run_id), skip_reason=skip))
            conv = await s.get(Conversation, p.conversation_id)
            if conv is not None:
                conv.updated_at = datetime.now(UTC)
        wake_worker()
        async with session_scope() as s:
            msg = await s.get(Message, p.assistant_message_id)
            return (await messages_to_out(s, [msg], p.user_id, diagnostics=p.diagnostics))[0]

    async def stream(self, p: PreparedChat) -> AsyncIterator[str]:
        """SSE stream. Generation runs in a background task so a client disconnect never loses the answer."""
        queue: asyncio.Queue = asyncio.Queue()

        def emit(event: str, data: dict) -> None:
            queue.put_nowait((event, data))

        async def runner() -> None:
            try:
                message = await self.execute(p, emit)
                if message.status == "failed":
                    queue.put_nowait(("error", {"code": (message.metadata or {}).get("error_code", "failed"),
                                                "message": message.error_message, "message_id": str(message.id)}))
                queue.put_nowait(("done", {"message": json.loads(message.model_dump_json())}))
            except Exception as exc:
                code, text = friendly_error(exc)
                queue.put_nowait(("error", {"code": code, "message": text}))
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(runner())
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

        yield _sse("meta", {"conversation_id": str(p.conversation_id), "user_message_id": str(p.user_message_id),
                            "assistant_message_id": str(p.assistant_message_id), "run_id": str(p.run_id)})
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=15)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if item is None:
                break
            event, data = item
            yield _sse(event, data)


def _llm_required() -> bool:
    from app.llm import provider

    return provider._factory_override is None  # tests inject a fake model


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _title_from(message: str) -> str:
    text = " ".join(message.split())
    return text if len(text) <= 80 else text[:77].rstrip() + "…"


chat_service = ChatService()
