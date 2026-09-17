"""
Excel-импорт: трёхвкладочный формат (Заказы + BOM + Маршруты).
"""
import io
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import uuid4, UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.production_order import ProductionOrder
from app.models.group_shift_log import GroupShiftLog
from app.models.operation_pin import OperationPin
from app.services.order_priority import normalize_priority
from app.services.priority_chain import (
    build_children_map,
    build_index,
    chain_summary,
    count_descendants,
    resolve_anchor,
    resolve_priority,
)
from app.models.product_structure import ProductStructure
from app.models.routing import Routing, RoutingOperation
from app.models.catalog_operation import CatalogOperation
from difflib import SequenceMatcher
from app.models.nomenclature import Nomenclature
from app.models.counterparty import Counterparty
from app.models.department import Department
from app.models.resource import Resource
from app.schemas.production_order import (
    ConflictResolveRequest,
    OrderAnchorRequest,
    ProductionOrderCreate,
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


_NTYPE_MAP = {
    "assembly": "product",
    "semi_finished": "semi_finished",
    "material": "material",
    "phantom": "material",
    "service": "service",
}


def _normalize_name(name: str) -> str:
    """Нормализация имени для сопоставления: lower, trim, ё→е, коллапс пробелов."""
    s = (name or "").strip().lower().replace("ё", "е")
    return " ".join(s.split())


async def _get_or_create_nomenclature(
    db: AsyncSession,
    tenant_id,
    name: str,
    code: Optional[str],
    node_type: str,
    unit: str,
) -> tuple[Optional[UUID], str]:
    """Найти запись номенклатуры или создать новую.

    Приоритет сопоставления: code (ext_id) → нормализованное имя.
    Возвращает (nomenclature_id, action), где action ∈ {created, linked, skip}.
    """
    norm_name = _normalize_name(name)
    if not norm_name:
        return None, "skip"

    # 1. По внутреннему коду (ext_id узла как code)
    if code:
        row = (
            await db.execute(
                select(Nomenclature).where(
                    Nomenclature.tenant_id == tenant_id,
                    Nomenclature.code == code,
                )
            )
        ).scalars().first()
        if row:
            return row.id, "linked"

    # 2. По нормализованному имени (точное)
    row = (
        await db.execute(
            select(Nomenclature).where(
                Nomenclature.tenant_id == tenant_id,
                func.lower(Nomenclature.name) == norm_name,
            )
        )
    ).scalars().first()
    if row:
        return row.id, "linked"

    # 3. Создать новую
    n = Nomenclature(
        id=uuid4(),
        tenant_id=tenant_id,
        name=(name or "").strip(),
        code=code or None,
        ntype=_NTYPE_MAP.get(node_type, "material"),
        unit=unit or "pcs",
    )
    db.add(n)
    await db.flush()
    return n.id, "created"


# ── Карты русских значений (7-вкладочный формат) ──────────────

# Приоритет разбирается по единому справочнику (app/services/order_priority.py):
# «Срочный», «критический», urgent и прочие формулировки сходятся к critical.
# См. вызовы normalize_priority ниже.

NODE_TYPE_MAP_RU = {
    "сборка": "assembly", "assembly": "assembly",
    "полуфабрикат": "semi_finished", "semi_finished": "semi_finished",
    "материал": "material", "material": "material",
    "фантом": "phantom", "phantom": "phantom",
}

RESOURCE_TYPE_MAP_RU = {
    "оборудование": "equipment", "equipment": "equipment",
    "персонал": "labor", "labor": "labor", "employee": "labor",
    "бригада": "team", "team": "team",
    "инструмент": "tool", "tool": "tool",
    "транспорт": "vehicle", "vehicle": "vehicle",
}


def _pick_sheet(wb, names):
    for n in names:
        if n in wb.sheetnames:
            return wb[n]
    return None


# ── POST /import ───────────────────────────────────────────────

def _norm_cat_name(value: str) -> str:
    """Нормализация названия для сопоставления со справочником операций."""
    import re as _re
    v = (value or "").strip()
    import re as _re
    v = _re.sub(r"[×x]\s*[0-9]+([.,][0-9]+)?\s*$", "", v)   # срезаем коэффициент вида ×0.45
    if "·" in v:
        v = v.split("·")[-1]                                   # берём часть после этапа
    v = v.strip()
    v = v.lower().replace("ё", "е")
    for ch in ("«", "»", '"', "'", "(", ")", "[", "]"):
        v = v.replace(ch, "")
    for ch in ("–", "—", "−"):
        v = v.replace(ch, "-")
    return " ".join(v.split())


async def _catalog_pick(db, tenant_id, name: str, cache: dict, create_missing: bool = True, norm=None):
    """Находит операцию справочника по названию (точно, затем нечётко ≥ 0.9).

    Если не нашлась и разрешено — создаёт новую запись справочника, чтобы
    операции заказов всегда были связаны с нормой.
    """
    if not cache.get("items"):
        rows = (await db.execute(
            select(CatalogOperation).where(CatalogOperation.tenant_id == tenant_id)
        )).scalars().all()
        cache["items"] = list(rows)
        cache["by_norm"] = {_norm_cat_name(r.name): r for r in rows}
    key = _norm_cat_name(name)
    hit = cache["by_norm"].get(key)
    if hit is None:
        best, best_r = None, 0.0
        for item in cache["items"]:
            r = SequenceMatcher(None, key, _norm_cat_name(item.name)).ratio()
            if r > best_r:
                best, best_r = item, r
        hit = best if best_r >= 0.9 else None
    if hit is None and create_missing and name:
        hit = CatalogOperation(id=uuid4(), tenant_id=tenant_id, name=name,
                               default_duration_hours=norm or 1, norm_typical=norm)
        db.add(hit)
        await db.flush()
        cache["items"].append(hit)
        cache["by_norm"][key] = hit
    return hit



@router.post("/import", response_model=ExcelImportResult)
async def import_excel(
    file: UploadFile = File(...),
    project_id: str = Form(None),
    create_missing_bom: bool = Form(False),
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

    # ── Вкладка 1-Настройки: параметры (Клиент по умолчанию) ─────
    default_client: Optional[str] = None
    ws_set = _pick_sheet(wb, ["1-Настройки", "Настройки"])
    if ws_set is not None:
        for row in ws_set.iter_rows(min_row=2, values_only=True):
            if not row or _str(row[0] if len(row) > 0 else None).rstrip(" *") != "Клиент":
                continue
            default_client = _str(row[1] if len(row) > 1 else None) or None
            break

    # ── Вкладка 1: Заказы (Заказы / Orders / 2-Заказы) ─────
    ws = _pick_sheet(wb, ["Заказы", "Orders", "2-Заказы"])
    if ws is not None:
        result = await _import_orders(ws, project_id, tenant_id, db, result, default_client=default_client)

    # ── Вкладка 2: BOM (Состав / BOM / 3-BOM) ──────────────
    ws = _pick_sheet(wb, ["Состав", "BOM", "3-BOM"])
    if ws is not None:
        result = await _import_bom(ws, tenant_id, project_id, db, result)

    # ── Вкладка 4: Ресурсы (4-Ресурсы / Ресурсы) ────────
    res_map: dict[str, UUID] = {}
    dept_map: dict[str, UUID] = {}
    ws = _pick_sheet(wb, ["4-Ресурсы", "Ресурсы"])
    if ws is not None:
        result, res_map, dept_map = await _import_resources(ws, tenant_id, project_id, db, result)

    # ── Вкладка 6: Этапы (6-Этапы) ──
    stage_map: dict[str, str] = {}
    ws_stages = _pick_sheet(wb, ["6-Этапы", "Этапы"])
    if ws_stages is not None:
        for row in ws_stages.iter_rows(min_row=2, values_only=True):
            if not row or row[0] is None:
                continue
            num = _str(row[0])
            name = _str(row[1]) if len(row) > 1 else ""
            if num and name:
                stage_map[num] = name

    # ── Вкладка 3: Маршруты (5-Маршруты / Маршруты / Routes) ─
    # В 7-вкладочном формате у «5-Маршруты» сдвиг колонок +2 (есть Этап и Подразделение)
    ws = _pick_sheet(wb, ["5-Маршруты", "Маршруты", "Routes"])
    is_7tab = ws is not None and ws.title == "5-Маршруты"
    if ws is not None:
        # Авто-создание BOM-узлов при отсутствии: узлы из маршрутов, которых нет в BOM
        missing: list[str] = []
        if ws is not None:
            bom_ext = set()
            ws_bom = _pick_sheet(wb, ["3-BOM", "BOM", "Состав"])
            if ws_bom is not None:
                for brow in ws_bom.iter_rows(min_row=2, values_only=True):
                    if brow and _str(brow[1] if len(brow) > 1 else None):
                        bom_ext.add(_str(brow[1]).strip())
            route_ext = set()
            for rrow in ws.iter_rows(min_row=2, values_only=True):
                if rrow and _str(rrow[0] if len(rrow) > 0 else None):
                    route_ext.add(_str(rrow[0]).strip())
            missing = sorted(route_ext - bom_ext)
        result.missing_bom_nodes = missing
        result = await _import_routes(ws, tenant_id, db, result, project_id, is_7tab=is_7tab, stage_map=stage_map, res_map=res_map, dept_map=dept_map, create_missing_bom=create_missing_bom)

    # Предупреждение: нет ресурсов
    if result.resources_created == 0:
        if result.resources_linked:
            result.warnings.append(
                f"Новые ресурсы не создавались: {result.resources_linked} из «4-Ресурсы» уже есть в каталоге предприятия и переиспользованы."
            )
        else:
            result.warnings.append(
                "Ресурсы не указаны (вкладка «4-Ресурсы» пуста или отсутствует) — загрузка выполнена, но расчёт ресурсов и критической цепи будет ограничен. Ресурсы можно ввести вручную в справочнике."
            )

    # Проверка наличия маршрутов для make-узлов (сборка/полуфабрикат)
    if project_id:
        make_nodes = (await db.execute(
            select(ProductStructure).where(
                ProductStructure.tenant_id == tenant_id,
                ProductStructure.project_id == UUID(project_id),
                ProductStructure.node_type.in_(("assembly", "semi_finished")),
                ProductStructure.is_phantom == False,  # noqa: E712
                ProductStructure.routing_id.is_(None),
            )
        )).scalars().all()
        if make_nodes:
            result.warnings.append(
                f"Узлы сборки/полуфабриката без маршрута: {len(make_nodes)} шт. — они не попадут в расчёт. Маршруты можно добавить вручную."
            )

    # Правила цепочки заказов: циклы parent_order_id и циклы BOM-связей
    await _validate_order_chain(project_id, tenant_id, db, result)

    await db.commit()
    return result


# ── Sheet parsers ──────────────────────────────────────────────


async def _import_orders(
    ws, project_id: Optional[str], tenant_id: str,
    db: AsyncSession, result: ExcelImportResult,
    default_client: Optional[str] = None,
) -> ExcelImportResult:
    """Парсинг вкладки 'Заказы'.

    Колонки: ext_id | specification_name | specification_id | quantity |
             start_date | due_date | priority | client | parent_order_id(ext_id)
    """
    rows = list(ws.iter_rows(min_row=2, values_only=True))  # skip header
    ext_to_id: dict[str, UUID] = {}
    pending_parent: list[tuple[ProductionOrder, str, int]] = []  # (order, parent_ext_id, row)
    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        ext_id = _str(row[0]) if len(row) > 0 else ""
        spec_name = _str(row[1]) if len(row) > 1 else ""
        if not ext_id:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Заказы", field="Код заказа",
                message="обязательное поле 'Код заказа' не заполнено",
            ))
            continue
        if not spec_name:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Заказы", field="Продукт",
                message="обязательное поле 'Продукт' не заполнено",
            ))
            continue
        if not _str(row[3] if len(row) > 3 else None):
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Заказы", field="Кол-во",
                message="обязательное поле 'Кол-во' не заполнено",
            ))
            continue
        client = _str(row[7]) if len(row) > 7 else ""
        if not client and default_client:
            client = default_client
        client_id = None
        if client:
            cp = (await db.execute(
                select(Counterparty).where(
                    Counterparty.tenant_id == tenant_id, Counterparty.name == client
                ).order_by(Counterparty.created_at.asc().nullslast())
            )).scalars().first()
            if not cp:
                cp = Counterparty(id=uuid4(), tenant_id=tenant_id, name=client)
                db.add(cp)
                await db.flush()
            client_id = cp.id
        client_name = client or None
        try:
            # Идемпотентность: повторный импорт ОБНОВЛЯЕТ существующий заказ по (project, ext_id),
            # а не плодит дубль
            order = None
            if project_id:
                order = (await db.execute(
                    select(ProductionOrder).where(
                        ProductionOrder.tenant_id == tenant_id,
                        ProductionOrder.project_id == UUID(project_id),
                        ProductionOrder.ext_id == ext_id,
                    ).order_by(ProductionOrder.created_at.asc().nullslast())
                )).scalars().first()
            if order:
                order.specification_name = spec_name
                order.specification_id = _str(row[2]) if len(row) > 2 else None
                order.quantity = _parse_decimal(row[3] if len(row) > 3 else 1, Decimal("1"))
                order.start_date = _parse_date(row[4] if len(row) > 4 else None)
                order.due_date = _parse_date(row[5] if len(row) > 5 else None)
                order.priority = normalize_priority(_str(row[6] if len(row) > 6 else None))
                order.client = client_name
                order.client_id = client_id
                result.orders_updated += 1
            else:
                order = ProductionOrder(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    project_id=project_id or None,
                    ext_id=ext_id,
                    specification_name=spec_name,
                    specification_id=_str(row[2]) if len(row) > 2 else None,
                    quantity=_parse_decimal(row[3] if len(row) > 3 else 1, Decimal("1")),
                    start_date=_parse_date(row[4] if len(row) > 4 else None),
                    due_date=_parse_date(row[5] if len(row) > 5 else None),
                    priority=normalize_priority(_str(row[6] if len(row) > 6 else None)),
                    client=client_name,
                    client_id=client_id,
                    status="draft",
                )
                db.add(order)
                result.orders_created += 1
            if order.ext_id:
                ext_to_id[order.ext_id] = order.id
            # parent_order_id — ext_id родителя, разрешаем после создания всех заказов
            parent_ext = _str(row[8]) if len(row) > 8 else ""
            if parent_ext:
                if parent_ext == ext_id:
                    result.errors.append(ImportValidationError(
                        row=i + 2, sheet="Заказы", field="Код заказа родителя",
                        message=f"заказ '{ext_id}' не может быть родителем самому себе",
                    ))
                else:
                    pending_parent.append((order, parent_ext, i + 2))
        except Exception as e:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Заказы", field="*",
                message=str(e),
            ))
    await db.flush()

    # Разрешаем parent_order_id: сначала импортированные заказы, затем уже существующие в БД проекта
    if project_id:
        db_orders = (await db.execute(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.project_id == UUID(project_id),
                ProductionOrder.ext_id.isnot(None),
            )
        )).scalars().all()
        for o in db_orders:
            if o.ext_id and o.ext_id not in ext_to_id:
                ext_to_id[o.ext_id] = o.id

    for order, parent_ext, row_no in pending_parent:
        pid = ext_to_id.get(parent_ext)
        if pid:
            order.parent_order_id = pid
        else:
            result.errors.append(ImportValidationError(
                row=row_no, sheet="Заказы", field="Код заказа родителя",
                message=f"код заказа родителя '{parent_ext}' не найден",
            ))
    await db.flush()
    return result


