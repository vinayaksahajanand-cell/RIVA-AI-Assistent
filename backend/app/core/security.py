"""Password hashing (Argon2) and JWT session tokens."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.errors import AuthError

_password_hash = PasswordHash.recommended()
_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _password_hash.verify(password, hashed)
    except Exception:  # malformed hash
        return False


def create_access_token(user_id: uuid.UUID, workspace_id: uuid.UUID) -> tuple[str, datetime]:
    settings = get_settings()
    expires = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "ws": str(workspace_id),
        "exp": expires,
        "iat": datetime.now(UTC),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.secret_key.get_secret_value(), algorithm=_ALGORITHM)
    return token, expires


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key.get_secret_value(), algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Session expired. Please sign in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Invalid authentication token.") from exc
