"""Связь фактов с заказ-нарядом, исполнителем и КТУ.

Revision ID: 0043_work_order_facts
Revises: 0042_plan_snapshot_resources
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0043_work_order_facts"
down_revision = "0042_plan_snapshot_resources"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column(
        "execution_facts",
        sa.Column(
            "work_order_id", UUID,
            sa.ForeignKey("work_orders.id", ondelete="SET NULL"), nullable=True,
        ),
    )
    op.add_column("execution_facts", sa.Column("work_order_line_uid", sa.String(length=100), nullable=True))
    op.add_column("execution_facts", sa.Column("executor_type", sa.String(length=20), nullable=True))
    op.add_column("execution_facts", sa.Column("ktu", sa.Numeric(8, 3), nullable=True))
    op.create_index("ix_execution_facts_work_order_id", "execution_facts", ["work_order_id"])


def downgrade() -> None:
    op.drop_index("ix_execution_facts_work_order_id", table_name="execution_facts")
    op.drop_column("execution_facts", "ktu")
    op.drop_column("execution_facts", "executor_type")
    op.drop_column("execution_facts", "work_order_line_uid")
    op.drop_column("execution_facts", "work_order_id")
