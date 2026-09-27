"""Источник тройных оценок операции (блок плана 6.17).

У каждой тройной оценки появляется источник — откуда взялись числа:
  expert — ввёл человек (значение по умолчанию);
  fact   — получено из факта по завершённым операциям (калибровка, блок 6.24);
  ai     — предложено ИИ-советником и принято человеком (блок 6.25).

Источник виден в экспертной таблице и в прослеживаемости: по цифре понятно, кто её дал.

Revision ID: 0003_estimate_source
Revises: 0002_calculation_runs
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_estimate_source"
down_revision = "0002_calculation_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operations", sa.Column("estimate_source", sa.String(10), nullable=False, server_default="expert"))
    op.execute("UPDATE operations SET estimate_source = 'expert' WHERE estimate_source IS NULL")


def downgrade() -> None:
    op.drop_column("operations", "estimate_source")
