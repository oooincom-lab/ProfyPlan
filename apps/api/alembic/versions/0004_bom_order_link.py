"""Add order_id to product_structures (BOM → ProductionOrder link)

Revision ID: 0004_bom_order_link
Revises: 0003_actual_audit
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0004_bom_order_link"
down_revision = "0003_actual_audit"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "product_structures",
        sa.Column(
            "order_id",
            UUID(as_uuid=True),
            sa.ForeignKey("production_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_product_structures_order_id",
        "product_structures",
        ["order_id"],
    )


def downgrade():
    op.drop_index("ix_product_structures_order_id", table_name="product_structures")
    op.drop_column("product_structures", "order_id")
