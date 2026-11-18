"""merge migration heads

Revision ID: 0f152fe17359
Revises: 0002, c0446e6c74ed
Create Date: 2026-11-18 09:21:54.082534
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0f152fe17359'
down_revision: str | None = ('0002', 'c0446e6c74ed')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
