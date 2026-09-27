"""Реквизит «Приоритетный заказ» — колонка is_priority у заказов на производство.

Признак хранится только у того заказа, который держит его сам; у подчинённых
он вычисляется по цепочке parent_order_id (см. app/services/priority_chain.py).
Поэтому колонка не денормализуется вниз — только собственный флаг.

Revision ID: 0035_order_priority
Revises: 0034_archive_directories
"""
from alembic import op
import sqlalchemy as sa

revision = "0035_order_priority"
down_revision = "0034_archive_directories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_orders",
        sa.Column("is_priority", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_production_orders_is_priority", "production_orders", ["is_priority"])


def downgrade() -> None:
    op.drop_index("ix_production_orders_is_priority", table_name="production_orders")
    op.drop_column("production_orders", "is_priority")
