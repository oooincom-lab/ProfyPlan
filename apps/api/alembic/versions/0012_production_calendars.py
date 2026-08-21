"""Create production_calendars + production_calendar_days (производственные календари)

Revision ID: 0012_production_calendars
Revises: 0011_work_schedules
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0012_production_calendars"
down_revision = "0011_work_schedules"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "production_calendars",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.UniqueConstraint("tenant_id", "country_code", "year", name="uq_prodcal_country_year"),
    )
    op.create_index("ix_production_calendars_tenant_id", "production_calendars", ["tenant_id"])

    op.create_table(
        "production_calendar_days",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("calendar_id", UUID(as_uuid=True), sa.ForeignKey("production_calendars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("day_type", sa.String(20), nullable=False, server_default="work"),
        sa.Column("hours", sa.Numeric(5, 2), nullable=True),
        sa.UniqueConstraint("calendar_id", "date", name="uq_prodcal_day_date"),
    )
    op.create_index("ix_production_calendar_days_calendar_id", "production_calendar_days", ["calendar_id"])


def downgrade():
    op.drop_index("ix_production_calendar_days_calendar_id", table_name="production_calendar_days")
    op.drop_table("production_calendar_days")
    op.drop_index("ix_production_calendars_tenant_id", table_name="production_calendars")
    op.drop_table("production_calendars")
