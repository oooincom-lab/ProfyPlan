"""Create work_schedules + work_schedule_slots (справочник графиков работы)

Revision ID: 0011_work_schedules
Revises: 0010_order_client_id
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0011_work_schedules"
down_revision = "0010_order_client_id"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "work_schedules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("fill_mode", sa.String(20), nullable=False, server_default="weekdays"),
        sa.Column("cycle_length", sa.Integer(), nullable=True),
        sa.Column("timezone", sa.String(50), nullable=False, server_default="Europe/Moscow"),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
    )
    op.create_index("ix_work_schedules_tenant_id", "work_schedules", ["tenant_id"])

    op.create_table(
        "work_schedule_slots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("schedule_id", UUID(as_uuid=True), sa.ForeignKey("work_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=True),
        sa.Column("cycle_day", sa.Integer(), nullable=True),
        sa.Column("start_hour", sa.Numeric(5, 2), nullable=False),
        sa.Column("end_hour", sa.Numeric(5, 2), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="work"),
    )
    op.create_index("ix_work_schedule_slots_schedule_id", "work_schedule_slots", ["schedule_id"])


def downgrade():
    op.drop_index("ix_work_schedule_slots_schedule_id", table_name="work_schedule_slots")
    op.drop_table("work_schedule_slots")
    op.drop_index("ix_work_schedules_tenant_id", table_name="work_schedules")
    op.drop_table("work_schedules")
