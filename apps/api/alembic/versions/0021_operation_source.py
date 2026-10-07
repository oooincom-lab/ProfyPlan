"""Трассировка операций плана: узел состава и шаг маршрута-источника (07.10.2026).

У операции плана появляется происхождение: из какого узла структуры изделия
и какого шага маршрута она создана при развёртке. Нужно для сверки «маршрут ↔
план» и умной пересборки (дополнить/обновить изменённое/пересобрать).

Revision ID: 0021_operation_source
Revises: 0020_run_imported
Create Date: 2026-10-07
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0021_operation_source"
down_revision = "0020_run_imported"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operations", sa.Column("source_node_id", sa.UUID(), nullable=True))
    op.add_column("operations", sa.Column("source_routing_id", sa.UUID(), nullable=True))
    op.add_column("operations", sa.Column("source_step_seq", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_operations_source_node", "operations", "product_structures",
        ["source_node_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_operations_source_routing", "operations", "routings",
        ["source_routing_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_operations_source_node_id", "operations", ["source_node_id"])


def downgrade() -> None:
    op.drop_index("ix_operations_source_node_id", table_name="operations")
    op.drop_constraint("fk_operations_source_routing", "operations", type_="foreignkey")
    op.drop_constraint("fk_operations_source_node", "operations", type_="foreignkey")
    op.drop_column("operations", "source_routing_id")
    op.drop_column("operations", "source_node_id")
    op.drop_column("operations", "source_step_seq")
