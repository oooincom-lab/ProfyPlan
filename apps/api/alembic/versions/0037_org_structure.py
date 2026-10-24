"""Оргструктура и сотрудники.

Revision ID: 0037_org_structure
Revises: 0036_hours_precision
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0037_org_structure"
down_revision = "0036_hours_precision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_levels",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("can_be_resource", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "code", name="uq_org_levels_tenant_code"),
    )
    op.create_index("ix_org_levels_tenant_id", "org_levels", ["tenant_id"])

    op.create_table(
        "employees",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("department_id", UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=True),
        sa.Column("position", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("ext_id", sa.String(length=100), nullable=True),
        sa.Column("ext_uid", sa.String(length=100), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="profyplan"),
        sa.Column("external_name", sa.String(length=255), nullable=True),
        sa.Column("external_name_ack", sa.String(length=255), nullable=True),
        sa.Column("name_overridden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("external_revision", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
    )
    for column in ["tenant_id", "department_id", "code", "ext_id", "ext_uid"]:
        op.create_index("ix_employees_" + column, "employees", [column])

    op.add_column("departments", sa.Column("level_id", UUID(as_uuid=True), nullable=True))
    op.create_index("ix_departments_level_id", "departments", ["level_id"])
    op.create_foreign_key(
        "fk_departments_level_id", "departments", "org_levels",
        ["level_id"], ["id"], ondelete="SET NULL",
    )

    op.add_column("resources", sa.Column("subject_type", sa.String(length=20), nullable=True))
    op.add_column("resources", sa.Column("subject_uid", sa.String(length=100), nullable=True))
    op.create_index("ix_resources_subject_uid", "resources", ["subject_uid"])
    op.add_column("resources", sa.Column("capacity_mode", sa.String(length=20), nullable=False, server_default="individual"))
    op.add_column("resources", sa.Column("is_bookable", sa.Boolean(), nullable=False, server_default=sa.text("true")))


def downgrade() -> None:
    op.drop_column("resources", "is_bookable")
    op.drop_column("resources", "capacity_mode")
    op.drop_index("ix_resources_subject_uid", table_name="resources")
    op.drop_column("resources", "subject_uid")
    op.drop_column("resources", "subject_type")
    op.drop_constraint("fk_departments_level_id", "departments", type_="foreignkey")
    op.drop_index("ix_departments_level_id", table_name="departments")
    op.drop_column("departments", "level_id")
    for column in ["ext_uid", "ext_id", "code", "department_id", "tenant_id"]:
        op.drop_index("ix_employees_" + column, table_name="employees")
    op.drop_table("employees")
    op.drop_index("ix_org_levels_tenant_id", table_name="org_levels")
    op.drop_table("org_levels")
