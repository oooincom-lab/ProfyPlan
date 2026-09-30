"""Журнал применённых сжатий из разбора разрыва (блок 6.14е): таблица gap_applications.

Применения сжатия сохраняются на сервере, чтобы журнал переживал перезагрузку страницы
и был виден с любой машины. Хранятся последние 100 записей на проект (лимит согласован
01.10.2026); откат помечает запись и возвращает прежние оценки операции на сервере.

Revision ID: 0011_gap_applications
Revises: 0010_goal_backfill
Create Date: 2026-10-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_gap_applications"
down_revision = "0010_goal_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gap_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("op_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("op_name", sa.String(255), nullable=False),
        sa.Column("percent", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("before", sa.JSON(), nullable=False),
        sa.Column("after", sa.JSON(), nullable=False),
        sa.Column("gap_before", sa.Float(), nullable=True),
        sa.Column("gap_after", sa.Float(), nullable=True),
        sa.Column("reverted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_gap_applications_tenant_id", "gap_applications", ["tenant_id"])
    op.create_index("ix_gap_applications_project_id", "gap_applications", ["project_id"])
    op.create_index("ix_gap_applications_op_id", "gap_applications", ["op_id"])
    op.create_index("ix_gap_applications_created_at", "gap_applications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_gap_applications_created_at", table_name="gap_applications")
    op.drop_index("ix_gap_applications_op_id", table_name="gap_applications")
    op.drop_index("ix_gap_applications_project_id", table_name="gap_applications")
    op.drop_index("ix_gap_applications_tenant_id", table_name="gap_applications")
    op.drop_table("gap_applications")
