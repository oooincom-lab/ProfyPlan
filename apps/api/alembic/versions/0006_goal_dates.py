"""Цели проекта: договорная и рабочая даты (блок плана 6.14г).

Режим цели ступени 2: назначенные даты обосновываются вероятностями, а не одной цифрой.
Храним сами назначения — их ставит человек и при пересчёте они НЕ сбрасываются:
  goal_contract_date — договорная дата (обязательство перед заказчиком);
  goal_working_date  — рабочая дата (внутренний ориентир).

Оперативная дата, разрыв и сигналы не хранятся: они считаются из расчёта.

Revision ID: 0006_goal_dates
Revises: 0005_date_policy
Create Date: 2026-09-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_goal_dates"
down_revision = "0005_date_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("goal_contract_date", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("goal_working_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "goal_working_date")
    op.drop_column("projects", "goal_contract_date")
