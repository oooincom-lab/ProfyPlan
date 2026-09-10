"""
Эффективная мощность ресурсов: события мощности (форсаж/ограничение/простой)
и их влияние на длительность операций.

Единый источник истины для всех расчётов (календарный/Гант, CPM, CCM):
- рабочее окно дня берётся из графика работы (start_hour/end_hour слотов),
- множитель мощности считается по перекрытию периода события с рабочими днями операции,
- при нескольких ресурсах операции учитывается самый ограничивающий (минимум).
"""
import math
from datetime import datetime, time, timedelta

# Порог предупреждения muri: форсаж дольше N рабочих дней — риск перегрузки
FORSAZH_MAX_WORKDAYS = 5
# Значения по умолчанию, если график не задан
DEFAULT_DAY_START = 8.0
DEFAULT_WINDOW_HOURS = 8.0
# Защита от «бесконечной» раскладки
MAX_DAYS_PER_OP = 400


def format_duration(total_minutes: float, hours_per_day: float = 8.0) -> str:
    """Длительность в формате «N дн H ч M мин» (часы/минуты — остаток рабочего дня)."""
    tm = int(round(total_minutes))
    if tm <= 0:
        return "0 мин"
    day_min = max(int(round(hours_per_day * 60)), 1)
    d = tm // day_min
    rem = tm % day_min
    h = rem // 60
    mi = rem % 60
    parts = []
    if d:
        parts.append("%d дн" % d)
    if h:
        parts.append("%d ч" % h)
    if mi or not parts:
        parts.append("%d мин" % mi)
    return " ".join(parts)


def schedule_window(slots) -> tuple:
    """Рабочее окно дня из слотов графика: (начало смены, длина окна в часах).

    Учитываются рабочие слоты (kind='work'); перерывы удлиняют окно, поэтому
    длина окна = конец смены − начало смены, но не меньше суммы рабочих часов.
    Ночная смена (конец <= начало) — упрощение: +8 часов.
    """
    work = [sl for sl in (slots or []) if (getattr(sl, "kind", None) or "work") == "work"]
    if not work:
        return DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS
    starts = [float(sl.start_hour) for sl in work]
    ends = [float(sl.end_hour) for sl in work]
    ds = min(starts)
    de = max(ends)
    if de <= ds:
        de = ds + DEFAULT_WINDOW_HOURS
    hpd = 0.0
    for sl in work:
        hpd += max(float(sl.end_hour) - float(sl.start_hour), 0.0)
    win = max(de - ds, hpd, 0.5)
    return ds, win


def day_factor(events, day_windows: list) -> tuple:
    """Множитель мощности по перекрытию событий с рабочими днями операции.

    day_windows: список (начало_рабочего_дня, конец_рабочего_дня).
    Возвращает (m_eff, использованные события). multiplier=0 обнуляет мощность
    на своей доле; неперекрытые доли считаются нормой (×1.0).
    """
    n = len(day_windows)
    if n <= 0:
        return 1.0, []
    m = 1.0
    used = []
    for (w0, w1) in day_windows:
        wlen = (w1 - w0).total_seconds() / 60.0
        if wlen <= 0:
            continue
        for ev in events:
            mult = ev.capacity_multiplier
            if mult is None:
                continue
            a_ = max(ev.date_from, w0)
            b_ = min(ev.date_to, w1)
            if b_ <= a_:
                continue
            share = ((b_ - a_).total_seconds() / 60.0) / wlen / n
            m += share * (float(mult) - 1.0)
            used.append({
                "event_id": str(ev.id),
                "event_type": ev.event_type,
                "capacity_multiplier": float(mult),
                "share": round(share * n, 4),
                "reason": ev.reason,
            })
    return max(m, 0.0), used


async def op_day_windows(node, win_hours: float, day_start: float, resolver, anchor) -> list:
    """Рабочие дни операции как интервалы календарного времени."""
    from app.services.scheduling import working_day_index_to_date

    dur = float(node.total_duration)
    es = float(node.early_start)
    start_idx = int(math.floor(es))
    n_days = max(int(math.ceil(dur - 1e-9)), 1) if dur > 0 else 1
    extra = (es - math.floor(es)) * win_hours
    wins = []
    for k in range(min(n_days, MAX_DAYS_PER_OP)):
        d = await working_day_index_to_date(resolver, anchor, max(start_idx + k, 0))
        w0 = datetime.combine(d, time.min) + timedelta(hours=day_start)
        if k == 0:
            w0 = w0 + timedelta(hours=extra)
        wins.append((w0, w0 + timedelta(hours=win_hours)))
    return wins


def spread_work_hours(es_days: float, dur_days: float, hpd: float, win_hours: float, day_start: float) -> tuple:
    """Раскладывает рабочие часы операции по рабочим дням.

    Возвращает (начало: часы от полуночи первого дня, число дней до конца, конец: часы от полуночи).
    Ночь и выходные пропускаются: внутри дня доступно не более win_hours часов.
    """
    di_s = int(math.floor(es_days))
    start_hour = day_start + (es_days - di_s) * win_hours
    rem_h = dur_days * hpd
    di_e = di_s
    end_hour = start_hour
    guard = 0
    while rem_h > 1e-9 and guard < 5000:
        avail = win_hours - (end_hour - day_start)
        if rem_h <= avail:
            end_hour += rem_h
            rem_h = 0.0
        else:
            rem_h -= avail
            di_e += 1
            end_hour = day_start
        guard += 1
    return start_hour, di_e, end_hour
