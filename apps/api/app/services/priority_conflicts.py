"""Конфликты приоритетного заказа с другими заказами на общих ресурсах.

Основание — шаг 3 блока 6.5: «приоритет по общим ресурсам» и «окно конфликта».
Модуль только ищет и объясняет конфликты; решения применяет роутер заказов
(окно конфликта из четырёх действий, первым — предложение по умолчанию).

Правила предложения по умолчанию:
    - приоритетный заказ выше неприоритетного в любом случае;
    - два приоритетных заказа: при включённой настройке «конкуренция по приоритетам»
      уступает тот, у кого приоритет ниже, при равенстве — кто позже стартует;
    - при выключенной настройке — «кто раньше начал», то есть уступает позже стартующий.

Автоматически ничего не разрешается: модуль отдаёт вариант по умолчанию и
признаки, из-за которых решение может быть затруднено (нулевая мощность в окне,
перегрузка ресурса).
"""
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation import Operation, OperationResource
from app.models.production_order import ProductionOrder
from app.models.resource import Resource
from app.models.resource_event import ResourceEvent

PRIORITY_LADDER = {"low": 0, "normal": 1, "high": 2, "critical": 3}
ZERO_CAPACITY_TYPES = ("breakdown", "maintenance", "reduced")


def parse_dt(value) -> Optional[datetime]:
    """Дата-время расчёта → «настенные» часы (как у закреплений)."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except Exception:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _overlap(a0, a1, b0, b1):
    start, end = max(a0, b0), min(a1, b1)
    return (start, end) if end > start else None


async def _chain_ids(db: AsyncSession, tenant_id, order: ProductionOrder) -> set:
    """Тело цепочки: сам заказ и все подчинённые (по parent_order_id)."""
    rows = (await db.execute(
        select(ProductionOrder.id, ProductionOrder.parent_order_id).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == order.project_id,
        )
    )).all()
    children: dict = {}
    for oid, pid in rows:
        if pid:
            children.setdefault(pid, []).append(oid)
    out, stack, seen = {order.id}, [order.id], {order.id}
    while stack:
        cur = stack.pop()
        for kid in children.get(cur, []):
            if kid not in seen:
                seen.add(kid)
                out.add(kid)
                stack.append(kid)
    return out


async def find_conflicts(
    db: AsyncSession, tenant_id, order: ProductionOrder, settings: Optional[dict] = None,
) -> dict:
    """Конфликты заказа с другими заказами проекта на общих ресурсах."""
    settings = settings or {}
    compete = bool(settings.get("priority_orders.compete_by_priority", False))
    on_zero = str(settings.get("priority_orders.on_zero_capacity", "warn") or "warn")
    on_overload = str(settings.get("priority_orders.on_overload", "warn") or "warn")
    resource_priority = bool(settings.get("priority_orders.resource_priority", False))

    from app.routers.calculations import run_schedule
    try:
        res = await run_schedule(project_id=order.project_id, body=None, db=db, tenant_id=tenant_id)
    except Exception as exc:  # расчёт недоступен — конфликтов не показываем, но объясняем
        return {
            "available": False,
            "reason": "Календарный расчёт недоступен: %s" % str(exc)[:200],
            "conflicts": [],
            "summary": {"total": 0, "blocking": 0},
        }

    chain = await _chain_ids(db, tenant_id, order)
    nodes = [n for n in (res or {}).get("nodes", []) if n.get("order_id")]
    if not nodes:
        return {"available": True, "reason": "В расчёте нет операций", "conflicts": [],
                "summary": {"total": 0, "blocking": 0}}

    op_ids = []
    for n in nodes:
        try:
            op_ids.append(UUID(str(n["id"])))
        except Exception:
            continue

    # ресурс операции: ведущий (primary), иначе первый
    op_res_rows = (await db.execute(
        select(OperationResource).where(OperationResource.operation_id.in_(op_ids))
    )).scalars().all() if op_ids else []
    by_op: dict = {}
    for link in op_res_rows:
        cur = by_op.get(link.operation_id)
        if cur is None or (getattr(link, "role", None) == "primary" and getattr(cur, "role", None) != "primary"):
            by_op[link.operation_id] = link
    res_ids = {l.resource_id for l in by_op.values()}
    res_names = {}
    if res_ids:
        for r in (await db.execute(select(Resource).where(Resource.id.in_(res_ids)))).scalars().all():
            res_names[r.id] = r.name

    orders_info = {}
    for o in (await db.execute(select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id, ProductionOrder.project_id == order.project_id))).scalars().all():
        orders_info[o.id] = o

    # события мощности: нулевая/сниженная мощность в окне
    events: dict = {}
    if res_ids:
        for ev in (await db.execute(select(ResourceEvent).where(
                ResourceEvent.tenant_id == tenant_id,
                ResourceEvent.resource_id.in_(res_ids),
                ResourceEvent.is_active.is_(True)))).scalars().all():
            if ev.project_id is not None and str(ev.project_id) != str(order.project_id):
                continue
            events.setdefault(ev.resource_id, []).append(ev)

    intervals = []
    for n in nodes:
        try:
            op_id = UUID(str(n["id"]))
        except Exception:
            continue
        link = by_op.get(op_id)
        if not link:
            continue
        st, fn = parse_dt(n.get("start_datetime")), parse_dt(n.get("finish_datetime"))
        if not st or not fn:
            continue
        try:
            ord_id = UUID(str(n["order_id"]))
        except Exception:
            continue
        intervals.append({
            "operation_id": op_id,
            "order_id": ord_id,
            "resource_id": link.resource_id,
            "start": st,
            "finish": fn,
            "name": n.get("name"),
        })

    mine = [x for x in intervals if x["order_id"] in chain]
    theirs = [x for x in intervals if x["order_id"] not in chain]
    by_resource: dict = {}
    for x in theirs:
        by_resource.setdefault(x["resource_id"], []).append(x)

    conflicts = []
    for a in mine:
        for b in by_resource.get(a["resource_id"], []):
            ov = _overlap(a["start"], a["finish"], b["start"], b["finish"])
            if not ov:
                continue
            other_order = orders_info.get(b["order_id"])
            a_prio, b_prio = True, bool(getattr(other_order, "is_priority", False))
            a_lvl = PRIORITY_LADDER.get((orders_info.get(a["order_id"]).priority or "normal"), 1) if orders_info.get(a["order_id"]) else 1
            b_lvl = PRIORITY_LADDER.get((getattr(other_order, "priority", "normal") or "normal"), 1)

            if not b_prio:
                loser = "other"
            elif compete and a_lvl != b_lvl:
                loser = "other" if a_lvl > b_lvl else "priority"
            else:
                loser = "other" if a["start"] <= b["start"] else "priority"

            # нулевая мощность в окне приоритетной операции
            zero_events = []
            for ev in events.get(a["resource_id"], []):
                if ev.event_type not in ZERO_CAPACITY_TYPES:
                    continue
                efr, eto = parse_dt(ev.date_from), parse_dt(ev.date_to)
                if efr and eto and _overlap(a["start"], a["finish"], efr, eto):
                    zero_events.append({"event_type": ev.event_type, "reason": ev.reason,
                                        "from": efr.isoformat(timespec="minutes"), "to": eto.isoformat(timespec="minutes")})

            blocking = bool(zero_events) and on_zero == "block"
            warn = []
            if zero_events:
                warn.append("В окне операции ресурс имеет нулевую/сниженную мощность: %s" % zero_events[0]["reason"])
            if on_overload == "block":
                warn.append("Настройка «при перегрузке» — запрещать расчёт: конфликт нужно разрешить до пересчёта")

            conflict_id = "%s:%s" % (a["resource_id"], b["operation_id"])
            proposal = {
                "action": "shift_other" if loser == "other" else "shift_anchor",
                "target_order_id": str(b["order_id"] if loser == "other" else a["order_id"]),
                "target_order_ext_id": (other_order.ext_id if other_order else None) if loser == "other" else (orders_info.get(a["order_id"]).ext_id if orders_info.get(a["order_id"]) else None),
                "description": (
                    "Сдвинуть операцию заказа %s на ресурсе «%s» после операции приоритетного заказа" % (
                        (other_order.ext_id if other_order else "—"), res_names.get(a["resource_id"], "—"))
                    if loser == "other" else
                    "Сдвинуть якорь приоритетного заказа — операция позже стартующего заказа уступает"
                ),
            }
            conflicts.append({
                "id": conflict_id,
                "resource_id": str(a["resource_id"]),
                "resource_name": res_names.get(a["resource_id"]),
                "priority_operation": {
                    "operation_id": str(a["operation_id"]), "name": a["name"],
                    "order_id": str(a["order_id"]),
                    "order_ext_id": (orders_info.get(a["order_id"]).ext_id if orders_info.get(a["order_id"]) else None),
                    "start": a["start"].isoformat(timespec="minutes"),
                    "finish": a["finish"].isoformat(timespec="minutes"),
                },
                "other_operation": {
                    "operation_id": str(b["operation_id"]), "name": b["name"],
                    "order_id": str(b["order_id"]),
                    "order_ext_id": (other_order.ext_id if other_order else None),
                    "order_priority": (getattr(other_order, "priority", None) if other_order else None),
                    "order_is_priority": b_prio,
                    "start": b["start"].isoformat(timespec="minutes"),
                    "finish": b["finish"].isoformat(timespec="minutes"),
                },
                "overlap_from": ov[0].isoformat(timespec="minutes"),
                "overlap_to": ov[1].isoformat(timespec="minutes"),
                "overlap_hours": round((ov[1] - ov[0]).total_seconds() / 3600.0, 2),
                "proposal": proposal,
                "blocking": blocking,
                "block_reason": ("Нулевая мощность ресурса в окне, расчёт запрещён настройкой" if blocking else None),
                "warnings": warn,
                "zero_capacity_events": zero_events,
            })

    conflicts.sort(key=lambda c: -c["overlap_hours"])
    return {
        "available": True,
        "order_id": str(order.id),
        "settings": {
            "resource_priority": resource_priority,
            "compete_by_priority": compete,
            "on_overload": on_overload,
            "on_zero_capacity": on_zero,
        },
        "conflicts": conflicts,
        "summary": {
            "total": len(conflicts),
            "blocking": sum(1 for c in conflicts if c["blocking"]),
            "resources": len({c["resource_id"] for c in conflicts}),
            "other_orders": len({c["other_operation"]["order_id"] for c in conflicts}),
        },
        "project_finish_date": (res or {}).get("project_finish_date"),
    }
