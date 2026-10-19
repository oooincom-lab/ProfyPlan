"""UID заказа из 1С: production_orders.ext_uid + plan_snapshot_rows.order_ext_uid (19.10.2026).

Revision ID: 0027_order_ext_uid
Revises: 0026_integration
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0027_order_ext_uid"
down_revision = "0026_integration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_orders", sa.Column("ext_uid", sa.String(length=100), nullable=True))
    op.create_index("ix_production_orders_ext_uid", "production_orders", ["ext_uid"])
    op.add_column("plan_snapshot_rows", sa.Column("order_ext_uid", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("plan_snapshot_rows", "order_ext_uid")
    op.drop_index("ix_production_orders_ext_uid", table_name="production_orders")
    op.drop_column("production_orders", "ext_uid")
