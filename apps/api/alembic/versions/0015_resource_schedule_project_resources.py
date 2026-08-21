"""Add resources.schedule_id + create project_resources (привязка графика к ресурсу + регистр ресурсов проекта)

Revision ID: 0015_resource_schedule_project_resources
Revises: 0014_resource_country_code
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0015_resource_schedule_project_resources"
down_revision = "0014_resource_country_code"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "resources",
        sa.Column(
            "schedule_id",
            UUID(as_uuid=True),
            sa.ForeignKey("work_schedules.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_resources_schedule_id", "resources", ["schedule_id"])

    op.create_table(
        "project_resources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), sa.ForeignKey("resources.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "schedule_id",
            UUID(as_uuid=True),
            sa.ForeignKey("work_schedules.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("project_id", "resource_id", name="uq_project_resource"),
    )
    op.create_index("ix_project_resources_project_id", "project_resources", ["project_id"])
    op.create_index("ix_project_resources_resource_id", "project_resources", ["resource_id"])


def downgrade():
    op.drop_index("ix_project_resources_resource_id", table_name="project_resources")
    op.drop_index("ix_project_resources_project_id", table_name="project_resources")
    op.drop_table("project_resources")
    op.drop_index("ix_resources_schedule_id", table_name="resources")
    op.drop_column("resources", "schedule_id")