async def _import_bom(
    ws, tenant_id: str, project_id: Optional[str], db: AsyncSession, result: ExcelImportResult,
) -> ExcelImportResult:
    """Парсинг вкладки 'Состав (BOM)'.

    Колонки: spec_name | node_ext_id | parent_ext_id | node_type | nomenclature_name |
             unit | qty_per_parent | procurement_days | order_id(ext_id заказа-производителя)
    """
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    # First pass: create all nodes
    node_map = {}  # ext_id → UUID

    # Карта заказов проекта: ext_id → order UUID (для привязки order_id)
    ext_to_order: dict[str, UUID] = {}
    orders_q = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == (UUID(project_id) if project_id else None),
        )
    )).scalars().all()
    for o in orders_q:
        if o.ext_id:
            ext_to_order[o.ext_id] = o.id

    pending_order_link: list[tuple[ProductStructure, str, int]] = []  # (node, order_ext_id, row)

    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        spec_name = _str(row[0]) if len(row) > 0 else ""
        node_ext_id = _str(row[1]) if len(row) > 1 else ""
        nomenclature_name = _str(row[4]) if len(row) > 4 else ""
        if not spec_name:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="Спецификация",
                message="обязательное поле 'Спецификация' не заполнено",
            ))
            continue
        if not node_ext_id:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="Узел ID",
                message="обязательное поле 'Узел ID' не заполнено",
            ))
            continue
        if not nomenclature_name:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="Номенклатура",
                message="обязательное поле 'Номенклатура' не заполнено",
            ))
            continue
        if not _str(row[3] if len(row) > 3 else None):
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="Тип",
                message="обязательное поле 'Тип' не заполнено",
            ))
            continue
        if not _str(row[6] if len(row) > 6 else None):
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="Норма на 1",
                message="обязательное поле 'Норма на 1' не заполнено",
            ))
            continue
        try:
            node_type_raw = _str(row[3]).lower() if len(row) > 3 else "material"
            node_type = NODE_TYPE_MAP_RU.get(node_type_raw, "material")
            is_phantom = (node_type_raw in ("phantom", "фантом"))
            unit_str = _str(row[5]) if len(row) > 5 else "pcs"

            nref_id, nact = await _get_or_create_nomenclature(
                db, tenant_id, nomenclature_name, node_ext_id, node_type, unit_str
            )
            if nact == "created":
                result.nomenclature_created += 1
            elif nact == "linked":
                result.nomenclature_linked += 1

            # Идемпотентность: повторный импорт переиспользует узел по (project, path)
            node = None
            node_path = f"{spec_name}/{node_ext_id}" if spec_name else node_ext_id
            if project_id:
                node = (await db.execute(
                    select(ProductStructure).where(
                        ProductStructure.tenant_id == tenant_id,
                        ProductStructure.project_id == UUID(project_id),
                        ProductStructure.path == node_path,
                    ).order_by(ProductStructure.created_at.asc().nullslast())
                )).scalars().first()
            if node:
                node.nomenclature_ref_id = nref_id
                node.nomenclature_name = nomenclature_name
                node.node_type = node_type
                node.is_phantom = is_phantom
                node.quantity_per_parent = _parse_decimal(row[6] if len(row) > 6 else 1, Decimal("1"))
                node.unit = unit_str
                node.procurement_lead_time_days = _parse_decimal(row[7] if len(row) > 7 else None, None)
                node.path = node_path
                result.bom_reused += 1
            else:
                node = ProductStructure(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    project_id=UUID(project_id) if project_id else None,
                    nomenclature_id=node_ext_id,
                    nomenclature_ref_id=nref_id,
                    nomenclature_name=nomenclature_name,
                    node_type=node_type,
                    is_phantom=is_phantom,
                    quantity_per_parent=_parse_decimal(row[6] if len(row) > 6 else 1, Decimal("1")),
                    unit=unit_str,
                    procurement_lead_time_days=_parse_decimal(row[7] if len(row) > 7 else None, None),
                    is_make_or_buy="make" if node_type in ("assembly","semi_finished") else "buy",
                )
                node.path = node_path
                db.add(node)
                result.bom_nodes_created += 1
            node_map[node_ext_id] = node.id

            # order_id — ext_id заказа-производителя (куст заказов)
            order_ext = _str(row[8]) if len(row) > 8 else ""
            if order_ext:
                pending_order_link.append((node, order_ext, i + 2))

        except Exception as e:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="BOM", field="*",
                message=str(e),
            ))

    await db.flush()

    # Привязываем order_id (ext_id → order UUID)
    for node, order_ext, row_no in pending_order_link:
        oid = ext_to_order.get(order_ext)
        if oid:
            node.order_id = oid
        else:
            result.errors.append(ImportValidationError(
                row=row_no, sheet="BOM", field="Код заказа",
                message=f"код заказа '{order_ext}' не найден",
            ))

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


