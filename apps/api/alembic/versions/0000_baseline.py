"""Начальная схема: единая основа вместо разрозненной цепочки.

Причина появления. Цепочка из 37 ревизий не собирает базу с нуля: часть
таблиц не создаётся ни одной ревизией, а более поздние ревизии на них
ссылаются. Проверено на пустой базе: `alembic upgrade head` падал на
ревизии 0004 (`ALTER TABLE product_structures ADD FOREIGN KEY(order_id)
REFERENCES production_orders (id)` — таблицы ещё нет).

Не создавались: production_orders, order_groups, order_pools, nomenclature,
units, resource_calendars, resource_calendar_slots.

Почему это не проявлялось: рабочая база собрана напрямую из моделей, а
миграции накладывались поверх. Расхождение зафиксировано в реестре сверки
(запись R21).

Что делает эта ревизия. Схема создаётся из моделей — они остаются
источником истины по структуре данных. Прежние ревизии сохранены в
`alembic/versions_legacy` (в репозитории, но вне цепочки) — ничего не
удалено.

На рабочей базе выполнять не нужно: она уже в нужном состоянии и только
отмечается этой ревизией (`alembic stamp 0000_baseline`), схема не меняется.

Revision ID: 0000_baseline
Revises:
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op

revision = "0000_baseline"
down_revision = None
branch_labels = None
depends_on = None


def _metadata():
    """Метаданные схемы: все модели должны быть зарегистрированы."""
    import app.models  # noqa: F401  — регистрирует модели в общих метаданных
    from app.core.database import Base

    return Base.metadata


def upgrade() -> None:
    _metadata().create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    _metadata().drop_all(bind=op.get_bind(), checkfirst=True)
