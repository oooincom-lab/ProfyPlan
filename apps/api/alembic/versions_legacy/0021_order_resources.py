"""Ресурсы заказа — order_resources (Шаг 5 плана v2.15)

Revision ID: 0021_order_resources
Revises: 0020_departments
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0021_order_resources"
down_revision = "0020_departments"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "order_resources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "order_id",
            UUID(as_uuid=True),
            sa.ForeignKey("production_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            UUID(as_uuid=True),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "department_id",
            UUID(as_uuid=True),
            sa.ForeignKey("departments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("capacity", sa.Numeric(12, 3), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("order_id", "resource_id", name="uq_order_resources_order_resource"),
    )
    op.create_index("ix_order_resources_tenant_id", "order_resources", ["tenant_id"])
    op.create_index("ix_order_resources_order_id", "order_resources", ["order_id"])
    op.create_index("ix_order_resources_resource_id", "order_resources", ["resource_id"])


def downgrade():
    op.drop_index("ix_order_resources_resource_id", table_name="order_resources")
    op.drop_index("ix_order_resources_order_id", table_name="order_resources")
    op.drop_index("ix_order_resources_tenant_id", table_name="order_resources")
    op.drop_table("order_resources")
