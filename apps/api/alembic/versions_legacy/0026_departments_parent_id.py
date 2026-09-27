"""departments: иерархия (parent_id)

Revision ID: 0026_departments_parent_id
Revises: 0025_organizations
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa


revision = "0026_departments_parent_id"
down_revision = "0025_organizations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "departments",
        sa.Column("parent_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_departments_parent_id",
        "departments",
        "departments",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_departments_parent_id", "departments", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_departments_parent_id", table_name="departments")
    op.drop_constraint("fk_departments_parent_id", "departments", type_="foreignkey")
    op.drop_column("departments", "parent_id")
