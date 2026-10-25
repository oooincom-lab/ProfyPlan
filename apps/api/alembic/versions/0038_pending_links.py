"""Отложенное связывание импортированных заказов и фактов.

Revision ID: 0038_pending_links
Revises: 0037_org_structure
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0038_pending_links"
down_revision = "0037_org_structure"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_orders", sa.Column("pending_project_uid", sa.String(length=100), nullable=True))
    op.add_column("production_orders", sa.Column("pending_organization_uid", sa.String(length=100), nullable=True))
    op.add_column("production_orders", sa.Column("pending_parent_uid", sa.String(length=100), nullable=True))
    op.add_column("execution_facts", sa.Column("pending_project_uid", sa.String(length=100), nullable=True))
    op.add_column("execution_facts", sa.Column("pending_order_uid", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("execution_facts", "pending_order_uid")
    op.drop_column("execution_facts", "pending_project_uid")
    op.drop_column("production_orders", "pending_parent_uid")
    op.drop_column("production_orders", "pending_organization_uid")
    op.drop_column("production_orders", "pending_project_uid")
