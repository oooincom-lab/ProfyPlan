"""
Реестр параметров планирования и разрешение значений по уровням.

Уровни (от младшего к старшему): system (значения по умолчанию) →
workspace (рабочий стол) → project (проект) → group (группа заказов).
"""
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planning_settings import PlanningSettings

# ── Реестр параметров ─────────────────────────────────────────────────────────
# key — техническое имя; title/hint используются интерфейсом (и подсказками).
PARAMS: list[dict] = [
    # Потоки
    {"key": "flows.enabled", "group": "Потоки", "type": "bool", "default": False,
     "title": "Расчёт по потокам",
     "hint": "Включает потоковый расчёт группы: ресурс идёт по фронтам без простоя (непрерывность). По умолчанию выключено — кусты считаются независимо."},
    {"key": "flows.min_gap_days", "group": "Потоки", "type": "number", "default": 0,
     "title": "Минимальный разрыв между фронтами, дней",
     "hint": "Пауза между завершением работы на одном фронте и началом на следующем. 0 — встык."},
    {"key": "flows.takt_days", "group": "Потоки", "type": "number", "default": None,
     "title": "Шаг потока, дней",
     "hint": "Ритм перехода работ между фронтами. Если не задан — вычисляется из ритмов фронтов."},
    {"key": "flows.priority", "group": "Потоки", "type": "number", "default": 100,
     "title": "Приоритет потока при конфликте",
     "hint": "При борьбе двух потоков за общий ресурс сдвигается поток с меньшим приоритетом."},

    # Магнит
    {"key": "magnet.anchors.op_finish", "group": "Магнит", "type": "bool", "default": True,
     "title": "Якорь: конец чужой операции",
     "hint": "Прилипание к концу операции другого заказа на том же ресурсе (начать не раньше)."},
    {"key": "magnet.anchors.capacity_window", "group": "Магнит", "type": "bool", "default": True,
     "title": "Якорь: начало свободного окна мощности",
     "hint": "Ресурс занят частично — прилипание к началу свободного окна его мощности."},
    {"key": "magnet.anchors.next_op_start", "group": "Магнит", "type": "bool", "default": True,
     "title": "Якорь: начало следующей операции",
     "hint": "Встать встык перед следующей операцией, не разрывая цепочку."},
    {"key": "magnet.anchors.milestone", "group": "Магнит", "type": "bool", "default": False,
     "title": "Якорь: контрольная дата (веха)",
     "hint": "Прилипание к сроку сдачи. По умолчанию выключено, чтобы не тянуло операции к дедлайну."},
    {"key": "magnet.radius_value", "group": "Магнит", "type": "number", "default": 1,
     "title": "Радиус магнита",
     "hint": "Расстояние, в пределах которого срабатывает прилипание. Меньше — точнее, больше — удобнее на дальних сдвигах."},
    {"key": "magnet.radius_unit", "group": "Магнит", "type": "enum", "default": "days",
     "options": ["minutes", "hours", "shifts", "days"],
     "title": "Единица радиуса магнита",
     "hint": "Минуты, часы, смены или дни."},
    {"key": "magnet.step_value", "group": "Магнит", "type": "number", "default": 1,
     "title": "Шаг прилипания",
     "hint": "С какой точностью магнит ставит операцию на якорь."},
    {"key": "magnet.step_unit", "group": "Магнит", "type": "enum", "default": "days",
     "options": ["minutes", "hours", "shifts", "days"],
     "title": "Единица шага прилипания"},
    {"key": "magnet.show_beam", "group": "Магнит", "type": "bool", "default": True,
     "title": "Показывать луч магнита",
     "hint": "Подсвечивает якорь, к которому «прилипнет» операция."},

    # Закрепления
    {"key": "pins.mode", "group": "Закрепления", "type": "enum", "default": "hard",
     "options": ["hard", "soft"],
     "title": "Тип закрепления",
     "hint": "Жёсткое — CPM обязан соблюсти. Мягкое — приоритетная цель, допускается нарушение."},
    {"key": "pins.soft_conflict_resolution", "group": "Закрепления", "type": "enum", "default": "pin_date",
     "options": ["pin_date", "order_deadline"],
     "title": "Мягкий режим: чем жертвуем при конфликте",
     "hint": "По умолчанию жертвуем датой закрепления (сдвигаем привязку, сохраняя срок заказа)."},
    {"key": "pins.autopick", "group": "Закрепления", "type": "enum", "default": "variants",
     "options": ["variants", "best"],
     "title": "Авто-подбор закрепления",
     "hint": "«Варианты» — предложить 2–3 точки с оценкой последствий; «лучшая» — одна оптимальная точка."},
    {"key": "pins.autopick_variants", "group": "Закрепления", "type": "number", "default": 3,
     "title": "Сколько вариантов предлагать"},
    {"key": "pins.visible_on_gantt", "group": "Закрепления", "type": "bool", "default": True,
     "title": "Показывать закрепления на диаграмме Ганта"},
    {"key": "pins.visible_in_ccm", "group": "Закрепления", "type": "bool", "default": True,
     "title": "Показывать закрепления в CCM"},

    # Что если / индикаторы
    {"key": "whatif.show_overload_cost", "group": "Что если", "type": "bool", "default": True,
     "title": "Показывать цену перегрузки в ползунке мощности",
     "hint": "Вместе с сокращением срока показываем рост риска перегрузки (muri)."},
    {"key": "plan.freedom_threshold_percent", "group": "Индикаторы", "type": "number", "default": 20,
     "title": "Порог «свободы плана», %",
     "hint": "Предупреждение, когда незакреплённых операций меньше этого процента — оптимизация почти не влияет."},

    # Интерфейс
    {"key": "ui.hints.enabled", "group": "Интерфейс", "type": "bool", "default": True,
     "title": "Показывать подсказки при наведении"},
    {"key": "ui.hints.delay_ms", "group": "Интерфейс", "type": "number", "default": 400,
     "title": "Задержка появления подсказки, мс"},
]

PARAMS_BY_KEY = {p["key"]: p for p in PARAMS}
LEVELS = ["system", "workspace", "project", "group"]


async def _load_level(db: AsyncSession, tenant_id: UUID, scope: str, scope_id: Optional[UUID]) -> dict:
    stmt = select(PlanningSettings).where(
        PlanningSettings.tenant_id == tenant_id,
        PlanningSettings.scope == scope,
    )
    if scope_id is None:
        stmt = stmt.where(PlanningSettings.scope_id.is_(None))
    else:
        stmt = stmt.where(PlanningSettings.scope_id == scope_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    return dict(row.settings or {}) if row else {}


async def resolve_settings(
    db: AsyncSession,
    tenant_id: UUID,
    project_id: Optional[UUID] = None,
    group_id: Optional[UUID] = None,
) -> dict:
    """Собирает эффективные значения и источник каждого параметра."""
    layers: list[tuple[str, dict]] = [("system", {p["key"]: p["default"] for p in PARAMS})]
    layers.append(("workspace", await _load_level(db, tenant_id, "workspace", None)))
    if project_id:
        layers.append(("project", await _load_level(db, tenant_id, "project", project_id)))
    if group_id:
        layers.append(("group", await _load_level(db, tenant_id, "group", group_id)))

    out: dict[str, dict] = {}
    for key, meta in PARAMS_BY_KEY.items():
        value, source = meta["default"], "system"
        for name, data in layers[1:]:
            if key in data and data[key] is not None:
                value, source = data[key], name
        out[key] = {"value": value, "source": source, "default": meta["default"]}
    return {"params": PARAMS, "values": out, "levels": LEVELS}
