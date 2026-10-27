"""Заказ-наряды: шапка, строки работ и исполнители с КТУ.

Revision ID: 0040_work_orders
Revises: 0039_op_resource_integrity
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0040_work_orders"
down_revision = "0039_op_resource_integrity"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column("id", UUID, primary_key=True, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "work_orders",
        *_base_columns(),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID, sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("organization_id", UUID, sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_id", UUID, sa.ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "parent_production_order_id",
            UUID,
            sa.ForeignKey("production_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("ext_uid", sa.String(length=100), nullable=True),
        sa.Column("ext_id", sa.String(length=100), nullable=True),
        sa.Column("number", sa.String(length=100), nullable=True),
        sa.Column("doc_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="1c"),
        sa.Column("external_revision", sa.String(length=64), nullable=True),
        sa.Column("pending_project_uid", sa.String(length=100), nullable=True),
        sa.Column("pending_organization_uid", sa.String(length=100), nullable=True),
        sa.Column("pending_parent_uid", sa.String(length=100), nullable=True),
    )
    op.create_index("ix_work_orders_tenant_id", "work_orders", ["tenant_id"])
    op.create_index("ix_work_orders_project_id", "work_orders", ["project_id"])
    op.create_index("ix_work_orders_ext_uid", "work_orders", ["ext_uid"])
    op.create_index("ix_work_orders_parent", "work_orders", ["parent_production_order_id"])

    op.create_table(
        "work_order_lines",
        *_base_columns(),
        sa.Column(
            "work_order_id", UUID,
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "operation_id", UUID,
            sa.ForeignKey("operations.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("line_uid", sa.String(length=100), nullable=False),
        sa.Column("source_line_key", sa.String(length=100), nullable=True),
        sa.Column("nomenclature_uid", sa.String(length=100), nullable=True),
        sa.Column("nomenclature_name", sa.String(length=255), nullable=True),
        sa.Column("nomenclature_kind", sa.String(length=20), nullable=False, server_default="work"),
        sa.Column("work_type_uid", sa.String(length=100), nullable=True),
        sa.Column("work_type_name", sa.String(length=255), nullable=True),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=False, server_default="1"),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("duration_hours", sa.Numeric(10, 3), nullable=False, server_default="0"),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("department_id", UUID, sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("stage_uid", sa.String(length=100), nullable=True),
        sa.Column("executor_uid", sa.String(length=100), nullable=True),
        sa.Column("executor_type", sa.String(length=20), nullable=True),
        sa.Column("resource_uid", sa.String(length=100), nullable=True),
        sa.Column("ktu", sa.Numeric(8, 3), nullable=False, server_default="1"),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.UniqueConstraint("work_order_id", "line_uid", name="uq_work_order_lines_order_line"),
    )
    op.create_index("ix_work_order_lines_order", "work_order_lines", ["work_order_id"])
    op.create_index("ix_work_order_lines_operation", "work_order_lines", ["operation_id"])

    op.create_table(
        "work_order_line_executors",
        *_base_columns(),
        sa.Column(
            "work_order_line_id", UUID,
            sa.ForeignKey("work_order_lines.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("executor_uid", sa.String(length=100), nullable=False),
        sa.Column("executor_type", sa.String(length=20), nullable=False, server_default="employee"),
        sa.Column("resource_uid", sa.String(length=100), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column("capacity_demand", sa.Numeric(10, 2), nullable=False, server_default="1"),
        sa.Column("ktu", sa.Numeric(8, 3), nullable=False, server_default="1"),
        sa.UniqueConstraint(
            "work_order_line_id", "executor_uid", name="uq_work_order_line_executor"
        ),
    )
    op.create_index(
        "ix_work_order_line_executors_line", "work_order_line_executors", ["work_order_line_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_work_order_line_executors_line", table_name="work_order_line_executors")
    op.drop_table("work_order_line_executors")
    op.drop_index("ix_work_order_lines_operation", table_name="work_order_lines")
    op.drop_index("ix_work_order_lines_order", table_name="work_order_lines")
    op.drop_table("work_order_lines")
    op.drop_index("ix_work_orders_parent", table_name="work_orders")
    op.drop_index("ix_work_orders_ext_uid", table_name="work_orders")
    op.drop_index("ix_work_orders_project_id", table_name="work_orders")
    op.drop_index("ix_work_orders_tenant_id", table_name="work_orders")
    op.drop_table("work_orders")
