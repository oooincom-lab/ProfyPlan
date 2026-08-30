"""Каскад календарей: schedule_id у departments/projects, версии графиков, исключения (v2.16)

Revision ID: 0022_calendars_cascade
Revises: 0021_order_resources
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0022_calendars_cascade"
down_revision = "0021_order_resources"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "departments",
        sa.Column("schedule_id", UUID(as_uuid=True), sa.ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("schedule_id", UUID(as_uuid=True), sa.ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "resources",
        sa.Column("department_id", UUID(as_uuid=True), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_table(
        "schedule_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), sa.ForeignKey("resources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("schedule_id", UUID(as_uuid=True), sa.ForeignKey("work_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_schedule_assignments_tenant_id", "schedule_assignments", ["tenant_id"])
    op.create_index("ix_schedule_assignments_resource_id", "schedule_assignments", ["resource_id"])
    op.create_table(
        "calendar_exceptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.String(20), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), sa.ForeignKey("resources.id", ondelete="CASCADE"), nullable=True),
        sa.Column("department_id", UUID(as_uuid=True), sa.ForeignKey("departments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("date_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("date_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hours_override", sa.Numeric(4, 2), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_calendar_exceptions_tenant_id", "calendar_exceptions", ["tenant_id"])
    op.create_index("ix_calendar_exceptions_resource_id", "calendar_exceptions", ["resource_id"])
    op.create_index("ix_calendar_exceptions_department_id", "calendar_exceptions", ["department_id"])
    op.create_index("ix_calendar_exceptions_project_id", "calendar_exceptions", ["project_id"])


def downgrade():
    op.drop_index("ix_calendar_exceptions_project_id", table_name="calendar_exceptions")
    op.drop_index("ix_calendar_exceptions_department_id", table_name="calendar_exceptions")
    op.drop_index("ix_calendar_exceptions_resource_id", table_name="calendar_exceptions")
    op.drop_index("ix_calendar_exceptions_tenant_id", table_name="calendar_exceptions")
    op.drop_table("calendar_exceptions")
    op.drop_index("ix_schedule_assignments_resource_id", table_name="schedule_assignments")
    op.drop_index("ix_schedule_assignments_tenant_id", table_name="schedule_assignments")
    op.drop_table("schedule_assignments")
    op.drop_column("resources", "department_id")
    op.drop_column("projects", "schedule_id")
    op.drop_column("departments", "schedule_id")
