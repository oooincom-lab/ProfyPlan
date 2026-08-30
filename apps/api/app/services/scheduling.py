"""
Календарное планирование: преобразование абстрактной длительности CPM
(часы) в реальные даты с учётом производственного календаря страны
и графика работы ресурса.

Логика:
  1. Длительность операции приводится к часам (sec/min/hour/day/shift).
  2. Для операции определяется «часов в сутки» из графика её ресурса
     (если назначен ресурс с графиком), иначе 8 ч (календарь по умолчанию).
  3. Длительность в часах → длительность в рабочих днях = часы / часов_в_сутки.
  4. CPM считается в рабочих днях (абстрактная шкала).
  5. Индекс рабочего дня → реальная дата через производственный календарь
     (Пн–Пт работа, выходные/праздники пропускаются; предпраздничные 7 ч).
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.production_calendar import ProductionCalendar, ProductionCalendarDay
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot


HOURS_PER_UNIT = {
    "sec": Decimal("1") / Decimal("3600"),
    "min": Decimal("1") / Decimal("60"),
    "hour": Decimal("1"),
    "day": Decimal("8"),
    "shift": Decimal("8"),
}
DEFAULT_HOURS_PER_DAY = Decimal("8")
PREHOLIDAY_HOURS = Decimal("7")


def normalize_to_hours(value, unit: str) -> Decimal:
    """Привести длительность к часам."""
    v = Decimal(str(value if value is not None else 0))
    return v * HOURS_PER_UNIT.get((unit or "hour").lower(), Decimal("1"))


def _slot_hours(sl: WorkScheduleSlot) -> Decimal:
    """Длительность слота в часах (end < start = ночная смена через полночь)."""
    start = Decimal(str(sl.start_hour))
    end = Decimal(str(sl.end_hour))
    dur = end - start
    if dur < 0:
        dur += Decimal("24")
    return dur


def schedule_hours_per_day(sched: Optional[WorkSchedule], slots: list) -> Decimal:
    """Среднее количество рабочих часов в сутки по графику работы."""
    if not sched or not slots:
        return DEFAULT_HOURS_PER_DAY

    work = [s for s in slots if s.kind == "work"]
    if not work:
        return DEFAULT_HOURS_PER_DAY
    breaks = [s for s in slots if s.kind == "break"]

    if sched.fill_mode == "cycle" and sched.cycle_length:
        total = sum(_slot_hours(s) for s in work) - sum(_slot_hours(s) for s in breaks)
        if total <= 0:
            return DEFAULT_HOURS_PER_DAY
        return total / Decimal(str(sched.cycle_length))

    # weekdays: среднее по дням недели, где есть рабочие слоты
    per_day: dict[int, Decimal] = {}
    for s in work:
        d = s.day_of_week if s.day_of_week is not None else 0
        per_day[d] = per_day.get(d, Decimal("0")) + _slot_hours(s)
    for s in breaks:
        d = s.day_of_week if s.day_of_week is not None else 0
        per_day[d] = per_day.get(d, Decimal("0")) - _slot_hours(s)

    positive = [v for v in per_day.values() if v > 0]
    if not positive:
        return DEFAULT_HOURS_PER_DAY
    return sum(positive) / Decimal(len(positive))


async def _load_calendar_days(db, tenant_id, country_code, year) -> Optional[dict]:
    """Загрузить дни календаря страны на год → {date: ProductionCalendarDay}."""
    result = await db.execute(
        select(ProductionCalendar).where(
            ProductionCalendar.tenant_id == tenant_id,
            ProductionCalendar.country_code == country_code,
            ProductionCalendar.year == year,
        )
    )
    cal = result.scalars().first()
    if not cal:
        return None
    days_result = await db.execute(
        select(ProductionCalendarDay).where(ProductionCalendarDay.calendar_id == cal.id)
    )
    return {d.date: d for d in days_result.scalars().all()}


class CalendarResolver:
    """Разрешает рабочее время по дате, подтягивая календари по годам (кэш)."""

    def __init__(self, db: AsyncSession, tenant_id, country_code: str, extra_exceptions: list | None = None):
        self.db = db
        self.tenant_id = tenant_id
        self.country_code = country_code
        # extra_exceptions: список интервалов недоступности [(date_from: date, date_to: date), ...]
        self.extra_exceptions = extra_exceptions or []
        self._cache: dict[int, dict] = {}
        self.found = True  # False если хотя бы один год без календаря

    def _in_extra_exception(self, d: date) -> bool:
        for (f, t) in self.extra_exceptions:
            try:
                if f <= d <= t:
                    return True
            except TypeError:
                # на случай datetime — привести к date
                f2 = f.date() if hasattr(f, 'date') else f
                t2 = t.date() if hasattr(t, 'date') else t
                if f2 <= d <= t2:
                    return True
        return False

    async def _days_for(self, d: date) -> dict:
        year = d.year
        if year not in self._cache:
            days = await _load_calendar_days(self.db, self.tenant_id, self.country_code, year)
            if days is None:
                self.found = False
                self._cache[year] = {}
            else:
                self._cache[year] = days
        return self._cache[year]

    async def day_for(self, d: date):
        return (await self._days_for(d)).get(d)

    async def is_working(self, d: date) -> bool:
        if self._in_extra_exception(d):
            return False
        day = await self.day_for(d)
        if day is None:
            return d.weekday() < 5  # фолбэк: Пн–Пт рабочий
        return day.day_type in ("work", "preholiday")


async def working_day_index_to_date(resolver: CalendarResolver, anchor: date, index: int) -> date:
    """Найти дату N-го рабочего дня (0-based) от anchor включительно."""
    d = anchor
    while not await resolver.is_working(d):
        d += timedelta(days=1)
    # d — рабочий день №0
    for _ in range(index):
        d += timedelta(days=1)
        while not await resolver.is_working(d):
            d += timedelta(days=1)
    return d


async def date_to_working_day_index(resolver: CalendarResolver, anchor: date, target: date) -> int:
    """Число рабочих дней от anchor до target (включительно) минус 1."""
    index = 0
    d = anchor
    while not await resolver.is_working(d):
        d += timedelta(days=1)
    while d < target:
        d += timedelta(days=1)
        if await resolver.is_working(d):
            index += 1
    return index
