"""Частичное переплетение операций на общем ресурсе (шаг 4 блока 6.5).

Когда приоритетный заказ не может ни вытеснить чужую операцию, ни сдвинуть свой
якорь, разрешается частичное переплетение: внутри окна пересечения ресурс делится
по сменам — операции чередуются участками.

Предохранители (настройки «Приоритетные заказы»):
    allow_interleave            — разрешено ли переплетение вообще;
    interleave_step             — шаг чередования (hour | half_shift | shift | day);
    min_chunk                   — минимальный непрерывный участок;
    max_preemptions             — лимит прерываний на операцию;
    interleave_max_operations   — лимит участников на ресурсе (2–3).

Учитывается повторная переналадка: каждый возврат к чужой операции добавляет её
время наладки. Каскад не запускается: считается ровно та пара, которую выбрал
человек, остальные конфликты остаются нерешёнными.
"""
from datetime import datetime, timedelta
from typing import Any, Optional

STEP_HOURS = {"hour": 1.0, "half_shift": 4.0, "shift": 8.0, "day": 8.0}
MIN_CHUNK_HOURS = {"hour": 1.0, "half_shift": 4.0, "shift": 8.0, "day": 8.0}
STEP_LABEL = {"hour": "час", "half_shift": "полсмены", "shift": "смена", "day": "день"}
MIN_CHUNK_LABEL = {"hour": "час", "half_shift": "полсмены", "shift": "смена", "day": "день"}


def _int_setting(value, default: int) -> int:
    """Целое из настроек: ноль — допустимое значение, None и мусор — значение по умолчанию."""
    if value is None:
        return default
    try:
        return int(value)
    except Exception:
        return default


def _fmt(hours: float) -> str:
    whole = int(hours)
    rest = round((hours - whole) * 60)
    if whole and rest:
        return "%d ч %d мин" % (whole, rest)
    if whole:
        return "%d ч" % whole
    return "%d мин" % rest