async def _import_resources(
    ws, tenant_id: str, project_id: Optional[str], db: AsyncSession, result: ExcelImportResult,
) -> tuple[ExcelImportResult, dict[str, UUID], dict[str, UUID]]:
    """Парсинг вкладки 'Ресурсы'.

    Колонки: ID ресурса | Название | Тип | Подразделение | Доступно | Ед.
    Подразделение создаётся/находится в справочнике (v2.17, Шаг 4b).
    """
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    res_map: dict[str, UUID] = {}
    dept_map: dict[str, UUID] = {}
    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        name = _str(row[1]) if len(row) > 1 else ""
        if not name:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Ресурсы", field="Название",
                message="обязательное поле 'Название' не заполнено",
            ))
            continue
        rtype_raw = _str(row[2]).lower() if len(row) > 2 else "equipment"
        rtype = RESOURCE_TYPE_MAP_RU.get(rtype_raw, "equipment")
        available = _parse_decimal(row[4] if len(row) > 4 else 1, Decimal("1"))
        unit = _str(row[5]) if len(row) > 5 else "pcs"
        dept_name = _str(row[3]) if len(row) > 3 else ""
        dept_id = None
        if dept_name:
            dept = (await db.execute(
                select(Department).where(
                    Department.tenant_id == tenant_id, Department.name == dept_name
                ).order_by(Department.created_at.asc().nullslast())
            )).scalars().first()
            if not dept:
                dept = Department(id=uuid4(), tenant_id=tenant_id, name=dept_name)
                db.add(dept)
            dept_id = dept.id
            dept_map[dept_name] = dept_id
        try:
            # Глобальный каталог предприятия: найти по имени или создать (проектных НЕ создаём —
            # лимиты к проекту привязываются отдельно через ProjectResource)
            res = (await db.execute(
                select(Resource).where(
                    Resource.tenant_id == tenant_id,
                    Resource.project_id.is_(None),
                    Resource.name == name,
                ).order_by(Resource.created_at.asc().nullslast())
            )).scalars().first()
            if not res:
                res = Resource(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    name=name,
                    resource_type=rtype,
                    capacity_per_unit=available,
                    capacity_unit="hour",
                    unit=unit,
                    department_id=dept_id,
                    ext_id=_str(row[0]) if len(row) > 0 else None,
                )
                db.add(res)
                result.resources_created += 1
            else:
                result.resources_linked += 1
                # Существующему ресурсу дописываем подразделение, если оно ещё не задано
                # (иначе отчёт по подразделениям уводит всё в «Без подразделения»)
                if dept_id and not res.department_id:
                    res.department_id = dept_id
            res_map[name] = res.id
        except Exception as e:
            result.errors.append(ImportValidationError(
                row=i + 2, sheet="Ресурсы", field="*",
                message=str(e),
            ))
    await db.flush()
    return result, res_map, dept_map


def _find_cycles_multi(graph: dict[UUID, set[UUID]]) -> list[list[UUID]]:
    """Поиск уникальных циклов в ориентированном мультиграфе (DFS)."""
    cycles: list[list[UUID]] = []
    seen: set[frozenset] = set()
    for start in graph:
        stack: list[tuple[UUID, list[UUID], set[UUID]]] = [(start, [start], {start})]
        while stack:
            node, path, path_set = stack.pop()
            for nxt in graph.get(node, set()):
                if nxt in path_set:
                    idx = path.index(nxt)
                    cyc = path[idx:] + [nxt]
                    key = frozenset(cyc)
                    if key not in seen:
                        seen.add(key)
                        cycles.append(cyc)
                elif nxt in graph:
                    stack.append((nxt, path + [nxt], path_set | {nxt}))
    return cycles


def _build_bom_link_graph(
    orders: list[ProductionOrder], nodes: list[ProductStructure],
) -> tuple[dict[UUID, set[UUID]], dict[UUID, str]]:
    """Граф связей BOM: владелец узла (по спецификации из path) → заказ-производитель узла.

    Возвращает (graph, ext_by_id).
    """
    order_by_spec: dict[str, ProductionOrder] = {}
    for o in orders:
        # «Спецификация» в BOM = specification_id заказа (колонка «Спецификация»), возможен и name
        if o.specification_id:
            order_by_spec[o.specification_id.strip()] = o
        if o.specification_name:
            order_by_spec.setdefault(o.specification_name.strip(), o)
    graph: dict[UUID, set[UUID]] = {}
    ext_by_id: dict[UUID, str] = {}
    for o in orders:
        graph.setdefault(o.id, set())
        ext_by_id[o.id] = o.ext_id or str(o.id)[:8]
    for n in nodes:
        if not n.order_id or n.order_id not in graph:
            continue
        spec = ""
        if n.path and "/" in n.path:
            spec = n.path.rsplit("/", 1)[0]
        owner = order_by_spec.get(spec.strip())
        if owner:
            if n.order_id == owner.id:
                continue  # ссылка на свой же заказ — допустима, цикла не создаёт
            graph[owner.id].add(n.order_id)
    return graph, ext_by_id


async def _validate_order_chain(
    project_id: Optional[str], tenant_id: str, db: AsyncSession, result: ExcelImportResult,
) -> None:
    """Проверка цепочки заказов после импорта.

    Правила:
      - в цепочке parent_order_id не должно быть циклов (нельзя ссылаться на себя или на потомка);
      - в связях BOM (order_id на узлах) не должно быть циклов между заказами.
    """
    if not project_id:
        return
    orders = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == UUID(project_id),
        )
    )).scalars().all()
    by_id = {o.id: o for o in orders}
    ext_by_id = {o.id: o.ext_id or str(o.id)[:8] for o in orders}

    # 1) Циклы в цепочке parent_order_id
    parent_graph: dict[UUID, set[UUID]] = {o.id: set() for o in orders}
    for o in orders:
        if o.parent_order_id and o.parent_order_id in by_id:
            parent_graph[o.id].add(o.parent_order_id)
    for cyc in _find_cycles_multi(parent_graph):
        chain = " → ".join(ext_by_id.get(c, str(c)[:8]) for c in cyc)
        result.errors.append(ImportValidationError(
            row=0, sheet="Заказы", field="Код заказа родителя",
            message=f"обнаружен цикл в цепочке заказов: {chain}",
        ))

    # 2) Циклы в связях BOM (order_id на узлах)
    nodes = (await db.execute(
        select(ProductStructure).where(
            ProductStructure.tenant_id == tenant_id,
            ProductStructure.project_id == UUID(project_id),
            ProductStructure.order_id.isnot(None),
        )
    )).scalars().all()
    bom_graph, _ = _build_bom_link_graph(orders, nodes)
    for cyc in _find_cycles_multi(bom_graph):
        chain = " → ".join(ext_by_id.get(c, str(c)[:8]) for c in cyc)
        result.errors.append(ImportValidationError(
            row=0, sheet="BOM", field="Код заказа",
            message=f"обнаружен цикл в связях BOM по цепочке заказов: {chain}",
        ))


