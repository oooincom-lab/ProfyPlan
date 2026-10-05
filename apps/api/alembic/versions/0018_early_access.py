"""Заявки на ранний доступ: таблица early_access_requests.

Онбординг «по заявке» (блок 6.34, фаза 1): заявка с экрана входа сохраняется
на сервере, письмо администратору — вспомогательный канал. По заявке вендор
создаёт организацию и приглашает владельца.

Revision ID: 0018_early_access
Revises: 0017_booking_exclusive
Create Date: 2026-10-05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0018_early_access"
down_revision = "0017_booking_exclusive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "early_access_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("company", sa.String(255), nullable=False, server_default=""),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_early_access_requests_email", "early_access_requests", ["email"])
    op.create_index("ix_early_access_requests_created_at", "early_access_requests", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_early_access_requests_created_at", table_name="early_access_requests")
    op.drop_index("ix_early_access_requests_email", table_name="early_access_requests")
    op.drop_table("early_access_requests")
