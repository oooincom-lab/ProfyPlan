"""Плановые даты операции в связи с ресурсом (регистр 1С).

Revision ID: 0041_operation_plan_fields
Revises: 0040_work_orders
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0041_operation_plan_fields"
down_revision = "0040_work_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "operation_resources",
        sa.Column("planned_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "operation_resources",
        sa.Column("planned_end", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("operation_resources", "planned_end")
    op.drop_column("operation_resources", "planned_start")