async def _import_routes(
    ws, tenant_id: str, db: AsyncSession, result: ExcelImportResult,
    project_id: Optional[str] = None, is_7tab: bool = False,
    stage_map: Optional[dict] = None, res_map: Optional[dict[str, UUID]] = None,
    dept_map: Optional[dict[str, UUID]] = None,
    create_missing_bom: bool = False,
) -> ExcelImportResult:
    """Парсинг вкладки 'Маршруты'.

    В 7-вкладочном формате колонки сдвинуты на +2 (есть «Этап» и «Подразделение»):
      Длит.ч → col 6, Предш.оп. → col 7, Доп.материал → col 8, Расход → col 9, Вых.год. → col 10.
    """
    if is_7tab:
        # 7-вкладочный: длительность на 6, предш.оп. на 7, материалы 8-9, вых.год. 10
        # этап на 4, подразделение на 5
        c_dur, c_out, c_pred, c_mat, c_qty, c_yield = 6, None, 7, 8, 9, 10
        c_stage, c_dept = 4, 5
    else:
        c_dur, c_out, c_pred, c_mat, c_qty, c_yield = 4, 5, 6, 7, 8, 9
        c_stage, c_dept = None, None
    # Группируем строки по node_id
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    routings_by_node = {}  # node_ext_id → [(row_idx, row_data)]
    ops_without_resource = 0

    for i, row in enumerate(rows):
        if not row or not any(c for c in row):
            continue
        node_id = _str(row[0]) if len(row) > 0 else ""
        if node_id:
            routings_by_node.setdefault(node_id, []).append((i, row))

    # Справочники для сопоставления: подразделение и этап по имени (get_or_create)
    from app.models.project_stage import ProjectStage
    stage_ids: dict[str, UUID] = {}

    async def _get_or_create_stage(name: str) -> Optional[UUID]:
        if not name or not project_id:
            return None
        key = name.strip().lower()
        if key in stage_ids:
            return stage_ids[key]
        st = (await db.execute(
            select(ProjectStage).where(
                ProjectStage.project_id == UUID(project_id),
                ProjectStage.name == name.strip(),
            ).order_by(ProjectStage.created_at.asc().nullslast())
        )).scalars().first()
        if not st:
            st = ProjectStage(
                id=uuid4(), tenant_id=tenant_id, project_id=UUID(project_id),
                name=name.strip(), position=len(stage_ids) + 1,
            )
            db.add(st)
        stage_ids[key] = st.id
        return st.id

    async def _get_or_create_department(name: str) -> Optional[UUID]:
        if not name:
            return None
        if dept_map and name in dept_map:
            return dept_map[name]
        d = (await db.execute(
            select(Department).where(
                Department.tenant_id == tenant_id, Department.name == name.strip()
            ).order_by(Department.created_at.asc().nullslast())
        )).scalars().first()
        if not d:
            d = Department(id=uuid4(), tenant_id=tenant_id, name=name.strip())
            db.add(d)
        if dept_map is not None:
            dept_map[name] = d.id
        return d.id

    # Находим BOM-узлы по ext_id
    for node_ext_id, node_rows in routings_by_node.items():
        try:
            stmt = select(ProductStructure).where(
                ProductStructure.nomenclature_id == node_ext_id,
                ProductStructure.tenant_id == tenant_id,
                ProductStructure.project_id == (UUID(project_id) if project_id else None),
            )
            res = await db.execute(stmt)
            bom_node = res.scalar_one_or_none()
            if not bom_node:
                # Авто-создание BOM-узла (при подтверждении пользователя)
                if create_missing_bom and node_ext_id:
                    bom_node = ProductStructure(
                        id=uuid4(),
                        tenant_id=tenant_id,
                        project_id=UUID(project_id) if project_id else None,
                        level=0,
                        node_type="semi_finished",
                        nomenclature_id=node_ext_id,
                        nomenclature_name=node_ext_id,
                        quantity_per_parent=Decimal("1"),
                        unit="pcs",
                        is_make_or_buy="make",
                        sort_order=0,
                        ext_id=node_ext_id,
                    )
                    db.add(bom_node)
                    result.bom_nodes_created += 1
                    result.warnings.append(f"Авто-создан BOM-узел «{node_ext_id}» (не был указан в составе)")
                else:
                    continue

            # Правило (решение 03.09.2026): материал не может быть узлом маршрута.
            # Маршрут material-узла переносится на ближайший родительский узел (продукция/полуфабрикат).
            if bom_node.node_type == 'material':
                owner = await db.get(ProductStructure, bom_node.parent_id) if bom_node.parent_id else None
                hops = 0
                while owner is not None and owner.node_type == 'material' and hops < 8:
                    owner = await db.get(ProductStructure, owner.parent_id) if owner.parent_id else None
                    hops += 1
                if owner is None:
                    result.warnings.append(
                        f'Отметка маршрута для узла «{node_ext_id} · {bom_node.nomenclature_name}» '
                        'проигнорирована: материал не может быть узлом маршрута, а родительский узел '
                        'продукции/полуфабриката не найден.'
                    )
                    continue
                # Перенос существующего маршрута материала на владельца (операция не теряется)
                if bom_node.routing_id and not owner.routing_id:
                    old_rt = await db.get(Routing, bom_node.routing_id)
                    if old_rt:
                        old_rt.product_node_id = owner.id
                        owner.routing_id = old_rt.id
                    bom_node.routing_id = None
                result.warnings.append(
                    f'Маршрут узла «{node_ext_id} · {bom_node.nomenclature_name}» (материал) закреплён за '
                    f'родительским узлом «{owner.nomenclature_id or ""} · {owner.nomenclature_name}»: '
                    'материал не может быть узлом маршрута.'
                )
                bom_node = owner

            # Идемпотентность: при повторном импорте заменяем маршрут узла
            # (импорт — источник истины для импортированных маршрутов)
            if bom_node.routing_id:
                old_rt = await db.get(Routing, bom_node.routing_id)
                if old_rt:
                    await db.execute(
                        delete(RoutingOperation).where(RoutingOperation.routing_id == old_rt.id)
                    )
                    await db.delete(old_rt)
                    await db.flush()
                bom_node.routing_id = None
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
                seq_val = row[1] if len(row) > 1 else None
                name_val = _str(row[2]) if len(row) > 2 else ""
                dur_val = row[c_dur] if len(row) > c_dur else None
                if not seq_val or not name_val or dur_val is None or _str(dur_val) == "":
                    result.errors.append(ImportValidationError(
                        row=row_idx + 2, sheet="Маршруты", field="№ оп./Операция/Длит.",
                        message="обязательные поля '№ оп.', 'Операция', 'Длит.,ч' не заполнены",
                    ))
                    continue
                res_name = _str(row[3]) if len(row) > 3 else ""
                stage_val = _str(row[c_stage]) if c_stage is not None and len(row) > c_stage else ""
                dept_val = _str(row[c_dept]) if c_dept is not None and len(row) > c_dept else ""
                stage_name_val = (stage_map or {}).get(stage_val, "") if stage_val else ""
                if not res_name:
                    ops_without_resource += 1
                try:
                    # Сопоставление по имени: ресурс и подразделение — из справочников
                    res_id = (res_map or {}).get(res_name)
                    if res_name and not res_id:
                        res_lookup = (await db.execute(
                            select(Resource).where(
                                Resource.tenant_id == tenant_id, Resource.name == res_name
                            ).order_by(Resource.created_at.asc().nullslast())
                        )).scalars().first()
                        res_id = res_lookup.id if res_lookup else None
                    # Автоподстановка (03.09.2026): подразделение операции наследуется от ресурса,
                    # если в файле не указано (правило: операция выполняется там, где стоит ресурс)
                    if not dept_val and res_id:
                        r_dept = (await db.execute(
                            select(Resource).where(Resource.id == res_id)
                        )).scalar_one_or_none()
                        if r_dept and r_dept.department_id:
                            r_d = await db.get(Department, r_dept.department_id)
                            if r_d:
                                dept_val = r_d.name
                    dept_id2 = await _get_or_create_department(dept_val)
                    stage_id2 = await _get_or_create_stage(stage_name_val or stage_val)
                    # Каталог операций: найти по имени, создать при отсутствии (v2.17)
                    cat_id = None
                    if name_val:
                        from app.models.catalog_operation import CatalogOperation
                        cat = (await db.execute(
                            select(CatalogOperation).where(
                                CatalogOperation.tenant_id == tenant_id,
                                func.lower(CatalogOperation.name) == name_val.strip().lower(),
                            ).order_by(CatalogOperation.created_at.asc().nullslast())
                        )).scalars().first()
                        if not cat:
                            cat = CatalogOperation(
                                id=uuid4(), tenant_id=tenant_id,
                                name=name_val.strip(),
                                default_duration_hours=_parse_decimal(dur_val) or Decimal("1"),
                            )
                            db.add(cat)
                        cat_id = cat.id
                    rop = RoutingOperation(
                        id=uuid4(),
                        routing_id=routing.id,
                        sequence_number=int(seq_val) if seq_val else 1,
                        name=name_val,
                        duration_hours=_parse_decimal(dur_val),
                        setup_hours=Decimal("0"),
                        resource_type_id=str(res_id) if res_id else (res_name or None),
                        stage=stage_val or None,
                        stage_name=stage_name_val or stage_val or None,
                        department=dept_val or None,
                        catalog_operation_id=cat_id,
                        department_id=dept_id2,
                        stage_id=stage_id2,
                        output_product=(
                            _str(row[c_out]) if c_out is not None and len(row) > c_out and _str(row[c_out]) else None
                        ),
                        output_quantity=_parse_decimal(Decimal("1")),
                        yield_rate=_parse_decimal(row[c_yield] if len(row) > c_yield else 1, Decimal("1")),
                        predecessors=_str(row[c_pred]) if len(row) > c_pred and row[c_pred] else None,
                    )
                    db.add(rop)

                    # Дополнительные материалы
                    extra_mat = _str(row[c_mat]) if len(row) > c_mat else ""
                    extra_qty = float(row[c_qty]) if len(row) > c_qty and row[c_qty] else 0
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

    if ops_without_resource > 0:
        result.warnings.append(
            f"В {ops_without_resource} операциях не указан ресурс — загрузка выполнена, но расчёт ресурсов будет неполным. Ресурсы можно добавить вручную в справочнике."
        )

    await db.flush()
    return result


# ── GET / ──────────────────────────────────────────────────────

