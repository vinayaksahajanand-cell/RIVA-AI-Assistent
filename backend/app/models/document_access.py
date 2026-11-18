
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, Timestamped, UUIDPk


class DocumentAccessGrant(UUIDPk, Timestamped, Base):
    """Explicit permission for a user to access a document."""

    __tablename__ = "document_access_grants"

    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "user_id",
            name="uq_document_access_user",
        ),
        Index(
            "ix_document_access_workspace_user",
            "workspace_id",
            "user_id",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
