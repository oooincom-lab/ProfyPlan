"""Настройки расчёта проекта: две независимые оси (блок плана 6.16.7).

Разделяет хранение методов расчёта на две независимые оси:
  planning_logic        — логика планирования: cpm | ccm
  uncertainty_analysis  — модель оценки: none | pert | mc
  monte_carlo_runs      — число прогонов Монте-Карло по умолчанию
  confidence_level      — доверительный уровень по умолчанию
  use_history           — использовать исторические данные (по умолчанию выключено)

Поле default_method НЕ удаляется: оно остаётся для совместимости и повторяет
сочетание осей (cpm / pert_cpm / cpm_ccm / pert_ccm). Существующие проекты
получают оси из уже заполненного default_method.

Revision ID: 0001_calc_settings
Revises: 0000_baseline
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_calc_settings"
down_revision = "0000_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("planning_logic", sa.String(10), nullable=False, server_default="cpm"))
    op.add_column("projects", sa.Column("uncertainty_analysis", sa.String(10), nullable=False, server_default="none"))
    op.add_column("projects", sa.Column("monte_carlo_runs", sa.Integer(), nullable=False, server_default="10000"))
    op.add_column("projects", sa.Column("confidence_level", sa.Float(), nullable=False, server_default="0.8"))
    op.add_column("projects", sa.Column("use_history", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Существующие проекты: оси выводятся из строки default_method
    op.execute("UPDATE projects SET planning_logic = 'ccm' WHERE default_method LIKE '%ccm%'")
    op.execute("UPDATE projects SET uncertainty_analysis = 'pert' WHERE default_method LIKE '%pert%'")


def downgrade() -> None:
    for column in ("use_history", "confidence_level", "monte_carlo_runs", "uncertainty_analysis", "planning_logic"):
        op.drop_column("projects", column)
