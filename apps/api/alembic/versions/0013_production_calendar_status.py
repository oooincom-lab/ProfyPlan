"""Add status/source fields to production_calendars (жизненный цикл календарей)

Revision ID: 0013_production_calendar_status
Revises: 0012_production_calendars
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa


revision = "0013_production_calendar_status"
down_revision = "0012_production_calendars"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "production_calendars",
        sa.Column("source", sa.String(20), nullable=False, server_default="base"),
    )
    op.add_column(
        "production_calendars",
        sa.Column("status", sa.String(20), nullable=False, server_default="fallback"),
    )
    op.add_column(
        "production_calendars",
        sa.Column("last_error", sa.String(500), nullable=True),
    )
    op.add_column(
        "production_calendars",
        sa.Column("source_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "production_calendars",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade():
    op.drop_column("production_calendars", "updated_at")
    op.drop_column("production_calendars", "source_synced_at")
    op.drop_column("production_calendars", "last_error")
    op.drop_column("production_calendars", "status")
    op.drop_column("production_calendars", "source")
