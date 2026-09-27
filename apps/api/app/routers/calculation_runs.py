"""Запуски расчёта проекта (блок 6.16.3 плана).

Расчёт сохраняется объектом: область, обе оси методов, параметры, отпечаток входных
данных и сводка результата. Реестр — основание сравнения методов, истории и
прослеживаемости: по любой цифре видно, на какую дату и по какой версии данных она
получена.

Честные границы: расчёт по осям PERT и Монте-Карло подключается блоками 6.18 и 6.19,
межпроектное объединение CCM — блоком 6.20. Пока считаем детерминированный CPM,
а в сводке результата прямо пишем, что ещё не считается.
"""
import hashlib
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.calculation_run import CalculationRun
from app.models.operation import Operation, OperationDependency
from app.models.production_order import ProductionOrder
from app.models.project import Project
from app.models.tenant import User
from app.services.cpm import calculate_cpm

runs_router = APIRouter(tags=["calculation-runs"])

AREA_PATTERN = "^(project|cluster|group|pool)$"


class RunRequest(BaseModel):
    """Что считаем: область расчёта и дополнительные параметры."""

    area: str = Field(default="project", pattern=AREA_PATTERN)
    area_ref: Optional[UUID] = None
    params: Optional[dict] = None
    # Готовый результат расчёта: так записывается запуск Монте-Карло, который считается
    # на своей странице (процентили, распределение, число прогонов и зерно).
    result: Optional[dict] = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    area: str
    area_ref: Optional[UUID] = None
    planning_logic: str
    uncertainty_analysis: str
    data_fingerprint: Optional[str] = None
    data_date: Optional[datetime] = None
    status: str
    result: Optional[dict] = None
    error: Optional[str] = None
    finished_at: Optional[datetime] = None
    created_at: datetime


class RunList(BaseModel):
    items: list[RunOut]
    total: int


async def _load_inputs(db: AsyncSession, project_id: UUID, tenant_id: UUID):
    """Входные данные расчёта: операции проекта (без черновых заказов) и зависимости."""
    ops_result = await db.execute(
        select(Operation)
        .outerjoin(ProductionOrder, Operation.order_id == ProductionOrder.id)
        .where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
            or_(Operation.order_id.is_(None), ProductionOrder.status != "draft"),
        )
    )
    operations = ops_result.scalars().all()

    deps_result = await db.execute(
        select(OperationDependency)
        .join(Operation, OperationDependency.predecessor_id == Operation.id)
        .where(Operation.project_id == project_id)
    )
    dependencies = deps_result.scalars().all()
    return operations, dependencies


def _fingerprint(operations, dependencies, project: Project) -> str:
    """Отпечаток входных данных: по нему видно, менялись ли данные после расчёта."""
    h = hashlib.sha256()
    for op in sorted(operations, key=lambda o: str(o.id)):
        h.update(
            f"{op.id}|{op.duration_base}|{op.to_optimistic}|{op.tm_likely}|{op.tp_pessimistic}".encode()
        )
    for dep in sorted(dependencies, key=lambda d: str(d.id)):
        h.update(
            f"{dep.predecessor_id}|{dep.successor_id}|{dep.dependency_type}|{dep.lag_time}".encode()
        )
    h.update(
        f"{project.planning_logic}|{project.uncertainty_analysis}|{project.monte_carlo_runs}|{project.confidence_level}".encode()
    )
    return h.hexdigest()[:24]


