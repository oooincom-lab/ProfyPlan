"""Подразделение операции: ручное значение с приоритетом над авто-правилами (10.10.2026).

Revision ID: 0024_operation_department
Revises: 0023_plan_snapshots
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0024_operation_department"
down_revision = "0023_plan_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "operations",
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_operations_department_id",
        "operations",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_operations_department_id", "operations", ["department_id"])


def downgrade() -> None:
    op.drop_index("ix_operations_department_id", table_name="operations")
    op.drop_constraint("fk_operations_department_id", "operations", type_="foreignkey")
    op.drop_column("operations", "department_id")
