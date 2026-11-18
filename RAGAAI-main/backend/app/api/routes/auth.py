from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, auth_rate_limit, get_auth_context
from app.core.config import get_settings
from app.core.errors import AuthError, ConflictError, ForbiddenError
from app.core.rbac import Permission, allowed_classifications, clearance_for, normalize_role, permissions_for
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models import User, Workspace, WorkspaceMember
from app.schemas.auth import AccessOut, AuthResponse, LoginRequest, MeResponse, RegisterRequest, UserOut, WorkspaceOut
from app.schemas.common import OkResponse
from app.schemas.settings import WorkspaceSettings
from app.services.audit import add_audit, record_audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


def access_out(role: str, workspace: Workspace) -> AccessOut:
    role = normalize_role(role)
    security = WorkspaceSettings.from_stored(workspace.settings).security
    clearance = clearance_for(role, security.role_clearance)
    perms = permissions_for(role)
    return AccessOut(role=role, permissions=sorted(p.value for p in perms), clearance=clearance,
                     allowed_classifications=allowed_classifications(clearance),
                     admin_portal=Permission.ADMIN_PORTAL in perms)


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
        .order_by(Workspace.is_default.desc(), Workspace.created_at)
    )).first()
    if row is None:
        raise ForbiddenError("No workspace is associated with this account.")
    return row[0], normalize_role(row[1])


def _auth_response(user: User, workspace: Workspace, role: str, response: Response) -> AuthResponse:
    token, expires = create_access_token(user.id, workspace.id)
    _set_cookie(response, token, expires)
    return AuthResponse(user=UserOut.model_validate(user),
                        workspace=WorkspaceOut(id=workspace.id, name=workspace.name, role=role),
                        access=access_out(role, workspace), access_token=token, expires_at=expires)


@router.post("/register", response_model=AuthResponse, status_code=201, dependencies=[Depends(auth_rate_limit)])
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Self-registration.

    shared mode (default): the first account creates the organization workspace and becomes its admin;
    every later sign-up joins that workspace with the least-privileged ``user`` role.
    personal mode: every sign-up gets a private workspace where they are admin.
    """
    settings = get_settings()
    if not settings.allow_registration:
        raise ForbiddenError("Self-registration is disabled. Ask an administrator for an account.")
    email = body.email.lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise ConflictError("An account with this email already exists.")
    is_first = (await db.scalar(select(func.count(User.id)).where(User.email != "benchmark@riva.local"))) == 0
    user = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password),
                role="admin" if is_first else "user")
    db.add(user)
    await db.flush()

    workspace = None
    if settings.registration_mode == "shared":
        workspace = (await db.execute(select(Workspace).where(Workspace.is_default.is_(True))
                                      .order_by(Workspace.created_at).limit(1))).scalar_one_or_none()
    if workspace is None:
        name = "Organization workspace" if settings.registration_mode == "shared" else (
            f"{user.full_name.split(' ')[0]}'s workspace" if user.full_name else "My workspace")
        workspace = Workspace(name=name, owner_id=user.id, settings={},
                              is_default=settings.registration_mode == "shared")
        db.add(workspace)
        await db.flush()
        role = "admin"
    else:
        role = "user"
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=role))
    add_audit(db, workspace_id=workspace.id, user_id=user.id, actor_email=email, event_type="auth.registered",
              summary=f"{email} registered as {role}", details={"role": role, "mode": settings.registration_mode})
    await db.commit()
    return _auth_response(user, workspace, role, response)


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(auth_rate_limit)])
async def login(body: LoginRequest, request: Request, response: Response,
                db: AsyncSession = Depends(get_db)) -> AuthResponse:
    email = body.email.lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    ip = request.client.host if request.client else None
    if user is None or not verify_password(body.password, user.password_hash):
        await record_audit(workspace_id=None, user_id=user.id if user else None, actor_email=email,
                           event_type="auth.login_failed", severity="warning",
                           summary=f"Failed sign-in for {email}", details={"ip": ip, "portal": body.portal})
        raise AuthError("Incorrect email or password.")
    if not user.is_active:
        raise AuthError("Account disabled.")
    workspace, role = await _primary_workspace(db, user)
    if body.portal == "admin" and Permission.ADMIN_PORTAL not in permissions_for(role):
        add_audit(db, workspace_id=workspace.id, user_id=user.id, actor_email=email, event_type="access.denied",
                  severity="warning", summary=f"{email} ({role}) tried to sign in to the admin portal",
                  details={"ip": ip})
        await db.commit()
        raise ForbiddenError("This account does not have access to the admin portal. Use the user portal instead.")
    user.last_login_at = datetime.now(UTC)
    add_audit(db, workspace_id=workspace.id, user_id=user.id, actor_email=email, event_type="auth.login",
              summary=f"{email} signed in to the {body.portal} portal", details={"ip": ip, "role": role})
    await db.commit()
    return _auth_response(user, workspace, role, response)


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
        workspaces=[WorkspaceOut(id=w.id, name=w.name, role=normalize_role(r)) for w, r in rows],
        access=access_out(ctx.role, ctx.workspace),
    )
