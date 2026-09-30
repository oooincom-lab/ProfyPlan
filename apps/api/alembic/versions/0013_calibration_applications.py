"""Журнал применений калибровки по истории (блок 6.24): таблица calibration_applications.

Одно применение — одна запись со списком затронутых строк (до/после по каждой
операции) и основанием (коэффициент, наблюдения, период). Лимит — 100 записей на
проект; откат помечает запись и возвращает прежние оценки на сервере.

Revision ID: 0013_calibration_applications
Revises: 0012_operation_fact
Create Date: 2026-10-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0013_calibration_applications"
down_revision = "0012_operation_fact"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calibration_applications",
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
        sa.Column("coefficient", sa.Numeric(8, 4), nullable=False),
        sa.Column("observations_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("period_from", sa.Date(), nullable=True),
        sa.Column("period_to", sa.Date(), nullable=True),
        sa.Column("applied_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_history", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_no_triple", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items", sa.JSON(), nullable=False),
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
    op.create_index("ix_calibration_applications_tenant_id", "calibration_applications", ["tenant_id"])
    op.create_index("ix_calibration_applications_project_id", "calibration_applications", ["project_id"])
    op.create_index("ix_calibration_applications_created_at", "calibration_applications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_calibration_applications_created_at", table_name="calibration_applications")
    op.drop_index("ix_calibration_applications_project_id", table_name="calibration_applications")
    op.drop_index("ix_calibration_applications_tenant_id", table_name="calibration_applications")
    op.drop_table("calibration_applications")
