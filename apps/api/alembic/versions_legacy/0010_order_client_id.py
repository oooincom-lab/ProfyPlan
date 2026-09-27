"""Add client_id FK to production_orders (контрагент)

Revision ID: 0010_order_client_id
Revises: 0009_counterparties
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0010_order_client_id"
down_revision = "0009_counterparties"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "production_orders",
        sa.Column(
            "client_id",
            UUID(as_uuid=True),
            sa.ForeignKey("counterparties.id", ondelete="SET NULL"),
            nullable=True,
            comment="Ссылка на справочник контрагентов (клиент)",
        ),
    )
    op.create_index(
        "ix_production_orders_client_id",
        "production_orders",
        ["client_id"],
    )


def downgrade():
    op.drop_index("ix_production_orders_client_id", table_name="production_orders")
    op.drop_column("production_orders", "client_id")
