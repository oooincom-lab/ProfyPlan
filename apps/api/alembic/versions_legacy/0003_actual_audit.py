"""Add updated_at + edit_count to actual_executions + auto_closed source

Revision ID: 0003_actual_audit
Revises: 0002_ccm_bom_routing_baseline
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_actual_audit"
down_revision = "0002_ccm_bom_routing_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("actual_executions",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("actual_executions",
        sa.Column("edit_count", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("actual_executions", "edit_count")
    op.drop_column("actual_executions", "updated_at")
