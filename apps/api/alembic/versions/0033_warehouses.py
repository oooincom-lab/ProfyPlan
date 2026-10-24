"""Справочник складов для обмена с 1С.

Revision ID: 0033_warehouses
Revises: 0032_organization_links
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0033_warehouses"
down_revision = "0032_organization_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "warehouses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=True),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
        sa.Column("department_id", UUID(as_uuid=True), nullable=True),
        sa.Column("ext_id", sa.String(length=100), nullable=True),
        sa.Column("ext_uid", sa.String(length=100), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="profyplan"),
        sa.Column("external_name", sa.String(length=255), nullable=True),
        sa.Column("external_name_ack", sa.String(length=255), nullable=True),
        sa.Column("name_overridden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("external_revision", sa.String(length=64), nullable=True),
        sa.Column("needs_mapping", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_warehouses_tenant_id", "warehouses", ["tenant_id"])
    op.create_index("ix_warehouses_code", "warehouses", ["code"])
    op.create_index("ix_warehouses_organization_id", "warehouses", ["organization_id"])
    op.create_index("ix_warehouses_department_id", "warehouses", ["department_id"])
    op.create_index("ix_warehouses_ext_id", "warehouses", ["ext_id"])
    op.create_index("ix_warehouses_ext_uid", "warehouses", ["ext_uid"])


def downgrade() -> None:
    op.drop_index("ix_warehouses_ext_uid", table_name="warehouses")
    op.drop_index("ix_warehouses_ext_id", table_name="warehouses")
    op.drop_index("ix_warehouses_department_id", table_name="warehouses")
    op.drop_index("ix_warehouses_organization_id", table_name="warehouses")
    op.drop_index("ix_warehouses_code", table_name="warehouses")
    op.drop_index("ix_warehouses_tenant_id", table_name="warehouses")
    op.drop_table("warehouses")