@runs_router.post(
    "/v1/projects/{project_id}/calculation-runs",
    response_model=RunOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_run(
    project_id: UUID,
    body: Optional[RunRequest] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Запустить расчёт и сохранить его как объект (основание сравнения и истории)."""
    project = (
        await db.execute(
            select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    area = body.area if body and body.area else "project"
    operations, dependencies = await _load_inputs(db, project_id, tenant_id)
    fingerprint = _fingerprint(operations, dependencies, project)
    now = datetime.now(timezone.utc)

    notes: list[str] = []
    if project.planning_logic == "ccm":
        notes.append(
            "Логика планирования CCM: межпроектное объединение считается в блоке 6.20. Здесь сохранён расчёт по проекту."
        )
    if project.uncertainty_analysis in ("pert", "mc"):
        notes.append(
            "Оценки разброса (PERT, Монте-Карло) подключаются блоками 6.18 и 6.19 — сохранён детерминированный результат."
        )
    if area != "project":
        notes.append(
            f"Область расчёта «{area}»: детализация по кусту, группе и пулу собирается вместе со страницами расчётов."
        )

    run_status = "done"
    error_text: Optional[str] = None
    summary: dict = {
        "operations": len(operations),
        "dependencies": len(dependencies),
        "areas": 1,
        "notes": notes,
    }

    # Если страница расчёта уже получила результат (Монте-Карло), записываем именно его:
    # в реестре должны лежать те числа, которые человек видел на экране.
    provided = body.result if body else None
    if provided:
        summary.update(provided)
        if provided.get("notes"):
            summary["notes"] = list(notes) + list(provided.get("notes") or [])

    try:
        if len(operations) < 2:
            raise ValueError("Для расчёта нужно не меньше двух операций")
        ops_dicts = [
            {
                "id": str(op.id),
                "name": op.name,
                "duration_base": float(op.duration_base),
                "setup_time": float(op.setup_time),
                "teardown_time": float(op.teardown_time),
            }
            for op in operations
        ]
        deps_dicts = [
            {
                "predecessor_id": str(dep.predecessor_id),
                "successor_id": str(dep.successor_id),
                "dependency_type": dep.dependency_type,
                "lag_time": float(dep.lag_time),
            }
            for dep in dependencies
        ]
        cpm = calculate_cpm(ops_dicts, deps_dicts)
        summary["project_duration_hours"] = float(cpm.total_duration)
        summary["critical_operations"] = len(cpm.critical_path or [])
        summary["estimates_without_triples"] = sum(
            1
            for op in operations
            if op.to_optimistic is None or op.tm_likely is None or op.tp_pessimistic is None
        )
    except ValueError as exc:
        run_status = "failed"
        error_text = str(exc)

    # Результат, полученный на странице расчёта (Монте-Карло), главнее локальной сводки:
    # на экране человек видел именно эти числа, они и должны лежать в реестре.
    if provided:
        summary.update(provided)
        if provided.get("notes"):
            summary["notes"] = list(notes) + list(provided.get("notes") or [])
        if provided.get("iterations"):
            summary["iterations"] = provided.get("iterations")
    except StopIteration:
        pass

    run = CalculationRun(
        tenant_id=tenant_id,
        project_id=project_id,
        area=area,
        area_ref=body.area_ref if body else None,
        planning_logic=project.planning_logic,
        uncertainty_analysis=project.uncertainty_analysis,
        params={
            "monte_carlo_runs": project.monte_carlo_runs,
            "confidence_level": project.confidence_level,
            "use_history": project.use_history,
            **(body.params or {} if body else {}),
        },
        data_fingerprint=fingerprint,
        data_date=now,
        status=run_status,
        result=summary,
        error=error_text,
        finished_at=now,
        created_by=user.id,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return RunOut.model_validate(run)


@runs_router.get("/v1/projects/{project_id}/calculation-runs", response_model=RunList)
async def list_runs(
    project_id: UUID,
    limit: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Список запусков проекта — от свежих к старым."""
    result = await db.execute(
        select(CalculationRun)
        .where(
            CalculationRun.tenant_id == tenant_id,
            CalculationRun.project_id == project_id,
        )
        .order_by(CalculationRun.created_at.desc())
        .limit(limit)
    )
    runs = result.scalars().all()
    return RunList(items=[RunOut.model_validate(r) for r in runs], total=len(runs))


@runs_router.get("/v1/calculation-runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Один запуск с полной сводкой — основание для сравнения «было / стало»."""
    run = (
        await db.execute(
            select(CalculationRun).where(
                CalculationRun.id == run_id,
                CalculationRun.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Запуск не найден")
    return RunOut.model_validate(run)
