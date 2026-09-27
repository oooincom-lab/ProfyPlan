"""События мощности ресурса (resource_events) — форсаж/ограничение/поломка/ТО.

Revision ID: 0027_resource_events
Revises: 0026_departments_parent_id
Create Date: 2026-09-10
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0027_resource_events"
down_revision = "0026_departments_parent_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            UUID(as_uuid=True),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "event_type", sa.String(length=30), nullable=False, server_default="boost"
        ),
        sa.Column("capacity_multiplier", sa.Numeric(6, 3), nullable=True),
        sa.Column("capacity_absolute", sa.Numeric(14, 3), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "related_operation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("operations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("base_document_type", sa.String(length=50), nullable=True),
        sa.Column("base_document_id", UUID(as_uuid=True), nullable=True),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    op.create_index("ix_resource_events_tenant_id", "resource_events", ["tenant_id"])
    op.create_index("ix_resource_events_resource_id", "resource_events", ["resource_id"])
    op.create_index("ix_resource_events_project_id", "resource_events", ["project_id"])
    op.create_index("ix_resource_events_event_type", "resource_events", ["event_type"])
    op.create_index("ix_resource_events_date_from", "resource_events", ["date_from"])
    op.create_index("ix_resource_events_date_to", "resource_events", ["date_to"])


def downgrade() -> None:
    op.drop_index("ix_resource_events_date_to", table_name="resource_events")
    op.drop_index("ix_resource_events_date_from", table_name="resource_events")
    op.drop_index("ix_resource_events_event_type", table_name="resource_events")
    op.drop_index("ix_resource_events_project_id", table_name="resource_events")
    op.drop_index("ix_resource_events_resource_id", table_name="resource_events")
    op.drop_index("ix_resource_events_tenant_id", table_name="resource_events")
    op.drop_table("resource_events")
