from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, Timestamped, UUIDPk, utcnow


class User(UUIDPk, Timestamped, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")  # admin | member
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[WorkspaceMember]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Workspace(UUIDPk, Timestamped, Base):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                                                index=True, nullable=False)
    # Chunking / retrieval / generation preferences for this workspace (validated by schemas.settings)
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # The organization workspace that self-registered users join in "shared" registration mode.
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    members: Mapped[list[WorkspaceMember]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class WorkspaceMember(Timestamped, Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                                               primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")  # admin | manager | user (RBAC)

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")
