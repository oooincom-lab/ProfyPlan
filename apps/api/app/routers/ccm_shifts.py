"""Журнал сдвигов CCM: применение сдвига, откат и пересчёт проектов (блок 6.33).

«Применить сдвиг» (мне или другому проекту) меняет дату старта проекта и вместе с
ней переносит контур: даты заказов проекта на +N дней (куст целиком — дети едут
вместе с родителем). Сдвиг применяется ко всему проекту («Сдвинуть всё») или
выборочно — к отдельным кустам («Сдвинуть куст»: scope_root_ids = корни, переносятся
их поддеревья; при этом дата старта проекта не меняется — move_project=false).
Закреплённые заказы (якорь) и заказы без дат не переносятся — попадают в «пропущено».
Запись журнала хранит охват, число перенесённых и пропущенных заказов, старые даты
перенесённых заказов — для точного возврата. «Проверка» перед сдвигом — отдельный
маршрут /v1/ccm/shifts/preview: показывает кусты, окна «до → после» и пропуски, ничего
не записывая.

Пересчёт проектов сдвига управляется флагом auto_recalc: по умолчанию выключен —
«ручной режим», список проектов и кнопки на странице; при включении после каждого
сдвига/возврата пересчитываются все проекты сдвига в порядке хронологии занятости
общих ресурсов (по дате старта проекта: более ранние первыми — так более поздние
видят актуальную занятость). «Вернуть» восстанавливает прежнюю дату старта проекта
и прежние даты заказов, помечает запись «(возвращено)». Хранятся последние 100
записей на организацию. Статус для панели отдаёт GET /v1/ccm/shift-recalc.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.calculation_run import CalculationRun
from app.models.ccm_shift_application import CcmShiftApplication
from app.models.production_order import ProductionOrder
from app.models.project import Project
from app.models.tenant import User
from app.routers.calculation_runs import perform_project_run

router = APIRouter(tags=["ccm-shifts"])

LIMIT_PER_TENANT = 100  # лимит журнала сдвигов на организацию


class ShiftApplyRequest(BaseModel):
    """Применение сдвига: какой проект, новая дата старта, направление, дней.

    move_project=false — «Сдвинуть куст»: дата старта проекта не меняется, едут
    только заказы выбранных кустов (scope_root_ids — корни; едут их поддеревья).
    """

    project_id: UUID
    new_start: datetime
    kind: str = Field(default="self", pattern="^(self|other)$")
    shift_days: int = Field(default=0, ge=0, le=3650)
    # Автопересчёт (по умолчанию выключен — ручной режим со списком и кнопками).
    auto_recalc: bool = False
    # Сдвиг с контуром (03.10.2026): двигать ли старт проекта и охват кустов.
    move_project: bool = True
    scope_root_ids: Optional[list[UUID]] = None


class ShiftPreviewRequest(BaseModel):
    """Проверка перед сдвигом: что перенесётся и что пропустится (без записи)."""

    project_id: UUID
    new_start: datetime


class ShiftRevertRequest(BaseModel):
    """Возврат сдвига: тем же флагом управляется пересчёт после отката."""

    auto_recalc: bool = False


class ShiftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    project_name: str
    kind: str
    shift_days: int
    old_start: Optional[datetime] = None
    new_start: Optional[datetime] = None
    reverted: bool
    reverted_at: Optional[datetime] = None
    created_at: datetime
    # Сдвиг с контуром (03.10.2026): охват и перенесённые заказы.
    scope: str = "project"
    orders_shifted: int = 0
    orders_skipped: int = 0


class ShiftList(BaseModel):
    items: list[ShiftOut]
    total: int


def _iso_d(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


async def _load_project_orders(db: AsyncSession, tenant_id: UUID, project_id: UUID) -> list:
    """Все заказы проекта (корни и потомки) в стабильном порядке."""
    rows = (
        (
            await db.execute(
                select(ProductionOrder)
                .where(
                    ProductionOrder.project_id == project_id,
                    ProductionOrder.tenant_id == tenant_id,
                )
                .order_by(ProductionOrder.created_at)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def _order_children_map(orders: list) -> dict:
    """Карта «родитель → дети»; корни — ключ пустой строки."""
    m: dict = {}
    for o in orders:
        key = str(o.parent_order_id) if o.parent_order_id else ""
        m.setdefault(key, []).append(o)
    return m


def _bush_orders(root, children_of: dict) -> list:
    """Куст: корень и все его потомки (дети едут вместе с родителем)."""
    res: list = []
    stack = [root]
    seen: set = set()
    while stack:
        cur = stack.pop()
        if str(cur.id) in seen:
            continue
        seen.add(str(cur.id))
        res.append(cur)
        stack.extend(children_of.get(str(cur.id), []))
    return res


def _shift_preview(project: Project, orders: list, new_start: datetime) -> dict:
    """Проверка сдвига: кусты, окна «до → после», пропуски. Ничего не пишет."""
    old_start = project.start_date
    days = (new_start.date() - old_start.date()).days if old_start else 0
    children_of = _order_children_map(orders)
    bushes: list = []
    skipped_all: list = []
    for root in children_of.get("", []):
        tree = _bush_orders(root, children_of)
        shifted = []
        skipped = []
        for o in tree:
            if o.priority_anchor_at is not None:
                skipped.append({"id": str(o.id), "ext_id": o.ext_id, "reason": "закреплён"})
            elif o.start_date is None and o.due_date is None:
                skipped.append({"id": str(o.id), "ext_id": o.ext_id, "reason": "без дат"})
            else:
                shifted.append(o)
        starts = [o.start_date for o in tree if o.start_date]
        dues = [o.due_date for o in tree if o.due_date]
        after_starts = [o.start_date + timedelta(days=days) for o in shifted if o.start_date]
        after_dues = [o.due_date + timedelta(days=days) for o in shifted if o.due_date]
        title = ((root.ext_id + " · ") if root.ext_id else "") + (root.specification_name or "Заказ")
        bushes.append(
            {
                "root_id": str(root.id),
                "title": title,
                "orders_total": len(tree),
                "orders_shifted": len(shifted),
                "orders_skipped": len(skipped),
                "window_before": [_iso_d(min(starts)), _iso_d(max(dues))] if starts and dues else None,
                "window_after": [_iso_d(min(after_starts)), _iso_d(max(after_dues))]
                if after_starts and after_dues
                else None,
            }
        )
        skipped_all.extend(skipped)
    return {
        "project_id": str(project.id),
        "project_name": project.name,
        "old_start": old_start.isoformat() if old_start else None,
        "new_start": new_start.isoformat(),
        "days": days,
        "bushes": bushes,
        "totals": {
            "orders_total": sum(b["orders_total"] for b in bushes),
            "orders_shifted": sum(b["orders_shifted"] for b in bushes),
            "orders_skipped": sum(b["orders_skipped"] for b in bushes),
            "skipped": skipped_all,
        },
        "warning": (
            None
            if old_start
            else "У проекта не задан старт — заказы не сдвинутся (0 дней). Сначала задайте старт сдвигом проекта."
        ),
    }


def _apply_contour(project: Project, orders: list, body: ShiftApplyRequest):
    """Перенести даты заказов (весь проект или выбранные кусты).

    Возвращает (moved, skipped, scope, days). Закреплённые и бездатные — в skipped.
    """
    old_start = project.start_date
    days = (body.new_start.date() - old_start.date()).days if old_start else int(body.shift_days or 0)
    children_of = _order_children_map(orders)
    if body.scope_root_ids:
        scope_ids = {str(x) for x in body.scope_root_ids}
        selected: list = []
        seen: set = set()
        for root in children_of.get("", []):
            if str(root.id) not in scope_ids:
                continue
            for o in _bush_orders(root, children_of):
                if str(o.id) not in seen:
                    seen.add(str(o.id))
                    selected.append(o)
        scope = "roots"
    else:
        selected = list(orders)
        scope = "project"
    moved: list = []
    skipped: list = []
    for o in selected:
        if o.priority_anchor_at is not None:
            skipped.append({"id": str(o.id), "ext_id": o.ext_id, "reason": "закреплён"})
            continue
        if o.start_date is None and o.due_date is None:
            skipped.append({"id": str(o.id), "ext_id": o.ext_id, "reason": "без дат"})
            continue
        entry = {"id": str(o.id), "old_start": _iso_d(o.start_date), "old_due": _iso_d(o.due_date)}
        if o.start_date is not None:
            o.start_date = o.start_date + timedelta(days=days)
        if o.due_date is not None:
            o.due_date = o.due_date + timedelta(days=days)
        moved.append(entry)
    return moved, skipped, scope, days


async def _trim(db: AsyncSession, tenant_id: UUID) -> None:
    """Держим журнал в пределах лимита: лишние самые старые записи уходят."""
    old_ids = (
        (
            await db.execute(
                select(CcmShiftApplication.id)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .order_by(CcmShiftApplication.created_at.desc())
                .offset(LIMIT_PER_TENANT)
            )
        )
        .scalars()
        .all()
    )
    if old_ids:
        await db.execute(delete(CcmShiftApplication).where(CcmShiftApplication.id.in_(old_ids)))
        await db.commit()


async def perform_shift_recalcs(
    db: AsyncSession,
    tenant_id: UUID,
    author_id: Optional[UUID] = None,
) -> list[dict]:
    """Пересчитать все проекты сдвига в порядке хронологии занятости ресурсов.

    Порядок: по дате старта проекта (с неё начинается окно занятости общих
    ресурсов) — более ранние пересчитываются первыми; проекты без дат — в конце.
    Используется автопересчётом после сдвига/возврата.
    """
    proj_ids = (
        (
            await db.execute(
                select(CcmShiftApplication.project_id)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    if not proj_ids:
        return []
    projects = (
        (
            await db.execute(
                select(Project).where(Project.id.in_(proj_ids), Project.tenant_id == tenant_id)
            )
        )
        .scalars()
        .all()
    )
    projects.sort(key=lambda p: (p.start_date is None, p.start_date or datetime.now(timezone.utc)))
    out: list[dict] = []
    total = len(projects)
    for idx, project in enumerate(projects, 1):
        try:
            run = await perform_project_run(
                db,
                project,
                tenant_id,
                author_id=author_id,
                auto_note=f"Автопересчёт проектов сдвига (CCM): шаг {idx}/{total}.",
            )
            out.append(
                {
                    "project_id": str(project.id),
                    "project_name": project.name,
                    "status": run.status,
                    "run_id": str(run.id),
                }
            )
        except Exception as exc:  # один упавший пересчёт не останавливает остальные
            out.append(
                {
                    "project_id": str(project.id),
                    "project_name": project.name,
                    "status": "failed",
                    "error": str(exc)[:200],
                }
            )
    return out


@router.post("/v1/ccm/shifts/preview")
async def preview_shift(
    body: ShiftPreviewRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Проверка перед сдвигом: кусты проекта, окна «до → после», пропуски.

    Ничего не записывает — безопасный шаг 1 мастера сдвига.
    """
    project = (
        await db.execute(
            select(Project).where(Project.id == body.project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    orders = await _load_project_orders(db, tenant_id, project.id)
    return _shift_preview(project, orders, body.new_start)


@router.post("/v1/ccm/shifts/apply")
async def apply_shift(
    body: ShiftApplyRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Применить сдвиг: журнал, перенос контура (проект и заказы), пересчёт (по флагу).

    «Сдвинуть всё» — move_project=true: старт проекта + весь контур.
    «Сдвинуть куст» — move_project=false и scope_root_ids: только выбранные кусты.
    """
    project = (
        await db.execute(
            select(Project).where(Project.id == body.project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    old_start = project.start_date
    orders = await _load_project_orders(db, tenant_id, project.id)
    moved, skipped, scope, days = _apply_contour(project, orders, body)
    if body.move_project:
        project.start_date = body.new_start

    rec = CcmShiftApplication(
        tenant_id=tenant_id,
        project_id=project.id,
        project_name=project.name,
        kind=body.kind,
        shift_days=int(days or 0),
        old_start=old_start,
        new_start=body.new_start,
        reverted=False,
        scope=scope,
        orders_shifted=len(moved),
        orders_skipped=len(skipped),
        orders_moved=moved or None,
        skipped_details=skipped or None,
        created_by=user.id,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    await _trim(db, tenant_id)

    if body.auto_recalc:
        recalc: dict = {"mode": "auto", "projects": await perform_shift_recalcs(db, tenant_id, user.id)}
    else:
        recalc = {
            "mode": "manual",
            "note": "Автопересчёт выключен: пересчитайте проекты сдвига в списке (по порядку).",
        }

    return {
        "record": ShiftOut.model_validate(rec),
        "recalc": recalc,
        "orders": {"shifted": len(moved), "skipped": len(skipped), "scope": scope},
    }


@router.get("/v1/ccm/shifts", response_model=ShiftList)
async def list_shifts(
    limit: int = Query(default=LIMIT_PER_TENANT, ge=1, le=LIMIT_PER_TENANT),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Журнал сдвигов: новые сверху, возвращённые записи хранятся и видны."""
    total = (
        await db.execute(
            select(func.count())
            .select_from(CcmShiftApplication)
            .where(CcmShiftApplication.tenant_id == tenant_id)
        )
    ).scalar() or 0
    rows = (
        (
            await db.execute(
                select(CcmShiftApplication)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .order_by(CcmShiftApplication.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return ShiftList(items=[ShiftOut.model_validate(r) for r in rows], total=total)


@router.get("/v1/ccm/shifts/{shift_id}")
async def get_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Детали записи сдвига для графика «до/после»: перенесённые и пропущенные заказы."""
    rec = (
        await db.execute(
            select(CcmShiftApplication).where(
                CcmShiftApplication.id == shift_id,
                CcmShiftApplication.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Запись сдвига не найдена")
    return {
        "record": ShiftOut.model_validate(rec),
        "orders_moved": rec.orders_moved or [],
        "orders_skipped": rec.skipped_details or [],
    }


@router.get("/v1/ccm/shift-recalc")
async def shift_recalc_status(
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Проекты сдвига и статус пересчёта — для панели «Пересчёт проектов сдвига».

    Порядок — хронология занятости общих ресурсов (по дате старта проекта);
    возвращённые сдвиги уходят вниз. «Требует пересчёта» — если последний сдвиг
    новее последнего запуска расчёта проекта.
    """
    recs = (
        (
            await db.execute(
                select(CcmShiftApplication)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .order_by(CcmShiftApplication.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    groups: dict[UUID, dict] = {}
    for r in recs:
        g = groups.setdefault(
            r.project_id,
            {
                "project_name": r.project_name,
                "last_shift_at": r.created_at,
                "has_active": False,
            },
        )
        if not r.reverted:
            g["has_active"] = True
    if not groups:
        return {"items": [], "total": 0}

    run_rows = (
        await db.execute(
            select(CalculationRun.project_id, func.max(CalculationRun.finished_at))
            .where(
                CalculationRun.tenant_id == tenant_id,
                CalculationRun.project_id.in_(list(groups.keys())),
            )
            .group_by(CalculationRun.project_id)
        )
    ).all()
    run_map = {row[0]: row[1] for row in run_rows}

    projects = (
        (
            await db.execute(
                select(Project).where(
                    Project.id.in_(list(groups.keys())), Project.tenant_id == tenant_id
                )
            )
        )
        .scalars()
        .all()
    )
    proj_map = {p.id: p for p in projects}

    items: list[dict] = []
    for pid, g in groups.items():
        p = proj_map.get(pid)
        last_run = run_map.get(pid)
        needs = (last_run is None) or (last_run < g["last_shift_at"])
        items.append(
            {
                "project_id": str(pid),
                "project_name": g["project_name"],
                "start_date": p.start_date.isoformat() if (p and p.start_date) else None,
                "last_shift_at": g["last_shift_at"].isoformat() if g["last_shift_at"] else None,
                "last_run_at": last_run.isoformat() if last_run else None,
                "needs_recalc": bool(needs),
                "state": "shifted" if g["has_active"] else "reverted",
            }
        )
    items.sort(key=lambda x: (x["state"] == "reverted", x["start_date"] or "9999"))
    return {"items": items, "total": len(items)}


@router.post("/v1/ccm/shifts/{shift_id}/revert")
async def revert_shift(
    shift_id: UUID,
    body: Optional[ShiftRevertRequest] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Вернуть сдвиг: прежняя дата старта и прежние даты заказов, пересчёт (по флагу)."""
    rec = (
        await db.execute(
            select(CcmShiftApplication).where(
                CcmShiftApplication.id == shift_id,
                CcmShiftApplication.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Запись сдвига не найдена")
    if rec.reverted:
        # Идемпотентно: повторный возврат ничего не делает.
        return {"record": ShiftOut.model_validate(rec), "recalc": {}, "already": True}

    project = (
        await db.execute(
            select(Project).where(Project.id == rec.project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Вернуть даты заказов — по старым значениям, сохранённым в записи журнала.
    if rec.orders_moved:
        ids: list = []
        for m in rec.orders_moved:
            try:
                ids.append(UUID(str(m.get("id"))))
            except Exception:
                continue
        if ids:
            rows = (
                (
                    await db.execute(
                        select(ProductionOrder).where(
                            ProductionOrder.id.in_(ids),
                            ProductionOrder.tenant_id == tenant_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            by_id = {str(o.id): o for o in rows}
            for m in rec.orders_moved:
                o = by_id.get(str(m.get("id")))
                if not o:
                    continue
                if m.get("old_start"):
                    o.start_date = date.fromisoformat(str(m["old_start"]))
                if m.get("old_due"):
                    o.due_date = date.fromisoformat(str(m["old_due"]))

    project.start_date = rec.old_start
    rec.reverted = True
    rec.reverted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rec)

    auto = bool(body and body.auto_recalc)
    if auto:
        recalc: dict = {"mode": "auto", "projects": await perform_shift_recalcs(db, tenant_id, user.id)}
    else:
        recalc = {
            "mode": "manual",
            "note": "Автопересчёт выключен: пересчитайте проекты сдвига в списке (по порядку).",
        }

    return {"record": ShiftOut.model_validate(rec), "recalc": recalc}
