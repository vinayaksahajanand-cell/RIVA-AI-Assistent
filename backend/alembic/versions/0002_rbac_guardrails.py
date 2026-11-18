"""RBAC roles, document classification and the audit log.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-17
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Document classification (+ denormalised copy on chunks for clearance filtering in retrieval SQL)
    op.add_column("documents", sa.Column("classification", sa.String(20), nullable=False, server_default="internal"))
    op.create_index("ix_documents_workspace_classification", "documents", ["workspace_id", "classification"])
    op.add_column("document_chunks",
                  sa.Column("classification", sa.String(20), nullable=False, server_default="internal"))
    op.create_index("ix_chunks_workspace_classification", "document_chunks", ["workspace_id", "classification"])

    # Organization workspace for shared registration
    op.add_column("workspaces", sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()))

    # RBAC roles: owner/editor/viewer → admin/manager/user
    op.execute("UPDATE workspace_members SET role = CASE role WHEN 'owner' THEN 'admin' WHEN 'editor' THEN 'manager' "
               "WHEN 'viewer' THEN 'user' ELSE role END")
    op.execute("UPDATE users SET role = 'user' WHERE role = 'member'")
    op.create_check_constraint("member_role", "workspace_members", "role IN ('admin', 'manager', 'user')")
    for table in ("documents", "document_chunks"):
        op.create_check_constraint("classification", table,
                                   "classification IN ('public', 'internal', 'confidential', 'restricted')")

    op.create_table(
        "audit_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("severity", sa.String(length=10), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("message_id", sa.UUID(), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], name="fk_audit_events_workspace_id_workspaces",
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_audit_events_user_id_users", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
    )
    op.create_index("ix_audit_events_workspace_created", "audit_events", ["workspace_id", "created_at"])
    op.create_index("ix_audit_events_type", "audit_events", ["event_type"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_type", table_name="audit_events")
    op.drop_index("ix_audit_events_workspace_created", table_name="audit_events")
    op.drop_table("audit_events")
    for table in ("documents", "document_chunks"):
        op.drop_constraint(op.f(f"ck_{table}_classification"), table, type_="check")
    op.drop_constraint(op.f("ck_workspace_members_member_role"), "workspace_members", type_="check")
    op.execute("UPDATE workspace_members SET role = CASE role WHEN 'admin' THEN 'owner' WHEN 'manager' THEN 'editor' "
               "ELSE 'viewer' END")
    op.drop_column("workspaces", "is_default")
    op.drop_index("ix_chunks_workspace_classification", table_name="document_chunks")
    op.drop_column("document_chunks", "classification")
    op.drop_index("ix_documents_workspace_classification", table_name="documents")
    op.drop_column("documents", "classification")