@router.get("", response_model=list[ProductionOrderOut])
@router.get("/", response_model=list[ProductionOrderOut])
async def list_orders(
    project_id: Optional[str] = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Список заказов на производство, опционально отфильтрованный по проекту."""
    stmt = select(ProductionOrder).where(ProductionOrder.tenant_id == tenant_id)
    if project_id:
        stmt = stmt.where(ProductionOrder.project_id == UUID(project_id))
    stmt = stmt.order_by(ProductionOrder.created_at.desc())
    res = await db.execute(stmt)
    orders = res.scalars().all()
    by_id = build_index(orders)
    children = build_children_map(orders)
    return [_order_to_out(o, by_id, children) for o in orders]


async def _resolve_parent_order(
    value: Optional[str],
    project_id: Optional[str],
    tenant_id: str,
    db: AsyncSession,
) -> Optional[UUID]:
    """Разрешает parent_order_id: принимает UUID или ext_id заказа.

    Возвращает UUID родительского заказа или None.
    """
    if not value:
        return None
    v = value.strip()
    # 1. Это валидный UUID?
    try:
        pid = UUID(v)
        # Проверим, что такой заказ существует
        exists = (await db.execute(
            select(ProductionOrder.id).where(ProductionOrder.id == pid)
        )).scalar_one_or_none()
        return pid if exists else None
    except ValueError:
        pass
    # 2. Это ext_id — ищем заказ по ext_id в рамках проекта/арендатора
    stmt = select(ProductionOrder).where(
        ProductionOrder.tenant_id == tenant_id,
        ProductionOrder.ext_id == v,
    )
    if project_id:
        stmt = stmt.where(ProductionOrder.project_id == UUID(project_id))
    res = await db.execute(stmt)
    order = res.scalars().first()
    return order.id if order else None


# ── POST / ─────────────────────────────────────────────────────

@router.post("/", response_model=ProductionOrderOut, status_code=201)
async def create_order(
    project_id: str,
    body: ProductionOrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Создать один заказ на производство."""
    from uuid import UUID
    parent_id = await _resolve_parent_order(body.parent_order_id, project_id, tenant_id, db)
    client_id = None
    client_name = body.client
    if body.client_id:
        c = (await db.execute(select(Counterparty).where(
            Counterparty.id == UUID(body.client_id),
            Counterparty.tenant_id == tenant_id,
        ))).scalar_one_or_none()
        if c:
            client_id = c.id
            client_name = c.name
    order = ProductionOrder(
        id=uuid4(),
        tenant_id=tenant_id,
        project_id=UUID(project_id),
        ext_id=body.ext_id,
        specification_name=body.specification_name,
        quantity=body.quantity,
        unit=body.unit,
        start_date=body.start_date,
        due_date=body.due_date,
        priority=body.priority,
        client=client_name,
        client_id=client_id,
        notes=body.notes,
        parent_order_id=parent_id,
        is_priority=bool(body.is_priority),
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return _order_to_out(order, by_id, children)


# ── GET /check-duplicate ───────────────────────────────────────
# (должен быть объявлен ДО /{order_id}, иначе "check-duplicate" попадёт в UUID-парсер)

@router.get("/check-duplicate")
async def check_duplicate(
    project_id: str,
    ext_id: Optional[str] = None,
    specification_name: Optional[str] = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Проверить возможный дубликат заказа по ext_id + specification_name.

    Возвращает список существующих заказов с совпадающими полями (в рамках проекта).
    """
    if not ext_id and not specification_name:
        return {"duplicate": False, "existing": []}
    stmt = select(ProductionOrder).where(
        ProductionOrder.tenant_id == tenant_id,
        ProductionOrder.project_id == UUID(project_id),
    )
    if specification_name:
        stmt = stmt.where(ProductionOrder.specification_name == specification_name)
    if ext_id:
        stmt = stmt.where(ProductionOrder.ext_id == ext_id)
    res = await db.execute(stmt)
    dups = res.scalars().all()
    return {
        "duplicate": len(dups) > 0,
        "existing": [
            {
                "id": str(o.id),
                "ext_id": o.ext_id,
                "specification_name": o.specification_name,
                "status": o.status,
            }
            for o in dups
        ],
    }


# ── GET /priority/chain ────────────────────────────────
# (тоже ДО /{order_id}, чтобы "priority" не попал в UUID-парсер)

@router.get("/priority/chain")
async def priority_chain(
    project_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Сводка по реквизиту «Приоритетный заказ» в проекте.

    Возвращает, сколько заказов приоритетны фактически, у кого признак
    свой и сколько подчинённых он за собой тянет.
    """
    rows = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == UUID(project_id),
        )
    )).scalars().all()
    return chain_summary(rows)


# ── GET /{id} ──────────────────────────────────────────────────

@router.get("/{order_id}", response_model=ProductionOrderOut)
async def get_order(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == UUID(order_id),
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return _order_to_out(order, by_id, children)


def _order_to_out(o: ProductionOrder, by_id: Optional[dict] = None, children: Optional[dict] = None) -> ProductionOrderOut:
    st = resolve_priority(o, by_id)
    anchor_st = resolve_anchor(o, by_id)
    src = st["source"]
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
        client_id=str(o.client_id) if o.client_id else None,
        notes=o.notes,
        status=o.status,
        group_id=str(o.group_id) if o.group_id else None,
        pool_id=str(o.pool_id) if o.pool_id else None,
        parent_order_id=str(o.parent_order_id) if o.parent_order_id else None,
        is_priority=st["own"],
        priority_effective=st["effective"],
        priority_inherited=st["inherited"],
        priority_locked=st["locked"],
        priority_lock_reason=st["reason"],
        priority_source_order_id=str(src.id) if src is not None else None,
        priority_source_ext_id=(src.ext_id if src is not None else None),
        priority_descendants=count_descendants(o.id, children),
        priority_anchor_at=o.priority_anchor_at,
        priority_anchor_effective_at=anchor_st["effective"],
        priority_anchor_inherited=anchor_st["inherited"],
        priority_anchor_locked=anchor_st["locked"],
        priority_anchor_source_ext_id=(anchor_st["source"].ext_id if anchor_st["source"] is not None else None),
        exploded_at=o.exploded_at,
        operations_created=o.operations_created,
        created_at=o.created_at,
    )


async def _load_chain(
    db: AsyncSession, tenant_id, project_id,
) -> tuple[dict, dict]:
    """Цепочка заказов проекта для расчёта наследования признака.

    Возвращает (индекс по id, карта детей по parent_order_id).
    """
    if not project_id:
        return {}, {}
    rows = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.project_id == project_id,
        )
    )).scalars().all()
    return build_index(rows), build_children_map(rows)


# ── POST /{id}/expand ──────────────────────────────────────────

from app.services.bom_explosion import ExplodedOperation, ExplodedDependency
from app.models.operation import Operation, OperationDependency, OperationResource


