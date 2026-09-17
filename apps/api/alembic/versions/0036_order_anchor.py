"""Якорь старта приоритетного заказа — колонка priority_anchor_at.

Хранится у заказа, который держит признак «Приоритетный заказ»; подчинённые
наследуют значение по цепочке. В расчёте якорь превращается в жёсткое
закрепление первых операций заказа (operation_pins, тип start_not_earlier).

Revision ID: 0036_order_anchor
Revises: 0035_order_priority
"""
from alembic import op
import sqlalchemy as sa

revision = "0036_order_anchor"
down_revision = "0035_order_priority"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_orders",
        sa.Column("priority_anchor_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("production_orders", "priority_anchor_at")
