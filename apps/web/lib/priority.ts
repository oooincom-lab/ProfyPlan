/**
 * Единый справочник приоритетов заказов.
 *
 * Коды: low | normal | high | critical. Подпись «Срочный» соответствует коду critical —
 * именно так приоритет приходит из импорта таблиц и состава. Прежнее значение urgent
 * больше не используется: при чтении оно приводится к critical.
 *
 * Правило: любые подписи и списки выбора приоритета берутся только отсюда,
 * чтобы «Высокий/Выс./Обычный/Крит.» больше не расходились по разным экранам.
 */
export const ORDER_PRIORITY_VALUES = ['low', 'normal', 'high', 'critical'] as const;
export type OrderPriority = (typeof ORDER_PRIORITY_VALUES)[number];

export const ORDER_PRIORITY_OPTIONS: { value: OrderPriority; label: string }[] = [
  { value: 'low', label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Срочный' },
];

const LABELS: Record<string, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  critical: 'Срочный',
  urgent: 'Срочный',
};

/** Приводит любое значение к каноническому (urgent → critical, пустое или неизвестное → normal). */
export function normalizePriority(v?: string | null): OrderPriority {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'urgent') return 'critical';
  return (ORDER_PRIORITY_VALUES as readonly string[]).includes(s) ? (s as OrderPriority) : 'normal';
}

/** Подпись для списков и карточек. */
export function priorityLabel(v?: string | null): string {
  const s = String(v ?? '').trim().toLowerCase();
  return LABELS[s] || 'Обычный';
}

/** Класс значка совпадает с кодом приоритета (badge low / normal / high / critical). */
export function priorityBadgeClass(v?: string | null): string {
  return normalizePriority(v);
}
