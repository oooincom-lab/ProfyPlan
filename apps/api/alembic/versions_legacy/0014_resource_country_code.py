"""Add country_code to resources (страна календаря ресурса, nullable)

Revision ID: 0014_resource_country_code
Revises: 0013_production_calendar_status
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa


revision = "0014_resource_country_code"
down_revision = "0013_production_calendar_status"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "resources",
        sa.Column("country_code", sa.String(2), nullable=True),
    )


def downgrade():
    op.drop_column("resources", "country_code")
