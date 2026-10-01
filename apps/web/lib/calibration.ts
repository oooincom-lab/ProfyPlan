/**
 * Калибровка по историческим данным (блок 6.24).
 *
 * Обратная связь «факт → оценки»: по завершённым операциям сравниваем фактическую
 * длительность с оценкой M (наиболее вероятной). Отношение «факт / оценка» показывает,
 * насколько мы систематически недо- или переоцениваем работу.
 *
 * Правила:
 *  - в наблюдения попадают только строки с фактом > 0 и оценкой M > 0;
 *  - это подсказка с основанием (сколько наблюдений, за какой период), а не правка:
 *    оценки меняет человек, нажатием;
 *  - при отсутствии наблюдений возвращается null — интерфейс говорит «нет данных».
 */

export type CalibOpLike = {
  id: string;
  name: string;
  tm_likely?: number | string | null;
  fact_hours?: number | string | null;
  fact_finished_on?: string | null;
  operation_type?: string | null;
};

export type CalibrationObs = {
  id: string;
  name: string;
  estimate: number; // M, наиболее вероятная оценка, ч
  fact: number; // фактическая длительность, ч
  ratio: number; // факт / оценка
  finishedOn: string | null; // YYYY-MM-DD, если указана
  opType: string | null; // тип операции (production / procurement / …)
};

