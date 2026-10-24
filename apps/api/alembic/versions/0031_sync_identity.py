"""Идентификация источника и имена для синхронизации с 1С.

Revision ID: 0031_sync_identity
Revises: 0030_exchange_leases
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0031_sync_identity"
down_revision = "0030_exchange_leases"
branch_labels = None
depends_on = None

NAMED_TABLES = (
    "projects",
    "nomenclature",
    "counterparties",
    "departments",
    "resources",
    "organizations",
)


def _add_named_columns(table: str) -> None:
    op.add_column(table, sa.Column("source", sa.String(length=20), nullable=False, server_default="profyplan"))
    op.add_column(table, sa.Column("external_name", sa.String(length=255), nullable=True))
    op.add_column(table, sa.Column("external_name_ack", sa.String(length=255), nullable=True))
    op.add_column(table, sa.Column("name_overridden", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column(table, sa.Column("external_revision", sa.String(length=64), nullable=True))


def upgrade() -> None:
    for table in NAMED_TABLES:
        _add_named_columns(table)
    op.add_column("production_orders", sa.Column("source", sa.String(length=20), nullable=False, server_default="profyplan"))
    op.add_column("production_orders", sa.Column("external_revision", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("production_orders", "external_revision")
    op.drop_column("production_orders", "source")
    for table in reversed(NAMED_TABLES):
        op.drop_column(table, "external_revision")
        op.drop_column(table, "name_overridden")
        op.drop_column(table, "external_name_ack")
        op.drop_column(table, "external_name")
        op.drop_column(table, "source")
