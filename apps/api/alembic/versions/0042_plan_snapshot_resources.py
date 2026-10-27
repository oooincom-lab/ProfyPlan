"""Роль, КТУ и загрузка ресурса в строках снимка плана.

Revision ID: 0042_plan_snapshot_resources
Revises: 0041_operation_plan_fields
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0042_plan_snapshot_resources"
down_revision = "0041_operation_plan_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plan_snapshot_rows", sa.Column("resource_role", sa.String(length=20), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("ktu", sa.Numeric(8, 3), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("resource_load", sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("plan_snapshot_rows", "resource_load")
    op.drop_column("plan_snapshot_rows", "ktu")
    op.drop_column("plan_snapshot_rows", "resource_role")
