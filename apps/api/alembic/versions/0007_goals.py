"""Цели по областям: таблица goals (блок плана 6.30, Дополнение 16).

Цель перестаёт быть свойством только проекта: договорная и рабочая даты живут по области —
проект, куст/группа, ветка, заказ. Проектные даты переносятся записью «область = проект».

Поля:
  area_type        — project | cluster | group | order;
  area_ref         — идентификатор области (для проекта — сам проект, для заказов — заказ);
  contract_date    — договорная дата (обязательство);
  working_date     — рабочая дата (цель);
  contract_source  — calculated | manual (откуда взялась дата);
  working_source   — calculated | manual;
  fixed            — фиксация: даты не перезаписываются автоматикой, расхождение показывается.

Флажок фиксации хранится только на той строке, где его поставил человек: у подчинённых
он выводится из ближайшего зафиксированного предка (правило из Дополнения 16).

Revision ID: 0007_goals
Revises: 0006_goal_dates
Create Date: 2026-09-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007_goals"
down_revision = "0006_goal_dates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("area_type", sa.String(20), nullable=False, server_default="project"),
        sa.Column("area_ref", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("contract_date", sa.Date(), nullable=True),
        sa.Column("working_date", sa.Date(), nullable=True),
        sa.Column("contract_source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("working_source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("fixed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_goals_tenant_id", "goals", ["tenant_id"])
    op.create_index("ix_goals_project_id", "goals", ["project_id"])
    op.create_index("ix_goals_area", "goals", ["project_id", "area_type", "area_ref"], unique=True)

    # Переносим текущие проектные даты в новую таблицу записью «область = проект»
    op.execute(
        """
        INSERT INTO goals (id, tenant_id, project_id, area_type, area_ref, contract_date, working_date, contract_source, working_source, fixed)
        SELECT gen_random_uuid(), p.tenant_id, p.id, 'project', p.id, p.goal_contract_date, p.goal_working_date, 'manual', 'manual', false
        FROM projects p
        WHERE p.goal_contract_date IS NOT NULL OR p.goal_working_date IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_goals_area", table_name="goals")
    op.drop_index("ix_goals_project_id", table_name="goals")
    op.drop_index("ix_goals_tenant_id", table_name="goals")
    op.drop_table("goals")
