"""Add stage_name to routing_operations

Revision ID: 0008_routing_op_stage_name
Revises: 0007_routing_op_stage_department
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa


revision = "0008_routing_op_stage_name"
down_revision = "0007_routing_op_stage_department"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "routing_operations",
        sa.Column(
            "stage_name",
            sa.String(255),
            nullable=True,
            comment="Название этапа (вкладка «6-Этапы»)",
        ),
    )


def downgrade():
    op.drop_column("routing_operations", "stage_name")
