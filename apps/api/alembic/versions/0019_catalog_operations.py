"""Каталог операций + FK catalog_operation_id в routing_operations (Шаг 3 v2.15)

Revision ID: 0019_catalog_operations
Revises: 0018_project_stages
Create Date: 2026-08-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0019_catalog_operations"
down_revision = "0018_project_stages"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "catalog_operations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "default_duration_hours",
            sa.Numeric(8, 2),
            nullable=False,
            server_default="1",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_catalog_operations_tenant_id", "catalog_operations", ["tenant_id"])
    op.add_column(
        "routing_operations",
        sa.Column(
            "catalog_operation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("catalog_operations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_routing_operations_catalog_operation_id",
        "routing_operations",
        ["catalog_operation_id"],
    )


def downgrade():
    op.drop_index("ix_routing_operations_catalog_operation_id", table_name="routing_operations")
    op.drop_column("routing_operations", "catalog_operation_id")
    op.drop_index("ix_catalog_operations_tenant_id", table_name="catalog_operations")
    op.drop_table("catalog_operations")
