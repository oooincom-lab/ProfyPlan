"""Политика редактирования импортированных данных.

Revision ID: 0035_sync_edit_policy
Revises: 0034_execution_facts
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0035_sync_edit_policy"
down_revision = "0034_execution_facts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column(
        "sync_edit_policy", sa.String(length=20), nullable=False, server_default="planning"
    ))


def downgrade() -> None:
    op.drop_column("tenants", "sync_edit_policy")
