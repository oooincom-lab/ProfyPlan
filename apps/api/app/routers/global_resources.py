"""
Глобальный справочник ресурсов (tenant-уровень, project_id = NULL).

Глобальный ресурс принадлежит всем проектам сразу; привязка к конкретному
проекту идёт через регистр ProjectResource (/v1/projects/{pid}/project-resources).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.resource import Resource
from app.schemas.resource import ResourceCreate, ResourceOut, ResourceUpdate

router = APIRouter(prefix="/v1/resources", tags=["resources-global"])


def _to_out(r: Resource, dept_names=None, sched_names=None) -> ResourceOut:
    dept_names = dept_names or {}
    sched_names = sched_names or {}
    return ResourceOut(
        id=str(r.id),
        project_id=str(r.project_id) if r.project_id else None,
        name=r.name,
        parent_id=str(r.parent_id) if r.parent_id else None,
        resource_type=r.resource_type,
        capacity_per_unit=r.capacity_per_unit,
        capacity_unit=r.capacity_unit,
        unit=r.unit,
        country_code=r.country_code,
        schedule_id=str(r.schedule_id) if r.schedule_id else None,
        scope=r.scope if getattr(r, 'scope', None) else 'shared',
        department_id=str(r.department_id) if r.department_id else None,
        department_name=dept_names.get(str(r.department_id)),
        schedule_name=sched_names.get(str(r.schedule_id)),
        usage_count=getattr(r, '_usage_count', 0) or 0,
        is_active=r.is_active,
    )


@router.get("", response_model=list[ResourceOut])
@router.get("/", response_model=list[ResourceOut])
async def list_global_resources(
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    from app.models.department import Department
    from app.models.work_schedule import WorkSchedule
    result = await db.execute(
        select(Resource)
        .where(
            Resource.tenant_id == tenant_id,
            Resource.project_id.is_(None),
        )
        .order_by(Resource.name)
    )
    rows = result.scalars().all()
    dept_ids = {r.department_id for r in rows if r.department_id}
    sched_ids = {r.schedule_id for r in rows if r.schedule_id}
    dept_names = {}
    sched_names = {}
    if dept_ids:
        dept_names = {str(d.id): d.name for d in (await db.execute(select(Department).where(Department.id.in_(dept_ids)))).scalars().all()}
    if sched_ids:
        sched_names = {str(s.id): s.name for s in (await db.execute(select(WorkSchedule).where(WorkSchedule.id.in_(sched_ids)))).scalars().all()}
    # Счётчик использования: сколько операций маршрутов ссылаются на ресурс (напрямую или через дочерний экземпляр)
    from sqlalchemy import func
    from app.models.routing import Routing, RoutingOperation
    child_map = {}
    child_rows = await db.execute(
        select(Resource).where(Resource.tenant_id == tenant_id, Resource.parent_id.isnot(None))
    )
    parent_of = {str(c.id): str(c.parent_id) for c in child_rows.scalars().all()}
    all_res_ids = [str(r.id) for r in rows] + list(parent_of.keys())
    per_rid: dict = {}
    if all_res_ids:
        cnt_rows = await db.execute(
            select(RoutingOperation.resource_type_id, func.count())
            .join(Routing, RoutingOperation.routing_id == Routing.id)
            .where(RoutingOperation.resource_type_id.in_(all_res_ids), Routing.tenant_id == tenant_id)
            .group_by(RoutingOperation.resource_type_id)
        )
        per_rid = {str(k): int(v) for k, v in cnt_rows.all()}
    for r in rows:
        gid = str(r.id)
        r._usage_count = per_rid.get(gid, 0) + sum(per_rid.get(cid, 0) for cid, p in parent_of.items() if p == gid)

    return [_to_out(r, dept_names, sched_names) for r in rows]


@router.post("", response_model=ResourceOut, status_code=status.HTTP_201_CREATED)
async def create_global_resource(
    body: ResourceCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    resource = Resource(
        tenant_id=tenant_id,
        project_id=None,
        schedule_id=UUID(body.schedule_id) if body.schedule_id else None,
        **body.model_dump(exclude={"parent_id", "schedule_id"}),
        parent_id=UUID(body.parent_id) if body.parent_id else None,
    )
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return _to_out(resource)


@router.get("/{resource_id}", response_model=ResourceOut)
async def get_global_resource(
    resource_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
            Resource.project_id.is_(None),
        )
    )
    resource = result.scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    return _to_out(resource)


@router.put("/{resource_id}", response_model=ResourceOut)
async def update_global_resource(
    resource_id: UUID,
    body: ResourceUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
            Resource.project_id.is_(None),
        )
    )
    resource = result.scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    data = body.model_dump(exclude_unset=True)
    if "schedule_id" in data:
        data["schedule_id"] = UUID(data["schedule_id"]) if data["schedule_id"] else None
    if "parent_id" in data:
        data["parent_id"] = UUID(data["parent_id"]) if data["parent_id"] else None
    for key, value in data.items():
        setattr(resource, key, value)

    await db.commit()
    await db.refresh(resource)
    return _to_out(resource)


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_global_resource(
    resource_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.tenant_id == tenant_id,
            Resource.project_id.is_(None),
        )
    )
    resource = result.scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    await db.delete(resource)
    await db.commit()


@router.get("/{resource_id}/effective-schedule")
async def effective_schedule(
    resource_id: UUID,
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Каскад календарей (v2.16): ResourceCalendar → WorkSchedule ресурса →
    график подразделения → график проекта → дефолт программы (пн–пт 8–17).
    Плюс применённые исключения доступности."""
    from app.models.resource_calendar import ResourceCalendar, ResourceCalendarSlot
    from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
    from app.models.schedule_assignment import ScheduleAssignment
    from app.models.calendar_exception import CalendarException
    from app.models.department import Department
    from app.models.project import Project
    from datetime import datetime, date as _date

    def slots_out(rows):
        return [
            {
                "day_of_week": (s.day_of_week if s.day_of_week is not None else -1),
                "cycle_day": getattr(s, "cycle_day", None),
                "start_hour": float(s.start_hour) if s.start_hour is not None else None,
                "end_hour": float(s.end_hour) if s.end_hour is not None else None,
                "kind": getattr(s, "kind", None),
                "exception_date": str(getattr(s, "exception_date", None) or "") or None,
            }
            for s in rows
        ]

    resource = (await db.execute(
        select(Resource).where(Resource.id == resource_id, Resource.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not resource:
        raise HTTPException(404, "Ресурс не найден")

    source, schedule_id, schedule_name, fill_mode, slots = None, None, None, None, []

    rc = (await db.execute(
        select(ResourceCalendar).where(
            ResourceCalendar.resource_id == resource.id,
            ResourceCalendar.is_active == True,  # noqa: E712
        )
    )).scalars().first()
    if rc:
        source, schedule_id, schedule_name = "resource_calendar", str(rc.id), rc.name
        rows = (await db.execute(
            select(ResourceCalendarSlot).where(ResourceCalendarSlot.calendar_id == rc.id)
        )).scalars().all()
        slots = slots_out(rows)
    else:
        ws = None
        if resource.schedule_id:
            ws = (await db.execute(
                select(WorkSchedule).where(
                    WorkSchedule.id == resource.schedule_id,
                    WorkSchedule.is_active == True,  # noqa: E712
                )
            )).scalar_one_or_none()
            if ws:
                source, schedule_id, schedule_name, fill_mode = "resource_schedule", str(ws.id), ws.name, ws.fill_mode
                rows = (await db.execute(
                    select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id == ws.id)
                )).scalars().all()
                slots = slots_out(rows)
        if ws is None:
            dept_ws = None
            if resource.department_id:
                dept = (await db.execute(
                    select(Department).where(Department.id == resource.department_id)
                )).scalar_one_or_none()
                if dept and dept.schedule_id:
                    dept_ws = (await db.execute(
                        select(WorkSchedule).where(
                            WorkSchedule.id == dept.schedule_id,
                            WorkSchedule.is_active == True,  # noqa: E712
                        )
                    )).scalar_one_or_none()
                    if dept_ws:
                        source, schedule_id, schedule_name, fill_mode = "department", str(dept_ws.id), dept_ws.name, dept_ws.fill_mode
                        rows = (await db.execute(
                            select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id == dept_ws.id)
                        )).scalars().all()
                        slots = slots_out(rows)
            if ws is None and dept_ws is None:
                proj_ws = None
                if project_id:
                    proj = (await db.execute(
                        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
                    )).scalar_one_or_none()
                    if proj and proj.schedule_id:
                        proj_ws = (await db.execute(
                            select(WorkSchedule).where(
                                WorkSchedule.id == proj.schedule_id,
                                WorkSchedule.is_active == True,  # noqa: E712
                            )
                        )).scalar_one_or_none()
                        if proj_ws:
                            source, schedule_id, schedule_name, fill_mode = "project", str(proj_ws.id), proj_ws.name, proj_ws.fill_mode
                            rows = (await db.execute(
                                select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id == proj_ws.id)
                            )).scalars().all()
                            slots = slots_out(rows)
                if proj_ws is None:
                    source = "default"
                    slots = [
                        {"day_of_week": d, "cycle_day": None, "start_hour": 8.0, "end_hour": 17.0, "kind": "work", "exception_date": None}
                        for d in range(1, 6)
                    ]

    # Исключения: персональные ресурса + подразделения ресурса + проекта
    exc_rows = (await db.execute(
        select(CalendarException).where(
            CalendarException.tenant_id == tenant_id,
            CalendarException.date_to >= datetime.combine(_date.today(), datetime.min.time()),
        ).order_by(CalendarException.date_from)
    )).scalars().all()
    applicable = []
    for x in exc_rows:
        if x.resource_id and str(x.resource_id) == str(resource.id):
            applicable.append(x)
        elif x.department_id and resource.department_id and str(x.department_id) == str(resource.department_id):
            applicable.append(x)
        elif x.project_id and project_id and str(x.project_id) == str(project_id):
            applicable.append(x)

    return {
        "resource_id": str(resource.id),
        "department_id": str(resource.department_id) if resource.department_id else None,
        "project_id": str(project_id) if project_id else None,
        "source": source,
        "schedule_id": schedule_id,
        "schedule_name": schedule_name,
        "fill_mode": fill_mode,
        "slots": slots,
        "exceptions": [
            {
                "kind": x.kind,
                "date_from": x.date_from.isoformat(),
                "date_to": x.date_to.isoformat(),
                "hours_override": float(x.hours_override) if x.hours_override is not None else None,
                "note": x.note,
            }
            for x in applicable
        ],
    }


@router.get("/{resource_id}/project-assignments")
async def resource_project_assignments(
    resource_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Привязки глобального ресурса к проектам (ProjectResource) — для resedit-окна."""
    from app.models.project_resource import ProjectResource
    from app.models.project import Project
    rows = (await db.execute(
        select(ProjectResource, Project.name)
        .join(Project, Project.id == ProjectResource.project_id)
        .where(
            ProjectResource.resource_id == resource_id,
            ProjectResource.tenant_id == tenant_id,
        )
        .order_by(Project.name)
    )).all()
    return [
        {
            "id": str(pr.id),
            "project_id": str(pr.project_id),
            "project_name": pname,
            "schedule_id": str(pr.schedule_id) if pr.schedule_id else None,
            "capacity_share": float(pr.capacity_share) if pr.capacity_share is not None else None,
            "date_from": str(pr.date_from) if pr.date_from else None,
            "date_to": str(pr.date_to) if pr.date_to else None,
        }
        for pr, pname in rows
    ]
