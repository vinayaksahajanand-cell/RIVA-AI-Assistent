"""Request-scoped dependencies: authentication and workspace (tenant) resolution."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthError, ForbiddenError
from app.core.rate_limit import rate_limiter
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import User, Workspace, WorkspaceMember


@dataclass
class AuthContext:
    user: User
    workspace: Workspace
    role: str  # workspace role: owner | editor | viewer

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def can_write(self) -> bool:
        return self.role in ("owner", "editor")


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
    return AuthContext(user=user, workspace=workspace, role=role)


async def require_writer(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    if not ctx.can_write:
        raise ForbiddenError("Your role in this workspace is read-only.")
    return ctx


async def require_admin(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    if ctx.role != "owner" and ctx.user.role != "admin":
        raise ForbiddenError("Administrator access required.")
    return ctx


chat_rate_limit = rate_limiter("chat", "rate_limit_chat_per_minute")
upload_rate_limit = rate_limiter("upload", "rate_limit_upload_per_minute")
auth_rate_limit = rate_limiter("auth", "rate_limit_auth_per_minute")
