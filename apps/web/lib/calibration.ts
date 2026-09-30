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
};

export type CalibrationObs = {
  id: string;
  name: string;
  estimate: number; // M, наиболее вероятная оценка, ч
  fact: number; // фактическая длительность, ч
  ratio: number; // факт / оценка
  finishedOn: string | null; // YYYY-MM-DD, если указана
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

/** «01.10.2026» — дата для человека; null → «—». */
export function fmtDateRu(d: string | null): string {
  return d ? d.split('-').reverse().join('.') : '—';
}
