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
    Разворачивает BOM-дерево спецификации в плоский список CPM-операций.

    Args:
        db: асинхронная сессия БД
        spec_id: ID спецификации (nomenclature_id корневого узла)
        project_quantity: количество продукции по заказу
        tenant_id: ID тенанта
        project_id: ID проекта (если есть)

    Returns:
        BOMExplosionResult с операциями, зависимостями и сводкой материалов
    """
    result = BOMExplosionResult(operations=[], dependencies=[], materials=[])

    # Загружаем все узлы BOM для данной спецификации
    all_nodes_result = await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.nomenclature_id == spec_id,
        )
    )
    root_node = all_nodes_result.scalars().first()

    if not root_node:
        # Ищем по project_id если spec_id не найден как точный nomenclature_id
        node_query = select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == project_id if project_id else root_node,
        )
        # Fallback: ищем корневой узел без родителя
        node_query = select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.parent_id.is_(None),
        )
        if project_id:
            node_query = node_query.where(
                ProductStructure.project_id == project_id
            )

        root_result = await db.execute(node_query)
        root_nodes = root_result.scalars().all()

        for node in root_nodes:
            _expand_node(db, node, project_quantity, result, {})

        return result

    # Рекурсивно разворачиваем от корня
    bom_cache = {}  # кеш узлов BOM по id
    _expand_node(root_node, project_quantity, result, bom_cache)

    return result


def _expand_node(
    node: ProductStructure,
    parent_quantity: Decimal,
    result: BOMExplosionResult,
    bom_cache: dict,
    active_session: Optional[AsyncSession] = None,
):
    """
    Рекурсивно разворачивает один узел BOM в операции.

    Args:
        node: узел BOM-дерева
        parent_quantity: количество родительских изделий
        result: накапливаемый результат развёртки
        bom_cache: кеш узлов (id → node)
    """
    total_qty = parent_quantity * node.quantity_per_parent

    # Фантомный узел — пропускаем, разворачиваем детей
    if node.is_phantom:
        children = _get_children(node, bom_cache)
        for child in children:
            _expand_node(child, total_qty, result, bom_cache)
        return

    # Узел-материал (закупка)
    if node.is_make_or_buy == "buy":
        op = ExplodedOperation(
            temp_id=f"proc_{uuid4().hex[:8]}",
            name=f"Закупка: {node.nomenclature_name}",
            duration_base=_days_to_hours(node.procurement_lead_time_days),
            operation_type="procurement",
            output_product=node.nomenclature_id,
            output_quantity=total_qty,
            supplier_id=None,  # заполняется при импорте
            procurement_lead_time_days=node.procurement_lead_time_days,
            source_node_path=node.path or str(node.id),
        )
        result.operations.append(op)
        result.materials.append({
            "nomenclature_id": node.nomenclature_id,
            "nomenclature_name": node.nomenclature_name,
            "quantity": float(total_qty),
            "unit": node.unit,
            "lead_time_days": float(node.procurement_lead_time_days or 0),
            "source_node_path": node.path,
        })
        return

    # Узел-изготовитель (make)
    if node.is_make_or_buy == "make" and node.routing_id:
        routing_ops = _load_routing(result, node, total_qty, bom_cache)

        # Разворачиваем детей (материалы и подсборки)
        children = _get_children(node, bom_cache)
        for child in children:
            _expand_node(child, total_qty, result, bom_cache)

        # Связываем закупки материалов с потребляющими операциями
        _link_materials_to_operations(node, routing_ops, result)

        return

    # Если узел make но без routing_id — предупреждение
    result.warnings.append(
        f"Узел '{node.nomenclature_name}' ({node.path}) типа 'make' "
        f"не имеет привязанного техмаршрута. Узел пропущен."
    )


def _get_children(node: ProductStructure, bom_cache: dict) -> list:
    """Получить дочерние узлы BOM."""
    # В реальной реализации — загрузка из БД по parent_id
    # Здесь возвращаем пустой список (дети загружаются в expand_node)
    return []


def _load_routing(
    result: BOMExplosionResult,
    node: ProductStructure,
    total_qty: Decimal,
    bom_cache: dict,
) -> list[ExplodedOperation]:
    """
    Загружает маршрут и создаёт операции.
    Возвращает список созданных операций в порядке sequence_number.
    """
    # Здесь routing_ops загружаются из БД по routing_id
    # В реальной имплементации — через сессию:
    # routing_ops = await db.execute(
    #     select(RoutingOperation)
    #     .where(RoutingOperation.routing_id == node.routing_id)
    #     .order_by(RoutingOperation.sequence_number)
    # )
    # routing_ops = routing_ops.scalars().all()

    # Для развёртки — операции создаются вызывающим кодом
    return []


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


def _link_materials_to_operations(
    node: ProductStructure,
    routing_ops: list[ExplodedOperation],
    result: BOMExplosionResult,
):
    """
    Связывает закупленные материалы с потребляющими операциями.
    Пока заглушка — полная реализация требует отслеживания
    того, какие материалы потребляются какими операциями.
    """
    pass


def _days_to_hours(days: Optional[Decimal]) -> Decimal:
    """Конвертирует дни поставки в часы (24/7 календарь)."""
    if days is None:
        return Decimal("0")
    return days * Decimal("24")
