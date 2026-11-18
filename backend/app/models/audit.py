from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, Timestamped, UUIDPk


class AuditEvent(UUIDPk, Timestamped, Base):
    """Security-relevant events: guardrail blocks/redactions, access denials, admin and auth actions."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_workspace_created", "workspace_id", "created_at"),
        Index("ix_audit_events_type", "event_type"),
    )

    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    actor_email: Mapped[str | None] = mapped_column(String(320))
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False, default="info")  # info | warning | critical
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
