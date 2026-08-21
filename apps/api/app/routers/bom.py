"""
BOM-роутер: загрузка структуры изделия, техмаршруты, развёртка BOM → CPM-операции.
"""
import json
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.product_structure import ProductStructure
from app.models.production_order import ProductionOrder
from app.routers.production_orders import _build_bom_link_graph, _order_to_out
from app.schemas.production_order import ProductionOrderOut
from app.models.routing import Routing, RoutingOperation
from app.models.operation import Operation, OperationDependency
from app.schemas.bom import (
    BOMNodeCreate, BOMNodeUpdate, BOMNodeOut, BOMTreeOut, BOMUploadResult,
    RoutingCreate, RoutingOut, RoutingOpOut, RoutingOpUpdate, RoutingList,
    BOMExplosionOut, BOMExplodeAndSaveRequest, BOMExplodeAndSaveOut,
    ExplodedOpOut, ExplodedDepOut,
)
from app.services.bom_explosion import (
    explode_bom_to_operations,
    ExplodedOperation,
    ExplodedDependency,
    load_routing_operations,
    expand_routing_to_ops,
)

bom_router = APIRouter(prefix="/v1/bom", tags=["BOM"])


# ── ProductStructure CRUD ──

@bom_router.get("/projects/{project_id}/tree", response_model=BOMTreeOut)
async def get_bom_tree(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Получить дерево BOM для проекта."""
    nodes = await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == project_id,
        ).order_by(ProductStructure.sort_order)
    )
    nodes_list = nodes.scalars().all()
    return BOMTreeOut(
        project_id=str(project_id),
        nodes=[BOMNodeOut.model_validate(n) for n in nodes_list],
        total_nodes=len(nodes_list),
    )


@bom_router.post("/projects/{project_id}/nodes", response_model=BOMNodeOut, status_code=201)
async def create_bom_node(
    project_id: UUID,
    body: BOMNodeCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Добавить узел в BOM-дерево."""
    # Вычисляем level и path
    level = 0
    path: Optional[str] = None
    parent = None
    if body.parent_id:
        parent = (await db.execute(
            select(ProductStructure).where(
                ProductStructure.id == body.parent_id,
                ProductStructure.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=404, detail="Родительский узел не найден")
        level = parent.level + 1
        path = (parent.path or "") + f".{level}" if parent.path else f"1.{level}"

    node = ProductStructure(
        tenant_id=tenant_id,
        project_id=project_id,
        parent_id=UUID(body.parent_id) if body.parent_id else None,
        level=level,
        path=path,
        node_type=body.node_type,
        nomenclature_id=body.nomenclature_id,
        nomenclature_name=body.nomenclature_name,
        quantity_per_parent=body.quantity_per_parent,
        unit=body.unit,
        is_make_or_buy=body.is_make_or_buy,
        procurement_lead_time_days=body.procurement_lead_time_days,
        is_phantom=body.is_phantom,
        sort_order=body.sort_order,
        routing_id=UUID(body.routing_id) if body.routing_id else None,
        order_id=UUID(body.order_id) if body.order_id else None,
        notes=body.notes,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return BOMNodeOut.model_validate(node)


@bom_router.patch("/nodes/{node_id}", response_model=BOMNodeOut)
async def update_bom_node(
    node_id: UUID,
    body: BOMNodeUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Обновить узел BOM (routing_id, quantity и т.д.)."""
    node = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.id == node_id,
            ProductStructure.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Узел не найден")

    if body.routing_id is not None:
        node.routing_id = UUID(body.routing_id) if body.routing_id else None
    if 'order_id' in body.model_fields_set:
        node.order_id = UUID(body.order_id) if body.order_id else None
    if body.quantity_per_parent is not None:
        node.quantity_per_parent = body.quantity_per_parent
    if body.nomenclature_name is not None:
        node.nomenclature_name = body.nomenclature_name
    if body.unit is not None:
        node.unit = body.unit
    if body.notes is not None:
        node.notes = body.notes

    await db.commit()
    await db.refresh(node)
    return BOMNodeOut.model_validate(node)


@bom_router.delete("/projects/{project_id}/nodes/{node_id}", status_code=204)
async def delete_bom_node(
    project_id: UUID,
    node_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Удалить узел BOM (и дочерние — cascade)."""
    node = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.id == node_id,
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == project_id,
        )
    )).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Узел не найден")

    # Рекурсивно удаляем потомков
    async def delete_children(parent_id: str):
        children = (await db.execute(
            select(ProductStructure).where(
                ProductStructure.parent_id == parent_id,
            )
        )).scalars().all()
        for child in children:
            await delete_children(str(child.id))
            await db.delete(child)

    await delete_children(str(node_id))
    await db.delete(node)
    await db.commit()


def _resolve_order_id(value) -> Optional[UUID]:
    """Преобразует order_id из JSON в UUID.

    Принимает: None / '' → None; валидный UUID-строк → UUID; иначе None.
    (для ext_id-привязки используйте Excel-импорт или PATCH /bom/nodes/{id})
    """
    if not value:
        return None
    s = str(value).strip()
    try:
        return UUID(s)
    except (ValueError, AttributeError):
        return None


@bom_router.post("/projects/{project_id}/upload", response_model=BOMUploadResult)
async def upload_bom_json(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Загрузить BOM из JSON-файла.

    Формат: [{ "nomenclature_name": "...", "level": 0, "parent_path": "1", ... }, ...]
    Или вложенное дерево: { "name": "Изделие", "children": [{...}] }
    """
    content = await file.read()
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Невалидный JSON: {e}")

    imported = 0
    skipped = 0
    errors: list[str] = []
    root_ids: list[str] = []

    if isinstance(data, list):
        # Плоский список с parent_path
        for item in data:
            try:
                node = ProductStructure(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    parent_id=None,
                    level=item.get("level", 0),
                    path=item.get("path"),
                    node_type=item.get("node_type", "material"),
                    nomenclature_id=item.get("nomenclature_id"),
                    nomenclature_name=item["nomenclature_name"],
                    quantity_per_parent=Decimal(str(item.get("quantity_per_parent", 1))),
                    unit=item.get("unit", "pcs"),
                    is_make_or_buy=item.get("is_make_or_buy", "buy"),
                    procurement_lead_time_days=Decimal(str(item.get("procurement_lead_time_days", 0))) if item.get("procurement_lead_time_days") else None,
                    is_phantom=item.get("is_phantom", False),
                    sort_order=item.get("sort_order", 0),
                    order_id=_resolve_order_id(item.get("order_id")),
                    notes=item.get("notes"),
                )
                db.add(node)
                imported += 1
                if item.get("level", 0) == 0:
                    root_ids.append(str(node.id))
            except Exception as e:
                errors.append(f"Строка {imported + skipped}: {e}")
                skipped += 1
    elif isinstance(data, dict):
        # Вложенное дерево — собираем узлы, flush, потом связываем
        temp_nodes: list[tuple[dict, Optional[str], int]] = []

        def collect_nodes(parent_node: dict, parent_temp_id: Optional[str], level: int):
            temp_id = f"__tmp_{len(temp_nodes)}"
            temp_nodes.append((parent_node, parent_temp_id, level, temp_id))
            for child in parent_node.get("children", []):
                collect_nodes(child, temp_id, level + 1)

        collect_nodes(data, None, 0)

        # Создаём и flush'им все узлы
        temp_to_real: dict[str, str] = {}
        for node_data, parent_temp_id, level, temp_id in temp_nodes:
            real_parent_id = temp_to_real.get(parent_temp_id) if parent_temp_id else None
            node = ProductStructure(
                tenant_id=tenant_id,
                project_id=project_id,
                parent_id=UUID(real_parent_id) if real_parent_id else None,
                level=level,
                path=None,
                node_type=node_data.get("node_type", "assembly" if "children" in node_data else "material"),
                nomenclature_id=node_data.get("nomenclature_id"),
                nomenclature_name=node_data["name"],
                quantity_per_parent=Decimal(str(node_data.get("quantity_per_parent", 1))),
                unit=node_data.get("unit", "pcs"),
                is_make_or_buy=node_data.get("is_make_or_buy", "make" if "children" in node_data else "buy"),
                procurement_lead_time_days=Decimal(str(node_data.get("procurement_lead_time_days", 0))) if node_data.get("procurement_lead_time_days") else None,
                is_phantom=node_data.get("is_phantom", False),
                sort_order=node_data.get("sort_order", 0),
                order_id=_resolve_order_id(node_data.get("order_id")),
                notes=node_data.get("notes"),
            )
            db.add(node)
            await db.flush()
            temp_to_real[temp_id] = str(node.id)
            imported += 1
            if level == 0:
                root_ids.append(str(node.id))

        await db.commit()

        # Update paths
        root_nodes = (await db.execute(
            select(ProductStructure).where(
                ProductStructure.project_id == project_id,
                ProductStructure.parent_id.is_(None),
            ).order_by(ProductStructure.created_at)
        )).scalars().all()

        queue: list[tuple[str, ProductStructure]] = [("1", node) for node in root_nodes]
        while queue:
            base_path, node = queue.pop(0)
            node.path = base_path
            children_q = (await db.execute(
                select(ProductStructure).where(
                    ProductStructure.parent_id == node.id,
                ).order_by(ProductStructure.sort_order, ProductStructure.id)
            )).scalars().all()
            for idx, child in enumerate(children_q):
                queue.append((f"{base_path}.{idx + 1}", child))
        await db.commit()
    else:
        raise HTTPException(status_code=400, detail="Ожидается JSON-массив или объект")

    await db.commit()

    return BOMUploadResult(
        imported=imported,
        skipped=skipped,
        errors=errors,
        root_ids=root_ids,
    )


# ── Routing CRUD ──

@bom_router.post("/routings", response_model=RoutingOut, status_code=201)
async def create_routing(
    body: RoutingCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Создать техмаршрут с операциями."""
    total_setup = Decimal("0")
    routing = Routing(
        tenant_id=tenant_id,
        name=body.name,
        product_node_id=UUID(body.product_node_id) if body.product_node_id else None,
        spec_id=body.spec_id,
        variant=body.variant,
        is_default=body.is_default,
        total_setup_hours=total_setup,
        notes=body.notes,
    )
    db.add(routing)
    await db.flush()

    for op_data in body.operations:
        rop = RoutingOperation(
            routing_id=routing.id,
            sequence_number=op_data.sequence_number,
            name=op_data.name,
            duration_hours=op_data.duration_hours,
            setup_hours=op_data.setup_hours,
            teardown_hours=op_data.teardown_hours,
            resource_type_id=op_data.resource_type_id,
            alternative_resource_types=op_data.alternative_resource_types,
            output_product=op_data.output_product,
            output_quantity=op_data.output_quantity,
            yield_rate=op_data.yield_rate,
            predecessors=op_data.predecessors,
            input_materials=op_data.input_materials,
            notes=op_data.notes,
        )
        db.add(rop)
        total_setup += op_data.setup_hours

    routing.total_setup_hours = total_setup
    await db.commit()
    await db.refresh(routing)

    # Load operations
    ops_result = (await db.execute(
        select(RoutingOperation).where(
            RoutingOperation.routing_id == routing.id,
        ).order_by(RoutingOperation.sequence_number)
    )).scalars().all()

    return RoutingOut(
        id=str(routing.id),
        tenant_id=str(routing.tenant_id),
        name=routing.name,
        product_node_id=str(routing.product_node_id) if routing.product_node_id else None,
        variant=routing.variant,
        is_default=routing.is_default,
        total_setup_hours=routing.total_setup_hours,
        notes=routing.notes,
        operations=[RoutingOpOut.model_validate(op) for op in ops_result],
    )


@bom_router.get("/routings", response_model=RoutingList)
async def list_routings(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    project_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Список техмаршрутов. При project_id — только маршруты узлов этого проекта."""
    conds = [Routing.tenant_id == tenant_id]
    if project_id:
        node_ids = select(ProductStructure.id).where(
            ProductStructure.project_id == UUID(project_id),
            ProductStructure.tenant_id == tenant_id,
        )
        conds.append(Routing.product_node_id.in_(node_ids))
    total = (await db.execute(
        select(func.count(Routing.id)).where(*conds)
    )).scalar() or 0

    routings = (await db.execute(
        select(Routing).where(*conds)
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    items = []
    for r in routings:
        ops = (await db.execute(
            select(RoutingOperation).where(
                RoutingOperation.routing_id == r.id,
            ).order_by(RoutingOperation.sequence_number)
        )).scalars().all()
        items.append(RoutingOut(
            id=str(r.id),
            tenant_id=str(r.tenant_id),
            name=r.name,
            product_node_id=str(r.product_node_id) if r.product_node_id else None,
            variant=r.variant,
            is_default=r.is_default,
            total_setup_hours=r.total_setup_hours,
            notes=r.notes,
            operations=[RoutingOpOut.model_validate(op) for op in ops],
        ))

    return RoutingList(items=items, total=total)


@bom_router.get("/routings/{routing_id}", response_model=RoutingOut)
async def get_routing(
    routing_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Получить техмаршрут по ID."""
    routing = (await db.execute(
        select(Routing).where(
            Routing.id == routing_id,
            Routing.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not routing:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    ops = (await db.execute(
        select(RoutingOperation).where(
            RoutingOperation.routing_id == routing.id,
        ).order_by(RoutingOperation.sequence_number)
    )).scalars().all()

    return RoutingOut(
        id=str(routing.id),
        tenant_id=str(routing.tenant_id),
        name=routing.name,
        product_node_id=str(routing.product_node_id) if routing.product_node_id else None,
        variant=routing.variant,
        is_default=routing.is_default,
        total_setup_hours=routing.total_setup_hours,
        notes=routing.notes,
        operations=[RoutingOpOut.model_validate(op) for op in ops],
    )


@bom_router.patch("/routing-operations/{operation_id}", response_model=RoutingOpOut)
async def update_routing_operation(
    operation_id: UUID,
    body: RoutingOpUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Обновить операцию маршрута (ресурс, длительность и т.д.). Тенант-скоп через маршрут."""
    op = (await db.execute(
        select(RoutingOperation)
        .join(Routing, RoutingOperation.routing_id == Routing.id)
        .where(RoutingOperation.id == operation_id, Routing.tenant_id == tenant_id)
    )).scalars().first()
    if not op:
        raise HTTPException(status_code=404, detail="Routing operation not found")

    data = body.model_dump(exclude_unset=True)
    # Пустая строка в resource_type_id = снять ресурс (null)
    if data.get("resource_type_id") == "":
        data["resource_type_id"] = None

    for k, v in data.items():
        setattr(op, k, v)

    await db.commit()
    await db.refresh(op)
    return RoutingOpOut.model_validate(op)


# ── BOM Explosion (Развёртка в CPM-операции) ──

@bom_router.post("/projects/{project_id}/explode", response_model=BOMExplosionOut)
async def explode_bom(
    project_id: UUID,
    body: BOMExplodeAndSaveRequest = BOMExplodeAndSaveRequest(),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Развернуть BOM проекта в CPM-операции (без сохранения).

    Возвращает список операций и зависимостей, которые будут созданы.
    Используйте explode-and-save для сохранения.
    """
    result = await run_explosion(db, tenant_id, project_id, body)
    return BOMExplosionOut(
        operations=[
            ExplodedOpOut(
                temp_id=op.temp_id,
                name=op.name,
                duration_base=op.duration_base,
                duration_unit=op.duration_unit,
                setup_time=op.setup_time,
                teardown_time=op.teardown_time,
                operation_type=op.operation_type,
                output_product=op.output_product,
                output_quantity=op.output_quantity,
                yield_rate=op.yield_rate,
                resource_type_id=op.resource_type_id,
                is_milestone=op.is_milestone,
                source_node_path=op.source_node_path,
            )
            for op in result.operations
        ],
        dependencies=[
            ExplodedDepOut(
                predecessor_temp_id=d.predecessor_temp_id,
                successor_temp_id=d.successor_temp_id,
                dependency_type=d.dependency_type,
                lag_hours=d.lag_hours,
            )
            for d in result.dependencies
        ],
        materials=result.materials,
        warnings=result.warnings,
    )


@bom_router.post("/projects/{project_id}/explode-and-save", response_model=BOMExplodeAndSaveOut)
async def explode_and_save_bom(
    project_id: UUID,
    body: BOMExplodeAndSaveRequest = BOMExplodeAndSaveRequest(),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Развернуть BOM проекта в CPM-операции и сохранить в БД.

    Создаёт операции и зависимости для CPM-расчёта.
    """
    result = await run_explosion(db, tenant_id, project_id, body)

    # Сохраняем операции (explode endpoint)
    temp_to_real: dict[str, str] = {}
    for op in result.operations:
        real_op = Operation(
            tenant_id=tenant_id,
            project_id=project_id,
            name=op.name,
            duration_base=op.duration_base,
            duration_unit=op.duration_unit,
            setup_time=op.setup_time,
            teardown_time=op.teardown_time,
        )
        db.add(real_op)
        await db.flush()
        temp_to_real[op.temp_id] = str(real_op.id)

    # Сохраняем зависимости
    dep_count = 0
    for dep in result.dependencies:
        pred_id = temp_to_real.get(dep.predecessor_temp_id)
        succ_id = temp_to_real.get(dep.successor_temp_id)
        if pred_id and succ_id:
            real_dep = OperationDependency(
                predecessor_id=UUID(pred_id),
                successor_id=UUID(succ_id),
                dependency_type=dep.dependency_type,
                lag_time=dep.lag_hours,
                lag_unit="hour",
            )
            db.add(real_dep)
            dep_count += 1

    await db.commit()

    return BOMExplodeAndSaveOut(
        created_operations=len(result.operations),
        created_dependencies=dep_count,
        materials_count=len(result.materials),
        warnings=result.warnings,
    )


async def run_explosion(
    db: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    body: BOMExplodeAndSaveRequest,
):
    """
    Выполнить развёртку BOM. Ищет все узлы BOM проекта,
    для make-узлов с routing_id загружает маршрутные операции,
    для buy-узлов создаёт операции закупки.
    """
    from app.services.bom_explosion import BOMExplosionResult

    result = BOMExplosionResult(operations=[], dependencies=[], materials=[])

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
        if key not in children_map:
            children_map[key] = []
        children_map[key].append(node)

    # Находим корневые узлы
    root_nodes = children_map.get("__root__", [])

    # Отслеживаем созданные узлы для построения зависимостей
    node_op_map: dict[str, list[str]] = {}  # node_id → [temp_op_id]
    last_op_in_path: dict[str, str] = {}  # parent_path → last_op_temp_id
    op_counter = [0]

    def _make_temp_id(prefix: str) -> str:
        op_counter[0] += 1
        return f"{prefix}_{op_counter[0]:04d}"

    async def _traverse(node: ProductStructure, parent_path: str):
        node_path = node.path or f"{parent_path}.{node.sort_order or 1}"

        if node.is_phantom:
            # Пропускаем фантомный узел, разворачиваем детей
            for child in children_map.get(str(node.id), []):
                await _traverse(child, node_path)
            return

        if node.is_make_or_buy == "buy":
            # Создаём операцию закупки
            lead_days = node.procurement_lead_time_days or Decimal("0")
            op = ExplodedOperation(
                temp_id=_make_temp_id("proc"),
                name=f"Закупка: {node.nomenclature_name}",
                duration_base=lead_days * Decimal("24"),  # дни → часы
                operation_type="procurement",
                output_product=node.nomenclature_id,
                output_quantity=node.quantity_per_parent * body.project_quantity,
                procurement_lead_time_days=lead_days,
                source_node_path=node_path,
            )
            result.operations.append(op)
            node_op_map[str(node.id)] = [op.temp_id]
            last_op_in_path[node_path] = op.temp_id

            result.materials.append({
                "nomenclature_id": node.nomenclature_id,
                "nomenclature_name": node.nomenclature_name,
                "quantity": float(node.quantity_per_parent * body.project_quantity),
                "unit": node.unit,
                "lead_time_days": float(lead_days),
                "source_node_path": node_path,
            })

            # Разворачиваем детей (если есть — вложенная закупка)
            for child in children_map.get(str(node.id), []):
                await _traverse(child, node_path)

            return

        if node.is_make_or_buy == "make" and node.routing_id:
            # Загружаем маршрутные операции
            routing_ops = await load_routing_operations(db, node.routing_id)
            if not routing_ops:
                result.warnings.append(
                    f"Узел '{node.nomenclature_name}' ({node_path}): маршрут без операций"
                )
                return

            prod_ops, internal_deps = expand_routing_to_ops(
                routing_ops,
                node.quantity_per_parent * body.project_quantity,
                node_path,
            )

            # Переименовываем temp_id в глобально уникальные и добавляем
            local_to_global: dict[str, str] = {}
            op_ids_in_node: list[str] = []
            for op in prod_ops:
                new_id = _make_temp_id("op")
                local_to_global[op.temp_id] = new_id
                op.temp_id = new_id
                op.name = f"{node.nomenclature_name} · {op.name}"
                result.operations.append(op)
                op_ids_in_node.append(new_id)

            # Добавляем внутренние зависимости
            for dep in internal_deps:
                pred_g = local_to_global.get(dep.predecessor_temp_id)
                succ_g = local_to_global.get(dep.successor_temp_id)
                if pred_g and succ_g:
                    result.dependencies.append(ExplodedDependency(
                        predecessor_temp_id=pred_g,
                        successor_temp_id=succ_g,
                        dependency_type=dep.dependency_type,
                        lag_hours=dep.lag_hours,
                    ))

            node_op_map[str(node.id)] = op_ids_in_node

            # Связываем с предыдущей операцией в иерархии (если есть)
            if parent_path in last_op_in_path:
                first_op = op_ids_in_node[0] if op_ids_in_node else None
                prev_op = last_op_in_path[parent_path]
                if first_op and prev_op:
                    result.dependencies.append(ExplodedDependency(
                        predecessor_temp_id=prev_op,
                        successor_temp_id=first_op,
                        dependency_type="FS",
                    ))

            # Обновляем last_op_in_path для этого уровня и выше
            if op_ids_in_node:
                last_op = op_ids_in_node[-1]
                # Обновляем путь к родительским уровням
                parts = node_path.split(".")
                for i in range(len(parts)):
                    ancestor_path = ".".join(parts[:i+1])
                    last_op_in_path[ancestor_path] = last_op

            return

        # Узел make без routing_id
        result.warnings.append(
            f"Узел '{node.nomenclature_name}' ({node_path}): тип 'make' без маршрута"
        )

    # Обходим все корневые узлы
    for root in root_nodes:
        await _traverse(root, "1")

    # Связываем операции закупки с потребляющими (FS от закупки к первому потребителю)
    _link_procurement_to_production(result, node_op_map, all_nodes, children_map)

    return result


def _link_procurement_to_production(
    result,
    node_op_map: dict[str, list[str]],
    all_nodes: list[ProductStructure],
    children_map: dict[str, list[ProductStructure]],
):
    """
    Связывает операции закупки материалов с производственными операциями,
    которые эти материалы потребляют.

    Правило: закупка → первая операция родительского маршрута.
    """
    node_by_id = {str(n.id): n for n in all_nodes}

    for node in all_nodes:
        if node.is_make_or_buy == "buy":
            parent_id = str(node.parent_id) if node.parent_id else None
            if not parent_id or parent_id not in node_op_map:
                continue

            parent_ops = node_op_map[parent_id]
            buy_ops = node_op_map.get(str(node.id), [])

            if not parent_ops or not buy_ops:
                continue

            # Закупка предшествует первой операции родительского маршрута
            first_prod_op = parent_ops[0]
            for buy_op_id in buy_ops:
                result.dependencies.append(ExplodedDependency(
                    predecessor_temp_id=buy_op_id,
                    successor_temp_id=first_prod_op,
                    dependency_type="FS",
                ))



# ── MRP Export ────────────────────────────────────────────────

from pydantic import BaseModel as PydanticBaseModel

class MRPMaterialRequirement(PydanticBaseModel):
    """Потребность в материале для MRP-экспорта."""
    nomenclature_id: str
    nomenclature_name: str
    quantity: float
    unit: str
    need_date: str
    source_operation: str
    lead_time_days: float


class MRPResourceLoad(PydanticBaseModel):
    """Загрузка ресурса для MRP-экспорта."""
    resource_id: str
    resource_name: str
    operation_name: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_hours: float
    load_percent: float


class MRPExportOut(PydanticBaseModel):
    """Агрегированный MRP-экспорт для ERP-интеграции."""
    project_id: str
    generated_at: str
    total_operations: int
    total_dependencies: int
    materials: list[dict]
    operations: list[dict]
    dependencies: list[dict]
    resource_load: list[MRPResourceLoad]
    warnings: list[str]


@bom_router.get("/projects/{project_id}/export/mrp", response_model=MRPExportOut)
async def export_mrp(
    project_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """MRP-экспорт: сводка операций, потребностей в материалах и загрузки ресурсов."""
    from datetime import datetime as dt

    ops_result = await db.execute(
        select(Operation).where(
            Operation.tenant_id == tenant_id,
            Operation.project_id == project_id,
        )
    )
    ops = ops_result.scalars().all()

    deps_result = await db.execute(
        select(OperationDependency).where(
            OperationDependency.predecessor_id.in_(
                select(Operation.id).where(
                    Operation.tenant_id == tenant_id,
                    Operation.project_id == project_id,
                )
            )
        )
    )
    deps = deps_result.scalars().all()

    from app.models.operation import OperationResource
    from app.models.resource import Resource

    res_result = await db.execute(
        select(OperationResource).where(
            OperationResource.operation_id.in_(
                select(Operation.id).where(
                    Operation.tenant_id == tenant_id,
                    Operation.project_id == project_id,
                )
            )
        )
    )
    op_resources = res_result.scalars().all()
    res_map: dict[str, list] = {}
    for or_m in op_resources:
        res_map.setdefault(str(orm.operation_id), []).append(orm)

    # Fetch resource names
    resource_names: dict[str, str] = {}
    if op_resources:
        res_ids = list({or_m.resource_id for or_m in op_resources})
        resources_result = await db.execute(
            select(Resource).where(
                Resource.id.in_(res_ids),
                Resource.tenant_id == tenant_id,
            )
        )
        for res in resources_result.scalars().all():
            resource_names[str(res.id)] = res.name

    warnings: list[str] = []

    # BOM развёртка для материалов
    result_exp = await run_explosion(
        db, tenant_id, project_id,
        BOMExplodeAndSaveRequest(project_quantity=Decimal("1"))
    )
    materials = result_exp.materials
    warnings.extend(result_exp.warnings)

    # Загрузка ресурсов
    resource_load: list[MRPResourceLoad] = []
    for op in ops:
        for or_m in res_map.get(str(op.id), []):
            resource_load.append(MRPResourceLoad(
                resource_id=str(or_m.resource_id),
                resource_name=resource_names.get(str(or_m.resource_id), ""),
                operation_name=op.name,
                start_date=op.expected_delivery.isoformat() if op.expected_delivery else None,
                end_date=None,
                duration_hours=float(op.duration_base),
                load_percent=100.0,
            ))

    ops_export = []
    for op in ops:
        ops_export.append({
            "id": str(op.id),
            "name": op.name,
            "ext_id": op.ext_id,
            "duration_hours": float(op.duration_base),
            "expected_start": op.expected_delivery.isoformat() if op.expected_delivery else None,
            "expected_finish": None,
            "is_critical": bool(op.is_critical),
            "operation_type": op.operation_type,
            "output_product": op.output_product,
            "output_quantity": float(op.output_quantity) if op.output_quantity else None,
            "yield_rate": float(op.yield_rate),
        })

    deps_export = []
    for d in deps:
        deps_export.append({
            "predecessor_id": str(d.predecessor_id),
            "successor_id": str(d.successor_id),
            "dependency_type": d.dependency_type,
            "lag_hours": float(d.lag_time) if d.lag_time else 0,
        })

    return MRPExportOut(
        project_id=str(project_id),
        generated_at=dt.utcnow().isoformat() + "Z",
        total_operations=len(ops),
        total_dependencies=len(deps),
        materials=materials,
        operations=ops_export,
        dependencies=deps_export,
        resource_load=resource_load,
        warnings=warnings,
    )


# ── Order cluster (куст заказов) ──

@bom_router.get("/projects/{project_id}/orders/{order_id}/cluster")
async def get_order_cluster(
    project_id: UUID,
    order_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Получить куст заказов: родительские и дочерние.

    Источники связей:
    1. parent_order_id на заказе (явная self-FK) — вверх и вниз по дереву.
    2. order_id на BOM-узлах (какой заказ производит этот узел) — доп. связь.

    Каждый заказ включает: id, ext_id, specification_name, status, group_id, pool_id,
    has_cpm (есть ли расчёт CPM), in_pool (входит ли в пул), relation (self/child/parent).
    """
    from app.models.production_order import ProductionOrder

    current_order = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.id == order_id,
            ProductionOrder.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not current_order:
        raise HTTPException(status_code=404, detail="Заказ не найден")

    parent_ids: set[UUID] = set()
    child_ids: set[UUID] = set()

    # 1. Обход вверх по parent_order_id
    cursor = current_order.parent_order_id
    seen: set[UUID] = set()
    while cursor and cursor not in seen:
        seen.add(cursor)
        parent_ids.add(cursor)
        parent_order = (await db.execute(
            select(ProductionOrder).where(
                ProductionOrder.id == cursor,
                ProductionOrder.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        cursor = parent_order.parent_order_id if parent_order else None

    # 2. Обход вниз по parent_order_id (BFS)
    frontier = [order_id]
    visited: set[UUID] = set()
    while frontier:
        nxt = []
        for pid in frontier:
            if pid in visited:
                continue
            visited.add(pid)
            children = (await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.project_id == project_id,
                    ProductionOrder.parent_order_id == pid,
                )
            )).scalars().all()
            for c in children:
                if c.id != order_id:
                    child_ids.add(c.id)
                    nxt.append(c.id)
        frontier = nxt

    # 3. Доп. связи через order_id на BOM-узлах:
    #    узлы, которые производит текущий заказ (order_id = order_id) →
    #    родители: заказы, в чьём BOM лежат эти узлы.
    bom_nodes_produced = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.project_id == project_id,
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.order_id == order_id,
        )
    )).scalars().all()
    for pnode in bom_nodes_produced:
        root = pnode
        while root and root.parent_id:
            root = (await db.execute(
                select(ProductStructure).where(ProductStructure.id == root.parent_id)
            )).scalar_one_or_none()
        if root and root.nomenclature_name:
            owner = (await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.project_id == project_id,
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.specification_name == root.nomenclature_name,
                )
            )).scalar_one_or_none()
            if owner and owner.id != order_id:
                parent_ids.add(owner.id)

    all_ids = {order_id} | parent_ids | child_ids
    orders = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.id.in_(list(all_ids)),
            ProductionOrder.tenant_id == tenant_id,
        )
    )).scalars().all()

    order_info = []
    for o in orders:
        has_cpm = o.operations_created is not None and o.operations_created > 0
        order_info.append({
            "id": str(o.id),
            "ext_id": o.ext_id,
            "specification_name": o.specification_name,
            "status": o.status,
            "group_id": str(o.group_id) if o.group_id else None,
            "pool_id": str(o.pool_id) if o.pool_id else None,
            "parent_order_id": str(o.parent_order_id) if o.parent_order_id else None,
            "has_cpm": has_cpm,
            "in_pool": o.pool_id is not None,
            "relation": "self" if o.id == order_id else ("child" if o.id in child_ids else "parent"),
        })

    return {
        "order_id": str(order_id),
        "orders": order_info,
        "total": len(order_info),
        "parents": [str(x) for x in parent_ids],
        "children": [str(x) for x in child_ids],
    }


class NodeOrderLinkCheck(BaseModel):
    node_id: UUID
    order_id: Optional[UUID] = None


@bom_router.post("/projects/{project_id}/validate-node-link")
async def validate_node_link(
    project_id: str,
    body: NodeOrderLinkCheck,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Онлайн-проверка привязки узла BOM к заказу: не создаёт ли она цикл в цепочке заказов."""
    orders = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == UUID(project_id),
        )
    )).scalars().all()
    nodes = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == UUID(project_id),
        )
    )).scalars().all()

    node = next((n for n in nodes if n.id == body.node_id), None)
    if not node:
        return {"ok": False, "message": "узел BOM не найден"}

    # Заказ-владелец узла — по спецификации из path (specification_id или specification_name)
    spec = node.path.rsplit("/", 1)[0] if node.path and "/" in node.path else ""
    owner = next(
        (o for o in orders
         if (o.specification_id and o.specification_id.strip() == spec.strip())
         or (o.specification_name and o.specification_name.strip() == spec.strip())),
        None,
    )
    if not owner:
        return {"ok": False, "message": "не удалось определить заказ-владельца узла"}

    if body.order_id is not None and body.order_id not in {o.id for o in orders}:
        return {"ok": False, "message": "код заказа не найден в проекте"}

    # Привязка к своему же заказу — допустима (не создаёт цикл)
    if body.order_id is not None and body.order_id == owner.id:
        return {"ok": True}

    # Граф без текущей связи узла (сам узел исключаем) + пробная новая связь
    graph, ext_by_id = _build_bom_link_graph(orders, [n for n in nodes if n.id != body.node_id])
    if body.order_id is not None:
        graph[owner.id].add(body.order_id)

    # Если из owner снова можно достичь owner — привязка создаёт цикл
    stack: list[tuple[UUID, list[UUID]]] = [(owner.id, [owner.id])]
    visited: set[UUID] = set()
    while stack:
        cur, path = stack.pop()
        if cur in visited:
            continue
        visited.add(cur)
        for nxt in graph.get(cur, set()):
            if nxt == owner.id:
                cyc = path + [nxt]
                chain = " → ".join(ext_by_id.get(c, str(c)[:8]) for c in cyc)
                return {"ok": False, "message": f"привязка создаст цикл: {chain}", "cycle": chain}
            stack.append((nxt, path + [nxt]))

    return {"ok": True}


# ── Проверка структуры: полуфабрикаты должны иметь маршрут и подчинённый заказ ──

class StructureIssue(BaseModel):
    """Одна аномалия структуры."""
    node_id: str
    ext_id: Optional[str] = None
    name: str
    path: Optional[str] = None
    category: str  # no_routing | no_order | self_order
    reason: str


class StructureValidationOut(BaseModel):
    checked_nodes: int
    issues: list[StructureIssue]
    no_routing: list[StructureIssue]
    no_order: list[StructureIssue]
    self_order: list[StructureIssue]
    total_issues: int


class CreateOrderFromNodeRequest(BaseModel):
    ext_id: Optional[str] = None
    notes: Optional[str] = None


class CreateMissingOrdersRequest(BaseModel):
    """Массовое создание подчинённых заказов для полуфабрикатов.

    strict=True — заказ нужен и тем, кто производится в рамках своего же заказа (self_order).
    strict=False — только совсем без привязки (no_order).
    """
    strict: bool = True
    ext_prefix: str = "ПФ-"


def _owner_for_node(node: ProductStructure, orders: list[ProductionOrder]) -> Optional[ProductionOrder]:
    """Заказ-владелец узла: по спецификации из path (specification_id или specification_name)."""
    spec = node.path.rsplit("/", 1)[0] if node.path and "/" in node.path else ""
    if not spec:
        return None
    return next(
        (o for o in orders
         if (o.specification_id and o.specification_id.strip() == spec.strip())
         or (o.specification_name and o.specification_name.strip() == spec.strip())),
        None,
    )


def _semi_issues(
    nodes: list[ProductStructure],
    orders: list[ProductionOrder],
    routing_ids_with_ops: set[UUID],
) -> list[StructureIssue]:
    """Собрать аномалии по полуфабрикатам (semi_finished, не фантом)."""
    issues: list[StructureIssue] = []
    for n in nodes:
        if n.node_type != "semi_finished" or n.is_phantom:
            continue
        common = {
            "node_id": str(n.id),
            "ext_id": n.ext_id,
            "name": n.nomenclature_name,
            "path": n.path,
        }
        # Правило 1: маршрут обязателен
        if n.routing_id is None or n.routing_id not in routing_ids_with_ops:
            issues.append(StructureIssue(
                **common, category="no_routing",
                reason="у полуфабриката нет маршрута с операциями — срок не вычислим",
            ))
        # Правило 2: привязка к заказу-производителю
        if n.order_id is None:
            issues.append(StructureIssue(
                **common, category="no_order",
                reason="полуфабрикат не привязан к подчинённому заказу",
            ))
        else:
            owner = _owner_for_node(n, orders)
            if owner is not None and n.order_id == owner.id:
                issues.append(StructureIssue(
                    **common, category="self_order",
                    reason="полуфабрикат производится в рамках своего же заказа — по строгому правилу нужен отдельный подчинённый заказ",
                ))
    return issues


@bom_router.post("/projects/{project_id}/validate-structure", response_model=StructureValidationOut)
async def validate_structure(
    project_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Проверить структуру проекта: у полуфабрикатов есть маршрут и подчинённый заказ."""
    pid = UUID(project_id)
    nodes = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == pid,
        )
    )).scalars().all()
    orders = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == pid,
        )
    )).scalars().all()

    routings = (await db.execute(
        select(Routing.id).where(Routing.tenant_id == tenant_id)
    )).scalars().all()
    if routings:
        ops_rows = (await db.execute(
            select(RoutingOperation.routing_id)
            .where(RoutingOperation.routing_id.in_(routings))
            .distinct()
        )).scalars().all()
        routing_ids_with_ops = set(ops_rows)
    else:
        routing_ids_with_ops = set()

    issues = _semi_issues(list(nodes), list(orders), routing_ids_with_ops)
    no_routing = [i for i in issues if i.category == "no_routing"]
    no_order = [i for i in issues if i.category == "no_order"]
    self_order = [i for i in issues if i.category == "self_order"]
    return StructureValidationOut(
        checked_nodes=len(nodes),
        issues=issues,
        no_routing=no_routing,
        no_order=no_order,
        self_order=self_order,
        total_issues=len(issues),
    )


