"""Иерархия проектов: parent_id + sort_order (20.10.2026).

Revision ID: 0029_project_hierarchy
Revises: 0028_ext_uids
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0029_project_hierarchy"
down_revision = "0028_ext_uids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("parent_id", UUID(as_uuid=True), nullable=True))
    op.add_column("projects", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.create_foreign_key(
        "fk_projects_parent_id", "projects", "projects", ["parent_id"], ["id"], ondelete="RESTRICT"
    )
    op.create_index("ix_projects_parent_id", "projects", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_projects_parent_id", table_name="projects")
    op.drop_constraint("fk_projects_parent_id", "projects", type_="foreignkey")
    op.drop_column("projects", "sort_order")
    op.drop_column("projects", "parent_id")
