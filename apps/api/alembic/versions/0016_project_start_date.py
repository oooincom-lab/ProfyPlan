"""Add projects.start_date (дата начала проекта для календарного планирования)

Revision ID: 0016_project_start_date
Revises: 0015_resource_sched_pr
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa


revision = "0016_project_start_date"
down_revision = "0015_resource_sched_pr"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("projects", "start_date")
