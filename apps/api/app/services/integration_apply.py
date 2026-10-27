"""Конвейер обработки входящей очереди обмена (срез 2, 14.10.2026).

Применяет принятые пакеты к справочникам ProfyPlan:
- nomenclature  → Номенклатура (upsert по ext_id → код → имя);
- counterparty  → Контрагенты (upsert по external_code → ИНН → имя);
- department    → Подразделения (upsert по коду → имени);
- resource      → Ресурсы (upsert по ext_id → имени);
- order         → Заказы на производство (upsert по номеру/ext_id; новые — черновиками; не-черновики не трогаем).
- project       → Проекты (только сопоставление; отсутствующие — в «пропущено» с пояснением).

Сопоставление — по внешним идентификаторам (ext_id/код), никогда по порядку; каждое
применение фиксируется в статусе элемента очереди (applied/skipped/error).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.counterparty import Counterparty
from app.models.department import Department
from app.models.employee import Employee
from app.models.execution_fact import ExecutionFact
from app.models.integration import ExchangeInboxItem
from app.models.nomenclature import Nomenclature
from app.models.organization import Organization
from app.models.operation import Operation, OperationResource
from app.models.production_order import ProductionOrder
from app.models.project import Project
from app.models.resource import Resource
from app.models.warehouse import Warehouse
from app.models.work_order import WorkOrder, WorkOrderLine, WorkOrderLineExecutor

NTYPE_MAP = {
    "запас": "material",
    "материал": "material",
    "material": "material",
    "услуга": "service",
    "работа": "service",
    "service": "service",
    "полуфабрикат": "semi_finished",
    "semi_finished": "semi_finished",
    "продукция": "product",
    "product": "product",
    "операция": "service",
}

PRIORITY_MAP = {
    "низкий": "low", "low": "low",
    "обычный": "normal", "средний": "normal", "normal": "normal",
    "высокий": "high", "high": "high",
    "критический": "critical", "critical": "critical",
}


def _s(v) -> str:
    return str(v).strip() if v is not None else ""


def _decimal(v, default: Decimal = Decimal("0")) -> Decimal:
    if v in (None, ""):
        return default
    try:
        return Decimal(str(v).replace(",", "."))
    except Exception:
        return default


def _parse_date(v):
    if v in (None, ""):
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def _parse_datetime(v):
    if v in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def _apply_sync_name(obj, name: str, version=None) -> None:
    """Обновить внешнее имя, не затирая закреплённое локальное."""
    obj.source = "1c"
    obj.external_name = name
    if version not in (None, ""):
        obj.external_revision = str(version)[:64]
    if not getattr(obj, "name_overridden", False):
        obj.name = name
        obj.external_name_ack = name


async def _apply_nomenclature(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    code = _s(f.get("code")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Nomenclature).where(Nomenclature.tenant_id == tenant_id, Nomenclature.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
        res = await db.execute(
            select(Nomenclature).where(Nomenclature.tenant_id == tenant_id, Nomenclature.ext_id == ext)
        )
        obj = res.scalars().first()
    if obj is None and code:
        res = await db.execute(
            select(Nomenclature).where(Nomenclature.tenant_id == tenant_id, Nomenclature.code == code)
        )
        obj = res.scalars().first()
    ntype = NTYPE_MAP.get(_s(f.get("type")).lower()) or NTYPE_MAP.get(_s(f.get("ntype")).lower()) or "material"
    article = _s(f.get("article")) or None
    unit = _s(f.get("unit")) or None
    if obj is not None:
        _apply_sync_name(obj, name, f.get("version"))
        if code:
            obj.code = code
        if article:
            obj.article = article
        obj.ntype = ntype
        if unit:
            obj.unit = unit
        if ext and not obj.ext_id:
            obj.ext_id = ext
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(
        Nomenclature(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=name,
            code=code,
            article=article,
            ntype=ntype,
            unit=unit,
            ext_id=ext or None,
            ext_uid=uid_s,
            source="1c",
            external_name=name,
            external_name_ack=name,
            name_overridden=False,
            external_revision=str(f.get("version")) if f.get("version") is not None else None,
        )
    )
    return "applied: создано"


async def _apply_counterparty(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    inn = _s(f.get("inn")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.external_code == ext)
        )
        obj = res.scalars().first()
    if obj is None and inn:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.inn == inn)
        )
        obj = res.scalars().first()
    if obj is None and not ext and not inn:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.name == name)
        )
        obj = res.scalars().first()
    if obj is not None:
        _apply_sync_name(obj, name, f.get("version"))
        if inn:
            obj.inn = inn
        if ext and not getattr(obj, "external_code", None):
            obj.external_code = ext
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(Counterparty(
        id=uuid.uuid4(), tenant_id=tenant_id, name=name, inn=inn,
        external_code=ext or None, ext_uid=uid_s,
        source="1c", external_name=name, external_name_ack=name,
        name_overridden=False,
        external_revision=str(f.get("version")) if f.get("version") is not None else None,
    ))
    return "applied: создано"


async def _apply_department(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    code = _s(f.get("code")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and code:
        res = await db.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.code == code)
        )
        obj = res.scalars().first()
    if obj is None:
        res = await db.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.name == name)
        )
        obj = res.scalars().first()
    if obj is not None:
        _apply_sync_name(obj, name, f.get("version"))
        if code:
            obj.code = code
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(Department(
        id=uuid.uuid4(), tenant_id=tenant_id, name=name, code=code, ext_uid=uid_s,
        source="1c", external_name=name, external_name_ack=name,
        name_overridden=False,
        external_revision=str(f.get("version")) if f.get("version") is not None else None,
    ))
    return "applied: создано"


async def _apply_warehouse(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование склада"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    code = _s(f.get("code")) or None
    organization_id = None
    organization_uid = _s(f.get("organization_uid")) or None
    if organization_uid:
        organization = (
            await db.execute(
                select(Organization).where(
                    Organization.tenant_id == tenant_id,
                    Organization.ext_uid == organization_uid,
                )
            )
        ).scalars().first()
        if organization is not None:
            organization_id = organization.id
    department_id = None
    department_uid = _s(f.get("department_uid")) or None
    if department_uid:
        department = (
            await db.execute(
                select(Department).where(
                    Department.tenant_id == tenant_id,
                    Department.ext_uid == department_uid,
                )
            )
        ).scalars().first()
        if department is not None:
            department_id = department.id

    obj = None
    if uid_s:
        obj = (
            await db.execute(
                select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.ext_uid == uid_s)
            )
        ).scalars().first()
    if obj is None and ext:
        obj = (
            await db.execute(
                select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.ext_id == ext)
            )
        ).scalars().first()
    if obj is None and code:
        obj = (
            await db.execute(
                select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.code == code)
            )
        ).scalars().first()
    if obj is None:
        obj = (
            await db.execute(
                select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.name == name)
            )
        ).scalars().first()

    if obj is not None:
        _apply_sync_name(obj, name, f.get("version"))
        if code:
            obj.code = code
        if organization_id is not None:
            obj.organization_id = organization_id
        if department_id is not None:
            obj.department_id = department_id
        obj.needs_mapping = department_id is None
        if ext and not obj.ext_id:
            obj.ext_id = ext
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"

    db.add(Warehouse(
        id=uuid.uuid4(), tenant_id=tenant_id, name=name, code=code,
        organization_id=organization_id, department_id=department_id,
        ext_id=ext, ext_uid=uid_s,
        source="1c", external_name=name, external_name_ack=name,
        name_overridden=False,
        external_revision=str(f.get("version")) if f.get("version") is not None else None,
        needs_mapping=department_id is None,
    ))
    return "applied: создано"


async def _apply_organization(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование организации"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or _s(f.get("code")) or None
    inn = _s(f.get("inn")) or None
    obj = None
    if uid_s:
        obj = (
            await db.execute(
                select(Organization).where(Organization.tenant_id == tenant_id, Organization.ext_uid == uid_s)
            )
        ).scalars().first()
    if obj is None and ext:
        obj = (
            await db.execute(
                select(Organization).where(Organization.tenant_id == tenant_id, Organization.ext_id == ext)
            )
        ).scalars().first()
    if obj is None and inn:
        obj = (
            await db.execute(
                select(Organization).where(Organization.tenant_id == tenant_id, Organization.inn == inn)
            )
        ).scalars().first()
    if obj is None:
        obj = (
            await db.execute(
                select(Organization).where(Organization.tenant_id == tenant_id, Organization.name == name)
            )
        ).scalars().first()
    if obj is not None:
        _apply_sync_name(obj, name, f.get("version"))
        if ext and not obj.ext_id:
            obj.ext_id = ext
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        if inn:
            obj.inn = inn
        return "applied: обновлено"
    db.add(Organization(
        id=uuid.uuid4(), tenant_id=tenant_id, name=name, inn=inn,
        kpp=_s(f.get("kpp")) or None, ogrn=_s(f.get("ogrn")) or None,
        ext_id=ext, ext_uid=uid_s,
        source="1c", external_name=name, external_name_ack=name,
        name_overridden=False,
        external_revision=str(f.get("version")) if f.get("version") is not None else None,
    ))
    return "applied: создано"


async def _apply_resource(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
        res = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.ext_id == ext)
        )
        obj = res.scalars().first()
    if obj is None:
        res = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.name == name)
        )
        obj = res.scalars().first()
    if obj is not None:
        _apply_sync_name(obj, name, f.get("version"))
        if ext and not obj.ext_id:
            obj.ext_id = ext
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(
        Resource(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=name,
            ext_id=ext or None,
            ext_uid=uid_s,
            source="1c",
            external_name=name,
            external_name_ack=name,
            name_overridden=False,
            external_revision=str(f.get("version")) if f.get("version") is not None else None,
            scope=f.get("scope") or "global",
            resource_type=(_s(f.get("resource_type")) or "equipment")[:20],
            capacity_per_unit=Decimal("1"),
            capacity_unit="h",
        )
    )
    return "applied: создано"


async def _apply_work_order(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    """Импорт заказ-наряда: строки работ становятся операциями проекта."""
    ext_uid = _s(uid) or None
    number = _s(f.get("number")) or _s(f.get("name")) or None
    ext_id = number or ext_uid
    if not ext_uid and not ext_id:
        return "skipped: нет UID/номера заказ-наряда"

    # Проект — только существующий; иначе строки сохраняем без операций.
    project_id = None
    puid = _s(f.get("project_uid")) or None
    pcode = _s(f.get("project_code")) or _s(f.get("project_ext_id")) or None
    pname = _s(f.get("project_name")) or _s(f.get("project")) or None
    proj = None
    if puid:
        proj = (await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_uid == puid)
        )).scalars().first()
    if proj is None and pcode:
        proj = (await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_id == pcode)
        )).scalars().first()
    if proj is None and pname:
        proj = (await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.name == pname)
        )).scalars().first()
    if proj is not None:
        project_id = proj.id

    organization_id = None
    org_uid = _s(f.get("organization_uid")) or None
    if org_uid:
        org = (await db.execute(
            select(Organization).where(
                Organization.tenant_id == tenant_id, Organization.ext_uid == org_uid
            )
        )).scalars().first()
        if org is not None:
            organization_id = org.id

    parent_order_id = None
    parent_uid = _s(f.get("parent_production_order_uid")) or _s(f.get("parent_uid")) or None
    if parent_uid:
        parent = (await db.execute(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.ext_uid == parent_uid,
            )
        )).scalars().first()
        if parent is not None:
            parent_order_id = parent.id

    wo = None
    if ext_uid:
        wo = (await db.execute(
            select(WorkOrder).where(
                WorkOrder.tenant_id == tenant_id, WorkOrder.ext_uid == ext_uid
            )
        )).scalars().first()
    if wo is None and ext_id:
        wo = (await db.execute(
            select(WorkOrder).where(
                WorkOrder.tenant_id == tenant_id, WorkOrder.ext_id == ext_id
            )
        )).scalars().first()

    if wo is None:
        wo = WorkOrder(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            ext_uid=ext_uid,
            ext_id=ext_id,
            number=number,
            source="1c",
        )
        db.add(wo)

    wo.project_id = project_id
    wo.organization_id = organization_id
    wo.parent_production_order_id = parent_order_id
    wo.pending_project_uid = None if project_id else (puid or pcode)
    wo.pending_organization_uid = None if organization_id else org_uid
    wo.pending_parent_uid = None if parent_order_id else parent_uid
    wo.number = number or wo.number
    wo.ext_uid = ext_uid or wo.ext_uid
    wo.ext_id = ext_id or wo.ext_id
    wo.doc_date = _parse_date(f.get("date") or f.get("doc_date")) or wo.doc_date
    wo.status = _s(f.get("status")) or wo.status or "draft"
    wo.description = _s(f.get("comment")) or _s(f.get("description")) or wo.description
    if f.get("version") is not None:
        wo.external_revision = str(f.get("version"))[:64]
    await db.flush()

    raw_lines = f.get("lines") or []
    for idx, line in enumerate(raw_lines):
        if not isinstance(line, dict):
            continue
        line_uid = (
            _s(line.get("line_uid"))
            or _s(line.get("uid"))
            or f"{ext_uid or ext_id}:{_s(line.get('source_line_key')) or idx + 1}"
        )
        line_obj = (await db.execute(
            select(WorkOrderLine).where(
                WorkOrderLine.work_order_id == wo.id,
                WorkOrderLine.line_uid == line_uid,
            )
        )).scalars().first()
        if line_obj is None:
            line_obj = WorkOrderLine(
                id=uuid.uuid4(), work_order_id=wo.id, line_uid=line_uid
            )
            db.add(line_obj)
        line_obj.source_line_key = _s(line.get("source_line_key")) or line_obj.source_line_key
        line_obj.nomenclature_uid = _s(line.get("nomenclature_uid")) or line_obj.nomenclature_uid
        line_obj.nomenclature_name = _s(line.get("nomenclature_name")) or line_obj.nomenclature_name
        line_obj.nomenclature_kind = _s(line.get("nomenclature_kind")).lower() or line_obj.nomenclature_kind or "work"
        line_obj.work_type_uid = _s(line.get("work_type_uid")) or line_obj.work_type_uid
        line_obj.work_type_name = _s(line.get("work_type_name")) or line_obj.work_type_name
        line_obj.quantity = _decimal(line.get("quantity"), line_obj.quantity or Decimal("1"))
        line_obj.unit = _s(line.get("unit")) or line_obj.unit
        line_obj.duration_hours = _decimal(line.get("duration_hours"), line_obj.duration_hours or Decimal("0"))
        line_obj.sequence = int(line.get("sequence") or line.get("position") or line_obj.sequence or (idx + 1) * 10)
        line_obj.position = line_obj.sequence
        line_obj.stage_uid = _s(line.get("stage_uid")) or line_obj.stage_uid
        line_obj.executor_uid = _s(line.get("executor_uid")) or line_obj.executor_uid
        line_obj.executor_type = (_s(line.get("executor_type")) or line_obj.executor_type or "").lower() or None
        line_obj.resource_uid = _s(line.get("resource_uid")) or line_obj.resource_uid
        line_obj.ktu = _decimal(line.get("ktu"), line_obj.ktu or Decimal("1"))

        dept_uid = _s(line.get("department_uid")) or None
        if dept_uid:
            dept = (await db.execute(
                select(Department).where(
                    Department.tenant_id == tenant_id,
                    (Department.ext_uid == dept_uid) | (Department.code == dept_uid),
                )
            )).scalars().first()
            if dept is not None:
                line_obj.department_id = dept.id

        # Строка заказ-наряда = операция проекта.
        if project_id:
            op_ext = f"wo:{ext_uid or ext_id}:{line_uid}"[:100]
            operation = (await db.execute(
                select(Operation).where(
                    Operation.tenant_id == tenant_id,
                    Operation.project_id == project_id,
                    Operation.ext_id == op_ext,
                )
            )).scalars().first()
            op_name = (
                _s(line.get("work_type_name"))
                or _s(line.get("nomenclature_name"))
                or _s(line.get("name"))
                or "Работа"
            )
            if operation is None:
                operation = Operation(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    project_id=project_id,
                    name=op_name,
                    duration_base=line_obj.duration_hours,
                    position=line_obj.sequence,
                    operation_type="production",
                    ext_id=op_ext,
                )
                db.add(operation)
            else:
                operation.name = op_name
                operation.duration_base = line_obj.duration_hours
                operation.position = line_obj.sequence
            operation.department_id = line_obj.department_id
            await db.flush()
            line_obj.operation_id = operation.id

            executors = line.get("executors")
            if not isinstance(executors, list):
                executors = []
            if not executors and (line_obj.executor_uid or line_obj.resource_uid):
                executors = [{
                    "executor_uid": line_obj.executor_uid,
                    "executor_type": line_obj.executor_type,
                    "resource_uid": line_obj.resource_uid,
                    "role": "primary",
                    "ktu": line_obj.ktu,
                }]

            primary_set = False
            for ex in executors:
                if not isinstance(ex, dict):
                    continue
                exec_uid = _s(ex.get("executor_uid")) or _s(ex.get("resource_uid"))
                if not exec_uid:
                    continue
                resource = (await db.execute(
                    select(Resource).where(
                        Resource.tenant_id == tenant_id,
                        Resource.is_active.is_(True),
                        (Resource.ext_uid == (_s(ex.get("resource_uid")) or exec_uid))
                        | (Resource.subject_uid == exec_uid),
                    )
                )).scalars().first()
                role = _s(ex.get("role")).lower() or ("primary" if not primary_set else "member")
                if role == "primary":
                    primary_set = True
                row = (await db.execute(
                    select(WorkOrderLineExecutor).where(
                        WorkOrderLineExecutor.work_order_line_id == line_obj.id,
                        WorkOrderLineExecutor.executor_uid == exec_uid,
                    )
                )).scalars().first()
                if row is None:
                    row = WorkOrderLineExecutor(
                        id=uuid.uuid4(), work_order_line_id=line_obj.id, executor_uid=exec_uid
                    )
                    db.add(row)
                row.executor_type = (_s(ex.get("executor_type")) or line_obj.executor_type or "employee").lower()
                row.resource_uid = _s(ex.get("resource_uid")) or line_obj.resource_uid
                row.role = role
                row.capacity_demand = _decimal(ex.get("capacity_demand"), row.capacity_demand or Decimal("1"))
                row.ktu = _decimal(ex.get("ktu"), row.ktu or line_obj.ktu or Decimal("1"))

                if resource is not None:
                    existing_primary = (await db.execute(
                        select(OperationResource).where(
                            OperationResource.operation_id == operation.id,
                            OperationResource.role == "primary",
                        )
                    )).scalars().first()
                    if role == "primary" and existing_primary is not None and existing_primary.resource_id != resource.id:
                        role = "member"
                    op_res = (await db.execute(
                        select(OperationResource).where(
                            OperationResource.operation_id == operation.id,
                            OperationResource.resource_id == resource.id,
                        )
                    )).scalars().first()
                    if op_res is None:
                        op_res = OperationResource(
                            id=uuid.uuid4(), operation_id=operation.id, resource_id=resource.id
                        )
                        db.add(op_res)
                    op_res.role = role
                    op_res.capacity_demand = row.capacity_demand
                    op_res.ktu = row.ktu

    await db.commit()
    return "applied: заказ-наряд %s" % (number or ext_uid or ext_id)


async def _apply_operation_resource(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    """Импорт записи регистра 1С «РесурсыОпераций» в OperationResource."""
    order_type = _s(f.get("order_type")).lower() or "production_order"
    order_uid = _s(f.get("order_uid")) or None
    operation_uid = _s(f.get("operation_uid")) or _s(uid) or None
    resource_uid = _s(f.get("resource_uid")) or None
    if not operation_uid or not resource_uid:
        return "skipped: нет operation_uid/resource_uid"

    operation = None
    if order_type == "work_order" and order_uid:
        wo = (await db.execute(
            select(WorkOrder).where(
                WorkOrder.tenant_id == tenant_id, WorkOrder.ext_uid == order_uid
            )
        )).scalars().first()
        if wo is not None:
            line = (await db.execute(
                select(WorkOrderLine).where(
                    WorkOrderLine.work_order_id == wo.id,
                    WorkOrderLine.line_uid == operation_uid,
                )
            )).scalars().first()
            if line is not None and line.operation_id:
                operation = await db.get(Operation, line.operation_id)
    if operation is None:
        operation = (await db.execute(
            select(Operation).where(
                Operation.tenant_id == tenant_id,
                Operation.ext_id == operation_uid,
            )
        )).scalars().first()
    if operation is None:
        try:
            operation = await db.get(Operation, UUID(operation_uid))
        except Exception:
            operation = None
    if operation is None:
        return "skipped: операция не найдена (%s)" % operation_uid

    resource = (await db.execute(
        select(Resource).where(
            Resource.tenant_id == tenant_id,
            Resource.is_active.is_(True),
            (Resource.ext_uid == resource_uid) | (Resource.subject_uid == resource_uid),
        )
    )).scalars().first()
    if resource is None:
        try:
            resource = await db.get(Resource, UUID(resource_uid))
        except Exception:
            resource = None
    if resource is None:
        return "skipped: RESOURCE_NOT_FOUND (%s)" % resource_uid

    role = _s(f.get("role")).lower() or "primary"
    if role not in ("primary", "member", "alternative", "helper"):
        return "skipped: RESOURCE_ROLE_INVALID (%s)" % role
    capacity_demand = _decimal(f.get("capacity_demand"), Decimal("1"))
    if capacity_demand <= 0:
        return "skipped: RESOURCE_CAPACITY_INVALID"
    ktu = _decimal(f.get("ktu"), Decimal("1"))
    if ktu < Decimal("0.1") or ktu > Decimal("3.0"):
        return "skipped: KTU_INVALID"

    existing = (await db.execute(
        select(OperationResource).where(OperationResource.operation_id == operation.id)
    )).scalars().all()
    op_res = next((x for x in existing if x.resource_id == resource.id), None)
    if role == "primary":
        other_primary = next(
            (x for x in existing if x.role == "primary" and x.id != (op_res.id if op_res else None)),
            None,
        )
        if other_primary is not None:
            return "skipped: RESOURCE_PRIMARY_MULTIPLE"

    if op_res is None:
        op_res = OperationResource(
            id=uuid.uuid4(), operation_id=operation.id, resource_id=resource.id
        )
        db.add(op_res)
    op_res.role = role
    op_res.capacity_demand = capacity_demand
    op_res.ktu = ktu
    op_res.planned_start = _parse_datetime(f.get("plan_start") or f.get("planned_start"))
    op_res.planned_end = _parse_datetime(f.get("plan_finish") or f.get("planned_end"))
    await db.commit()
    return "applied: связь операции с ресурсом"


async def _apply_order(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    """Приём заказа на производство из 1С: новые — черновиками; черновики обновляются; не-черновики не трогаем."""
    order_type = _s(f.get("order_type")).lower()
    if order_type == "work_order":
        return await _apply_work_order(db, tenant_id, uid, f)
    if order_type and order_type != "production_order":
        return "skipped: тип %s пока не поддержан" % order_type
    number = _s(f.get("number")) or _s(f.get("name"))
    ext = number or _s(uid)
    if not ext:
        return "skipped: нет номера заказа"
    qty_raw = f.get("quantity")
    try:
        qty = Decimal(str(qty_raw).replace(",", ".")) if qty_raw not in (None, "") else Decimal("1")
    except Exception:
        qty = Decimal("1")
    if qty <= 0:
        return "skipped: количество <= 0"
    unit = _s(f.get("unit")) or "pcs"
    start_date = _parse_date(f.get("start_date"))
    due_date = _parse_date(f.get("due_date") or f.get("date"))
    priority = PRIORITY_MAP.get(_s(f.get("priority")).lower()) or "normal"
    spec = (
        _s(f.get("specification_name"))
        or _s(f.get("specification"))
        or _s(f.get("product_name"))
        or _s(f.get("product"))
        or None
    )
    client = _s(f.get("client")) or None

    # Проект — только сопоставление (по коду/ext_id, затем по имени)
    project_id = None
    puid = _s(f.get("project_uid")) or None
    pcode = _s(f.get("project_code")) or _s(f.get("project_ext_id"))
    pname = _s(f.get("project_name")) or _s(f.get("project"))
    proj = None
    if puid:
        proj = (
            await db.execute(select(Project).where(Project.tenant_id == tenant_id, Project.ext_uid == puid))
        ).scalars().first()
    if proj is None and pcode:
        proj = (
            await db.execute(select(Project).where(Project.tenant_id == tenant_id, Project.ext_id == pcode))
        ).scalars().first()
    if proj is None and pname:
        proj = (
            await db.execute(select(Project).where(Project.tenant_id == tenant_id, Project.name == pname))
        ).scalars().first()
    if proj is not None:
        project_id = proj.id

    organization_id = None
    org_uid = _s(f.get("organization_uid")) or None
    if org_uid:
        organization = (
            await db.execute(
                select(Organization).where(Organization.tenant_id == tenant_id, Organization.ext_uid == org_uid)
            )
        ).scalars().first()
        if organization is not None:
            organization_id = organization.id

    parent_order_id = None
    parent_uid = _s(f.get("parent_uid")) or None
    if parent_uid:
        parent = (
            await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.ext_uid == parent_uid,
                )
            )
        ).scalars().first()
        if parent is not None:
            parent_order_id = parent.id

    obj = None
    uid_s = _s(uid) or None
    # Правило Дополнения №1: UID — главный ключ, номер — резервный.
    if uid_s:
        obj = (
            await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id, ProductionOrder.ext_uid == uid_s
                )
            )
        ).scalars().first()
    if obj is None and ext:
        obj = (
            await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id, ProductionOrder.ext_id == ext
                )
            )
        ).scalars().first()

    if obj is None:
        db.add(
            ProductionOrder(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                organization_id=organization_id,
                parent_order_id=parent_order_id,
                pending_project_uid=None if project_id else (puid or pcode or None),
                pending_organization_uid=None if organization_id else org_uid,
                pending_parent_uid=None if parent_order_id else parent_uid,
                ext_id=ext,
                ext_uid=(_s(uid) or None),
                specification_name=spec,
                quantity=qty,
                unit=unit,
                start_date=start_date,
                due_date=due_date,
                priority=priority,
                client=client,
                status="draft",
                notes="Импорт из 1С (интеграция)",
                source="1c",
                external_revision=str(f.get("version")) if f.get("version") is not None else None,
            )
        )
        return "applied: создан черновик" + ("" if project_id else " (без проекта — сопоставьте в системе)")

    if obj.status == "draft" and obj.exploded_at is None:
        obj.source = "1c"
        if f.get("version") is not None:
            obj.external_revision = str(f.get("version"))[:64]
        obj.quantity = qty
        obj.unit = unit
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        # Номер мог измениться в 1С; UID остаётся стабильным.
        if ext and obj.ext_uid == uid_s:
            obj.ext_id = ext
        if start_date:
            obj.start_date = start_date
        if due_date:
            obj.due_date = due_date
        obj.priority = priority
        if spec:
            obj.specification_name = spec
        if client:
            obj.client = client
        if project_id and obj.project_id is None:
            obj.project_id = project_id
        if organization_id and obj.organization_id is None:
            obj.organization_id = organization_id
        if parent_order_id and obj.parent_order_id is None:
            obj.parent_order_id = parent_order_id
        obj.pending_project_uid = None if project_id else (puid or pcode or None)
        obj.pending_organization_uid = None if organization_id else org_uid
        obj.pending_parent_uid = None if parent_order_id else parent_uid
        return "applied: обновлён черновик"

    return "skipped: заказ уже есть (не черновик) — оставлен без изменений"


async def _apply_project(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    uid_s = _s(uid) or None
    ext = _s(f.get("ext_id")) or _s(f.get("code")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
        res = await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_id == ext)
        )
        obj = res.scalars().first()
    if obj is None and name:
        res = await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.name == name)
        )
        obj = res.scalars().first()
    parent_id = None
    parent_uid = _s(f.get("parent_uid")) or None
    if parent_uid:
        parent = (
            await db.execute(
                select(Project).where(
                    Project.tenant_id == tenant_id,
                    Project.ext_uid == parent_uid,
                )
            )
        ).scalars().first()
        if parent is not None:
            parent_id = parent.id
    if obj is None:
        if not name:
            return "skipped: пустое наименование проекта"
        db.add(Project(
            id=uuid.uuid4(), tenant_id=tenant_id, name=name,
            parent_id=parent_id, status="draft", mode="quick",
            ext_id=ext, ext_uid=uid_s,
            source="1c", external_name=name, external_name_ack=name,
            name_overridden=False,
            external_revision=str(f.get("version")) if f.get("version") is not None else None,
        ))
        return "applied: создан проект"
    _apply_sync_name(obj, name, f.get("version"))
    obj.parent_id = parent_id
    if uid_s and not obj.ext_uid:
        obj.ext_uid = uid_s
    if ext:
        obj.ext_id = ext
    return "applied: обновлён проект"


async def _apply_fact(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    fact_type = _s(f.get("fact_type") or f.get("type")).lower()
    if fact_type not in (
        "production", "order_naryad_close", "receipt", "transfer",
        "work_order_close", "work_order_execution", "work_order_line",
    ):
        return "skipped: неизвестный тип факта"
    document_uid = _s(f.get("source_document_uid")) or _s(uid)
    row_uid = _s(f.get("source_row_uid")) or document_uid
    if not document_uid:
        return "skipped: нет UID документа факта"

    order = None
    order_uid = _s(f.get("order_uid")) or None
    if order_uid:
        order = (
            await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.ext_uid == order_uid,
                )
            )
        ).scalars().first()
    project_id = order.project_id if order is not None else None
    work_order = None
    work_order_uid = _s(f.get("work_order_uid")) or None
    if fact_type.startswith("work_order") or work_order_uid:
        work_order_uid = work_order_uid or order_uid
        if work_order_uid:
            work_order = (
                await db.execute(
                    select(WorkOrder).where(
                        WorkOrder.tenant_id == tenant_id,
                        WorkOrder.ext_uid == work_order_uid,
                    )
                )
            ).scalars().first()
        if work_order is not None and work_order.project_id:
            project_id = work_order.project_id
    project_uid = _s(f.get("project_uid")) or None
    if project_id is None and project_uid:
        project = (
            await db.execute(
                select(Project).where(Project.tenant_id == tenant_id, Project.ext_uid == project_uid)
            )
        ).scalars().first()
        project_id = project.id if project is not None else None

    nomenclature_id = None
    nomenclature_uid = _s(f.get("nomenclature_uid")) or None
    if nomenclature_uid:
        nomenclature = (
            await db.execute(
                select(Nomenclature).where(
                    Nomenclature.tenant_id == tenant_id, Nomenclature.ext_uid == nomenclature_uid
                )
            )
        ).scalars().first()
        nomenclature_id = nomenclature.id if nomenclature is not None else None

    warehouse_from_id = None
    warehouse_to_id = None
    for attr, key in [
        ("warehouse_from_id", "from_warehouse_uid"),
        ("warehouse_to_id", "to_warehouse_uid"),
        ("warehouse_from_id", "warehouse_uid"),
    ]:
        warehouse_uid = _s(f.get(key)) or None
        if not warehouse_uid:
            continue
        warehouse = (
            await db.execute(
                select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.ext_uid == warehouse_uid)
            )
        ).scalars().first()
        if warehouse is not None:
            if attr == "warehouse_from_id":
                warehouse_from_id = warehouse.id
            else:
                warehouse_to_id = warehouse.id

    def _decimal(value):
        try:
            return Decimal(str(value).replace(",", ".")) if value not in (None, "") else None
        except Exception:
            return None

    quantity = _decimal(f.get("quantity"))
    hours = _decimal(f.get("hours"))
    ktu = _decimal(f.get("ktu"))
    executor_type = _s(f.get("executor_type")) or None
    work_order_line_uid = (
        _s(f.get("work_order_line_uid"))
        or _s(f.get("line_uid"))
        or _s(f.get("operation_uid"))
        or None
    )
    fact_date = _parse_date(f.get("date") or f.get("fact_date"))
    status = _s(f.get("status")) or "posted"
    revision = str(f.get("version")) if f.get("version") is not None else None

    obj = (
        await db.execute(
            select(ExecutionFact).where(
                ExecutionFact.tenant_id == tenant_id,
                ExecutionFact.fact_type == fact_type,
                ExecutionFact.source_document_uid == document_uid,
                ExecutionFact.source_row_uid == row_uid,
            )
        )
    ).scalars().first()

    changed = obj is None or (
        obj.status != status
        or obj.quantity != quantity
        or obj.hours != hours
        or obj.ktu != ktu
        or obj.executor_uid != (_s(f.get("executor_uid")) or None)
        or obj.fact_date != fact_date
        or obj.external_revision != revision
    )
    if obj is None:
        obj = ExecutionFact(
            id=uuid.uuid4(), tenant_id=tenant_id, fact_type=fact_type,
            source_document_uid=document_uid, source_row_uid=row_uid,
            source="1c", external_revision=revision,
        )
        db.add(obj)
    obj.project_id = project_id
    obj.production_order_id = order.id if order is not None else None
    obj.work_order_id = work_order.id if work_order is not None else None
    obj.work_order_line_uid = work_order_line_uid
    obj.pending_project_uid = None if project_id else project_uid
    obj.pending_order_uid = None if order is not None else order_uid
    obj.operation_uid = _s(f.get("operation_uid")) or None
    obj.stage_uid = _s(f.get("stage_uid")) or None
    obj.executor_uid = _s(f.get("executor_uid")) or None
    obj.executor_type = executor_type
    obj.ktu = ktu
    obj.nomenclature_id = nomenclature_id
    obj.warehouse_from_id = warehouse_from_id
    obj.warehouse_to_id = warehouse_to_id
    obj.quantity = quantity
    obj.hours = hours
    obj.fact_date = fact_date
    obj.status = status
    if changed and project_id is not None:
        project = await db.get(Project, project_id)
        if project is not None:
            project.fact_revision += 1
            project.recalc_required = True
            project.last_fact_at = datetime.now(timezone.utc)
    return "applied: факт обновлён" if not changed else "applied: факт создан/изменён"


async def _apply_delete(db: AsyncSession, tenant_id: UUID, entity_type: str, uid: Optional[str]) -> str:
    """Мягкое удаление импортированной сущности; повторный delete — no-op."""
    uid_s = _s(uid) or None
    if not uid_s:
        return "skipped: нет UID для удаления"
    et = (entity_type or "").lower().strip()

    if et in ("project", "проект", "проекты"):
        obj = (await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_uid == uid_s)
        )).scalars().first()
        if obj is None:
            return "applied: no-op (проект уже отсутствует)"
        active = (await db.execute(
            select(func.count(ProductionOrder.id)).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.project_id == obj.id,
                ProductionOrder.status.notin_(("cancelled", "archived", "closed")),
            )
        )).scalar() or 0
        if active:
            return "skipped: DEPENDENCY_CONFLICT: активных заказов %s" % active
        obj.status = "archived"
        return "applied: проект архивирован"

    if et in ("order", "orders", "заказ", "заказы", "производственный_заказ"):
        obj = (await db.execute(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id, ProductionOrder.ext_uid == uid_s
            )
        )).scalars().first()
        if obj is None:
            return "applied: no-op (заказ уже отсутствует)"
        if obj.status not in ("cancelled", "archived", "closed"):
            obj.status = "cancelled"
            return "applied: заказ отменён (мягкое удаление)"
        return "applied: no-op (заказ уже отменён)"

    models = {
        "nomenclature": Nomenclature, "номенклатура": Nomenclature,
        "counterparty": Counterparty, "контрагент": Counterparty, "контрагенты": Counterparty,
        "department": Department, "подразделение": Department, "подразделения": Department,
        "resource": Resource, "ресурс": Resource, "ресурсы": Resource,
        "organization": Organization, "организация": Organization,
        "warehouse": Warehouse, "склад": Warehouse,
        "employee": Employee, "сотрудник": Employee,
    }
    model = models.get(et)
    if model is None:
        return "skipped: тип удаления не поддержан (%s)" % entity_type
    obj = (await db.execute(
        select(model).where(model.tenant_id == tenant_id, model.ext_uid == uid_s)
    )).scalars().first()
    if obj is None:
        return "applied: no-op (уже отсутствует)"
    if hasattr(obj, "is_active"):
        if not obj.is_active:
            return "applied: no-op (уже неактивна)"
        obj.is_active = False
        return "applied: помечено неактивным"
    return "skipped: у сущности нет признака активности"


async def _relink_pending(db: AsyncSession, tenant_id: UUID) -> None:
    """Досвязать заказы/факты, пришедшие раньше справочников."""
    orders = (await db.execute(
        select(ProductionOrder).where(ProductionOrder.tenant_id == tenant_id)
    )).scalars().all()
    for order in orders:
        if order.pending_project_uid:
            project = (await db.execute(
                select(Project).where(
                    Project.tenant_id == tenant_id, Project.ext_uid == order.pending_project_uid
                )
            )).scalars().first()
            if project is not None:
                order.project_id = project.id
                order.pending_project_uid = None
        if order.pending_organization_uid:
            organization = (await db.execute(
                select(Organization).where(
                    Organization.tenant_id == tenant_id,
                    Organization.ext_uid == order.pending_organization_uid,
                )
            )).scalars().first()
            if organization is not None:
                order.organization_id = organization.id
                order.pending_organization_uid = None
        if order.pending_parent_uid:
            parent = (await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.ext_uid == order.pending_parent_uid,
                )
            )).scalars().first()
            if parent is not None:
                order.parent_order_id = parent.id
                order.pending_parent_uid = None

    facts = (await db.execute(
        select(ExecutionFact).where(ExecutionFact.tenant_id == tenant_id)
    )).scalars().all()
    for fact in facts:
        if fact.pending_order_uid:
            order = (await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.ext_uid == fact.pending_order_uid,
                )
            )).scalars().first()
            if order is not None:
                fact.production_order_id = order.id
                if fact.project_id is None:
                    fact.project_id = order.project_id
                fact.pending_order_uid = None
        if fact.pending_project_uid:
            project = (await db.execute(
                select(Project).where(
                    Project.tenant_id == tenant_id, Project.ext_uid == fact.pending_project_uid
                )
            )).scalars().first()
            if project is not None:
                fact.project_id = project.id
                fact.pending_project_uid = None
    await db.flush()


async def apply_pending(
    db: AsyncSession, tenant_id: UUID, connection_id: Optional[UUID] = None, limit: int = 500
) -> dict:
    """Применить ожидающие элементы очереди к справочникам."""
    q = (
        select(ExchangeInboxItem)
        .where(ExchangeInboxItem.tenant_id == tenant_id, ExchangeInboxItem.status == "pending")
        .order_by(ExchangeInboxItem.created_at.asc().nullslast())
        .limit(min(max(limit, 1), 2000))
    )
    if connection_id:
        q = q.where(ExchangeInboxItem.connection_id == connection_id)
    res = await db.execute(q)
    items = res.scalars().all()

    stats = {"applied": 0, "skipped": 0, "errors": 0, "total": len(items), "details": []}
    for item in items:
        et = (item.entity_type or "").lower().strip()
        f = item.payload.get("fields") if isinstance(item.payload, dict) else {}
        f = f if isinstance(f, dict) else {}
        try:
            async with db.begin_nested():
                if (item.op or "upsert").lower() == "delete":
                    msg = await _apply_delete(db, tenant_id, et, item.entity_uid)
                elif et in ("nomenclature", "номенклатура"):
                    msg = await _apply_nomenclature(db, tenant_id, item.entity_uid, f)
                elif et in ("counterparty", "контрагент", "контрагенты"):
                    msg = await _apply_counterparty(db, tenant_id, item.entity_uid, f)
                elif et in ("department", "подразделение", "подразделения"):
                    msg = await _apply_department(db, tenant_id, item.entity_uid, f)
                elif et in ("resource", "ресурс", "ресурсы"):
                    msg = await _apply_resource(db, tenant_id, item.entity_uid, f)
                elif et == "organization":
                    msg = await _apply_organization(db, tenant_id, item.entity_uid, f)
                elif et == "warehouse":
                    msg = await _apply_warehouse(db, tenant_id, item.entity_uid, f)
                elif et in ("fact", "facts"):
                    msg = await _apply_fact(db, tenant_id, item.entity_uid, f)
                elif et in ("project", "проект", "проекты"):
                    msg = await _apply_project(db, tenant_id, item.entity_uid, f)
                elif et in ("order", "заказ", "заказы", "orders", "производственный_заказ"):
                    msg = await _apply_order(db, tenant_id, item.entity_uid, f)
                elif et in ("operation_resource", "operation-resource", "operation_resources", "ресурсы_операций"):
                    msg = await _apply_operation_resource(db, tenant_id, item.entity_uid, f)
                else:
                    msg = "skipped: тип не поддержан каркасом (%s)" % (item.entity_type or "?")
        except Exception as e:
            msg = "error: %s" % str(e)[:300]
        if msg.startswith("applied"):
            item.status = "applied"
            stats["applied"] += 1
        elif msg.startswith("skipped"):
            item.status = "skipped"
            stats["skipped"] += 1
        else:
            item.status = "error"
            stats["errors"] += 1
        stats["details"].append({"id": str(item.id), "type": item.entity_type, "result": msg})
    await _relink_pending(db, tenant_id)
    await db.commit()
    return stats
