"""Наследование реквизита «Приоритетный заказ» по цепочке заказов.

«Приоритетный заказ» — не то же самое, что критический путь. Это признак
неприкосновенности заказа: его не режут, он вытесняет остальные, у него
обязательный якорь старта. Признак стоит выше любого приоритета.

Правило наследования (согласовано 16.09.2026):
    если приоритетен заказ-родитель, все подчинённые заказы (по parent_order_id
    на любую глубину) тоже приоритетны, а их поле заблокировано — снять признак
    можно только у того заказа, который держит его сам. При переносе заказа
    к другому родителю признак пересчитывается автоматически, потому что
    эффективное значение всегда вычисляется по текущей цепочке.

Здесь только вычисление состояния — само хранилище это флаг `is_priority`
на заказе (собственный признак, без учёта родителей).
"""
from typing import Any, Iterable, Optional


def build_index(orders: Iterable[Any]) -> dict:
    """Индекс заказов проекта: id → заказ."""
    return {o.id: o for o in orders}


def build_children_map(orders: Iterable[Any]) -> dict:
    """Дети по parent_order_id: id родителя → список заказов."""
    children: dict = {}
    for o in orders:
        if o.parent_order_id:
            children.setdefault(o.parent_order_id, []).append(o)
    return children


def _label(order: Any) -> str:
    return order.ext_id or str(order.id)[:8]


def resolve_priority(order: Any, by_id: Optional[dict] = None) -> dict:
    """Состояние реквизита «Приоритетный заказ» для одного заказа.

    own           — признак выставлен непосредственно у заказа;
    inherited     — признак пришёл от заказа-родителя (на любой глубине);
    effective     — итоговое состояние: свой или унаследованный;
    locked        — менять поле нельзя (признак задан родителем);
    source        — заказ-родитель, от которого признак унаследован;
    reason        — пояснение для интерфейса, почему поле заблокировано.
    """
    by_id = by_id or {order.id: order}
    seen: set = set()
    cur_id = order.parent_order_id
    source = None
    while cur_id and cur_id in by_id and cur_id not in seen:
        seen.add(cur_id)
        ancestor = by_id[cur_id]
        if ancestor.is_priority:
            source = ancestor
            break
        cur_id = ancestor.parent_order_id

    own = bool(order.is_priority)
    inherited = source is not None
    reason = None
    if source is not None:
        reason = (
            f"У заказа-родителя {_label(source)} статус приоритетного — "
            "изменение запрещено. Снять признак можно только у родителя."
        )
    return {
        "own": own,
        "inherited": inherited,
        "effective": own or inherited,
        "locked": inherited,
        "source": source,
        "reason": reason,
    }


def count_descendants(order_id, children: Optional[dict] = None) -> int:
    """Сколько заказов унаследует признак от этого заказа (вся цепочка вниз)."""
    if not children:
        return 0
    total = 0
    stack = list(children.get(order_id, []))
    seen: set = set()
    while stack:
        node = stack.pop()
        if node.id in seen:
            continue
        seen.add(node.id)
        total += 1
        stack.extend(children.get(node.id, []))
    return total


def chain_summary(orders: Iterable[Any]) -> dict:
    """Сводка по цепочкам проекта: сколько заказов приоритетны и кто держит признак."""
    orders = list(orders)
    by_id = build_index(orders)
    children = build_children_map(orders)
    priority_roots = [o for o in orders if o.is_priority]
    return {
        "orders": len(orders),
        "priority_own": len(priority_roots),
        "priority_effective": sum(
            1 for o in orders if resolve_priority(o, by_id)["effective"]
        ),
        "roots": [
            {
                "id": str(o.id),
                "ext_id": o.ext_id,
                "descendants": count_descendants(o.id, children),
            }
            for o in priority_roots
        ],
    }
