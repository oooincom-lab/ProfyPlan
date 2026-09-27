/**
 * Вероятность уложиться в дату (блок 6.14г — режим цели).
 *
 * Дата обосновывается вероятностью, а не одной цифрой. Если распределение срока известно
 * (страницы PERT и Монте-Карло), вероятность считается по нему. Если распределения нет —
 * возвращается null, и вызывающая сторона обязана показать «нет данных», а не подставить
 * правдоподобное число.
 *
 * Два способа, и они честно различаются в подписи:
 *   'normal' — аналитически по ожидаемому сроку и разбросу (допущение PERT: критический путь неизменен);
 *   'curve'  — по S-кривой Монте-Карло (точнее: учитывает переходы критичности).
 */

/** Функция стандартного нормального распределения (точность ~1e-7, достаточно для сроков). */
export function normalCdf(z: number): number {
  // Аппроксимация по erf через ряд Зеленого-Абрамовица
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export type ProbabilityResult = {
  probability: number;
  method: 'normal' | 'curve';
  note: string;
};

/** Вероятность уложиться в дату по нормальному приближению: (дата − ожидаемый срок) / σ. */
export function probabilityByNormal(
  expectedHours: number,
  sigmaHours: number,
  dateHoursFromStart: number,
): ProbabilityResult {
  if (!(sigmaHours > 0)) {
    return {
      probability: dateHoursFromStart >= expectedHours ? 1 : 0,
      method: 'normal',
      note: 'разброс нулевой: все оценки одинаковы, вероятности считать не из чего',
    };
  }
  const z = (dateHoursFromStart - expectedHours) / sigmaHours;
  const probability = Math.max(0, Math.min(1, normalCdf(z)));
  return {
    probability,
    method: 'normal',
    note: 'по ожидаемому сроку и разбросу (допущение PERT: состав критического пути не меняется)',
  };
}

/** Вероятность по S-кривой Монте-Карло: ближайшие две точки интерполируются. */
export function probabilityByCurve(
  curve: { duration: number; probability: number }[],
  dateHoursFromStart: number,
): ProbabilityResult | null {
  const points = (curve || [])
    .map((p) => ({ duration: Number(p.duration), probability: Number(p.probability) }))
    .filter((p) => Number.isFinite(p.duration) && Number.isFinite(p.probability))
    .sort((a, b) => a.duration - b.duration);
  if (points.length < 2) return null;
  if (dateHoursFromStart <= points[0].duration) {
    return { probability: points[0].probability, method: 'curve', note: 'по S-кривой Монте-Карло' };
  }
  const last = points[points.length - 1];
  if (dateHoursFromStart >= last.duration) {
    return { probability: last.probability, method: 'curve', note: 'по S-кривой Монте-Карло' };
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (dateHoursFromStart <= b.duration) {
      const k = (dateHoursFromStart - a.duration) / (b.duration - a.duration || 1);
      return {
        probability: a.probability + k * (b.probability - a.probability),
        method: 'curve',
        note: 'по S-кривой Монте-Карло (между двумя точками кривой)',
      };
    }
  }
  return null;
}

/** Состояние цели по вероятности: зелёный — уверенно, жёлтый — под риском, красный — недостижимо. */
export function goalState(probability: number): { label: string; color: string } {
  if (probability >= 0.8) return { label: 'достижима', color: 'var(--success)' };
  if (probability >= 0.5) return { label: 'под риском', color: 'var(--warning)' };
  if (probability >= 0.2) return { label: 'высокий риск', color: 'var(--warning)' };
  return { label: 'недостижима по расчёту', color: '#EF4444' };
}
