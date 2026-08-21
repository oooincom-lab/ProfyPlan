"""CRUD для производственных календарей (ProductionCalendar) + генерация базового календаря."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.production_calendar import ProductionCalendar, ProductionCalendarDay
from app.schemas.production_calendar import (
    ProductionCalendarCreate,
    ProductionCalendarOut,
    ProductionCalendarSeed,
    ProductionCalendarUpdate,
)

router = APIRouter(prefix="/v1/production-calendars", tags=["production-calendars"])

# Официальные нерабочие праздничные дни РФ (ст. 112 ТК РФ) — без переносов выходных.
RU_HOLIDAYS = {
    (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8),
    (2, 23), (3, 8), (5, 1), (5, 9), (6, 12), (11, 4),
}

COUNTRY_NAMES = {"RU": "РФ", "BY": "РБ", "KZ": "РК"}


def _load_days():
    return selectinload(ProductionCalendar.days)


def _generate_days(country_code: str, year: int) -> list[dict]:
    """Базовый календарь: Пн–Пт — работа (8ч), Сб–Вс — выходной.
    Для РФ дополнительно праздники (ст. 112) и предпраздничные дни (7ч)."""
    holidays = RU_HOLIDAYS if country_code == "RU" else set()
    result: dict[date, str] = {}
    d = date(year, 1, 1)
    while d.year == year:
        if (d.month, d.day) in holidays:
            result[d] = "holiday"
        elif d.weekday() >= 5:
            result[d] = "weekend"
        else:
            result[d] = "work"
        d += timedelta(days=1)

    # предпраздничные: рабочий день перед праздником → 7ч
    for day, typ in list(result.items()):
        if typ == "holiday":
            prev = day - timedelta(days=1)
            if result.get(prev) == "work":
                result[prev] = "preholiday"

    out = []
    for day, typ in sorted(result.items()):
        hours = None
        if typ == "work":
            hours = Decimal("8.0")
        elif typ == "preholiday":
            hours = Decimal("7.0")
        out.append({"date": day, "day_type": typ, "hours": hours})
    return out


def _parse_xmlcalendar(data: dict, country_code: str) -> list[dict]:
    """Разобрать JSON xmlcalendar.ru в список дней.
    Маркеры: `+` — перенесённый выходной, `*` — предпраздничный (7ч), без маркера — выходной/праздник."""
    year = int(data["year"])
    holidays = RU_HOLIDAYS if country_code == "RU" else set()
    result: dict[date, tuple[str, Decimal | None]] = {}
    for month in data.get("months", []):
        m = month["month"]
        for tok in month["days"].split(","):
            tok = tok.strip()
            if not tok:
                continue
            if tok.endswith("*"):
                day = int(tok[:-1])
                result[date(year, m, day)] = ("preholiday", Decimal("7.0"))
            elif tok.endswith("+"):
                day = int(tok[:-1])
                result[date(year, m, day)] = ("holiday", None)
            else:
                day = int(tok)
                typ = "holiday" if (m, day) in holidays else "weekend"
                result[date(year, m, day)] = (typ, None)

    out: list[dict] = []
    d = date(year, 1, 1)
    while d.year == year:
        typ, hours = result.get(d, ("work", Decimal("8.0")))
        out.append({"date": d, "day_type": typ, "hours": hours})
        d += timedelta(days=1)
    return out


def _make_name(country_code: str, year: int) -> str:
    base = COUNTRY_NAMES.get(country_code, country_code)
    return f"{base} {year}"


@router.get("/", response_model=list[ProductionCalendarOut])
async def list_items(
    search: str | None = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ProductionCalendar).options(_load_days()).where(
        ProductionCalendar.tenant_id == tenant_id
    )
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            (ProductionCalendar.name.ilike(like))
            | (ProductionCalendar.country_code.ilike(like))
        )
    stmt = stmt.order_by(ProductionCalendar.year.desc(), ProductionCalendar.country_code)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/", response_model=ProductionCalendarOut, status_code=201)
async def create_item(
    body: ProductionCalendarCreate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    country = body.country_code.upper()
    name = (body.name or "").strip() or _make_name(country, body.year)
    item = ProductionCalendar(
        id=uuid4(), tenant_id=tenant_id, country_code=country, year=body.year, name=name,
        source="manual", status="ok",
    )
    db.add(item)
    await db.flush()
    for dc in body.days:
        db.add(
            ProductionCalendarDay(
                calendar_id=item.id, date=dc.date, day_type=dc.day_type, hours=dc.hours
            )
        )
    await db.commit()
    res = await db.execute(
        select(ProductionCalendar).options(_load_days()).where(ProductionCalendar.id == item.id)
    )
    return res.scalar_one()


@router.post("/seed", response_model=ProductionCalendarOut, status_code=201)
async def seed_item(
    body: ProductionCalendarSeed,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Сгенерировать базовый календарь страны на год (идемпотентно)."""
    country = body.country_code.upper()
    existing = await db.execute(
        select(ProductionCalendar).options(_load_days()).where(
            ProductionCalendar.tenant_id == tenant_id,
            ProductionCalendar.country_code == country,
            ProductionCalendar.year == body.year,
        )
    )
    found = existing.scalar_one_or_none()
    if found:
        return found

    item = ProductionCalendar(
        id=uuid4(), tenant_id=tenant_id, country_code=country,
        year=body.year, name=_make_name(country, body.year),
        source="base", status="fallback",
    )
    db.add(item)
    await db.flush()
    for dc in _generate_days(country, body.year):
        db.add(
            ProductionCalendarDay(
                calendar_id=item.id, date=dc["date"], day_type=dc["day_type"], hours=dc["hours"]
            )
        )
    await db.commit()
    res = await db.execute(
        select(ProductionCalendar).options(_load_days()).where(ProductionCalendar.id == item.id)
    )
    return res.scalar_one()


