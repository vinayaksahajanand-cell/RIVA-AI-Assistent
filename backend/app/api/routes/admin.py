"""Admin portal API: workspace members (RBAC), audit log and security overview."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_permission
from app.core.errors import ConflictError, NotFoundError, ValidationFailed
from app.core.rbac import (
    CLASSIFICATIONS,
    ROLES,
    Permission,
    allowed_classifications,
    clearance_for,
    normalize_role,
    permissions_for,
)
from app.core.security import hash_password
from app.database.session import get_db
from app.models import AuditEvent, Document, User, WorkspaceMember
from app.schemas.admin import (
    AuditEventOut,
    AuditPage,
    MemberCreate,
    MemberOut,
    MemberUpdate,
    RoleInfo,
    SecurityOverview,
)
from app.schemas.common import OkResponse
from app.services.audit import add_audit

router = APIRouter(prefix="/api/admin", tags=["admin"])
manage_users = require_permission(Permission.USERS_MANAGE)


def _member_out(user: User, role: str, ctx: AuthContext) -> MemberOut:
    role = normalize_role(role)
    return MemberOut(id=user.id, email=user.email, full_name=user.full_name, role=role,
                     clearance=clearance_for(role, ctx.security.role_clearance), is_active=user.is_active,
                     created_at=user.created_at, last_login_at=user.last_login_at)


async def _membership(db: AsyncSession, ctx: AuthContext, user_id: uuid.UUID) -> tuple[User, WorkspaceMember]:
    row = (await db.execute(select(User, WorkspaceMember).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
                            .where(WorkspaceMember.workspace_id == ctx.workspace_id, User.id == user_id))).first()
    if row is None:
        raise NotFoundError("User not found in this workspace.")
    return row[0], row[1]


async def _admin_count(db: AsyncSession, ctx: AuthContext) -> int:
    return await db.scalar(select(func.count()).select_from(WorkspaceMember).join(User, User.id == WorkspaceMember.user_id)
                           .where(WorkspaceMember.workspace_id == ctx.workspace_id, WorkspaceMember.role == "admin",
                                  User.is_active.is_(True))) or 0


@router.get("/users", response_model=list[MemberOut])
async def list_members(q: str | None = Query(default=None, max_length=200), ctx: AuthContext = Depends(manage_users),
                       db: AsyncSession = Depends(get_db)):
    stmt = (select(User, WorkspaceMember.role).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
            .where(WorkspaceMember.workspace_id == ctx.workspace_id).order_by(User.created_at))
    if q:
        stmt = stmt.where(User.email.ilike(f"%{q}%") | User.full_name.ilike(f"%{q}%"))
    return [_member_out(u, r, ctx) for u, r in (await db.execute(stmt)).all()]


@router.post("/users", response_model=MemberOut, status_code=201)
async def create_member(body: MemberCreate, ctx: AuthContext = Depends(manage_users), db: AsyncSession = Depends(get_db)):
    email = body.email.lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise ConflictError("An account with this email already exists.")
    user = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password),
                role="user")
    db.add(user)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=ctx.workspace_id, user_id=user.id, role=body.role))
    add_audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user_id, actor_email=ctx.user.email,
              event_type="admin.user_created", summary=f"{ctx.user.email} created {email} as {body.role}",
              details={"target": str(user.id), "role": body.role})
    await db.commit()
    await db.refresh(user)
    return _member_out(user, body.role, ctx)


@router.patch("/users/{user_id}", response_model=MemberOut)
async def update_member(user_id: uuid.UUID, body: MemberUpdate, ctx: AuthContext = Depends(manage_users),
                        db: AsyncSession = Depends(get_db)):
    user, member = await _membership(db, ctx, user_id)
    changes: dict = {}
    demoting_admin = member.role == "admin" and ((body.role and body.role != "admin") or body.is_active is False)
    if demoting_admin and await _admin_count(db, ctx) <= 1:
        raise ValidationFailed("A workspace needs at least one active admin.")
    if user.id == ctx.user_id and (body.is_active is False or (body.role and body.role != "admin")):
        raise ValidationFailed("You cannot demote or deactivate your own account.")
    if body.role and body.role != member.role:
        changes["role"] = {"from": member.role, "to": body.role}
        member.role = body.role
    if body.is_active is not None and body.is_active != user.is_active:
        changes["is_active"] = {"from": user.is_active, "to": body.is_active}
        user.is_active = body.is_active
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if changes:
        add_audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user_id, actor_email=ctx.user.email,
                  event_type="admin.user_updated", severity="warning" if "role" in changes else "info",
                  summary=f"{ctx.user.email} updated {user.email}: {', '.join(changes)}",
                  details={"target": str(user.id), **changes})
    await db.commit()
    return _member_out(user, member.role, ctx)


@router.delete("/users/{user_id}", response_model=OkResponse)
async def remove_member(user_id: uuid.UUID, ctx: AuthContext = Depends(manage_users), db: AsyncSession = Depends(get_db)):
    user, member = await _membership(db, ctx, user_id)
    if user.id == ctx.user_id:
        raise ValidationFailed("You cannot remove yourself from the workspace.")
    if member.role == "admin" and await _admin_count(db, ctx) <= 1:
        raise ValidationFailed("A workspace needs at least one active admin.")
    await db.delete(member)
    add_audit(db, workspace_id=ctx.workspace_id, user_id=ctx.user_id, actor_email=ctx.user.email,
              event_type="admin.user_removed", severity="warning",
              summary=f"{ctx.user.email} removed {user.email} from the workspace", details={"target": str(user.id)})
    await db.commit()
    return OkResponse()


@router.get("/audit", response_model=AuditPage)
async def audit_log(event_type: str | None = Query(default=None, max_length=60),
                    severity: str | None = Query(default=None, pattern="^(info|warning|critical)$"),
                    offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200),
                    ctx: AuthContext = Depends(require_permission(Permission.AUDIT_VIEW)),
                    db: AsyncSession = Depends(get_db)):
    cond = [AuditEvent.workspace_id == ctx.workspace_id]
    if event_type:
        cond.append(AuditEvent.event_type.startswith(event_type))
    if severity:
        cond.append(AuditEvent.severity == severity)
    total = await db.scalar(select(func.count()).select_from(AuditEvent).where(*cond)) or 0
    rows = (await db.execute(select(AuditEvent).where(*cond).order_by(AuditEvent.created_at.desc())
                             .offset(offset).limit(limit))).scalars().all()
    return AuditPage(total=total, items=[AuditEventOut(
        id=e.id, event_type=e.event_type, severity=e.severity, summary=e.summary, actor_email=e.actor_email,
        user_id=e.user_id, message_id=e.message_id, details=e.details or {}, created_at=e.created_at) for e in rows])


@router.get("/security", response_model=SecurityOverview)
async def security_overview(ctx: AuthContext = Depends(require_permission(Permission.AUDIT_VIEW)),
                            db: AsyncSession = Depends(get_db)):
    member_counts = dict((await db.execute(select(WorkspaceMember.role, func.count()).where(
        WorkspaceMember.workspace_id == ctx.workspace_id).group_by(WorkspaceMember.role))).all())
    roles = []
    for role in ROLES:
        clearance = clearance_for(role, ctx.security.role_clearance)
        roles.append(RoleInfo(role=role, permissions=sorted(p.value for p in permissions_for(role)),
                              clearance=clearance, allowed_classifications=allowed_classifications(clearance),
                              members=member_counts.get(role, 0)))
    docs = dict((await db.execute(select(Document.classification, func.count()).where(
        Document.workspace_id == ctx.workspace_id).group_by(Document.classification))).all())
    since = datetime.now(UTC) - timedelta(days=30)
    events = dict((await db.execute(select(AuditEvent.event_type, func.count()).where(
        AuditEvent.workspace_id == ctx.workspace_id, AuditEvent.created_at >= since,
        AuditEvent.event_type.startswith("guardrail.")).group_by(AuditEvent.event_type))).all())
    return SecurityOverview(roles=roles, classifications=list(CLASSIFICATIONS),
                            documents_by_classification={c: docs.get(c, 0) for c in CLASSIFICATIONS},
                            guardrail_events_30d=events)
