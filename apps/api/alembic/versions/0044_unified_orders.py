"""Единый заказ: order_type, общие order_lines и перенос заказ-нарядов.

Revision ID: 0044_unified_orders
Revises: 0043_work_order_facts
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0044_unified_orders"
down_revision = "0043_work_order_facts"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column(
        "production_orders",
        sa.Column("order_type", sa.String(length=20), nullable=False, server_default="production_order"),
    )
    op.add_column("production_orders", sa.Column("doc_date", sa.Date(), nullable=True))
    op.create_index("ix_production_orders_order_type", "production_orders", ["order_type"])

    op.create_table(
        "order_lines",
        sa.Column("id", UUID, primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("order_id", UUID, sa.ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation_id", UUID, sa.ForeignKey("operations.id", ondelete="SET NULL"), nullable=True),
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
        sa.UniqueConstraint("order_id", "line_uid", name="uq_order_lines_order_line"),
    )
    op.create_index("ix_order_lines_order_id", "order_lines", ["order_id"])
    op.create_index("ix_order_lines_operation_id", "order_lines", ["operation_id"])

    op.create_table(
        "order_line_executors",
        sa.Column("id", UUID, primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("order_line_id", UUID, sa.ForeignKey("order_lines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("executor_uid", sa.String(length=100), nullable=False),
        sa.Column("executor_type", sa.String(length=20), nullable=False, server_default="employee"),
        sa.Column("resource_uid", sa.String(length=100), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column("capacity_demand", sa.Numeric(10, 2), nullable=False, server_default="1"),
        sa.Column("ktu", sa.Numeric(8, 3), nullable=False, server_default="1"),
        sa.UniqueConstraint("order_line_id", "executor_uid", name="uq_order_line_executor"),
    )
    op.create_index("ix_order_line_executors_line", "order_line_executors", ["order_line_id"])

    # Переносим legacy work_orders в production_orders как order_type=work_order.
    op.execute(
        """
        INSERT INTO production_orders (
            id, created_at, tenant_id, project_id, organization_id, client_id,
            parent_order_id, ext_uid, ext_id, source, external_revision,
            order_type, doc_date, start_date, status, notes,
            pending_project_uid, pending_organization_uid, pending_parent_uid
        )
        SELECT
            id, created_at, tenant_id, project_id, organization_id, customer_id,
            parent_production_order_id, ext_uid, ext_id, source, external_revision,
            'work_order', doc_date, doc_date, status, description,
            pending_project_uid, pending_organization_uid, pending_parent_uid
        FROM work_orders
        WHERE NOT EXISTS (SELECT 1 FROM production_orders po WHERE po.id = work_orders.id)
        """
    )
    op.execute(
        """
        UPDATE operations o
        SET order_id = wl.work_order_id
        FROM work_order_lines wl
        WHERE wl.operation_id = o.id AND o.order_id IS NULL
        """
    )
    op.execute(
        """
        INSERT INTO order_lines (
            id, created_at, order_id, operation_id, line_uid, source_line_key,
            nomenclature_uid, nomenclature_name, nomenclature_kind, work_type_uid,
            work_type_name, quantity, unit, duration_hours, sequence, department_id,
            stage_uid, executor_uid, executor_type, resource_uid, ktu, position
        )
        SELECT
            id, created_at, work_order_id, operation_id, line_uid, source_line_key,
            nomenclature_uid, nomenclature_name, nomenclature_kind, work_type_uid,
            work_type_name, quantity, unit, duration_hours, sequence, department_id,
            stage_uid, executor_uid, executor_type, resource_uid, ktu, position
        FROM work_order_lines
        WHERE NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.id = work_order_lines.id)
        """
    )
    op.execute(
        """
        INSERT INTO order_line_executors (
            id, created_at, order_line_id, executor_uid, executor_type,
            resource_uid, role, capacity_demand, ktu
        )
        SELECT
            id, created_at, work_order_line_id, executor_uid, executor_type,
            resource_uid, role, capacity_demand, ktu
        FROM work_order_line_executors
        WHERE NOT EXISTS (SELECT 1 FROM order_line_executors ole WHERE ole.id = work_order_line_executors.id)
        """
    )

    op.add_column("execution_facts", sa.Column("order_line_uid", sa.String(length=100), nullable=True))
    op.execute("UPDATE execution_facts SET order_line_uid = work_order_line_uid WHERE order_line_uid IS NULL")


def downgrade() -> None:
    op.drop_column("execution_facts", "order_line_uid")
    op.drop_index("ix_order_line_executors_line", table_name="order_line_executors")
    op.drop_table("order_line_executors")
    op.drop_index("ix_order_lines_operation_id", table_name="order_lines")
    op.drop_index("ix_order_lines_order_id", table_name="order_lines")
    op.drop_table("order_lines")
    op.drop_index("ix_production_orders_order_type", table_name="production_orders")
    op.drop_column("production_orders", "doc_date")
    op.drop_column("production_orders", "order_type")
