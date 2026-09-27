"""CCM Level 1 — BOM, routings, baselines, inter-project deps (non-duplicate columns only)

Revision ID: 0002_ccm_bom_routing_baseline
Revises: 0001_initial
Create Date: 2026-08-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_ccm_bom_routing_baseline"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_structures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("product_structures.id", ondelete="CASCADE"), nullable=True),
        sa.Column("level", sa.Integer(), default=0),
        sa.Column("path", sa.String(500), nullable=True),
        sa.Column("node_type", sa.String(20), nullable=False, default="material"),
        sa.Column("nomenclature_id", sa.String(100), nullable=True),
        sa.Column("nomenclature_name", sa.String(255), nullable=False),
        sa.Column("quantity_per_parent", sa.Numeric(12, 4), default=1.0),
        sa.Column("unit", sa.String(20), default="pcs"),
        sa.Column("is_make_or_buy", sa.String(10), nullable=False, default="buy"),
        sa.Column("procurement_lead_time_days", sa.Numeric(8, 2), nullable=True),
        sa.Column("is_phantom", sa.Boolean(), default=False),
        sa.Column("sort_order", sa.Integer(), default=0),
        sa.Column("routing_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_product_structures_tenant_id", "product_structures", ["tenant_id"])
    op.create_index("ix_product_structures_project_id", "product_structures", ["project_id"])

    op.create_table(
        "routings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("product_node_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("product_structures.id", ondelete="SET NULL"), nullable=True),
        sa.Column("spec_id", sa.String(100), nullable=True),
        sa.Column("variant", sa.String(100), default="Основной"),
        sa.Column("is_default", sa.Boolean(), default=True),
        sa.Column("total_setup_hours", sa.Numeric(8, 2), default=0),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_routings_tenant_id", "routings", ["tenant_id"])

    op.create_foreign_key(
        "fk_product_structures_routing", "product_structures", "routings",
        ["routing_id"], ["id"], ondelete="SET NULL",
    )

    op.create_table(
        "routing_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("routing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("routings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("duration_hours", sa.Numeric(8, 2), default=0),
        sa.Column("setup_hours", sa.Numeric(8, 2), default=0),
        sa.Column("teardown_hours", sa.Numeric(8, 2), default=0),
        sa.Column("resource_type_id", sa.String(100), nullable=True),
        sa.Column("alternative_resource_types", sa.String(500), nullable=True),
        sa.Column("output_product", sa.String(100), nullable=True),
        sa.Column("output_quantity", sa.Numeric(12, 2), default=1.0),
        sa.Column("yield_rate", sa.Numeric(5, 3), default=1.0),
        sa.Column("predecessors", sa.String(200), nullable=True),
        sa.Column("input_materials", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_routing_ops_routing_id", "routing_operations", ["routing_id"])

    op.create_table(
        "plan_baselines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), default=1),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("snapshot_data", postgresql.JSONB, nullable=True),
        sa.Column("is_active", sa.Boolean(), default=False),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_plan_baselines_project_id", "plan_baselines", ["project_id"])

    op.create_table(
        "actual_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("operations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fact_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fact_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("quantity_completed", sa.Numeric(12, 2), nullable=True),
        sa.Column("quantity_defect", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", sa.String(20), default="not_started"),
        sa.Column("deviation_reason", sa.Text(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("recorded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("source", sa.String(20), default="manual"),
    )

    op.create_table(
        "inter_project_dependencies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("source_project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_operation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("operations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("target_project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_operation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("operations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("dependency_type", sa.String(10), default="FS"),
        sa.Column("lag_hours", sa.Numeric(10, 2), default=0),
        sa.Column("lag_unit", sa.String(10), default="hour"),
        sa.Column("created_by", sa.String(20), default="manual"),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("inter_project_dependencies")
    op.drop_table("actual_executions")
    op.drop_index("ix_plan_baselines_project_id", table_name="plan_baselines")
    op.drop_table("plan_baselines")
    op.drop_index("ix_routing_ops_routing_id", table_name="routing_operations")
    op.drop_table("routing_operations")
    op.drop_index("ix_routings_tenant_id", table_name="routings")
    op.drop_table("routings")
    op.drop_index("ix_product_structures_project_id", table_name="product_structures")
    op.drop_index("ix_product_structures_tenant_id", table_name="product_structures")
    op.drop_table("product_structures")
