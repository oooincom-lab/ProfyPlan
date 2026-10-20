"""
CRUD-роутер для проектов.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.project import Project
from app.models.tenant import User
from app.schemas.project import ProjectCreate, ProjectList, ProjectMove, ProjectOut, ProjectUpdate

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

    update_data = body.model_dump(exclude_unset=True)
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
