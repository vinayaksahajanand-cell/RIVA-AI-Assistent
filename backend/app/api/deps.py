"""Request-scoped dependencies: authentication, workspace (tenant) resolution and RBAC."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthError, ForbiddenError
from app.core.rate_limit import rate_limiter
from app.core.rbac import Permission, allowed_classifications, clearance_for, normalize_role, permissions_for
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import User, Workspace, WorkspaceMember
from app.schemas.settings import SecuritySettings, WorkspaceSettings


@dataclass
class AuthContext:
    user: User
    workspace: Workspace
    role: str  # workspace RBAC role: admin | manager | user
    security: SecuritySettings = field(default_factory=SecuritySettings)

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def permissions(self) -> frozenset[Permission]:
        return permissions_for(self.role)

    def has(self, permission: Permission) -> bool:
        return permission in self.permissions

    @property
    def clearance(self) -> str:
        return clearance_for(self.role, self.security.role_clearance)

    @property
    def allowed_classifications(self) -> list[str]:
        return allowed_classifications(self.clearance)

    @property
    def sees_diagnostics(self) -> bool:
        return self.has(Permission.DIAGNOSTICS_VIEW) or self.security.show_diagnostics_to_users

    @property
    def redact_output(self) -> bool:
        return (self.security.guardrails_enabled and self.security.redact_sensitive_output
                and not self.has(Permission.PII_VIEW))

    # Backwards-compatible helper used by document routes
    @property
    def can_write(self) -> bool:
        return self.has(Permission.DOCUMENTS_MANAGE)


def _extract_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(get_settings().session_cookie_name)


async def get_auth_context(request: Request, db: AsyncSession = Depends(get_db)) -> AuthContext:
    token = _extract_token(request)
    if not token:
        raise AuthError("Authentication required.")
    payload = decode_access_token(token)
    try:
        user_id = uuid.UUID(payload["sub"])
        token_ws = uuid.UUID(payload["ws"])
    except (KeyError, ValueError) as exc:
        raise AuthError("Invalid authentication token.") from exc

    # Optional explicit workspace switch; membership is always re-verified.
    requested_ws = request.headers.get("x-workspace-id")
    workspace_id = token_ws
    if requested_ws:
        try:
            workspace_id = uuid.UUID(requested_ws)
        except ValueError as exc:
            raise ForbiddenError("Invalid workspace id.") from exc

    row = (await db.execute(
        select(User, Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(User.id == user_id, Workspace.id == workspace_id)
    )).first()
    if row is None:
        raise ForbiddenError("You do not have access to this workspace.")
    user, workspace, role = row
    if not user.is_active:
        raise AuthError("Account disabled.")
    request.state.user_id = str(user.id)
    security = WorkspaceSettings.from_stored(workspace.settings).security
    return AuthContext(user=user, workspace=workspace, role=normalize_role(role), security=security)


def require_permission(*permissions: Permission):
    """Dependency factory: the caller's role must grant every listed permission."""

    async def _dep(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        missing = [p for p in permissions if not ctx.has(p)]
        if missing:
            raise ForbiddenError("Your role does not allow this action.",
                                 details={"required": [p.value for p in missing], "role": ctx.role})
        return ctx

    return _dep


require_writer = require_permission(Permission.DOCUMENTS_MANAGE)
require_admin = require_permission(Permission.USERS_MANAGE)

chat_rate_limit = rate_limiter("chat", "rate_limit_chat_per_minute")
upload_rate_limit = rate_limiter("upload", "rate_limit_upload_per_minute")
auth_rate_limit = rate_limiter("auth", "rate_limit_auth_per_minute")
