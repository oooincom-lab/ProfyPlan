"""
BOM-развёртка: преобразование структуры изделия в CPM-граф операций.
"""
import json
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product_structure import ProductStructure
from app.models.routing import Routing, RoutingOperation


@dataclass
class ExplodedOperation:
    """Операция, созданная при развёртке BOM."""
    temp_id: str
    name: str
    duration_base: Decimal
    duration_unit: str = "hour"
    setup_time: Decimal = Decimal("0")
    teardown_time: Decimal = Decimal("0")
    operation_type: str = "production"
    output_product: Optional[str] = None
    output_quantity: Optional[Decimal] = None
    yield_rate: Decimal = Decimal("1.0")
    resource_type_id: Optional[str] = None
    alternative_resources: Optional[str] = None
    input_materials: Optional[str] = None
    supplier_id: Optional[str] = None
    procurement_lead_time_days: Optional[Decimal] = None
    is_milestone: bool = False
    source_node_path: str = ""  # путь в BOM-дереве "1/1.1/1.1.2"


@dataclass
class ExplodedDependency:
    """Связь между развёрнутыми операциями."""
    predecessor_temp_id: str
    successor_temp_id: str
    dependency_type: str = "FS"
    lag_hours: Decimal = Decimal("0")


@dataclass
class BOMExplosionResult:
    """Результат развёртки BOM."""
    operations: list[ExplodedOperation]
    dependencies: list[ExplodedDependency]
    materials: list[dict]  # сводка потребностей в материалах
    warnings: list[str] = field(default_factory=list)


async def explode_bom_to_operations(
    db: AsyncSession,
    spec_id: str,
    project_quantity: Decimal,
    tenant_id: UUID,
    project_id: Optional[UUID] = None,
) -> BOMExplosionResult:
    """
    Разворачивает BOM-дерево проекта в плоский список CPM-операций.

    Загружает все узлы BOM по project_id, строит children_map и
    рекурсивно обходит дерево: для phantom-узлов — пропускает,
    для buy — создаёт операции закупки, для make с routing_id —
    разворачивает техмаршрут в операции.

    Args:
        db: асинхронная сессия БД
        spec_id: не используется (сохранено для обратной совместимости)
        project_quantity: количество продукции по заказу
        tenant_id: ID тенанта
        project_id: ID проекта

    Returns:
        BOMExplosionResult с операциями, зависимостями и сводкой материалов
    """
    result = BOMExplosionResult(operations=[], dependencies=[], materials=[])

    if not project_id:
        result.warnings.append("project_id не указан — развёртка невозможна")
        return result

    # Загружаем все узлы BOM для проекта
    nodes_result = await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == project_id,
        ).order_by(ProductStructure.level, ProductStructure.sort_order)
    )
    all_nodes = nodes_result.scalars().all()

    if not all_nodes:
        result.warnings.append("BOM-дерево пусто. Загрузите структуру изделия.")
        return result

    # Строим индекс: parent_id → [children]
    children_map: dict[str, list[ProductStructure]] = {}
    for node in all_nodes:
        key = str(node.parent_id) if node.parent_id else "__root__"
        children_map.setdefault(key, []).append(node)

    root_nodes = children_map.get("__root__", [])

    # Состояние обхода
    node_op_map: dict[str, list[str]] = {}  # node_id → [temp_op_id]
    last_op_in_path: dict[str, str] = {}  # parent_path → last_op_temp_id
    _counter = [0]

    def _tid(prefix: str) -> str:
        _counter[0] += 1
        return f"{prefix}_{_counter[0]:04d}"

    async def _traverse(node: ProductStructure, node_path: str):
        if node.is_phantom:
            for child in children_map.get(str(node.id), []):
                await _traverse(child, node_path)
            return

        if node.is_make_or_buy == "buy":
            lead_days = node.procurement_lead_time_days or Decimal("0")
            op = ExplodedOperation(
                temp_id=_tid("proc"),
                name=f"Закупка: {node.nomenclature_name}",
                duration_base=lead_days * Decimal("24"),
                operation_type="procurement",
                output_product=node.nomenclature_id,
                output_quantity=node.quantity_per_parent * project_quantity,
                procurement_lead_time_days=lead_days,
                source_node_path=node_path,
            )
            result.operations.append(op)
            node_op_map[str(node.id)] = [op.temp_id]
            last_op_in_path[node_path] = op.temp_id
            result.materials.append({
                "nomenclature_id": node.nomenclature_id,
                "nomenclature_name": node.nomenclature_name,
                "quantity": float(node.quantity_per_parent * project_quantity),
                "unit": node.unit,
                "lead_time_days": float(lead_days),
                "source_node_path": node_path,
            })
            for child in children_map.get(str(node.id), []):
                await _traverse(child, node_path)
            return

        if node.is_make_or_buy == "make" and node.routing_id:
            routing_ops = await load_routing_operations(db, node.routing_id)
            if not routing_ops:
                result.warnings.append(
                    f"Узел '{node.nomenclature_name}' ({node_path}): маршрут без операций"
                )
                return

            prod_ops, internal_deps = expand_routing_to_ops(
                routing_ops,
                node.quantity_per_parent * project_quantity,
                node_path,
            )

            # Глобально уникальные temp_id
            local_to_global: dict[str, str] = {}
            op_ids: list[str] = []
            for op in prod_ops:
                new_id = _tid("op")
                local_to_global[op.temp_id] = new_id
                op.temp_id = new_id
                op.name = f"{node.nomenclature_name} · {op.name}"
                result.operations.append(op)
                op_ids.append(new_id)

            for dep in internal_deps:
                pg = local_to_global.get(dep.predecessor_temp_id)
                sg = local_to_global.get(dep.successor_temp_id)
                if pg and sg:
                    result.dependencies.append(ExplodedDependency(
                        predecessor_temp_id=pg,
                        successor_temp_id=sg,
                        dependency_type=dep.dependency_type,
                        lag_hours=dep.lag_hours,
                    ))

            node_op_map[str(node.id)] = op_ids

            # Связь с предыдущей операцией в иерархии
            if node_path in last_op_in_path and op_ids:
                result.dependencies.append(ExplodedDependency(
                    predecessor_temp_id=last_op_in_path[node_path],
                    successor_temp_id=op_ids[0],
                    dependency_type="FS",
                ))

            if op_ids:
                last_op = op_ids[-1]
                parts = node_path.split(".")
                for i in range(len(parts)):
                    last_op_in_path[".".join(parts[:i+1])] = last_op

            for child in children_map.get(str(node.id), []):
                await _traverse(child, node_path)
            return

        result.warnings.append(
            f"Узел '{node.nomenclature_name}' ({node_path}): тип 'make' без маршрута"
        )

    for root in root_nodes:
        await _traverse(root, "1")

    # Связываем закупки с производством
    _link_procurement(result, node_op_map, all_nodes, children_map)

    return result


