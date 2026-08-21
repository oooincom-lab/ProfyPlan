"""Расширить регистр project_resources: capacity_share + период (регистр-выделение)

Revision ID: 0017_resource_capacity
Revises: 0016_project_start_date
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa


revision = "0017_resource_capacity"
down_revision = "0016_project_start_date"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "project_resources",
        sa.Column(
            "capacity_share",
            sa.Numeric(5, 3),
            server_default="1",
            nullable=False,
        ),
    )
    op.add_column(
        "project_resources",
        sa.Column("date_from", sa.Date(), nullable=True),
    )
    op.add_column(
        "project_resources",
        sa.Column("date_to", sa.Date(), nullable=True),
    )


def downgrade():
    op.drop_column("project_resources", "date_to")
    op.drop_column("project_resources", "date_from")
    op.drop_column("project_resources", "capacity_share")
