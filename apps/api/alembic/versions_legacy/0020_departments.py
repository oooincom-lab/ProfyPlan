"""Справочник подразделений (Шаг 4 плана v2.15)

Revision ID: 0020_departments
Revises: 0019_catalog_operations
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0020_departments"
down_revision = "0019_catalog_operations"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "departments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_departments_tenant_id", "departments", ["tenant_id"])


def downgrade():
    op.drop_index("ix_departments_tenant_id", table_name="departments")
    op.drop_table("departments")
