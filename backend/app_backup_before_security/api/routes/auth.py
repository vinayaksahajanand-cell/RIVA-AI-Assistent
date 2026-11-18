from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, auth_rate_limit, get_auth_context
from app.core.config import get_settings
from app.core.errors import AuthError, ConflictError, ForbiddenError
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models import User, Workspace, WorkspaceMember
from app.schemas.auth import AuthResponse, LoginRequest, MeResponse, RegisterRequest, UserOut, WorkspaceOut
from app.schemas.common import OkResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(response: Response, token: str, expires: datetime) -> None:
    s = get_settings()
    response.set_cookie(
        s.session_cookie_name, token, httponly=True, secure=s.cookie_secure, samesite="lax",
        expires=expires, path="/",
    )


async def _primary_workspace(db: AsyncSession, user: User) -> tuple[Workspace, str]:
    row = (await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.created_at)
    )).first()
    if row is None:
        raise ForbiddenError("No workspace is associated with this account.")
    return row[0], row[1]


@router.post("/register", response_model=AuthResponse, status_code=201, dependencies=[Depends(auth_rate_limit)])
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    settings = get_settings()
    if not settings.allow_registration:
        raise ForbiddenError("Self-registration is disabled. Ask an administrator for an account.")
    email = body.email.lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise ConflictError("An account with this email already exists.")
    is_first = (await db.scalar(select(func.count(User.id)))) == 0
    user = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password),
                role="admin" if is_first else "member")
    db.add(user)
    await db.flush()
    name = f"{user.full_name.split(' ')[0]}'s workspace" if user.full_name else "My workspace"
    workspace = Workspace(name=name, owner_id=user.id, settings={})
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
    await db.commit()
    token, expires = create_access_token(user.id, workspace.id)
    _set_cookie(response, token, expires)
    return AuthResponse(user=UserOut.model_validate(user),
                        workspace=WorkspaceOut(id=workspace.id, name=workspace.name, role="owner"),
                        access_token=token, expires_at=expires)


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(auth_rate_limit)])
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    user = (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise AuthError("Incorrect email or password.")
    if not user.is_active:
        raise AuthError("Account disabled.")
    workspace, role = await _primary_workspace(db, user)
    user.last_login_at = datetime.now(UTC)
    await db.commit()
    token, expires = create_access_token(user.id, workspace.id)
    _set_cookie(response, token, expires)
    return AuthResponse(user=UserOut.model_validate(user),
                        workspace=WorkspaceOut(id=workspace.id, name=workspace.name, role=role),
                        access_token=token, expires_at=expires)


@router.post("/logout", response_model=OkResponse)
async def logout(response: Response) -> OkResponse:
    response.delete_cookie(get_settings().session_cookie_name, path="/")
    return OkResponse()


@router.get("/me", response_model=MeResponse)
async def me(ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)) -> MeResponse:
    rows = (await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == ctx.user_id).order_by(Workspace.created_at)
    )).all()
    return MeResponse(
        user=UserOut.model_validate(ctx.user),
        workspace=WorkspaceOut(id=ctx.workspace.id, name=ctx.workspace.name, role=ctx.role),
        workspaces=[WorkspaceOut(id=w.id, name=w.name, role=r) for w, r in rows],
    )
