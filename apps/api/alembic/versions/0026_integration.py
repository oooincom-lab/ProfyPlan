"""Каркас интеграций: подключения, журнал обмена, входящие (14.10.2026).

Revision ID: 0026_integration
Revises: 0025_plan_snapshot_refs
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0026_integration"
down_revision = "0025_plan_snapshot_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "integration_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("profile", sa.String(20), nullable=False, server_default="1c_unf"),
        sa.Column("transport", sa.String(10), nullable=False, server_default="file"),
        sa.Column("settings", postgresql.JSONB(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_integration_connections_tenant_id", "integration_connections", ["tenant_id"])

    op.create_table(
        "exchange_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("integration_connections.id", ondelete="SET NULL"), nullable=True),
        sa.Column("direction", sa.String(3), nullable=False, server_default="in"),
        sa.Column("kind", sa.String(40), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="ok"),
        sa.Column("entities_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("file_name", sa.String(300), nullable=True),
        sa.Column("packet_id", sa.String(64), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
    )
    op.create_index("ix_exchange_log_tenant_id", "exchange_log", ["tenant_id"])
    op.create_index("ix_exchange_log_connection_id", "exchange_log", ["connection_id"])

    op.create_table(
        "exchange_inbox_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("integration_connections.id", ondelete="SET NULL"), nullable=True),
        sa.Column("log_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("exchange_log.id", ondelete="SET NULL"), nullable=True),
        sa.Column("entity_type", sa.String(60), nullable=False, server_default=""),
        sa.Column("entity_uid", sa.String(120), nullable=True),
        sa.Column("op", sa.String(20), nullable=False, server_default="upsert"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
    )
    op.create_index("ix_exchange_inbox_items_tenant_id", "exchange_inbox_items", ["tenant_id"])
    op.create_index("ix_exchange_inbox_items_connection_id", "exchange_inbox_items", ["connection_id"])
    op.create_index("ix_exchange_inbox_items_entity_uid", "exchange_inbox_items", ["entity_uid"])


def downgrade() -> None:
    op.drop_table("exchange_inbox_items")
    op.drop_table("exchange_log")
    op.drop_table("integration_connections")
