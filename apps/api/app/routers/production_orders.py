"""
Excel-импорт: трёхвкладочный формат (Заказы + BOM + Маршруты).
"""
import io
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.production_order import ProductionOrder
from app.models.product_structure import ProductStructure
from app.models.routing import Routing, RoutingOperation
from app.schemas.production_order import (
    ProductionOrderOut,
    ExcelImportResult,
    ImportValidationError,
)

router = APIRouter(prefix="/v1/production-orders", tags=["production-orders"])

# ── Helpers ────────────────────────────────────────────────────

def _parse_date(raw) -> Optional[date]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_decimal(raw, default=Decimal("0")) -> Decimal:
    if raw is None or raw == "":
        return default
    try:
        return Decimal(str(raw).replace(",", "."))
    except Exception:
        return default


def _str(raw) -> str:
    if raw is None:
        return ""
    return str(raw).strip()


# ── POST /import ───────────────────────────────────────────────

@router.post("/import", response_model=ExcelImportResult)
async def import_excel(
    file: UploadFile = File(...),
    project_id: str = Form(None),
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Принимает .xlsx с тремя вкладками:
    1. Заказы (Orders)
    2. Состав (BOM)
    3. Маршруты (Routes)

    Создаёт ProductionOrder, BOM-узлы, техмаршруты и операции маршрутов.
    """
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Требуется файл .xlsx")

    content = await file.read()
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(500, "openpyxl не установлен на сервере")

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    sheet_names = wb.sheetnames

    result = ExcelImportResult()

    # ── Вкладка 1: Заказы ──────────────────────────────────
    if "Заказы" in sheet_names or "Orders" in sheet_names:
        ws_name = "Заказы" if "Заказы" in sheet_names else "Orders"
        ws = wb[ws_name]
        result = await _import_orders(ws, project_id, tenant_id, db, result)

    # ── Вкладка 2: BOM ─────────────────────────────────────
    if "Состав" in sheet_names or "BOM" in sheet_names:
        ws_name = "Состав" if "Состав" in sheet_names else "BOM"
        ws = wb[ws_name]
        result = await _import_bom(ws, tenant_id, project_id, db, result)

    # ── Вкладка 3: Маршруты ────────────────────────────────
    if "Маршруты" in sheet_names or "Routes" in sheet_names:
        ws_name = "Маршруты" if "Маршруты" in sheet_names else "Routes"
        ws = wb[ws_name]
        result = await _import_routes(ws, tenant_id, db, result)

    await db.commit()
    return result


# ── Sheet parsers ──────────────────────────────────────────────


async def _import_orders(
    ws, project_id: Optional[str], tenant_id: str,
    db: AsyncSession, result: ExcelImportResult,
) -> ExcelImportResult:
    """Парсинг вкладки 'Заказы'."""
    rows = list(ws.iter_rows(min_row=2, values_only=True))  # skip header
    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        try:
            order = ProductionOrder(
                id=uuid4(),
                tenant_id=tenant_id,
                project_id=project_id or None,
                ext_id=_str(row[0]) if len(row) > 0 else None,
                specification_name=_str(row[1]) if len(row) > 1 else "",
                specification_id=_str(row[2]) if len(row) > 2 else None,
                quantity=_parse_decimal(row[3] if len(row) > 3 else 1, Decimal("1")),
                start_date=_parse_date(row[4] if len(row) > 4 else None),
                due_date=_parse_date(row[5] if len(row) > 5 else None),
                priority=_str(row[6]) if len(row) > 6 and _str(row[6]) in ("low","normal","high","critical") else "normal",
                client=_str(row[7]) if len(row) > 7 else None,
                status="draft",
            )
            db.add(order)
            result.orders_created += 1
        except Exception as e:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Заказы", field="*",
                message=str(e),
            ))
    await db.flush()
    return result


async def _import_bom(
    ws, tenant_id: str, project_id: Optional[str], db: AsyncSession, result: ExcelImportResult,
) -> ExcelImportResult:
    """Парсинг вкладки 'Состав (BOM)'."""
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    # First pass: create all nodes
    node_map = {}  # ext_id → UUID

    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        try:
            node_ext_id = _str(row[1]) if len(row) > 1 else ""
            if not node_ext_id:
                continue

            node_type = _str(row[3]) if len(row) > 3 else "material"
            is_phantom = (node_type == "phantom")

            node = ProductStructure(
                id=uuid4(),
                tenant_id=tenant_id,
                project_id=UUID(project_id) if project_id else None,
                nomenclature_id=node_ext_id,
                nomenclature_name=_str(row[4]) if len(row) > 4 else "",
                node_type=node_type if node_type in ("assembly","semi_finished","material") else "material",
                is_phantom=is_phantom,
                quantity_per_parent=_parse_decimal(row[6] if len(row) > 6 else 1, Decimal("1")),
                unit=_str(row[5]) if len(row) > 5 else "pcs",
                procurement_lead_time_days=_parse_decimal(row[7] if len(row) > 7 else None, None),
                is_make_or_buy="make" if node_type in ("assembly","semi_finished") else "buy",
            )
            # Используем id родительской спецификации (spec) как путь
            spec_name = _str(row[0]) if len(row) > 0 else ""
            node.path = f"{spec_name}/{node_ext_id}" if spec_name else node_ext_id
            db.add(node)
            node_map[node_ext_id] = node.id
            result.bom_nodes_created += 1
        except Exception as e:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="*",
                message=str(e),
            ))

    await db.flush()

    # Second pass: set parent relationships
    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        try:
            node_ext_id = _str(row[1]) if len(row) > 1 else ""
            parent_ext_id = _str(row[2]) if len(row) > 2 else ""
            if parent_ext_id and parent_ext_id in node_map and node_ext_id in node_map:
                node = await db.get(ProductStructure, node_map[node_ext_id])
                if node:
                    node.parent_id = node_map[parent_ext_id]
        except Exception:
            pass

    await db.flush()
    return result


async def _import_routes(
    ws, tenant_id: str, db: AsyncSession, result: ExcelImportResult,
) -> ExcelImportResult:
    """Парсинг вкладки 'Маршруты'."""
    # Группируем строки по node_id
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    routings_by_node = {}  # node_ext_id → [(row_idx, row_data)]

    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        node_id = _str(row[0]) if len(row) > 0 else ""
        if node_id:
            routings_by_node.setdefault(node_id, []).append((i, row))

    # Находим BOM-узлы по ext_id
    for node_ext_id, node_rows in routings_by_node.items():
        try:
            stmt = select(ProductStructure).where(
                ProductStructure.nomenclature_id == node_ext_id,
                ProductStructure.tenant_id == tenant_id,
            )
            res = await db.execute(stmt)
            bom_node = res.scalar_one_or_none()
            if not bom_node:
                continue

            # Создаём Routing
            routing = Routing(
                id=uuid4(),
                tenant_id=tenant_id,
                name=f"Маршрут: {bom_node.nomenclature_name}",
                product_node_id=bom_node.id,
                variant="Основной",
                is_default=True,
            )
            db.add(routing)
            await db.flush()
            result.routings_created += 1

            # Создаём RoutingOperation для каждой строки
            for row_idx, row in node_rows:
                try:
                    rop = RoutingOperation(
                        id=uuid4(),
                        routing_id=routing.id,
                        sequence_number=int(row[1]) if len(row) > 1 and row[1] else 1,
                        name=_str(row[2]) if len(row) > 2 else "",
                        duration_hours=_parse_decimal(row[4] if len(row) > 4 else 0),
                        setup_hours=Decimal("0"),
                        resource_type_id=_str(row[3]) if len(row) > 3 else None,
                        output_product=_str(row[5]) if len(row) > 5 and _str(row[5]) else None,
                        output_quantity=_parse_decimal(Decimal("1")),
                        yield_rate=_parse_decimal(row[9] if len(row) > 9 else 1, Decimal("1")),
                        predecessors=_str(row[6]) if len(row) > 6 and row[6] else None,
                    )
                    db.add(rop)

                    # Дополнительные материалы
                    extra_mat = _str(row[7]) if len(row) > 7 else ""
                    extra_qty = float(row[8]) if len(row) > 8 and row[8] else 0
                    if extra_mat and extra_qty > 0:
                        import json
                        rop.input_materials = json.dumps([{
                            "name": extra_mat,
                            "qty": extra_qty,
                        }])

                    result.routing_ops_created += 1
                except Exception as e:
                    result.errors.append(ImportValidationError(
                        row=row_idx + 2, sheet="Маршруты", field="*",
                        message=str(e),
                    ))

            # Линкуем routing_id к BOM-узлу
            bom_node.routing_id = routing.id

        except Exception as e:
            result.errors.append(ImportValidationError(
                row=0, sheet="Маршруты", field="node_id",
                message=f"Узел {node_ext_id}: {e}",
            ))

    await db.flush()
    return result


# ── GET / ──────────────────────────────────────────────────────

@router.get("/", response_model=list[ProductionOrderOut])
async def list_orders(
    project_id: Optional[str] = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Список заказов на производство, опционально отфильтрованный по проекту."""
    stmt = select(ProductionOrder).where(ProductionOrder.tenant_id == tenant_id)
    if project_id:
        stmt = stmt.where(ProductionOrder.project_id == project_id)
    stmt = stmt.order_by(ProductionOrder.created_at.desc())
    res = await db.execute(stmt)
    orders = res.scalars().all()
    return [_order_to_out(o) for o in orders]


# ── GET /{id} ──────────────────────────────────────────────────

@router.get("/{order_id}", response_model=ProductionOrderOut)
async def get_order(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    return _order_to_out(order)


def _order_to_out(o: ProductionOrder) -> ProductionOrderOut:
    return ProductionOrderOut(
        id=str(o.id),
        tenant_id=str(o.tenant_id),
        project_id=str(o.project_id) if o.project_id else None,
        ext_id=o.ext_id,
        specification_id=o.specification_id,
        specification_name=o.specification_name,
        quantity=o.quantity,
        unit=o.unit,
        start_date=o.start_date,
        due_date=o.due_date,
        priority=o.priority,
        client=o.client,
        notes=o.notes,
        status=o.status,
        exploded_at=o.exploded_at,
        operations_created=o.operations_created,
        created_at=o.created_at,
    )


# ── POST /{id}/expand ──────────────────────────────────────────

from app.services.bom_explosion import ExplodedOperation, ExplodedDependency
from app.models.operation import Operation, OperationDependency


@router.post("/{order_id}/expand")
async def expand_order(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Разворачивает BOM-спецификацию заказа в CPM-операции."""
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == order_id,
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    if not order.project_id:
        raise HTTPException(400, "У заказа не указан проект (project_id). Сначала импортируйте Excel и укажите project_id.")

    # Запускаем развёртку через реальный движок
    from app.routers.bom import run_explosion
    from app.schemas.bom import BOMExplodeAndSaveRequest

    body = BOMExplodeAndSaveRequest(project_quantity=order.quantity)
    result = await run_explosion(
        db=db,
        tenant_id=tenant_id,
        project_id=order.project_id,
        body=body,
    )

    if result.warnings:
        import logging
        for w in result.warnings:
            logging.warning(f"BOM expand warning: {w}")

    # Сохраняем операции
    op_map = {}  # temp_id → Operation.id
    for eop in result.operations:
        op = Operation(
            id=uuid4(),
            tenant_id=tenant_id,
            project_id=order.project_id,
            name=eop.name,
            duration_base=eop.duration_base,
            duration_unit=eop.duration_unit,
            setup_time=eop.setup_time,
            teardown_time=eop.teardown_time,
            operation_type=eop.operation_type,
            output_product=eop.output_product,
            output_quantity=eop.output_quantity,
            yield_rate=eop.yield_rate,
            input_materials=eop.input_materials,
            supplier_id=eop.supplier_id,
            is_milestone=eop.is_milestone,
        )
        db.add(op)
        await db.flush()
        op_map[eop.temp_id] = op.id

    # Сохраняем зависимости
    for dep in result.dependencies:
        if dep.predecessor_temp_id in op_map and dep.successor_temp_id in op_map:
            d = OperationDependency(
                id=uuid4(),
                predecessor_id=op_map[dep.predecessor_temp_id],
                successor_id=op_map[dep.successor_temp_id],
                dependency_type=dep.dependency_type,
                lag_time=dep.lag_hours,
                lag_unit="hour",
            )
            db.add(d)

    # Обновляем заказ
    from datetime import datetime, timezone
    order.status = "planned"
    order.exploded_at = datetime.now(timezone.utc)
    order.operations_created = len(result.operations)

    await db.commit()

    return {
        "order_id": str(order.id),
        "status": order.status,
        "operations_created": len(result.operations),
        "dependencies_created": len(result.dependencies),
        "materials_required": len(result.materials),
        "warnings": result.warnings,
    }
