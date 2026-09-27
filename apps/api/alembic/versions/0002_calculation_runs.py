"""Реестр запусков расчёта (блок плана 6.16.3): таблица calculation_runs.

Запуск расчёта — объект: область, обе оси методов, параметры, отпечаток входных
данных (версия данных), дата и сводка результата. Это основание сравнения методов,
истории и прослеживаемости.

Revision ID: 0002_calculation_runs
Revises: 0001_calc_settings
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_calculation_runs"
down_revision = "0001_calc_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calculation_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("area", sa.String(20), nullable=False, server_default="project"),
        sa.Column("area_ref", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("planning_logic", sa.String(10), nullable=False, server_default="cpm"),
        sa.Column("uncertainty_analysis", sa.String(10), nullable=False, server_default="none"),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("data_fingerprint", sa.String(32), nullable=True),
        sa.Column("data_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="done"),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_calculation_runs_tenant_id", "calculation_runs", ["tenant_id"])
    op.create_index("ix_calculation_runs_project_id", "calculation_runs", ["project_id"])
    op.create_index("ix_calculation_runs_created_at", "calculation_runs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_calculation_runs_created_at", table_name="calculation_runs")
    op.drop_index("ix_calculation_runs_project_id", table_name="calculation_runs")
    op.drop_index("ix_calculation_runs_tenant_id", table_name="calculation_runs")
    op.drop_table("calculation_runs")
