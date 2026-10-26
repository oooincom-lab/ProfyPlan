"""
CRUD-роутер для проектов.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.project import Project
from app.models.production_order import ProductionOrder
from app.models.operation import Operation, OperationResource
from app.models.department import Department
from app.models.resource import Resource
from app.models.calculation_run import CalculationRun
from app.models.plan_snapshot import PlanSnapshot, PlanSnapshotRow
from app.models.plan_version import InterProjectDependency
from app.models.tenant import User
from app.schemas.project import ProjectCreate, ProjectList, ProjectMove, ProjectOut, ProjectUpdate
from app.services.edit_policy import require_imported_editable

MAX_PROJECT_DEPTH = 6


async def _project_depth(db: AsyncSession, tenant_id: UUID, project_id: UUID) -> int:
    """Глубина проекта от корня (корень = 1)."""
    depth = 1
    cur = project_id
    seen = set()
    while True:
        if cur in seen or depth > 50:
            break
        seen.add(cur)
        res = await db.execute(select(Project).where(Project.id == cur, Project.tenant_id == tenant_id))
        pr = res.scalar_one_or_none()
        if not pr or not pr.parent_id:
            break
        cur = pr.parent_id
        depth += 1
    return depth


async def _subtree_height(db: AsyncSession, tenant_id: UUID, root_id: UUID) -> int:
    """Высота поддерева (только вершина = 1)."""
    res = await db.execute(select(Project.id, Project.parent_id).where(Project.tenant_id == tenant_id))
    rows = res.all()
    children: dict = {}
    for cid, pid in rows:
        if pid:
            children.setdefault(pid, []).append(cid)
    best = 0
    stack = [(root_id, 1)]
    seen = set()
    while stack:
        pid, d = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        best = max(best, d)
        for ch in children.get(pid, []):
            stack.append((ch, d + 1))
    return best or 1


async def _is_descendant(db: AsyncSession, tenant_id: UUID, maybe_child: UUID, ancestor: UUID) -> bool:
    cur = maybe_child
    seen = set()
    while cur and cur not in seen:
        seen.add(cur)
        if cur == ancestor:
            return True
        res = await db.execute(select(Project.parent_id).where(Project.id == cur, Project.tenant_id == tenant_id))
        cur = res.scalar_one_or_none()
    return False




async def _attach_start_checks(db: AsyncSession, tenant_id: UUID, projects: list) -> None:
    """Проставляет проектам проверку даты старта (без N+1 по одному).

    start_issue:
      missing — дата старта не задана;
      late    — дата старта позже первого заказа/операции на start_issue_days дней.
    """
    if not projects:
        return
    ids = [p.id for p in projects]
    order_min = {
        pid: d0
        for pid, d0 in (await db.execute(
            select(ProductionOrder.project_id, func.min(ProductionOrder.start_date))
            .where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.project_id.in_(ids),
                ProductionOrder.start_date.isnot(None),
            )
            .group_by(ProductionOrder.project_id)
        )).all()
    }
    # операции из снимков плана — резервный источник, если заказов нет
    snap_min = {
        pid: d0
        for pid, d0 in (await db.execute(
            select(PlanSnapshot.project_id, func.min(PlanSnapshotRow.start_datetime))
            .join(PlanSnapshotRow, PlanSnapshotRow.snapshot_id == PlanSnapshot.id)
            .where(PlanSnapshot.tenant_id == tenant_id, PlanSnapshot.project_id.in_(ids))
            .group_by(PlanSnapshot.project_id)
        )).all()
    }
    for p in projects:
        o = order_min.get(p.id)
        s0 = snap_min.get(p.id)
        cand = o or (s0.date() if s0 else None)
        src = "orders" if o else ("plan" if s0 else None)
        issue = None
        days = None
        if getattr(p, "start_date", None) is None:
            issue = "missing"
        elif cand is not None:
            ps = p.start_date.date() if hasattr(p.start_date, "date") else p.start_date
            if ps > cand:
                issue = "late"
                days = (ps - cand).days
        p.earliest_start = cand
        p.earliest_start_source = src
        p.start_issue = issue
        p.start_issue_days = days

router = APIRouter(prefix="/v1/projects", tags=["projects"])


@router.get("", response_model=ProjectList)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status_filter: str = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Список проектов с пагинацией и фильтром по статусу."""
    query = select(Project).where(Project.tenant_id == tenant_id)
    count_query = select(func.count(Project.id)).where(Project.tenant_id == tenant_id)

    if status_filter:
        query = query.where(Project.status == status_filter)
        count_query = count_query.where(Project.status == status_filter)

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(
        query.order_by(Project.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    projects = result.scalars().all()
    await _attach_start_checks(db, tenant_id, list(projects))

    return ProjectList(
        items=[ProjectOut.model_validate(p) for p in projects],
        total=total,
        page=page,
        page_size=page_size,
    )


def _axes_from_method(method: str) -> tuple[str, str]:
    """Логика планирования и модель оценки из строки default_method.

    Нужно для совместимости: старые записи и клиенты знают только одну строку.
    """
    method = (method or "cpm").lower()
    logic = "ccm" if "ccm" in method else "cpm"
    analysis = "pert" if "pert" in method else ("mc" if "mc" in method else "none")
    return logic, analysis


def _method_from_axes(logic: str, analysis: str) -> str:
    """Строка default_method из двух осей — держим совместимое поле в согласии."""
    if analysis == "pert":
        return "pert_ccm" if logic == "ccm" else "pert_cpm"
    return "cpm_ccm" if logic == "ccm" else "cpm"


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Создать новый проект."""
    # Оси расчёта (блок 6.16.7): если заданы явно — они источник истины,
    # иначе выводим их из default_method; совместимая строка всегда согласована с осями.
    # Иерархия (A): валидация родителя и глубины
    if body.parent_id:
        pres = await db.execute(
            select(Project).where(Project.id == body.parent_id, Project.tenant_id == tenant_id)
        )
        parent = pres.scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=400, detail="Родительский проект не найден")
        if await _project_depth(db, tenant_id, parent.id) + 1 > MAX_PROJECT_DEPTH:
            raise HTTPException(status_code=400, detail=f"Максимальная глубина иерархии — {MAX_PROJECT_DEPTH}")

    logic, analysis = _axes_from_method(body.default_method)
    if body.planning_logic:
        logic = body.planning_logic
    if body.uncertainty_analysis:
        analysis = body.uncertainty_analysis

    project = Project(
        tenant_id=tenant_id,
        parent_id=body.parent_id,
        sort_order=body.sort_order or 0,
        name=body.name,
        description=body.description,
        mode=body.mode,
        default_method=_method_from_axes(logic, analysis),
        planning_logic=logic,
        uncertainty_analysis=analysis,
        monte_carlo_runs=body.monte_carlo_runs if body.monte_carlo_runs is not None else 10000,
        confidence_level=body.confidence_level if body.confidence_level is not None else 0.8,
        use_history=bool(body.use_history) if body.use_history is not None else False,
        country_code=body.country_code,
        start_date=body.start_date,
        priority=getattr(body, 'priority', None) or 'normal',
        created_by=user.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return ProjectOut.model_validate(project)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Получить проект по ID."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == tenant_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await _attach_start_checks(db, tenant_id, [project])
    return ProjectOut.model_validate(project)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Обновить проект."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == tenant_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await require_imported_editable(db, tenant_id, project)

    update_data = body.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] != project.name:
        project.name_overridden = True
    for key, value in update_data.items():
        setattr(project, key, value)

    # Оси расчёта и совместимая строка держатся в согласии (блок 6.16.7):
    # изменили оси — пересчитываем строку; изменили строку — разбираем её на оси.
    if "planning_logic" in update_data or "uncertainty_analysis" in update_data:
        project.default_method = _method_from_axes(project.planning_logic, project.uncertainty_analysis)
    elif "default_method" in update_data:
        project.planning_logic, project.uncertainty_analysis = _axes_from_method(project.default_method)

    await db.commit()
    await db.refresh(project)
    return ProjectOut.model_validate(project)


@router.get("/{project_id}/readiness")
async def project_readiness(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Готовность проекта к расчёту: шаги подготовки данных (чек-лист)."""
    pres = await db.execute(select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id))
    project = pres.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    orders = (await db.execute(
        select(ProductionOrder).where(ProductionOrder.tenant_id == tenant_id, ProductionOrder.project_id == project_id)
    )).scalars().all()
    total_orders = len(orders)
    drafts = len([o for o in orders if (o.status or "draft") == "draft"])

    ops = (await db.execute(
        select(Operation).where(Operation.tenant_id == tenant_id, Operation.project_id == project_id)
    )).scalars().all()
    op_ids = [o.id for o in ops]
    nondraft = {o.id for o in orders if (o.status or "draft") != "draft"}
    ops_without_dept = len([
        o for o in ops
        if o.department_id is None and (o.order_id is None or o.order_id in nondraft)
    ])
    with_res = 0
    if op_ids:
        with_res = (await db.execute(
            select(func.count(func.distinct(OperationResource.operation_id))).where(
                OperationResource.operation_id.in_(op_ids),
                OperationResource.role == "primary",
            )
        )).scalar() or 0
    ops_without_res = max(0, len(ops) - with_res)

    last_run = (await db.execute(
        select(CalculationRun).where(CalculationRun.tenant_id == tenant_id, CalculationRun.project_id == project_id)
        .order_by(CalculationRun.created_at.desc()).limit(1)
    )).scalars().first()
    snaps = (await db.execute(
        select(func.count(PlanSnapshot.id)).where(PlanSnapshot.tenant_id == tenant_id, PlanSnapshot.project_id == project_id)
    )).scalar() or 0
    deps = (await db.execute(
        select(func.count(InterProjectDependency.id)).where(
            (InterProjectDependency.source_project_id == project_id)
            | (InterProjectDependency.target_project_id == project_id)
        )
    )).scalar() or 0
    kids = (await db.execute(
        select(func.count(Project.id)).where(Project.tenant_id == tenant_id, Project.parent_id == project_id)
    )).scalar() or 0
    multi = bool(project.parent_id) or kids > 0

    items = []
    def add(iid, title, status, detail, action):
        items.append({"id": iid, "title": title, "status": status, "detail": detail, "action": action})

    if total_orders == 0:
        add("orders", "Заказы", "block", "В проекте нет заказов — расчёт невозможен", "project")
    elif drafts == total_orders:
        add("orders", "Заказы", "warn", f"Заказов: {total_orders}, все черновики — в расчёт не попадут", "project")
    elif drafts > 0:
        add("orders", "Заказы", "warn", f"Заказов: {total_orders}, черновиков: {drafts}", "project")
    else:
        add("orders", "Заказы", "ok", f"Заказов: {total_orders}", "project")

    if len(ops) == 0:
        add("structure", "Структура", "block", "Операций нет — разверните заказы по маршрутам" if total_orders else "Нет заказов и операций", "project")
    elif ops_without_dept > 0:
        add("structure", "Структура", "block", f"Операций без подразделения: {ops_without_dept} — развёртка блокируется/карантин", "project")
    else:
        add("structure", "Структура", "ok", f"Операций: {len(ops)}", "project")

    if project.schedule_id:
        add("calendar", "Календарь и графики", "ok", "График проекта задан", "project")
    else:
        add("calendar", "Календарь и графики", "warn", "График проекта не задан — даты будут условными", "project")

    if len(ops) == 0:
        add("resources", "Ресурсы", "warn", "Нет операций — назначить ресурсы некому", "project")
    elif ops_without_res > 0:
        add("resources", "Ресурсы", "warn", f"Операций без primary-ресурса: {ops_without_res}", "project")
    else:
        add("resources", "Ресурсы", "ok", "Все операции с ресурсами", "project")

    if last_run is None:
        add("calculation", "Локальный расчёт", "warn", "Расчёт ещё не запускался", "project")
    else:
        add("calculation", "Локальный расчёт", "ok", "Последний расчёт: " + last_run.created_at.strftime("%d.%m.%Y %H:%M"), "project")

    if not multi:
        add("complex", "Комплекс (C)", "ok", "Один проект — связи с другими не требуются", "complex")
    elif deps == 0:
        add("complex", "Комплекс (C)", "warn", "Проект в ветке, но межпроектных связей нет", "complex")
    else:
        add("complex", "Комплекс (C)", "ok", f"Межпроектных связей: {deps}", "complex")

    # Межпроектное выравнивание: конфликты по общим ресурсам с другими проектами
    conflicts = 0
    try:
        from app.routers.ccm import _overload_rows
        rows = await _overload_rows(db, tenant_id)
        pid_s = str(project_id)
        for r in rows:
            for c in (r.get("conflicts") or []):
                if pid_s in (str(c.get("a_id")), str(c.get("b_id"))):
                    conflicts += 1
    except Exception:
        conflicts = 0
    if conflicts > 0:
        add("leveling", "Межпроектное выравнивание", "warn",
            f"Пересечений по общим ресурсам с другими проектами: {conflicts} — проверьте CCM → Выравнивание", "ccm")
    else:
        add("leveling", "Межпроектное выравнивание", "ok", "Межпроектных пересечений по ресурсам нет", "ccm")

    if snaps == 0:
        add("fixation", "Фиксация плана", "warn", "Фиксаций плана нет — нечего брать в отчёты и передавать во внешние системы", "project")
    else:
        add("fixation", "Фиксация плана", "ok", f"Фиксаций: {snaps}", "project")

    ok = len([i for i in items if i["status"] == "ok"])
    nxt = next((i["id"] for i in items if i["status"] == "block"), None) or next((i["id"] for i in items if i["status"] == "warn"), None)
    return {"project_id": str(project_id), "project_name": project.name, "score": {"ok": ok, "total": len(items)}, "next": nxt, "items": items}


@router.get("/{project_id}/resource-coverage")
async def project_resource_coverage(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Операции проекта и их покрытие ресурсами для экрана «Ресурсы операций»."""
    project = (await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    op_rows = (await db.execute(
        select(Operation, ProductionOrder.ext_id, ProductionOrder.specification_name, Department.name)
        .outerjoin(ProductionOrder, ProductionOrder.id == Operation.order_id)
        .outerjoin(Department, Department.id == Operation.department_id)
        .where(Operation.tenant_id == tenant_id, Operation.project_id == project_id)
        .order_by(Operation.order_id, Operation.position, Operation.name)
    )).all()

    op_ids = [row[0].id for row in op_rows]
    assignments: dict[str, list[dict]] = {}
    if op_ids:
        assign_rows = (await db.execute(
            select(OperationResource, Resource)
            .join(Resource, Resource.id == OperationResource.resource_id)
            .where(OperationResource.operation_id.in_(op_ids))
            .order_by(OperationResource.role, OperationResource.priority, Resource.name)
        )).all()
        for assignment, resource in assign_rows:
            assignments.setdefault(str(assignment.operation_id), []).append({
                "id": str(assignment.id),
                "resource_id": str(resource.id),
                "resource_name": resource.name,
                "resource_type": resource.resource_type,
                "role": assignment.role,
                "capacity_demand": float(assignment.capacity_demand or 0),
                "ktu": float(assignment.ktu or 1),
                "priority": assignment.priority,
            })

    items = []
    for op, order_ext_id, order_spec_name, dept_name in op_rows:
        order_name = order_ext_id or order_spec_name
        linked = assignments.get(str(op.id), [])
        primary = [x for x in linked if x["role"] == "primary"]
        if not linked:
            status = "missing"
        elif len(primary) == 0:
            status = "warning"
        elif len(primary) > 1:
            status = "multiple"
        else:
            status = "ok"
        items.append({
            "id": str(op.id),
            "name": op.name,
            "order_id": str(op.order_id) if op.order_id else None,
            "order_name": order_name,
            "department_id": str(op.department_id) if op.department_id else None,
            "department_name": dept_name,
            "duration_hours": float(op.duration_base or 0),
            "operation_type": op.operation_type or "production",
            "position": op.position,
            "status": status,
            "primary_count": len(primary),
            "resources": linked,
        })

    resources = (await db.execute(
        select(Resource)
        .where(
            Resource.tenant_id == tenant_id,
            Resource.is_active.is_(True),
            or_(
                Resource.scope == "shared",
                Resource.project_id == project_id,
                Resource.project_id.is_(None),
            ),
        )
        .order_by(Resource.name)
    )).scalars().all()

    return {
        "project_id": str(project_id),
        "project_name": project.name,
        "summary": {
            "total": len(items),
            "ok": len([i for i in items if i["status"] == "ok"]),
            "missing": len([i for i in items if i["status"] == "missing"]),
            "warning": len([i for i in items if i["status"] == "warning"]),
            "multiple": len([i for i in items if i["status"] == "multiple"]),
        },
        "items": items,
        "resources": [
            {
                "id": str(r.id),
                "name": r.name,
                "resource_type": r.resource_type,
                "scope": r.scope,
                "is_bookable": r.is_bookable,
            }
            for r in resources
        ],
    }


@router.patch("/{project_id}/move", response_model=ProjectOut)
async def move_project(
    project_id: UUID,
    body: ProjectMove,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Перемещение проекта в другую ветку (или в корень)."""
    res = await db.execute(select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id))
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.parent_id is not None:
        if body.parent_id == project_id:
            raise HTTPException(status_code=400, detail="Проект не может быть родителем самому себе")
        pres = await db.execute(select(Project).where(Project.id == body.parent_id, Project.tenant_id == tenant_id))
        parent = pres.scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=400, detail="Родительский проект не найден")
        if await _is_descendant(db, tenant_id, body.parent_id, project_id):
            raise HTTPException(status_code=400, detail="Нельзя переместить проект внутрь собственного подпроекта")
        depth = await _project_depth(db, tenant_id, body.parent_id) + 1
        height = await _subtree_height(db, tenant_id, project_id)
        if depth + height - 1 > MAX_PROJECT_DEPTH:
            raise HTTPException(status_code=400, detail=f"Максимальная глубина иерархии — {MAX_PROJECT_DEPTH}")

    project.parent_id = body.parent_id
    if body.sort_order is not None:
        project.sort_order = body.sort_order
    await db.commit()
    await db.refresh(project)
    return ProjectOut.model_validate(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Удалить проект."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == tenant_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await require_imported_editable(db, tenant_id, project)

    # Иерархия (A): проект с подпроектами удалять нельзя
    ch = await db.execute(
        select(func.count(Project.id)).where(Project.tenant_id == tenant_id, Project.parent_id == project_id)
    )
    if (ch.scalar() or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить проект с подпроектами: перенесите их или архивируйте ветку",
        )

    # События мощности проекта удаляются вместе с ним: иначе внешний ключ обнуляет
    # привязку и событие становится общим для всех проектов (12.09.2026)
    from sqlalchemy import delete as _sa_delete
    from app.models.resource_event import ResourceEvent as _RE
    await db.execute(_sa_delete(_RE).where(
        _RE.tenant_id == tenant_id,
        _RE.project_id == project_id,
    ))

    await db.delete(project)
    await db.commit()
