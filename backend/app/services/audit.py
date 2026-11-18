"""Audit log writer (security events, admin actions, guardrail decisions)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database.session import session_scope
from app.models import AuditEvent

log = get_logger("riva.audit")


def audit_event(*, workspace_id: uuid.UUID | None, user_id: uuid.UUID | None, actor_email: str | None,
                event_type: str, summary: str, severity: str = "info", details: dict | None = None,
                message_id: uuid.UUID | None = None) -> AuditEvent:
    log.info("audit %s [%s] %s", event_type, severity, summary)
    return AuditEvent(workspace_id=workspace_id, user_id=user_id, actor_email=actor_email, event_type=event_type,
                      severity=severity, summary=summary[:2000], details=details or {}, message_id=message_id)


def add_audit(db: AsyncSession, **kwargs) -> None:
    """Stage an audit event in the caller's transaction (committed with the action it describes)."""
    db.add(audit_event(**kwargs))


async def record_audit(**kwargs) -> None:
    """Write an audit event in its own transaction (used where the main action may roll back)."""
    try:
        async with session_scope() as s:
            s.add(audit_event(**kwargs))
    except Exception as exc:  # auditing must never break the request
        log.warning("Failed to write audit event: %s", exc)
