"""Факты производства, наряда, прихода и перемещения; ревизии проекта.

Revision ID: 0034_execution_facts
Revises: 0033_warehouses
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0034_execution_facts"
down_revision = "0033_warehouses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column, default in [
        ("fact_revision", "0"), ("plan_revision", "0"),
        ("calculated_revision", "0"),
    ]:
        op.add_column("projects", sa.Column(column, sa.Integer(), nullable=False, server_default=default))
    op.add_column("projects", sa.Column("recalc_required", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("projects", sa.Column("last_fact_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "execution_facts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("fact_type", sa.String(length=30), nullable=False),
        sa.Column("source_document_uid", sa.String(length=100), nullable=False),
        sa.Column("source_row_uid", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="1c"),
        sa.Column("external_revision", sa.String(length=64), nullable=True),
        sa.Column("project_id", UUID(as_uuid=True), nullable=True),
        sa.Column("production_order_id", UUID(as_uuid=True), nullable=True),
        sa.Column("operation_uid", sa.String(length=100), nullable=True),
        sa.Column("stage_uid", sa.String(length=100), nullable=True),
        sa.Column("executor_uid", sa.String(length=100), nullable=True),
        sa.Column("nomenclature_id", UUID(as_uuid=True), nullable=True),
        sa.Column("warehouse_from_id", UUID(as_uuid=True), nullable=True),
        sa.Column("warehouse_to_id", UUID(as_uuid=True), nullable=True),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=True),
        sa.Column("hours", sa.Numeric(12, 2), nullable=True),
        sa.Column("fact_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="posted"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["production_order_id"], ["production_orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["nomenclature_id"], ["nomenclature.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["warehouse_from_id"], ["warehouses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["warehouse_to_id"], ["warehouses.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "tenant_id", "fact_type", "source_document_uid", "source_row_uid",
            name="uq_execution_facts_source_row",
        ),
    )
    for column in [
        "tenant_id", "fact_type", "source_document_uid", "project_id",
        "production_order_id", "nomenclature_id",
    ]:
        op.create_index("ix_execution_facts_" + column, "execution_facts", [column])


def downgrade() -> None:
    for column in [
        "nomenclature_id", "production_order_id", "project_id",
        "source_document_uid", "fact_type", "tenant_id",
    ]:
        op.drop_index("ix_execution_facts_" + column, table_name="execution_facts")
    op.drop_table("execution_facts")
    op.drop_column("projects", "last_fact_at")
    op.drop_column("projects", "recalc_required")
    op.drop_column("projects", "calculated_revision")
    op.drop_column("projects", "plan_revision")
    op.drop_column("projects", "fact_revision")
