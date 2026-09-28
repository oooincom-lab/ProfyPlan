"""Нормализация проектных целей и защита от дублей (блок 6.30).

Что было не так: при переносе проектных дат миграция 0007 записала в area_ref идентификатор
проекта, а API ищет проектную цель по ПУСТОЙ ссылке (проект уже указан в project_id).
Из-за этого первое же «Взять расчётные» создало вторую проектную строку вместо обновления.

Что делаем:
  1) у проектных целей очищаем area_ref — проект определяется колонкой project_id;
  2) если после этого образовались дубли, оставляем самую свежую строку (её значение и есть
     последнее намерение — авто-заполнение по правилу перезаписывает свободные строки);
  3) ставим частичный уникальный индекс: у проекта может быть только одна строка цели.

Revision ID: 0009_goals_normalize
Revises: 0008_fixation_mode
Create Date: 2026-09-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0009_goals_normalize"
down_revision = "0008_fixation_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE goals SET area_ref = NULL WHERE area_type = 'project'")

    # Дубли проектных целей: оставляем самую свежую строку
    op.execute(
        """
        DELETE FROM goals
        WHERE area_type = 'project'
          AND id NOT IN (
            SELECT DISTINCT ON (project_id) id
            FROM goals
            WHERE area_type = 'project'
            ORDER BY project_id, created_at DESC
          )
        """
    )

    # Одна проектная цель на проект — на уровне базы
    op.create_index(
        "ux_goals_project_area_null",
        "goals",
        ["project_id", "area_type"],
        unique=True,
        postgresql_where=sa.text("area_ref IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_goals_project_area_null", table_name="goals")
