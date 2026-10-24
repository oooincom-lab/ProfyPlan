"""Связь заказа с организацией и внешние ключи организации.

Revision ID: 0032_organization_links
Revises: 0031_sync_identity
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0032_organization_links"
down_revision = "0031_sync_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("ext_id", sa.String(length=100), nullable=True))
    op.add_column("organizations", sa.Column("ext_uid", sa.String(length=100), nullable=True))
    op.create_index("ix_organizations_ext_id", "organizations", ["ext_id"])
    op.create_index("ix_organizations_ext_uid", "organizations", ["ext_uid"])
    op.add_column("production_orders", sa.Column("organization_id", UUID(as_uuid=True), nullable=True))
    op.create_index("ix_production_orders_organization_id", "production_orders", ["organization_id"])
    op.create_foreign_key(
        "fk_production_orders_organization_id",
        "production_orders", "organizations",
        ["organization_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_production_orders_organization_id", "production_orders", type_="foreignkey")
    op.drop_index("ix_production_orders_organization_id", table_name="production_orders")
    op.drop_column("production_orders", "organization_id")
    op.drop_index("ix_organizations_ext_uid", table_name="organizations")
    op.drop_index("ix_organizations_ext_id", table_name="organizations")
    op.drop_column("organizations", "ext_uid")
    op.drop_column("organizations", "ext_id")
