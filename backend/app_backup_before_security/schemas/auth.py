from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(default="", max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    created_at: datetime


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    role: str


class AuthResponse(BaseModel):
    user: UserOut
    workspace: WorkspaceOut
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class MeResponse(BaseModel):
    user: UserOut
    workspace: WorkspaceOut
    workspaces: list[WorkspaceOut]
