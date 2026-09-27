"""Межпроектные мощности (блок 3): scope ресурса + флаг проекта (v2.17)

Revision ID: 0024_resource_scope
Revises: 0023_routing_fks
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa


revision = "0024_resource_scope"
down_revision = "0023_routing_fks"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "resources",
        sa.Column("scope", sa.String(20), nullable=False, server_default="shared"),
    )
    op.add_column(
        "projects",
        sa.Column("use_shared_resources", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade():
    op.drop_column("projects", "use_shared_resources")
    op.drop_column("resources", "scope")