@bom_router.post("/projects/{project_id}/nodes/{node_id}/create-order")
async def create_order_from_node(
    project_id: str,
    node_id: str,
    body: CreateOrderFromNodeRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Создать подчинённый заказ из узла-полуфабриката и привязать узел к нему."""
    pid = UUID(project_id)
    node = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == pid,
            ProductStructure.id == UUID(node_id),
        )
    )).scalar_one_or_none()
    if not node:
        raise HTTPException(404, "узел BOM не найден")
    if node.node_type != "semi_finished":
        raise HTTPException(400, "заказ можно создать только для узла-полуфабриката")
    if node.order_id is not None:
        raise HTTPException(409, "узел уже привязан к заказу")

    orders = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == pid,
        )
    )).scalars().all()
    owner = _owner_for_node(node, list(orders))

    ext_id = (body.ext_id or "").strip() or node.ext_id or node.nomenclature_id
    if ext_id:
        dup = next((o for o in orders if o.ext_id and o.ext_id.strip() == ext_id), None)
        if dup:
            raise HTTPException(409, f"заказ с кодом «{ext_id}» уже существует")

    order = ProductionOrder(
        id=uuid4(),
        tenant_id=tenant_id,
        project_id=pid,
        ext_id=ext_id,
        specification_id=node.nomenclature_id or node.ext_id,
        specification_name=node.nomenclature_name,
        quantity=node.quantity_per_parent,
        unit=node.unit,
        priority="normal",
        status="draft",
        parent_order_id=owner.id if owner else None,
        notes=body.notes or "Создан из узла BOM",
    )
    db.add(order)
    await db.flush()
    node.order_id = order.id
    await db.commit()
    await db.refresh(order)

    return {
        "message": f"Создан подчинённый заказ {ext_id or order.id} и привязан к узлу",
        "order": _order_to_out(order),
        "node_id": str(node.id),
        "node_name": node.nomenclature_name,
    }


@bom_router.post("/projects/{project_id}/create-missing-orders")
async def create_missing_orders(
    project_id: str,
    body: CreateMissingOrdersRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Массово создать подчинённые заказы для полуфабрикатов без привязки."""
    pid = UUID(project_id)
    nodes = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == pid,
        )
    )).scalars().all()
    orders = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == pid,
        )
    )).scalars().all()

    prefix = body.ext_prefix.strip() or "ПФ-"
    used = {o.ext_id.strip() for o in orders if o.ext_id}

    created: list[dict] = []
    errors: list[dict] = []
    i = 0
    for node in nodes:
        if node.node_type != "semi_finished" or node.is_phantom:
            continue
        owner = _owner_for_node(node, list(orders))
        if node.order_id is not None:
            if node.order_id != (owner.id if owner else None):
                continue  # уже привязан к другому заказу — не трогаем
            if not body.strict:
                continue  # в гибком режиме «свой заказ» допустим
        # сюда попадают: без привязки ИЛИ «свой заказ» в strict-режиме (нужен отдельный подчинённый)

        # ext_id: код узла, если свободен, иначе префикс + счётчик
        ext_id = None
        if node.ext_id and node.ext_id not in used:
            ext_id = node.ext_id
        else:
            while True:
                i += 1
                cand = f"{prefix}{i}"
                if cand not in used:
                    ext_id = cand
                    break
        used.add(ext_id)

        order = ProductionOrder(
            id=uuid4(),
            tenant_id=tenant_id,
            project_id=pid,
            ext_id=ext_id,
            specification_id=node.nomenclature_id or node.ext_id,
            specification_name=node.nomenclature_name,
            quantity=node.quantity_per_parent,
            unit=node.unit,
            priority="normal",
            status="draft",
            parent_order_id=owner.id if owner else None,
            notes="Создан из узла BOM (массово)",
        )
        db.add(order)
        await db.flush()
        node.order_id = order.id
        created.append({
            "node_id": str(node.id),
            "node_name": node.nomenclature_name,
            "order_id": str(order.id),
            "ext_id": ext_id,
        })

    await db.commit()
    return {
        "message": f"Создано заказов: {len(created)}" + (f", ошибок: {len(errors)}" if errors else ""),
        "created": created,
        "errors": errors,
        "count": len(created),
    }