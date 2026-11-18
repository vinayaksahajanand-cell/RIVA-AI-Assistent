from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, Timestamped, UUIDPk, utcnow


class Conversation(UUIDPk, Timestamped, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_workspace_user_updated", "workspace_id", "user_id", "updated_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                                               nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="New conversation")
    # Last used document scope: {"document_ids": [...], "collection_id": ...}
    scope: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    messages: Mapped[list[Message]] = relationship(back_populates="conversation", cascade="all, delete-orphan",
                                                   order_by="Message.created_at")


class Message(UUIDPk, Timestamped, Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # streaming | completed | insufficient_context | failed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    model: Mapped[str | None] = mapped_column(String(100))
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True),
                                                          ForeignKey("messages.id", ondelete="SET NULL"))
    citations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    verification: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    msg_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    reference_answer: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class RetrievalEvent(UUIDPk, Timestamped, Base):
    __tablename__ = "retrieval_events"

    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"),
                                                  nullable=False, index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    query: Mapped[str] = mapped_column(Text, nullable=False)
    rewritten_queries: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    candidates: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    selected_chunk_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    document_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    retrieval_success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    grade: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class PerformanceMetric(UUIDPk, Timestamped, Base):
    __tablename__ = "performance_metrics"

    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"),
                                                  nullable=False, unique=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    model: Mapped[str | None] = mapped_column(String(100))
    stages_ms: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    time_to_first_token_ms: Mapped[float | None] = mapped_column(Float)
    total_ms: Mapped[float] = mapped_column(Float, nullable=False)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float)
    llm_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Feedback(UUIDPk, Timestamped, Base):
    __tablename__ = "feedback"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_feedback_message_user"),)

    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"),
                                                  nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                                               nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # +1 / -1
    comment: Mapped[str | None] = mapped_column(Text)