async def load_routing_operations(
    db: AsyncSession,
    routing_id: UUID,
) -> list[RoutingOperation]:
    """Загрузить операции маршрута из БД."""
    result = await db.execute(
        select(RoutingOperation)
        .where(RoutingOperation.routing_id == routing_id)
        .order_by(RoutingOperation.sequence_number)
    )
    return list(result.scalars().all())


def expand_routing_to_ops(
    routing_ops: list[RoutingOperation],
    total_qty: Decimal,
    node_path: str,
) -> tuple[list[ExplodedOperation], list[ExplodedDependency]]:
    """
    Разворачивает операции маршрута с учётом количества и yield_rate.

    Returns:
        (operations, internal_dependencies)
    """
    ops = []
    deps = []
    op_map = {}  # seq_num → ExplodedOperation

    for rop in routing_ops:
        effective_qty = total_qty * rop.output_quantity
        # Учёт yield_rate: длительность увеличивается при браке
        if rop.yield_rate > 0 and rop.yield_rate < Decimal("1.0"):
            effective_duration = rop.duration_hours / rop.yield_rate
        else:
            effective_duration = rop.duration_hours

        op = ExplodedOperation(
            temp_id=f"op_{uuid4().hex[:8]}",
            name=rop.name,
            duration_base=effective_duration,
            setup_time=rop.setup_hours,
            teardown_time=rop.teardown_hours,
            operation_type="production",
            output_product=rop.output_product,
            output_quantity=effective_qty * rop.yield_rate,
            yield_rate=rop.yield_rate,
            resource_type_id=rop.resource_type_id,
            alternative_resources=rop.alternative_resource_types,
            input_materials=rop.input_materials,
            source_node_path=node_path,
        )
        ops.append(op)
        op_map[rop.sequence_number] = op

    # Создаём внутренние зависимости маршрута
    for rop in routing_ops:
        if rop.predecessors:
            pred_seqs = [int(s.strip()) for s in rop.predecessors.split(",") if s.strip()]
            for pred_seq in pred_seqs:
                if pred_seq in op_map:
                    deps.append(
                        ExplodedDependency(
                            predecessor_temp_id=op_map[pred_seq].temp_id,
                            successor_temp_id=op_map[rop.sequence_number].temp_id,
                            dependency_type="FS",
                        )
                    )

    return ops, deps


def _link_procurement(
    result: BOMExplosionResult,
    node_op_map: dict[str, list[str]],
    all_nodes: list[ProductStructure],
    children_map: dict[str, list[ProductStructure]],
):
    """
    Связывает операции закупки материалов с производственными операциями,
    которые эти материалы потребляют.

    Правило: закупка → первая операция родительского маршрута.
    """
    for node in all_nodes:
        if node.is_make_or_buy != "buy":
            continue
        parent_id = str(node.parent_id) if node.parent_id else None
        if not parent_id or parent_id not in node_op_map:
            continue
        parent_ops = node_op_map[parent_id]
        buy_ops = node_op_map.get(str(node.id), [])
        if not parent_ops or not buy_ops:
            continue
        first_prod_op = parent_ops[0]
        for buy_op_id in buy_ops:
            result.dependencies.append(ExplodedDependency(
                predecessor_temp_id=buy_op_id,
                successor_temp_id=first_prod_op,
                dependency_type="FS",
            ))


def _days_to_hours(days: Optional[Decimal]) -> Decimal:
    """Конвертирует дни поставки в часы (24/7 календарь)."""
    if days is None:
        return Decimal("0")
    return days * Decimal("24")
