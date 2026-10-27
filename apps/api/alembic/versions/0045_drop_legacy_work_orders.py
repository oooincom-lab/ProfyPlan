"""Удаление legacy-таблиц WorkOrder после перехода на единый заказ.

Revision ID: 0045_drop_legacy_work_orders
Revises: 0044_unified_orders
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0045_drop_legacy_work_orders"
down_revision = "0044_unified_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_execution_facts_work_order_id", table_name="execution_facts")
    op.drop_constraint(
        "execution_facts_work_order_id_fkey",
        "execution_facts",
        type_="foreignkey",
    )
    op.drop_column("execution_facts", "work_order_id")
    op.drop_column("execution_facts", "work_order_line_uid")

    op.drop_index("ix_work_order_line_executors_line", table_name="work_order_line_executors")
    op.drop_table("work_order_line_executors")
    op.drop_index("ix_work_order_lines_operation", table_name="work_order_lines")
    op.drop_index("ix_work_order_lines_order", table_name="work_order_lines")
    op.drop_table("work_order_lines")
    op.drop_index("ix_work_orders_parent", table_name="work_orders")
    op.drop_index("ix_work_orders_ext_uid", table_name="work_orders")
    op.drop_index("ix_work_orders_project_id", table_name="work_orders")
    op.drop_index("ix_work_orders_tenant_id", table_name="work_orders")
    op.drop_table("work_orders")


def downgrade() -> None:
    # Legacy-таблицы не восстанавливаются: данные уже перенесены в единый заказ.
    pass
