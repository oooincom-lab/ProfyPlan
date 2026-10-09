"""Фиксация плана: снимок результата расчёта для передачи во внешние системы (09.10.2026).

Таблицы:
- plan_snapshots — шапка фиксации (проект, метод, отпечаток входных данных, автор);
- plan_snapshot_rows — пооперационные плановые данные (даты, длительность, подразделение).

Revision ID: 0023_plan_snapshots
Revises: 0022_order_plan_manual
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0023_plan_snapshots"
down_revision = "0022_order_plan_manual"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("planning_logic", sa.String(10), nullable=False, server_default="cpm"),
        sa.Column("data_fingerprint", sa.String(64), nullable=True),
        sa.Column("start_anchor", sa.Date(), nullable=True),
        sa.Column("rows_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_plan_snapshots_tenant_id", "plan_snapshots", ["tenant_id"])
    op.create_index("ix_plan_snapshots_project_id", "plan_snapshots", ["project_id"])

    op.create_table(
        "plan_snapshot_rows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("plan_snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("production_orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("order_ext_id", sa.String(120), nullable=True),
        sa.Column("order_name", sa.String(500), nullable=True),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("operations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation_name", sa.String(500), nullable=False, server_default=""),
        sa.Column("department_name", sa.String(300), nullable=True),
        sa.Column("resource_name", sa.String(300), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("finish_date", sa.Date(), nullable=True),
        sa.Column("start_datetime", sa.DateTime(timezone=False), nullable=True),
        sa.Column("finish_datetime", sa.DateTime(timezone=False), nullable=True),
        sa.Column("duration_hours", sa.Numeric(14, 4), nullable=True),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=True),
        sa.Column("unit", sa.String(30), nullable=True),
        sa.Column("is_critical", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("position", sa.Integer(), nullable=True),
    )
    op.create_index("ix_plan_snapshot_rows_snapshot_id", "plan_snapshot_rows", ["snapshot_id"])


def downgrade() -> None:
    op.drop_table("plan_snapshot_rows")
    op.drop_table("plan_snapshots")
