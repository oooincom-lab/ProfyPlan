"""Факт исполнения операций (блок 6.24): фактическая длительность и дата завершения.

Калибровка по историческим данным: система собирает факт по завершённым операциям,
сопоставляет его с оценкой M (наиболее вероятная) и показывает коэффициент как подсказку.
Оценки молча не меняются — правку выполняет человек.

Revision ID: 0012_operation_fact
Revises: 0011_gap_applications
Create Date: 2026-10-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0012_operation_fact"
down_revision = "0011_gap_applications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operations", sa.Column("fact_hours", sa.Numeric(10, 2), nullable=True))
    op.add_column("operations", sa.Column("fact_finished_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("operations", "fact_finished_on")
    op.drop_column("operations", "fact_hours")
