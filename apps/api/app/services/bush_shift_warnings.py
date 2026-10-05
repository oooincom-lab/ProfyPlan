"""Предупреждения при постановке дерева заказов в свободное окно (блок 6.33.4, срез 2).

Смысл: перенос дерева освобождает конфликтный ресурс, но может «заехать» в период,
когда другие проекты занимают другие общие ресурсы этого же дерева. Считаем по окнам:
окно дерева (старт → финиш его заказов) до и после переноса — против окон чужих
проектов на общих ресурсах дерева. Предупреждаем там, где пересечение появилось или
выросло. Это оценка для человека («решение за человеком»); точные интервалы — на карте
занятости.
"""
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        s = str(value)
        if "T" in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None)
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _overlap_days(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> int:
    o0 = max(a0, b0)
    o1 = min(a1, b1)
    return max(0, (o1 - o0).days)


def tree_move_warnings(tree_window, res_ids, by_res, my_pid, delta, cap: int = 3) -> list:
    """Предупреждения «заедет в чужую занятость» для переноса дерева на delta дней.

    tree_window — (datetime старта, datetime финиша) дерева до переноса;
    res_ids — общие ресурсы дерева (глобальные id);
    by_res — строки сводки ресурсов (_overload_rows): id → {name, assignments: [...]};
    my_pid — id моего проекта. Возвращает не более cap предупреждений.
    """
    try:
        d = int(delta or 0)
    except Exception:
        d = 0
    if not tree_window or d <= 0:
        return []
    b0, b1 = tree_window
    a0 = b0 + timedelta(days=d)
    a1 = b1 + timedelta(days=d)
    out = []
    for gid in sorted(res_ids):
        row = by_res.get(gid)
        if not row:
            continue
        mine = None
        for a in (row.get("assignments") or []):
            if a.get("project_id") == str(my_pid):
                mine = a
                break
        if mine is None:
            continue
        my_excl = bool(mine.get("exclusive"))
        my_share = 1.0 if my_excl else float(mine.get("capacity_share") or 0.0)
        for a in (row.get("assignments") or []):
            if a.get("project_id") == str(my_pid):
                continue
            w0 = _parse_dt(a.get("start"))
            w1 = _parse_dt(a.get("finish"))
            if w0 is None or w1 is None:
                continue
            p_excl = bool(a.get("exclusive"))
            p_share = 1.0 if p_excl else float(a.get("capacity_share") or 0.0)
            # Семантика та же, что у конфликтов: эксклюзив — всегда, иначе сумма долей > 100%.
            if not (my_excl or p_excl or (my_share + p_share) > 1.0 + 1e-9):
                continue
            ov_b = _overlap_days(b0, b1, w0, w1)
            ov_a = _overlap_days(a0, a1, w0, w1)
            inc = ov_a - ov_b
            if inc >= 1:
                out.append({
                    "resource_id": gid,
                    "resource_name": row.get("name"),
                    "project_name": a.get("project_name"),
                    "days_new": int(inc),
                    "days_before": int(ov_b),
                    "days_after": int(ov_a),
                })
    out.sort(key=lambda x: -x["days_new"])
    return out[:cap]


def _root_by_order(orders: list) -> dict:
    """order_id → root order id (по parent_order_id, с защитой от циклов)."""
    by_id = {str(o.id): o for o in orders}
    roots: dict = {}
    for o in orders:
        cur = o
        seen: set = set()
        while cur is not None and getattr(cur, "parent_order_id", None):
            nxt = by_id.get(str(cur.parent_order_id))
            if nxt is None or str(nxt.id) in seen:
                break
            seen.add(str(nxt.id))
            cur = nxt
        roots[str(o.id)] = str(cur.id) if cur is not None else ""
    return roots


async def compute_tree_warnings_for_project(
    db: AsyncSession, tenant_id, project_id: UUID, delta_by_root: dict
) -> dict:
    """Предупреждения по деревьям проекта: {root_id: [warning, ...]}.

    delta_by_root — {root_id: дней переноса}. Используется мастером «проверки»;
    для панели «Предложить сдвиг» предупреждения считаются там же, где опции
    (ccm.overload_suggestion), по уже загруженным данным.
    """
    result = {str(k): [] for k in (delta_by_root or {})}
    if not delta_by_root:
        return result
    has_positive = False
    for d in delta_by_root.values():
        try:
            if int(d or 0) > 0:
                has_positive = True
                break
        except Exception:
            continue
    if not has_positive:
        return result

    from app.models.operation import Operation, OperationResource
    from app.models.production_order import ProductionOrder
    from app.models.resource import Resource
    from app.routers.ccm import _overload_rows

    rows = await _overload_rows(db, tenant_id)
    by_res = {str(r.get("id")): r for r in rows}

    orders = (
        await db.execute(
            select(ProductionOrder).where(
                ProductionOrder.project_id == project_id, ProductionOrder.tenant_id == tenant_id
            )
        )
    ).scalars().all()
    if not orders:
        return result
    root_of = _root_by_order(orders)

    orows = (
        await db.execute(
            select(OperationResource.operation_id, OperationResource.resource_id, Operation.order_id)
            .join(Operation, Operation.id == OperationResource.operation_id)
            .where(
                Operation.project_id == project_id,
                Operation.tenant_id == tenant_id,
                Operation.order_id.isnot(None),
            )
        )
    ).all()
    res_rows = (
        await db.execute(select(Resource.id, Resource.parent_id).where(Resource.tenant_id == tenant_id))
    ).all()
    parent_of = {str(rid): (str(pid) if pid else None) for rid, pid in res_rows}

    res_by_order: dict = {}
    for _op, _res, _ord in orows:
        if not _res or not _ord:
            continue
        gid = parent_of.get(str(_res)) or str(_res)
        res_by_order.setdefault(str(_ord), set()).add(gid)

    for root_id, delta in delta_by_root.items():
        try:
            d = int(delta or 0)
        except Exception:
            d = 0
        if d <= 0:
            continue
        tree_ids = [oid for oid, rid in root_of.items() if rid == str(root_id)]
        if not tree_ids:
            continue
        tset = set(tree_ids)
        starts = [o.start_date for o in orders if str(o.id) in tset and o.start_date]
        dues = [o.due_date for o in orders if str(o.id) in tset and o.due_date]
        if not starts or not dues:
            continue
        tree_window = (
            datetime.combine(min(starts), datetime.min.time()),
            datetime.combine(max(dues), datetime.min.time()),
        )
        res_ids: set = set()
        for oid in tree_ids:
            res_ids.update(res_by_order.get(oid, set()))
        result[str(root_id)] = tree_move_warnings(tree_window, res_ids, by_res, str(project_id), d)
    return result
