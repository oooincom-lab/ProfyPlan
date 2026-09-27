"""Регистр «Этапы проекта» (Шаг 2 плана v2.15)

Revision ID: 0018_project_stages
Revises: 0017_resource_capacity
Create Date: 2026-08-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0018_project_stages"
down_revision = "0017_resource_capacity"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "project_stages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_project_stages_tenant_id", "project_stages", ["tenant_id"])
    op.create_index("ix_project_stages_project_id", "project_stages", ["project_id"])


def downgrade():
    op.drop_index("ix_project_stages_project_id", table_name="project_stages")
    op.drop_index("ix_project_stages_tenant_id", table_name="project_stages")
    op.drop_table("project_stages")
