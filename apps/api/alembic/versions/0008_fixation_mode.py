"""Режим фиксации дат (блок 6.30, Дополнение 16).

Настройка проекта, рядом с политикой даты:
  simple   — простой режим (по умолчанию): два состояния — свободно и зависит от родителя.
             Жёсткая дата отдельного заказа внутри свободного куста недоступна: фиксируется ветка.
  extended — расширенный: своя фиксация на любой строке, и она сильнее родительской.

Хранение одно для обоих режимов: переключение не сбрасывает построчные фиксации.

Revision ID: 0008_fixation_mode
Revises: 0007_goals
Create Date: 2026-09-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0008_fixation_mode"
down_revision = "0007_goals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("fixation_mode", sa.String(20), nullable=False, server_default="simple"))


def downgrade() -> None:
    op.drop_column("projects", "fixation_mode")