def build_interleave_plan(
    priority_op: dict,
    other_op: dict,
    settings: Optional[dict] = None,
    setup_hours: float = 0.0,
) -> dict:
    """План чередования двух операций на одном ресурсе.

    priority_op / other_op: {"name": str, "start": datetime, "finish": datetime, "hours": float}
    """
    settings = settings or {}
    step_raw = str(settings.get("priority_orders.interleave_step", "shift") or "shift")
    min_raw = str(settings.get("priority_orders.min_chunk", "half_shift") or "half_shift")
    enabled = bool(settings.get("priority_orders.allow_interleave", False))
    max_preemptions = _int_setting(settings.get("priority_orders.max_preemptions"), 2)
    max_participants = _int_setting(settings.get("priority_orders.interleave_max_operations"), 2)

    step = STEP_HOURS.get(step_raw, 8.0)
    min_chunk = MIN_CHUNK_HOURS.get(min_raw, 4.0)

    base = {
        "settings": {
            "allow_interleave": enabled,
            "interleave_step": step_raw,
            "interleave_step_hours": step,
            "min_chunk": min_raw,
            "min_chunk_hours": min_chunk,
            "max_preemptions": max_preemptions,
            "interleave_max_operations": max_participants,
        }
    }

    if not enabled:
        return {**base, "ok": False, "refusal":
                "Частичное переплетение выключено в настройках «Приоритетные заказы» — включите «Разрешать частичное переплетение»."}
    if max_participants < 2:
        return {**base, "ok": False, "refusal":
                "Лимит участников переплетения меньше двух — делить ресурс не с кем."}
    if step < min_chunk:
        return {**base, "ok": False, "refusal":
                "Шаг чередования (%s) меньше минимального непрерывного участка (%s) — участки будут короче допустимого." %
                (STEP_LABEL.get(step_raw, step_raw), MIN_CHUNK_LABEL.get(min_raw, min_raw))}

    a_start, a_finish = priority_op["start"], priority_op["finish"]
    b_start, b_finish = other_op["start"], other_op["finish"]
    win_start, win_end = max(a_start, b_start), min(a_finish, b_finish)
    overlap_hours = (win_end - win_start).total_seconds() / 3600.0
    if overlap_hours <= 0:
        return {**base, "ok": False, "refusal": "Пересечения по времени нет — переплетать нечего."}
    if overlap_hours < step * 2:
        return {**base, "ok": False, "refusal":
                "Окно пересечения %s — короче двух участков по %s. Переплетение невозможно." %
                (_fmt(overlap_hours), _fmt(step))}

    # чередуем: первым идёт приоритетный заказ
    segments = []
    cursor = win_start
    owner = "priority"
    while cursor < win_end:
        chunk_end = min(cursor + timedelta(hours=step), win_end)
        chunk_hours = (chunk_end - cursor).total_seconds() / 3600.0
        if chunk_hours < min_chunk and segments:
            # последний огрызок короче минимального участка — отдаём его предыдущему владельцу
            segments[-1]["to"] = chunk_end.isoformat(timespec="minutes")
            segments[-1]["hours"] = round(segments[-1]["hours"] + chunk_hours, 2)
            cursor = chunk_end
            continue
        segments.append({
            "owner": owner,
            "from": cursor.isoformat(timespec="minutes"),
            "to": chunk_end.isoformat(timespec="minutes"),
            "hours": round(chunk_hours, 2),
        })
        cursor = chunk_end
        owner = "other" if owner == "priority" else "priority"

    inferior = [s for s in segments if s["owner"] == "other"]
    switches = max(len(inferior) - 1, 0)

    # лимит прерываний: лишние возвраты к чужой операции отсекаем
    trimmed = False
    if switches > max_preemptions:
        allowed = max_preemptions + 1
        kept, seen = [], 0
        for s in segments:
            if s["owner"] == "other":
                seen += 1
                if seen > allowed:
                    continue
            kept.append(s)
        # «хвост» отдаём приоритетному заказу
        for s in kept:
            if s["owner"] == "priority":
                pass
        segments = kept
        trimmed = True
        inferior = [s for s in segments if s["owner"] == "other"]
        switches = max(len(inferior) - 1, 0)

    inferior_hours = round(sum(s["hours"] for s in inferior), 2)
    needed = float(other_op.get("hours") or 0.0)
    added_setup = round(setup_hours * switches, 2)
    shortfall = round(max(needed - (inferior_hours + added_setup), 0.0), 2)

    warn = []
    if added_setup > 0:
        warn.append("Повторная наладка: %d возврат(ов) к чужой операции добавляют %s." %
                    (switches, _fmt(added_setup)))
    if shortfall > 0:
        warn.append("Переплетение покрывает %s из %s потребных — не хватает %s: операция всё равно выйдет за окно." %
                    (_fmt(inferior_hours + added_setup), _fmt(needed), _fmt(shortfall)))
    if trimmed:
        warn.append("Число возвратов ограничено лимитом прерываний (%d) — участок сокращён." % max_preemptions)

    return {
        **base,
        "ok": True,
        "refusal": None,
        "window": {"from": win_start.isoformat(timespec="minutes"), "to": win_end.isoformat(timespec="minutes"),
                   "hours": round(overlap_hours, 2), "label": _fmt(overlap_hours)},
        "segments": segments,
        "summary": {
            "segments": len(segments),
            "inferior_chunks": len(inferior),
            "switches": switches,
            "participants": 2,
            "participants_limit": max_participants,
            "inferior_hours": inferior_hours,
            "added_setup_hours": added_setup,
            "other_operation_hours": round(needed, 2),
            "shortfall_hours": shortfall,
            "first_inferior_start": (inferior[0]["from"] if inferior else None),
        },
        "warnings": warn,
        "note": ("Переплетение — согласованная раскладка участков: приоритетный и уступающий заказ "
                 "по очереди занимают ресурс внутри окна. Каскад не запускается: остальные конфликты "
                 "остаются нерешёнными."),
    }
