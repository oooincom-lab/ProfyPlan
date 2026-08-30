"""FK этапа и подразделения в операциях маршрутов (Шаг 4b)

Revision ID: 0023_routing_fks
Revises: 0022_calendars_cascade
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0023_routing_fks"
down_revision = "0022_calendars_cascade"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "routing_operations",
        sa.Column("stage_id", UUID(as_uuid=True), sa.ForeignKey("project_stages.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "routing_operations",
        sa.Column("department_id", UUID(as_uuid=True), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_routing_operations_stage_id", "routing_operations", ["stage_id"])
    op.create_index("ix_routing_operations_department_id", "routing_operations", ["department_id"])


def downgrade():
    op.drop_index("ix_routing_operations_department_id", table_name="routing_operations")
    op.drop_index("ix_routing_operations_stage_id", table_name="routing_operations")
    op.drop_column("routing_operations", "department_id")
    op.drop_column("routing_operations", "stage_id")