@router.post("/{order_id}/expand")
async def expand_order(
    order_id: str,
    replace: bool = False,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Разворачивает BOM-спецификацию заказа в CPM-операции."""
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == UUID(order_id),
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    if not order.project_id:
        raise HTTPException(400, "У заказа не указан проект (project_id). Сначала импортируйте Excel и укажите project_id.")

    # Идемпотентность (12.09.2026): повторная развёртка не должна плодить дубли операций
    _auto_types = ("production", "procurement")
    _proj_ops = select(Operation.id).where(
        Operation.tenant_id == tenant_id,
        Operation.project_id == order.project_id,
        Operation.operation_type.in_(_auto_types),
    )
    _existing = (await db.execute(
        select(func.count()).select_from(Operation).where(
            Operation.tenant_id == tenant_id,
            Operation.project_id == order.project_id,
            Operation.operation_type.in_(_auto_types),
        )
    )).scalar() or 0
    if _existing and not replace:
        return {
            "order_id": str(order.id),
            "status": order.status,
            "operations_created": 0,
            "dependencies_created": 0,
            "materials_required": 0,
            "warnings": [f"Операции проекта уже развёрнуты ({_existing} шт.) — повторная развёртка пропущена. "
                         f"Для пересборки вызовите с replace=true."],
        }
    if _existing and replace:
        await db.execute(delete(OperationDependency).where(OperationDependency.predecessor_id.in_(_proj_ops)))
        await db.execute(delete(OperationDependency).where(OperationDependency.successor_id.in_(_proj_ops)))
        await db.execute(delete(Operation).where(Operation.id.in_(_proj_ops)))
        await db.flush()

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
    # Резолвер ресурса: в маршруте ресурс хранится как ID или как название (12.09.2026)
    _res_cache: dict[str, Optional[UUID]] = {}

    async def _resolve_resource(tag: Optional[str]):
        if not tag:
            return None
        key = str(tag).strip()
        if not key:
            return None
        if key in _res_cache:
            return _res_cache[key]
        rid = None
        try:
            rid = UUID(key)
        except Exception:
            rid = None
        if rid is not None:
            r = await db.get(Resource, rid)
            if r:
                _res_cache[key] = r.id
                return r.id
        r = (await db.execute(
            select(Resource).where(
                Resource.tenant_id == tenant_id,
                func.lower(Resource.name) == key.lower(),
            ).order_by(Resource.created_at.asc().nullslast())
        )).scalars().first()
        _res_cache[key] = r.id if r else None
        return _res_cache[key]

    _cat_cache: dict = {}   # кэш справочника операций на время развёртки
    op_map = {}  # temp_id → Operation.id
    for eop in result.operations:
        _rid = await _resolve_resource(eop.resource_type_id)
        _cat = await _catalog_pick(db, tenant_id, eop.name, _cat_cache,
                                   create_missing=True, norm=eop.duration_base)
        op = Operation(
            id=uuid4(),
            tenant_id=tenant_id,
            project_id=order.project_id,
            order_id=order.id,
            catalog_operation_id=(_cat.id if _cat is not None else None),
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

        # Ресурс операции (12.09.2026): маршрутный ресурс переносится в связь операция-ресурс
        if _rid:
            db.add(OperationResource(
                id=uuid4(),
                operation_id=op.id,
                resource_id=_rid,
                role="primary",
                efficiency_factor=Decimal("1"),
                capacity_demand=Decimal("1"),
            ))

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


# ── PUT /{id} ─────────────────────────────────────────────────

@router.put("/{order_id}", response_model=ProductionOrderOut)
async def update_order(
    order_id: str,
    body: ProductionOrderCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Обновить поля заказа."""
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == UUID(order_id),
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    body_fields = body.model_dump(exclude_unset=True)
    for field in ("specification_name", "ext_id", "unit", "priority", "client", "notes", "status"):
        # Только явно присланные поля: иначе PUT с одним реквизитом затирал остальные
        # значениями по умолчанию схемы (priority -> normal, unit -> pcs).
        if body_fields.get(field) is not None:
            setattr(order, field, body_fields[field])
    if body_fields.get("client_id") is not None:
        if body.client_id:
            c = (await db.execute(select(Counterparty).where(
                Counterparty.id == UUID(body.client_id),
                Counterparty.tenant_id == tenant_id,
            ))).scalar_one_or_none()
            order.client_id = c.id if c else None
            if c:
                order.client = c.name
        else:
            order.client_id = None
    if body_fields.get("quantity") is not None:
        order.quantity = body.quantity
    if body_fields.get("start_date") is not None:
        order.start_date = body.start_date
    if body_fields.get("due_date") is not None:
        order.due_date = body.due_date
    if 'parent_order_id' in body_fields:
        if not body.parent_order_id:
            order.parent_order_id = None
        else:
            order.parent_order_id = await _resolve_parent_order(
                body.parent_order_id, str(order.project_id) if order.project_id else None,
            tenant_id, db
        )
    # Реквизит «Приоритетный заказ». Сначала разрешается новая позиция в цепочке,
    # затем проверяется блокировка: у подчинённого приоритетного родителя
    # изменение поля запрещено.
    if 'is_priority' in body_fields and body.is_priority is not None:
        by_id, _children = await _load_chain(db, tenant_id, order.project_id)
        by_id[order.id] = order
        st = resolve_priority(order, by_id)
        if st["locked"]:
            raise HTTPException(409, st["reason"] or "Реквизит задан родительским заказом — изменение запрещено")
        order.is_priority = bool(body.is_priority)
    await db.commit()
    await db.refresh(order)
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return _order_to_out(order, by_id, children)


# ── PATCH /{id}/move ───────────────────────────────────────────

from pydantic import BaseModel as PydanticBase


class OrderMoveRequest(PydanticBase):
    group_id: Optional[str] = None
    pool_id: Optional[str] = None


@router.patch("/{order_id}/move", response_model=ProductionOrderOut)
async def move_order(
    order_id: str,
    body: OrderMoveRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Переместить заказ в группу/кластер или убрать из них.
    
    Передайте group_id или pool_id (не оба сразу).
    Передайте оба null чтобы убрать заказ из группы/кластера и вернуть в корень.
    """
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == UUID(order_id),
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    order.group_id = UUID(body.group_id) if body.group_id else None
    order.pool_id = UUID(body.pool_id) if body.pool_id else None
    await db.commit()
    await db.refresh(order)
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return _order_to_out(order, by_id, children)


# ── DELETE /{id} ──────────────────────────────────────────────

@router.delete("/{order_id}", status_code=204)
async def delete_order(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Удалить заказ на производство."""
    stmt = select(ProductionOrder).where(
        ProductionOrder.id == UUID(order_id),
        ProductionOrder.tenant_id == tenant_id,
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    await db.delete(order)
    await db.commit()

# ── Якорь старта приоритетного заказа ──────────────────────────
#
# Якорь — жёсткая дата и время начала приоритетного заказа. В расчёте он
# превращается в жёсткое закрепление первых операций заказа (operation_pins,
# тип start_not_earlier), поэтому календарный расчёт соблюдает его как
# ограничение, а зависимые заказы сдвигаются автоматически.
# Изменения пишутся в журнал сдвигов (group_shift_logs) с «до/после».

ANCHOR_NOTE_PREFIX = "Якорь старта"


async def _get_order_or_404(db: AsyncSession, tenant_id, order_id: str) -> ProductionOrder:
    order = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.id == UUID(order_id),
            ProductionOrder.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    return order


async def _chain_order_ids(db: AsyncSession, tenant_id, order: ProductionOrder) -> list:
    """Идентификаторы «тела» заказа: сам заказ и все подчинённые на любую глубину.

    Цепочка заказов считается одним телом (передел), поэтому операции могут
    лежать как на самом приоритетном заказе, так и на его подчинённых.
    """
    _by_id, children = await _load_chain(db, tenant_id, order.project_id)
    ids = [order.id]
    seen = {order.id}
    stack = [order.id]
    while stack:
        cur = stack.pop()
        for kid in children.get(cur, []):
            if kid.id not in seen:
                seen.add(kid.id)
                ids.append(kid.id)
                stack.append(kid.id)
    return ids


async def _order_operations(db: AsyncSession, tenant_id, order_ids: list) -> list:
    if not order_ids:
        return []
    return (await db.execute(
        select(Operation).where(
            Operation.tenant_id == tenant_id,
            Operation.order_id.in_(order_ids),
        )
    )).scalars().all()


async def _order_root_operations(db: AsyncSession, tenant_id, order_ids: list) -> list:
    """Первые операции тела заказа: те, у которых нет предшественника внутри тела."""
    ops = await _order_operations(db, tenant_id, order_ids)
    if not ops:
        return []
    ids = {o.id for o in ops}
    deps = (await db.execute(
        select(OperationDependency).where(OperationDependency.successor_id.in_(ids))
    )).scalars().all()
    has_pred = {d.successor_id for d in deps if d.predecessor_id in ids}
    roots = [o for o in ops if o.id not in has_pred]
    return roots or ops


def _anchor_note(order: ProductionOrder) -> str:
    return "%s приоритетного заказа %s [anchor:%s]" % (
        ANCHOR_NOTE_PREFIX, (order.ext_id or str(order.id)[:8]), order.id,
    )


async def _clear_anchor_pins(db: AsyncSession, tenant_id, order: ProductionOrder) -> int:
    ops = await _order_operations(db, tenant_id, await _chain_order_ids(db, tenant_id, order))
    ids = [o.id for o in ops]
    if not ids:
        return 0
    pins = (await db.execute(
        select(OperationPin).where(
            OperationPin.tenant_id == tenant_id,
            OperationPin.operation_id.in_(ids),
            OperationPin.note.like(ANCHOR_NOTE_PREFIX + "%"),
        )
    )).scalars().all()
    for pin in pins:
        await db.delete(pin)
    return len(pins)


async def _apply_anchor_pins(db: AsyncSession, tenant_id, order: ProductionOrder, anchor_at, roots: list) -> int:
    created = 0
    note = _anchor_note(order)
    for op in roots:
        pin = (await db.execute(
            select(OperationPin).where(
                OperationPin.tenant_id == tenant_id,
                OperationPin.operation_id == op.id,
                OperationPin.note.like(ANCHOR_NOTE_PREFIX + "%"),
            )
        )).scalars().first()
        if pin:
            pin.pin_at = anchor_at
            pin.pin_type = "start_not_earlier"
            pin.is_hard = True
            pin.note = note
        else:
            db.add(OperationPin(
                id=uuid4(), tenant_id=tenant_id, project_id=order.project_id,
                operation_id=op.id, group_id=order.group_id,
                pin_type="start_not_earlier", pin_at=anchor_at, is_hard=True, note=note,
            ))
            created += 1
    return created


async def _apply_anchor(db: AsyncSession, tenant_id, order: ProductionOrder, anchor_at) -> tuple:
    """Ставит или снимает якорь заказа вместе с закреплениями. Возвращает (число закреплений, предупреждения)."""
    warnings: list = []
    await _clear_anchor_pins(db, tenant_id, order)
    if anchor_at is None:
        order.priority_anchor_at = None
        return 0, warnings
    order.priority_anchor_at = anchor_at
    roots = await _order_root_operations(db, tenant_id, await _chain_order_ids(db, tenant_id, order))
    if not roots:
        warnings.append("В цепочке заказа нет операций — якорь сохранён, но закрепление в расчёте не создано.")
        return 0, warnings
    created = await _apply_anchor_pins(db, tenant_id, order, anchor_at, roots)
    return len(roots), warnings


def _parse_dt(value):
    """Разбор даты-времени из ответа расчёта: сравнение идёт по «настенным» часам."""
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value))
    except Exception:
        return None
    if d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    return d


async def _settings_for_order(db: AsyncSession, tenant_id, order: ProductionOrder) -> dict:
    from app.services.planning_settings import resolve_settings
    try:
        res = await resolve_settings(db, tenant_id, order.project_id, pool_id=order.pool_id)
        return {k: v.get("value") for k, v in (res.get("values") or {}).items()}
    except Exception:
        return {}


async def _schedule_snapshot(db: AsyncSession, tenant_id, project_id) -> Optional[dict]:
    """Компактный снимок календарного плана: по заказам — ранний старт и поздний финиш."""
    from app.routers.calculations import run_schedule
    try:
        res = await run_schedule(project_id=project_id, body=None, db=db, tenant_id=tenant_id)
    except Exception:
        return None
    ops = (await db.execute(
        select(Operation).where(
            Operation.tenant_id == tenant_id, Operation.project_id == project_id,
        )
    )).scalars().all()
    op_to_order = {o.id: o.order_id for o in ops}
    per_order: dict = {}
    for node in (res or {}).get("nodes", []):
        # узел расчёта отдаёт order_id напрямую; иначе связываем через операцию
        ord_id = None
        raw_ord = node.get("order_id")
        if raw_ord:
            try:
                ord_id = UUID(str(raw_ord))
            except Exception:
                ord_id = None
        if ord_id is None:
            raw_op = node.get("operation_id") or node.get("id")
            if raw_op:
                try:
                    ord_id = op_to_order.get(UUID(str(raw_op)))
                except Exception:
                    ord_id = None
        if not ord_id:
            continue
        key = str(ord_id)
        cur = per_order.setdefault(key, {"start": None, "finish": None, "operations": 0})
        st_dt, fn_dt = _parse_dt(node.get("start_datetime")), _parse_dt(node.get("finish_datetime"))
        if st_dt and (cur["start"] is None or st_dt < cur["start"]):
            cur["start"] = st_dt
        if fn_dt and (cur["finish"] is None or fn_dt > cur["finish"]):
            cur["finish"] = fn_dt
        cur["operations"] += 1
    for v in per_order.values():
        v["start"] = v["start"].isoformat(timespec="minutes") if v["start"] else None
        v["finish"] = v["finish"].isoformat(timespec="minutes") if v["finish"] else None
    return {
        "project_finish_date": (res or {}).get("project_finish_date"),
        "project_duration_days": (res or {}).get("total_duration_days"),
        "orders": per_order,
        "warnings": [w.get("message") for w in (res or {}).get("warnings", [])][:8],
    }


def _ghost(before: Optional[dict], after: Optional[dict], ext_by_order: Optional[dict] = None) -> dict:
    """«Призрак»: что именно сдвинулось после установки или снятия якоря."""
    if not after:
        return {"available": False, "rows": [], "note": "Календарный расчёт недоступен — «призрак» не построен."}
    rows = []
    for oid, a in (after.get("orders") or {}).items():
        b = ((before or {}).get("orders") or {}).get(oid) or {}
        if not b:
            continue
        bs, as_ = _parse_dt(b.get("start")), _parse_dt(a.get("start"))
        bf, af = _parse_dt(b.get("finish")), _parse_dt(a.get("finish"))
        start_delta = round((as_ - bs).total_seconds() / 86400.0, 2) if (bs and as_) else None
        finish_delta = round((af - bf).total_seconds() / 86400.0, 2) if (bf and af) else None
        # у заказа может сдвинуться только финиш (старт держат предшественники)
        if (start_delta in (None, 0)) and (finish_delta in (None, 0)):
            continue
        use_finish = (start_delta in (None, 0)) and (finish_delta not in (None, 0))
        rows.append({
            "order_id": oid,
            "order_ext_id": (ext_by_order or {}).get(oid),
            "basis": "finish" if use_finish else "start",
            "delta_days": finish_delta if use_finish else start_delta,
            "before_start": b.get("start"),
            "after_start": a.get("start"),
            "before_finish": b.get("finish"),
            "after_finish": a.get("finish"),
            "before_point": b.get("finish") if use_finish else b.get("start"),
            "after_point": a.get("finish") if use_finish else a.get("start"),
        })
    rows.sort(key=lambda r: -abs(r.get("delta_days") or 0))
    finish_before = (before or {}).get("project_finish_date")
    finish_after = after.get("project_finish_date")
    fb, fa = _parse_dt(finish_before), _parse_dt(finish_after)
    return {
        "available": True,
        "rows": rows[:12],
        "shifted": len(rows),
        "project_finish_before": finish_before,
        "project_finish_after": finish_after,
        "project_finish_delta_days": (round((fa - fb).total_seconds() / 86400.0, 2) if (fb and fa) else None),
    }


async def _log_shift(db: AsyncSession, tenant_id, order: ProductionOrder, action: str, payload: dict, note=None) -> None:
    db.add(GroupShiftLog(
        id=uuid4(), tenant_id=tenant_id, project_id=order.project_id,
        group_id=order.group_id, action=action, payload=payload, note=note,
    ))


@router.get("/{order_id}/anchor")
async def get_order_anchor(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Состояние якоря старта: значение, наследование, закрепления и журнал по заказу."""
    order = await _get_order_or_404(db, tenant_id, order_id)
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    by_id[order.id] = order
    a_st = resolve_anchor(order, by_id)
    ops = await _order_operations(db, tenant_id, await _chain_order_ids(db, tenant_id, order))
    ids = [o.id for o in ops]
    pins = []
    if ids:
        rows = (await db.execute(
            select(OperationPin).where(
                OperationPin.tenant_id == tenant_id,
                OperationPin.operation_id.in_(ids),
                OperationPin.note.like(ANCHOR_NOTE_PREFIX + "%"),
            )
        )).scalars().all()
        pins = [{"id": str(p.id), "operation_id": str(p.operation_id), "pin_at": p.pin_at.isoformat(),
                 "pin_type": p.pin_type, "is_hard": p.is_hard} for p in rows]
    log_rows = (await db.execute(
        select(GroupShiftLog).where(
            GroupShiftLog.tenant_id == tenant_id,
            GroupShiftLog.project_id == order.project_id,
        ).order_by(GroupShiftLog.created_at.desc()).limit(200)
    )).scalars().all()
    journal = [
        {"id": str(e.id), "action": e.action, "created_at": e.created_at,
         "before_anchor": (e.payload or {}).get("before_anchor"),
         "after_anchor": (e.payload or {}).get("after_anchor"),
         "restored_from": (e.payload or {}).get("restored_from"),
         "note": e.note}
        for e in log_rows if (e.payload or {}).get("order_id") == str(order.id)
    ][:10]
    return {
        "order": _order_to_out(order, by_id, children),
        "anchor": {
            "own": a_st["own"], "effective": a_st["effective"], "inherited": a_st["inherited"],
            "locked": a_st["locked"], "reason": a_st["reason"],
            "source_ext_id": (a_st["source"].ext_id if a_st["source"] is not None else None),
        },
        "operations_total": len(ops),
        "pins": pins,
        "journal": journal,
    }


@router.put("/{order_id}/anchor")
async def set_order_anchor(
    order_id: str,
    body: OrderAnchorRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Задать (или снять, передав null) якорь старта приоритетного заказа.

    Якорь превращается в жёсткое закрепление первых операций заказа, поэтому
    календарный расчёт обязан его соблюсти, а зависимые заказы сдвигаются.
    Возвращает «призрак» — какой заказ насколько сдвинулся.
    """
    order = await _get_order_or_404(db, tenant_id, order_id)
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    by_id[order.id] = order

    p_st = resolve_priority(order, by_id)
    if not p_st["effective"]:
        raise HTTPException(400, "Якорь старта задаётся только приоритетному заказу — сначала отметьте заказ приоритетным")
    a_st = resolve_anchor(order, by_id)
    if a_st["locked"]:
        raise HTTPException(409, a_st["reason"] or "Якорь наследуется от заказа-родителя")

    anchor_at = body.anchor_at
    if anchor_at is not None:
        anchor_at = anchor_at.replace(tzinfo=None, microsecond=0)   # «настенное» время предприятия, как у закреплений

    settings = await _settings_for_order(db, tenant_id, order)
    keep_before_after = bool(settings.get("priority_orders.keep_before_after", True))
    shift_dependents = bool(settings.get("priority_orders.shift_dependents", True))
    allow_before = bool(settings.get("priority_orders.allow_start_before_predecessors", True))
    mode_on = bool(settings.get("priority_orders.enabled", False))

    warnings: list = []
    before_anchor = a_st["effective"]

    snap_before = await _schedule_snapshot(db, tenant_id, order.project_id) if keep_before_after else None

    if anchor_at is not None and not allow_before and snap_before:
        cur = (snap_before.get("orders") or {}).get(str(order.id)) or {}
        planned_start = _parse_dt(cur.get("start"))
        if planned_start and anchor_at < planned_start:
            raise HTTPException(
                409,
                "Якорь раньше расчётного старта заказа — предшественники не успевают. "
                "Разрешите старт раньше предшественников в настройках «Приоритетные заказы».",
            )

    pins_count, warns = await _apply_anchor(db, tenant_id, order, anchor_at)
    warnings.extend(warns)
    if anchor_at is not None and not mode_on:
        warnings.append("Режим «Использование приоритетных заказов» выключен в настройках — якорь сохранён и закрепления поставлены.")
    await db.flush()

    snap_after = await _schedule_snapshot(db, tenant_id, order.project_id) if keep_before_after else None
    ext_by_order = {str(o.id): o.ext_id for o in by_id.values()}
    if keep_before_after:
        ghost = _ghost(snap_before, snap_after, ext_by_order)
        if not shift_dependents:
            ghost = dict(ghost)
            ghost["note"] = "Сдвиг зависимых заказов выключен в настройках — сдвиги показаны справочно."
    else:
        ghost = {"available": False, "rows": [], "note": "Хранение плана «до/после» выключено в настройках проекта."}

    await _log_shift(db, tenant_id, order, "anchor" if anchor_at else "unanchor", {
        "order_id": str(order.id),
        "order_ext_id": order.ext_id,
        "before_anchor": before_anchor.isoformat(timespec="minutes") if before_anchor else None,
        "after_anchor": anchor_at.isoformat(timespec="minutes") if anchor_at else None,
        "pinned_operations": pins_count,
        "shift_dependents": shift_dependents,
        "ghost": ghost if keep_before_after else None,
    }, note=body.note)
    await db.commit()
    await db.refresh(order)

    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return {
        "ok": True,
        "order": _order_to_out(order, by_id, children),
        "anchor_effective": anchor_at.isoformat(timespec="minutes") if anchor_at else None,
        "pinned_operations": pins_count,
        "ghost": ghost,
        "warnings": warnings,
    }


@router.post("/{order_id}/anchor/rollback")
async def rollback_order_anchor(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Откат последнего изменения якоря: возвращает значение, которое было до него."""
    order = await _get_order_or_404(db, tenant_id, order_id)
    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    by_id[order.id] = order

    rows = (await db.execute(
        select(GroupShiftLog).where(
            GroupShiftLog.tenant_id == tenant_id,
            GroupShiftLog.project_id == order.project_id,
        ).order_by(GroupShiftLog.created_at.desc()).limit(200)
    )).scalars().all()
    entry = next((e for e in rows
                  if (e.payload or {}).get("order_id") == str(order.id)
                  and e.action in ("anchor", "unanchor")), None)
    if not entry:
        raise HTTPException(404, "В журнале нет изменений якоря по этому заказу")

    target_raw = (entry.payload or {}).get("before_anchor")
    target = datetime.fromisoformat(target_raw).replace(tzinfo=None) if target_raw else None
    settings = await _settings_for_order(db, tenant_id, order)
    keep_before_after = bool(settings.get("priority_orders.keep_before_after", True))

    snap_before = await _schedule_snapshot(db, tenant_id, order.project_id) if keep_before_after else None
    pins_count, warns = await _apply_anchor(db, tenant_id, order, target)
    await db.flush()
    snap_after = await _schedule_snapshot(db, tenant_id, order.project_id) if keep_before_after else None
    ghost = _ghost(snap_before, snap_after, {str(o.id): o.ext_id for o in by_id.values()}) if keep_before_after else {
        "available": False, "rows": [], "note": "Хранение плана «до/после» выключено в настройках проекта."}

    await _log_shift(db, tenant_id, order, "rollback", {
        "order_id": str(order.id),
        "order_ext_id": order.ext_id,
        "restored_from": str(entry.id),
        "before_anchor": (entry.payload or {}).get("after_anchor"),
        "after_anchor": target_raw,
        "pinned_operations": pins_count,
        "ghost": ghost if keep_before_after else None,
    })
    await db.commit()
    await db.refresh(order)

    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return {
        "ok": True,
        "order": _order_to_out(order, by_id, children),
        "anchor_effective": target.isoformat(timespec="minutes") if target else None,
        "restored_from": str(entry.id),
        "ghost": ghost,
        "warnings": warns,
    }

# ── Конфликты приоритетного заказа на общих ресурсах ──────────
#
# Шаг 3 блока 6.5: «приоритет по общим ресурсам» и «окно конфликта».
# Конфликт — пересечение по времени операций разных заказов на одном ресурсе.
# Автоматически ничего не разрешается: система показывает вариант по умолчанию
# и четыре действия, из которых первое — предложение.

CONFLICT_PIN_PREFIX = "Вытеснение приоритетным заказом"


async def _conflicts_for(db: AsyncSession, tenant_id, order: ProductionOrder) -> tuple:
    """(данные конфликтов, настройки заказа)."""
    from app.services.priority_conflicts import find_conflicts
    settings = await _settings_for_order(db, tenant_id, order)
    data = await find_conflicts(db, tenant_id, order, settings)
    return data, settings


@router.get("/{order_id}/conflicts")
async def get_order_conflicts(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Конфликты приоритетного заказа с другими заказами на общих ресурсах."""
    order = await _get_order_or_404(db, tenant_id, order_id)
    by_id, _children = await _load_chain(db, tenant_id, order.project_id)
    by_id[order.id] = order
    p_st = resolve_priority(order, by_id)
    if not p_st["effective"]:
        raise HTTPException(400, "Конфликты считаются для приоритетного заказа — сначала отметьте заказ приоритетным")

    data, _settings = await _conflicts_for(db, tenant_id, order)

    # какие конфликты уже разрешены вытеснением (есть закрепление «вытеснения»)
    ops = await _order_operations(db, tenant_id, await _chain_order_ids(db, tenant_id, order))
    op_ids = [o.id for o in ops]
    resolved = set()
    if op_ids:
        rows = (await db.execute(
            select(OperationPin).where(
                OperationPin.tenant_id == tenant_id,
                OperationPin.note.like(CONFLICT_PIN_PREFIX + "%"),
            )
        )).scalars().all()
        for pin in rows:
            note = pin.note or ""
            if "[conflict:" in note:
                resolved.add(note.split("[conflict:", 1)[1].rstrip("]"))
    for c in data.get("conflicts", []):
        c["resolved"] = c["id"] in resolved
    if data.get("summary") is not None:
        data["summary"]["resolved"] = sum(1 for c in data.get("conflicts", []) if c.get("resolved"))
    return data


@router.post("/{order_id}/conflicts/resolve")
async def resolve_order_conflict(
    order_id: str,
    body: ConflictResolveRequest,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Применить решение по конфликту (окно конфликта).

    Действия: сдвинуть операцию другого заказа, сдвинуть якорь приоритетного
    заказа, разрешить частичное переплетение, снять признак приоритетного заказа.
    Автоматически не разрешается ничего — действие приходит от человека.
    """
    order = await _get_order_or_404(db, tenant_id, order_id)
    by_id, _children = await _load_chain(db, tenant_id, order.project_id)
    by_id[order.id] = order
    p_st = resolve_priority(order, by_id)
    if not p_st["effective"]:
        raise HTTPException(400, "Конфликты считаются для приоритетного заказа")

    if body.action not in ("shift_other", "shift_anchor", "interleave", "unpriority"):
        raise HTTPException(400, "action должен быть shift_other, shift_anchor, interleave или unpriority")

    data, settings = await _conflicts_for(db, tenant_id, order)
    conflict = next((c for c in data.get("conflicts", []) if c["id"] == body.conflict_id), None)
    if not conflict:
        raise HTTPException(404, "Конфликт не найден — возможно, он уже разрешён или план изменился")

    keep_before_after = bool(settings.get("priority_orders.keep_before_after", True))
    ext_by_order = {str(o.id): o.ext_id for o in by_id.values()}
    warnings: list = []
    notes: list = []
    interleave_plan = None
    snap_before = await _schedule_snapshot(db, tenant_id, order.project_id) if keep_before_after else None

    if body.action == "shift_other":
        other_op_id = conflict["other_operation"]["operation_id"]
        finish_at = _parse_dt(conflict["priority_operation"]["finish"])
        if not finish_at:
            raise HTTPException(400, "Не удалось определить финиш операции приоритетного заказа")
        other_op = await db.get(Operation, UUID(other_op_id))
        if not other_op:
            raise HTTPException(404, "Операция другого заказа не найдена")
        note = "%s %s [conflict:%s]" % (CONFLICT_PIN_PREFIX, (order.ext_id or str(order.id)[:8]), body.conflict_id)
        pin = (await db.execute(
            select(OperationPin).where(
                OperationPin.tenant_id == tenant_id,
                OperationPin.operation_id == other_op.id,
                OperationPin.note.like(CONFLICT_PIN_PREFIX + "%"),
            )
        )).scalars().first()
        if pin:
            pin.pin_at = finish_at
            pin.pin_type = "start_not_earlier"
            pin.is_hard = True
            pin.note = note
        else:
            db.add(OperationPin(
                id=uuid4(), tenant_id=tenant_id, project_id=order.project_id,
                operation_id=other_op.id, group_id=order.group_id,
                pin_type="start_not_earlier", pin_at=finish_at, is_hard=True, note=note,
            ))
        warnings.append("Операция другого заказа сдвинута за приоритетную: она начнётся не раньше %s." %
                        finish_at.isoformat(timespec="minutes"))

    elif body.action == "shift_anchor":
        anchor_at = body.anchor_at
        if anchor_at is None:
            raise HTTPException(400, "Для действия «сдвинуть якорь» нужна дата и время (anchor_at)")
        anchor_at = anchor_at.replace(tzinfo=None, microsecond=0)
        a_st = resolve_anchor(order, by_id)
        if a_st["locked"]:
            raise HTTPException(409, a_st["reason"] or "Якорь наследуется от заказа-родителя")
        pins_count, warns = await _apply_anchor(db, tenant_id, order, anchor_at)
        warnings.extend(warns)

    elif body.action == "interleave":
        from app.services.interleave import build_interleave_plan
        other_op_obj = await db.get(Operation, UUID(conflict["other_operation"]["operation_id"]))
        p_start = _parse_dt(conflict["priority_operation"]["start"])
        p_finish = _parse_dt(conflict["priority_operation"]["finish"])
        o_start = _parse_dt(conflict["other_operation"]["start"])
        o_finish = _parse_dt(conflict["other_operation"]["finish"])
        if not (p_start and p_finish and o_start and o_finish):
            raise HTTPException(400, "Не удалось определить интервалы операций для переплетения")
        other_hours = (o_finish - o_start).total_seconds() / 3600.0
        setup = float(getattr(other_op_obj, "setup_time", 0) or 0) if other_op_obj else 0.0
        plan = build_interleave_plan(
            {"name": conflict["priority_operation"]["name"], "start": p_start, "finish": p_finish,
             "hours": (p_finish - p_start).total_seconds() / 3600.0},
            {"name": conflict["other_operation"]["name"], "start": o_start, "finish": o_finish,
             "hours": other_hours},
            settings, setup_hours=setup,
        )
        if not plan.get("ok"):
            raise HTTPException(400, plan.get("refusal") or "Переплетение невозможно")
        interleave_plan = plan
        warnings.extend(plan.get("warnings") or [])
        notes.append(plan.get("note") or "")
        # согласованная раскладка: чужую операцию не пускаем раньше её первого участка
        first_start = plan.get("summary", {}).get("first_inferior_start")
        if other_op_obj and first_start:
            first_at = _parse_dt(first_start)
            note = "Переплетение с приоритетным заказом %s [conflict:%s]" % (
                (order.ext_id or str(order.id)[:8]), body.conflict_id)
            pin = (await db.execute(
                select(OperationPin).where(
                    OperationPin.tenant_id == tenant_id,
                    OperationPin.operation_id == other_op_obj.id,
                    OperationPin.note.like("Переплетение%"),
                )
            )).scalars().first()
            if pin:
                pin.pin_at = first_at
                pin.pin_type = "start_not_earlier"
                pin.is_hard = True
                pin.note = note
            else:
                db.add(OperationPin(
                    id=uuid4(), tenant_id=tenant_id, project_id=order.project_id,
                    operation_id=other_op_obj.id, group_id=order.group_id,
                    pin_type="start_not_earlier", pin_at=first_at, is_hard=True, note=note,
                ))

    else:  # unpriority
        if p_st["locked"]:
            raise HTTPException(409, "Признак задан родительским заказом — снимать нужно у родителя")
        order.is_priority = False
        await _apply_anchor(db, tenant_id, order, None)
        notes.append("Признак приоритетного заказа снят, якорь старта очищен.")

    await db.flush()
    snap_after = await _schedule_snapshot(db, tenant_id, order.project_id) if keep_before_after else None
    ghost = (_ghost(snap_before, snap_after, ext_by_order) if keep_before_after
             else {"available": False, "rows": [], "note": "Хранение плана «до/после» выключено в настройках проекта."})

    await _log_shift(db, tenant_id, order, "conflict", {
        "order_id": str(order.id),
        "order_ext_id": order.ext_id,
        "conflict_id": body.conflict_id,
        "action": body.action,
        "resource_name": conflict.get("resource_name"),
        "other_order_ext_id": conflict["other_operation"].get("order_ext_id"),
        "interleave_plan": interleave_plan,
        "ghost": ghost if keep_before_after else None,
    }, note=body.note)
    await db.commit()
    await db.refresh(order)

    by_id, children = await _load_chain(db, tenant_id, order.project_id)
    return {
        "ok": True,
        "action": body.action,
        "conflict_id": body.conflict_id,
        "order": _order_to_out(order, by_id, children),
        "interleave_plan": interleave_plan,
        "ghost": ghost,
        "warnings": warnings,
        "notes": notes,
    }
