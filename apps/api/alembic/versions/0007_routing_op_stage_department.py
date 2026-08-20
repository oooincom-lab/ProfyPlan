"""Add stage and department to routing_operations

Revision ID: 0007_routing_op_stage_department
Revises: 0006_nomenclature_ref
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa


revision = "0007_routing_op_stage_department"
down_revision = "0006_nomenclature_ref"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "routing_operations",
        sa.Column(
            "stage",
            sa.String(100),
            nullable=True,
            comment="Этап (колонка «Этап» вкладки Маршруты)",
        ),
    )
    op.add_column(
        "routing_operations",
        sa.Column(
            "department",
            sa.String(255),
            nullable=True,
            comment="Подразделение (колонка «Подразделение» вкладки Маршруты)",
        ),
    )


def downgrade():
    op.drop_column("routing_operations", "department")
    op.drop_column("routing_operations", "stage")
