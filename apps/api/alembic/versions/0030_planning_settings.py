"""Настройки планирования с наследованием (planning_settings)

Уровни: workspace (рабочий стол) → project → group.
Хранятся только переопределения; эффективные значения собираются по цепочке.

Revision ID: 0030_planning_settings
Revises: 0029_resource_department_quotas
Create Date: 2026-09-12
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0030_planning_settings"
down_revision = "0029_resource_department_quotas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "planning_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("scope_id", UUID(as_uuid=True), nullable=True),
        sa.Column("settings", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.UniqueConstraint("tenant_id", "scope", "scope_id", name="uq_planning_settings_scope"),
    )
    op.create_index("ix_planning_settings_tenant", "planning_settings", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_planning_settings_tenant", table_name="planning_settings")
    op.drop_table("planning_settings")
