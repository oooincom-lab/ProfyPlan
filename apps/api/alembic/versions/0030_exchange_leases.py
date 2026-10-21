"""Lease активного обмена на подключении (22.10.2026).

Revision ID: 0030_exchange_leases
Revises: 0029_project_hierarchy
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0030_exchange_leases"
down_revision = "0029_project_hierarchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exchange_leases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("instance_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("session_id", sa.String(length=120), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connection_id"], ["integration_connections.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("connection_id", name="uq_exchange_leases_connection"),
    )
    op.create_index("ix_exchange_leases_tenant_id", "exchange_leases", ["tenant_id"])
    op.create_index("ix_exchange_leases_expires_at", "exchange_leases", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_exchange_leases_expires_at", table_name="exchange_leases")
    op.drop_index("ix_exchange_leases_tenant_id", table_name="exchange_leases")
    op.drop_table("exchange_leases")
