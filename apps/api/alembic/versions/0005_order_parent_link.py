"""Add parent_order_id to production_orders (order cluster self-FK)

Revision ID: 0005_order_parent_link
Revises: 0004_bom_order_link
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0005_order_parent_link"
down_revision = "0004_bom_order_link"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "production_orders",
        sa.Column(
            "parent_order_id",
            UUID(as_uuid=True),
            sa.ForeignKey("production_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_production_orders_parent_order_id",
        "production_orders",
        ["parent_order_id"],
    )


def downgrade():
    op.drop_index("ix_production_orders_parent_order_id", table_name="production_orders")
    op.drop_column("production_orders", "parent_order_id")