@router.post("/import-xmlcalendar", response_model=ProductionCalendarOut, status_code=201)
async def import_xmlcalendar(
    body: ProductionCalendarSeed,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Загрузить календарь из xmlcalendar.ru (полный: переносы + предпраздничные)."""
    country = body.country_code.upper()
    year = body.year
    url = f"https://xmlcalendar.ru/data/{country.lower()}/{year}/calendar.json"
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Источник недоступен: {e}")

    days = _parse_xmlcalendar(data, country)

    existing = await db.execute(
        select(ProductionCalendar).options(_load_days()).where(
            ProductionCalendar.tenant_id == tenant_id,
            ProductionCalendar.country_code == country,
            ProductionCalendar.year == year,
        )
    )
    item = existing.scalar_one_or_none()
    if item:
        await db.execute(
            delete(ProductionCalendarDay).where(ProductionCalendarDay.calendar_id == item.id)
        )
        item.name = _make_name(country, year)
        item.source = "xmlcalendar"
        item.status = "ok"
        item.last_error = None
        item.source_synced_at = datetime.now(timezone.utc)
    else:
        item = ProductionCalendar(
            id=uuid4(), tenant_id=tenant_id, country_code=country,
            year=year, name=_make_name(country, year),
            source="xmlcalendar", status="ok",
            source_synced_at=datetime.now(timezone.utc),
        )
        db.add(item)
        await db.flush()
    for dc in days:
        db.add(
            ProductionCalendarDay(
                calendar_id=item.id, date=dc["date"], day_type=dc["day_type"], hours=dc["hours"]
            )
        )
    await db.commit()
    db.expire_all()
    res = await db.execute(
        select(ProductionCalendar).options(_load_days()).where(ProductionCalendar.id == item.id)
    )
    return res.scalar_one()


@router.get("/{item_id}", response_model=ProductionCalendarOut)
async def get_item(
    item_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(ProductionCalendar)
        .options(_load_days())
        .where(ProductionCalendar.id == item_id, ProductionCalendar.tenant_id == tenant_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    return item


@router.put("/{item_id}", response_model=ProductionCalendarOut)
async def update_item(
    item_id: UUID,
    body: ProductionCalendarUpdate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(ProductionCalendar)
        .options(_load_days())
        .where(ProductionCalendar.id == item_id, ProductionCalendar.tenant_id == tenant_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")

    data = body.model_dump(exclude_unset=True)
    days = data.pop("days", None)
    if "country_code" in data and data["country_code"]:
        data["country_code"] = data["country_code"].upper()
    for k, v in data.items():
        setattr(item, k, v)

    if days is not None:
        await db.execute(
            delete(ProductionCalendarDay).where(ProductionCalendarDay.calendar_id == item.id)
        )
        for dc in days:
            db.add(
                ProductionCalendarDay(
                    calendar_id=item.id, date=dc["date"], day_type=dc["day_type"], hours=dc["hours"]
                )
            )

    await db.commit()
    db.expire_all()
    res = await db.execute(
        select(ProductionCalendar).options(_load_days()).where(ProductionCalendar.id == item.id)
    )
    return res.scalar_one()


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(ProductionCalendar).where(
            ProductionCalendar.id == item_id, ProductionCalendar.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    await db.delete(item)
    await db.commit()
