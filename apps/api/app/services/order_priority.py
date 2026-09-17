"""Единый справочник приоритетов заказа.

Значения: low | normal | high | critical. Подписи: Низкий · Обычный · Высокий · Срочный.

Раньше набор значений жил в трёх местах: шаблон в схеме API, карта русских подписей
в импорте Excel и словарь в интерфейсе. Из-за этого импорт не узнавал слово «Срочный»
(подпись critical в интерфейсе) и молча ставил «Обычный», а API отказывался принимать
знакомые человеку формулировки. Теперь источник один — этот модуль.

Живой приоритет заказа (low/normal/high/critical) — это только очерёдность в расчёте.
Неприкосновенность заказа — отдельный реквизит «Приоритетный заказ» (is_priority).
"""
from typing import Optional

ORDER_PRIORITY_VALUES = ("low", "normal", "high", "critical")
ORDER_PRIORITY_DEFAULT = "normal"
ORDER_PRIORITY_LABELS = {
    "low": "Низкий",
    "normal": "Обычный",
    "high": "Высокий",
    "critical": "Срочный",
}
# Синонимы: русские подписи, встречающиеся в файлах и в речи, и английские варианты.
ORDER_PRIORITY_ALIASES = {
    "low": "low", "низкий": "low", "невысокий": "low", "низший": "low",
    "normal": "normal", "обычный": "normal", "нормальный": "normal",
    "стандартный": "normal", "плановый": "normal", "": "normal",
    "high": "high", "высокий": "high", "повышенный": "high",
    "critical": "critical", "критический": "critical", "критичный": "critical",
    "срочный": "critical", "аварийный": "critical", "urgent": "critical", "asap": "critical",
}


def _key(value) -> str:
    return str(value if value is not None else "").strip().lower()


def is_known_priority(value) -> bool:
    """Значение (или его синоним) известно справочнику."""
    return _key(value) in ORDER_PRIORITY_ALIASES


def normalize_priority(value, default: str = ORDER_PRIORITY_DEFAULT) -> str:
    """Приводит значение к каноническому виду; неизвестное — к значению по умолчанию."""
    return ORDER_PRIORITY_ALIASES.get(_key(value), default)


def priority_label(value) -> str:
    return ORDER_PRIORITY_LABELS.get(normalize_priority(value), ORDER_PRIORITY_LABELS[ORDER_PRIORITY_DEFAULT])


def allowed_text() -> str:
    return " · ".join(ORDER_PRIORITY_LABELS[v] for v in ORDER_PRIORITY_VALUES)


def unknown_message(value) -> str:
    return ("Недопустимый приоритет «%s». Допустимо: %s (low, normal, high, critical)."
            % (value, allowed_text()))
