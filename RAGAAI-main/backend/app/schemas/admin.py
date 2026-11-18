from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

RoleName = Literal["admin", "manager", "user"]


class MemberOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    clearance: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class MemberCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(default="", max_length=200)
    password: str = Field(min_length=8, max_length=128)
    role: RoleName = "user"


class MemberUpdate(BaseModel):
    role: RoleName | None = None
    is_active: bool | None = None
    full_name: str | None = Field(default=None, max_length=200)


class AuditEventOut(BaseModel):
    id: uuid.UUID
    event_type: str
    severity: str
    summary: str
    actor_email: str | None
    user_id: uuid.UUID | None
    message_id: uuid.UUID | None
    details: dict
    created_at: datetime


class AuditPage(BaseModel):
    total: int
    items: list[AuditEventOut]


class RoleInfo(BaseModel):
    role: str
    permissions: list[str]
    clearance: str
    allowed_classifications: list[str]
    members: int


class SecurityOverview(BaseModel):
    roles: list[RoleInfo]
    classifications: list[str]
    documents_by_classification: dict[str, int]
    guardrail_events_30d: dict[str, int]
