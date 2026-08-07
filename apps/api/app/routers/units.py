"""CRUD для единиц измерения + seed ОКЕИ."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_tenant_id, get_db
from app.models.unit import Unit
from app.schemas.unit import UnitCreate, UnitOut, UnitUpdate

router = APIRouter(prefix="/v1/units", tags=["units"])

OKEI_SEED = [
    ("796", "pcs", "шт", "Штука", "Piece", 1.0, True),
    ("166", "kg", "кг", "Килограмм", "Kilogram", 1.0, True),
    ("163", "g", "г", "Грамм", "Gram", 1000.0, False),
    ("168", "t", "т", "Тонна метрическая", "Tonne", 0.001, False),
    ("006", "m", "м", "Метр", "Metre", 1.0, True),
    ("003", "mm", "мм", "Миллиметр", "Millimetre", 1000.0, False),
    ("004", "cm", "см", "Сантиметр", "Centimetre", 100.0, False),
    ("008", "km", "км", "Километр", "Kilometre", 0.001, False),
    ("055", "ft", "фут", "Фут", "Foot", 3.281, False),
    ("112", "L", "л", "Литр", "Litre", 1.0, True),
    ("111", "mL", "мл", "Миллилитр", "Millilitre", 1000.0, False),
    ("113", "m³", "м³", "Куб. метр", "Cubic metre", 0.001, False),
    ("018", "mtr", "п.м", "Погонный метр", "Linear metre", 1.0, True),
    ("019", "m²", "м²", "Квадратный метр", "Square metre", 1.0, True),
    ("245", "kWh", "кВт⋅ч", "Киловатт-час", "Kilowatt-hour", 1.0, True),
    ("214", "kW", "кВт", "Киловатт", "Kilowatt", 0.001, False),
    ("360", "wk", "нед", "Неделя", "Week", 1.0, True),
    ("359", "d", "сут", "Сутки", "Day", 1.0, False),
    ("356", "h", "ч", "Час", "Hour", 1.0, True),
    ("355", "min", "мин", "Минута", "Minute", 60.0, False),
    ("354", "s", "с", "Секунда", "Second", 3600.0, False),
    ("715", "pair", "пар", "Пара", "Pair", 1.0, True),
    ("797", "100 pcs", "100 шт", "Сто штук", "Hundred pieces", 100.0, False),
    ("798", "1000 pcs", "1000 шт", "Тысяча штук", "Thousand pieces", 1000.0, False),
    ("778", "pack", "упак", "Упаковка", "Package", 1.0, True),
    ("839", "set", "компл", "Комплект", "Set", 1.0, True),
    ("641", "doz", "дюж", "Дюжина", "Dozen", 12.0, False),
    ("657", "roll", "рул", "Рулон", "Roll", 1.0, True),
    ("625", "sheet", "лист", "Лист", "Sheet", 1.0, True),
    ("246", "MWh", "МВт⋅ч", "Мегаватт-час", "Megawatt-hour", 0.001, False),
]


@router.get("/", response_model=list[UnitOut])
async def list_units(
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Unit).where(Unit.tenant_id == tenant_id, Unit.is_active == True).order_by(Unit.symbol_int)
    )
    return res.scalars().all()


@router.post("/", response_model=UnitOut, status_code=201)
async def create_unit(
    body: UnitCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = Unit(id=uuid4(), tenant_id=tenant_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/{unit_id}", response_model=UnitOut)
async def update_unit(
    unit_id: str,
    body: UnitUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Unit).where(Unit.id == unit_id, Unit.tenant_id == tenant_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{unit_id}", status_code=204)
async def delete_unit(
    unit_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Unit).where(Unit.id == unit_id, Unit.tenant_id == tenant_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404)
    await db.delete(item)
    await db.commit()


@router.post("/seed", response_model=dict)
async def seed_units(
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Заполнить справочник единицами измерения по ОКЕИ."""
    created = 0
    for code, si, sr, nr, ne, factor, is_base in OKEI_SEED:
        existing = await db.execute(
            select(Unit).where(Unit.tenant_id == tenant_id, Unit.code == code)
        )
        if existing.scalar_one_or_none():
            continue
        db.add(Unit(
            id=uuid4(), tenant_id=tenant_id,
            code=code, symbol_int=si, symbol_ru=sr,
            name_ru=nr, name_en=ne, factor=factor, is_base=is_base,
        ))
        created += 1
    await db.commit()
    return {"seeded": created}
