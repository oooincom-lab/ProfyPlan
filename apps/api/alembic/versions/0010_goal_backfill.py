"""Догрузка проектных дат цели из старых полей проекта (блок 6.30).

Контекст: миграция 0007 перенесла проектные даты в таблицу goals (запись «область = проект»),
но при нормализации 0009 у проектов, где затем появлялась более свежая строка без части полей,
договорная дата могла потеряться. Легаси-поля projects.goal_contract_date / goal_working_date
при этом сохранились.

Что делаем (аккуратно, без перезаписи пользовательских данных):
  1) если проектной записи в goals нет, а в проекте даты есть — создаём её;
  2) если запись есть, но поле пустое, а в проекте значение есть — дозаполняем только пустое поле.

Новое хранилище — таблица goals; поля проекта остаются как архив на время перехода.

Revision ID: 0010_goal_backfill
Revises: 0009_goals_normalize
Create Date: 2026-09-28
"""
from __future__ import annotations

from alembic import op

revision = "0010_goal_backfill"
down_revision = "0009_goals_normalize"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Нет проектной записи — создаём из легаси-полей
    op.execute(
        """
        INSERT INTO goals (id, tenant_id, project_id, area_type, area_ref, contract_date, working_date, contract_source, working_source, fixed)
        SELECT gen_random_uuid(), p.tenant_id, p.id, 'project', NULL, p.goal_contract_date, p.goal_working_date, 'manual', 'manual', false
        FROM projects p
        WHERE (p.goal_contract_date IS NOT NULL OR p.goal_working_date IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1 FROM goals g
              WHERE g.project_id = p.id AND g.area_type = 'project' AND g.area_ref IS NULL
          )
        """
    )
    # 2) Запись есть, но поле пустое — дозаполняем только пустое
    op.execute(
        """
        UPDATE goals g
        SET contract_date = p.goal_contract_date,
            contract_source = CASE WHEN g.contract_source IS NULL OR g.contract_source = '' THEN 'manual' ELSE g.contract_source END
        FROM projects p
        WHERE g.project_id = p.id AND g.area_type = 'project' AND g.area_ref IS NULL
          AND g.contract_date IS NULL AND p.goal_contract_date IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE goals g
        SET working_date = p.goal_working_date,
            working_source = CASE WHEN g.working_source IS NULL OR g.working_source = '' THEN 'manual' ELSE g.working_source END
        FROM projects p
        WHERE g.project_id = p.id AND g.area_type = 'project' AND g.area_ref IS NULL
          AND g.working_date IS NULL AND p.goal_working_date IS NOT NULL
        """
    )


def downgrade() -> None:
    # Бэкфилл данных не откатываем: удаление дозаполненных значений потеряло бы данные пользователя.
    pass
