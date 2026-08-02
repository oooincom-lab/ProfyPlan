"""CCM Level 1 — BOM, маршруты, версионирование, inter-project deps

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
    # --- product_structures ---
    op.create_table(
        "product_structures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("product_structures.id", ondelete="CASCADE"),
                  nullable=True),
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

    # --- routings ---
    op.create_table(
        "routings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("product_node_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("product_structures.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("spec_id", sa.String(100), nullable=True),
        sa.Column("variant", sa.String(100), default="Основной"),
        sa.Column("is_default", sa.Boolean(), default=True),
        sa.Column("total_setup_hours", sa.Numeric(8, 2), default=0),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_routings_tenant_id", "routings", ["tenant_id"])

    # FK от product_structures к routings
    op.create_foreign_key(
        "fk_product_structures_routing",
        "product_structures", "routings",
        ["routing_id"], ["id"],
        ondelete="SET NULL",
    )

    # --- routing_operations ---
    op.create_table(
        "routing_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("routing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("routings.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("work_center_code", sa.String(50), nullable=True),
        sa.Column("setup_hours", sa.Numeric(8, 2), default=0),
        sa.Column("run_hours_per_unit", sa.Numeric(8, 2), default=0),
        sa.Column("overlap_percent", sa.Numeric(5, 2), default=0),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_routing_ops_routing_id", "routing_operations", ["routing_id"])

    # --- plan_baselines ---
    op.create_table(
        "plan_baselines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("version", sa.Integer(), default=1),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_duration", sa.Numeric(10, 2), nullable=True),
        sa.Column("critical_path_length", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_plan_baselines_project_id", "plan_baselines", ["project_id"])

    # --- actual_executions ---
    op.create_table(
        "actual_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("operations.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("actual_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_duration", sa.Numeric(10, 2), nullable=True),
        sa.Column("status", sa.String(20), default="pending"),
        sa.Column("progress_percent", sa.Numeric(5, 2), default=0),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    # --- inter_project_dependencies ---
    op.create_table(
        "inter_project_dependencies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("predecessor_project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("successor_project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("dependency_type", sa.String(20), default="FS"),
        sa.Column("lag_days", sa.Numeric(8, 2), default=0),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    # --- resource.calendar_id (NOT ext_id — that's in 0001_initial) ---
    # (calendar_id is already in 0001_initial — skip duplicate alter)
    # --- Add columns to operations that do NOT exist in 0001_initial ---
    # bom_node_code, routing_operation_code, parent_operation_id — already in 0001_initial
    # ext_id — already in resources 0001_initial
    # inter_project_dep_id — NOT in 0001, add it
    try:
        op.add_column("operations", sa.Column(
            "inter_project_dep_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("inter_project_dependencies.id", ondelete="SET NULL"),
            nullable=True,
        ))
    except Exception:
        pass

    # Add columns NOT in 0001_initial
    cols_to_add = [
        ("product_structure_node_id", postgresql.UUID(as_uuid=True)),
    ]
    for col_name, col_type in cols_to_add:
        try:
            # Check if column exists
            op.add_column("operations", sa.Column(col_name, col_type, nullable=True))
        except Exception:
            pass


def downgrade() -> None:
    op.drop_column("operations", "inter_project_dep_id")
    op.drop_column("operations", "product_structure_node_id")
    op.drop_table("inter_project_dependencies")
    op.drop_table("actual_executions")
    op.drop_index("ix_plan_baselines_project_id", table_name="plan_baselines")
    op.drop_table("plan_baselines")
    op.drop_index("ix_routing_ops_routing_id", table_name="routing_operations")
    op.drop_table("routing_operations")
    op.drop_table("routings")
    op.drop_index("ix_product_structures_project_id", table_name="product_structures")
    op.drop_index("ix_product_structures_tenant_id", table_name="product_structures")
    op.drop_table("product_structures")
