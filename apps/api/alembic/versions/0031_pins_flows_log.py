"""Закрепления операций, потоки и журнал сдвигов (шаг 2.1)

Таблицы:
- operation_pins — закрепления операций («маркеры» на ресурсах)
- group_flows — потоки (участки) внутри группы заказов
- group_flow_operations — привязка операций к потокам
- group_shift_logs — журнал сдвигов и закреплений (аудит, откат, воспроизводимость)

Revision ID: 0031_pins_flows_log
Revises: 0030_planning_settings
Create Date: 2026-09-12
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0031_pins_flows_log"
down_revision = "0030_planning_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operation_pins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation_id", UUID(as_uuid=True), sa.ForeignKey("operations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), sa.ForeignKey("resources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("group_id", UUID(as_uuid=True), sa.ForeignKey("order_groups.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pin_type", sa.String(length=30), nullable=False),
        sa.Column("pin_at", sa.DateTime(), nullable=False),
        sa.Column("is_hard", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("note", sa.Text(), nullable=True),
    )
    for name, col in [("ix_op_pins_tenant", "tenant_id"), ("ix_op_pins_project", "project_id"),
                      ("ix_op_pins_operation", "operation_id"), ("ix_op_pins_resource", "resource_id"),
                      ("ix_op_pins_group", "group_id")]:
        op.create_index(name, "operation_pins", [col])

    op.create_table(
        "group_flows",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", UUID(as_uuid=True), sa.ForeignKey("order_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("min_gap_days", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("takt_days", sa.Numeric(6, 2), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_group_flows_tenant", "group_flows", ["tenant_id"])
    op.create_index("ix_group_flows_group", "group_flows", ["group_id"])

    op.create_table(
        "group_flow_operations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("flow_id", UUID(as_uuid=True), sa.ForeignKey("group_flows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation_id", UUID(as_uuid=True), sa.ForeignKey("operations.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_gfo_tenant", "group_flow_operations", ["tenant_id"])
    op.create_index("ix_gfo_flow", "group_flow_operations", ["flow_id"])
    op.create_index("ix_gfo_operation", "group_flow_operations", ["operation_id"])

    op.create_table(
        "group_shift_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", UUID(as_uuid=True), sa.ForeignKey("order_groups.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("author_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
    )
    op.create_index("ix_gsl_tenant", "group_shift_logs", ["tenant_id"])
    op.create_index("ix_gsl_group", "group_shift_logs", ["group_id"])
    op.create_index("ix_gsl_project", "group_shift_logs", ["project_id"])


def downgrade() -> None:
    for t, idx in [("group_shift_logs", ["ix_gsl_project", "ix_gsl_group", "ix_gsl_tenant"]),
                   ("group_flow_operations", ["ix_gfo_operation", "ix_gfo_flow", "ix_gfo_tenant"]),
                   ("group_flows", ["ix_group_flows_group", "ix_group_flows_tenant"]),
                   ("operation_pins", ["ix_op_pins_group", "ix_op_pins_resource", "ix_op_pins_operation",
                                       "ix_op_pins_project", "ix_op_pins_tenant"])]:
        for i in idx:
            op.drop_index(i, table_name=t)
        op.drop_table(t)