export type CalibrationStats = {
  n: number;
  median: number;
  mean: number;
  over: number; // наблюдений, где факт больше оценки
  under: number; // наблюдений, где факт меньше оценки
  from: string | null;
  to: string | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Наблюдения: завершённые операции (есть факт > 0) с заполненной оценкой M. */
export function factObservations(ops: CalibOpLike[]): CalibrationObs[] {
  const out: CalibrationObs[] = [];
  for (const op of ops) {
    const fact = num(op.fact_hours);
    const estimate = num(op.tm_likely);
    if (fact === null || estimate === null || fact <= 0 || estimate <= 0) continue;
    out.push({
      id: op.id,
      name: op.name,
      estimate,
      fact,
      ratio: fact / estimate,
      finishedOn: op.fact_finished_on ? String(op.fact_finished_on).slice(0, 10) : null,
      opType: op.operation_type ? String(op.operation_type) : null,
    });
  }
  return out;
}

/** Сводка по наблюдениям; null — истории нет (честное «нет данных»). */
export function calibrationStats(obs: CalibrationObs[]): CalibrationStats | null {
  if (!obs.length) return null;
  const ratios = obs.map((o) => o.ratio).sort((a, b) => a - b);
  const n = ratios.length;
  const median = n % 2 === 1 ? ratios[(n - 1) / 2] : (ratios[n / 2 - 1] + ratios[n / 2]) / 2;
  const mean = ratios.reduce((s, r) => s + r, 0) / n;
  const dates = obs
    .map((o) => o.finishedOn)
    .filter((d): d is string => !!d)
    .sort();
  return {
    n,
    median,
    mean,
    over: ratios.filter((r) => r > 1.0001).length,
    under: ratios.filter((r) => r < 0.9999).length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
  };
}

/** «×1.15» — компактная запись отношения. */
export function fmtRatio(r: number): string {
  return '×' + r.toFixed(2);
}

// ── Разбивка по типам операций (блок 6.24): единый коэффициент — не всегда вся правда;
// ── производство и закупка могут недооцениваться по-разному.

const TYPE_LABELS: Record<string, string> = {
  production: 'производство',
  procurement: 'закупка',
  transport: 'перевозка',
  assembly: 'сборка',
};

export function typeLabel(key: string): string {
  return TYPE_LABELS[key] || key;
}

export type CalibrationGroup = {
  key: string;
  label: string;
  n: number;
  median: number;
  mean: number;
  from: string | null;
  to: string | null;
};

/** Группировка наблюдений по типу операции: сколько и какая медиана у каждого типа. */
export function calibrationGroups(obs: CalibrationObs[]): CalibrationGroup[] {
  const by = new Map<string, number[]>();
  for (const o of obs) {
    const key = o.opType || 'other';
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(o.ratio);
  }
  const out: CalibrationGroup[] = [];
  for (const [key, ratios] of by) {
    ratios.sort((a, b) => a - b);
    const n = ratios.length;
    const median = n % 2 === 1 ? ratios[(n - 1) / 2] : (ratios[n / 2 - 1] + ratios[n / 2]) / 2;
    const mean = ratios.reduce((s, r) => s + r, 0) / n;
    const dates = obs
      .filter((o) => (o.opType || 'other') === key)
      .map((o) => o.finishedOn)
      .filter((d): d is string => !!d)
      .sort();
    out.push({ key, label: typeLabel(key), n, median, mean, from: dates[0] || null, to: dates[dates.length - 1] || null });
  }
  out.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return out;
}

// ── Достоверность коэффициента (блок 6.24): насколько можно доверять медиане ──
// Правила простые и проверяемые: «высокая» — от 5 наблюдений при узком разбросе,
// «средняя» — от 3, иначе «низкая». Дополнительно — предупреждения: слабая выборка,
// заметный/большой разброс, расхождение медиан по типам, давность наблюдений.

export type CalibrationReliability = {
  level: 'high' | 'medium' | 'low';
  label: string;
  n: number;
  min: number;
  max: number;
  spread: number; // max / min
  daysSinceLast: number | null;
  notes: string[]; // предупреждения для панели
};

/** Достоверность медианного коэффициента: уровень + честные оговорки. */
export function calibrationReliability(
  obs: CalibrationObs[],
  groups: CalibrationGroup[],
  now?: Date,
): CalibrationReliability | null {
  if (!obs.length) return null;
  const ratios = obs.map((o) => o.ratio);
  const n = ratios.length;
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  const spread = min > 0 ? max / min : max;
  let level: CalibrationReliability['level'] = 'low';
  if (n >= 5 && spread <= 1.5) level = 'high';
  else if (n >= 3 && spread <= 2) level = 'medium';
  const label = level === 'high' ? 'высокая' : level === 'medium' ? 'средняя' : 'низкая';

  let daysSinceLast: number | null = null;
  const dates = obs
    .map((o) => o.finishedOn)
    .filter((d): d is string => !!d)
    .sort();
  if (dates.length) {
    const last = new Date(dates[dates.length - 1] + 'T00:00:00Z');
    daysSinceLast = Math.floor(((now || new Date()).getTime() - last.getTime()) / 86400000);
  }

  const notes: string[] = [];
  if (n <= 2) notes.push(`Наблюдений мало (${n}) — коэффициент может быть случайным.`);
  if (spread > 2) notes.push(`Разброс большой: ${fmtRatio(min)}–${fmtRatio(max)} — по части строк поправка будет сильной.`);
  else if (spread > 1.5) notes.push(`Разброс заметный: ${fmtRatio(min)}–${fmtRatio(max)} — часть строк сместится сильнее медианы.`);
  if (groups.length > 1) {
    const meds = groups.map((g) => g.median);
    const dmin = Math.min(...meds);
    const dmax = Math.max(...meds);
    if (dmin > 0 && dmax / dmin > 1.1) {
      const parts = groups.map((g) => `${g.label} ${fmtRatio(g.median)} (${g.n})`).join(', ');
      notes.push(`Типы расходятся: ${parts} — надёжнее применять по типам отдельно.`);
    }
  }
  if (daysSinceLast !== null && daysSinceLast > 180) {
    notes.push(`Последнее наблюдение ${daysSinceLast} дн назад — данные могут быть неактуальны.`);
  }

  return { level, label, n, min, max, spread, daysSinceLast, notes };
}

/** «01.10.2026» — дата для человека; null → «—». */
export function fmtDateRu(d: string | null): string {
  return d ? d.split('-').reverse().join('.') : '—';
}
