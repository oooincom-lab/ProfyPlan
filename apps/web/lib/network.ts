/**
 * Расчёт сети: критический путь, резервы, сценарии (блоки 6.18 и 6.18.1 плана).
 *
 * Одна реализация на всё приложение — чтобы область расчёта, страница PERT и сценарии
 * не считали по-разному. Формулы классические:
 *   прямой проход  — ранние сроки (ES/EF) по длительностям,
 *   обратный проход — поздний срок операции = минимум по последователям от (поздний срок последователя − его длительность),
 *   резерв = поздний срок − длительность − раннее начало.
 *
 * Ошибка, которую здесь легко сделать и на которой я уже спотыкался: брать поздний срок
 * последователя вместо его позднего начала. Разница ровно в длительности последователя.
 */

export type NetOp = { id: string; duration: number; sigma?: number };

export type NetCpm = {
  length: number;
  sigma: number;
  criticalIds: Set<string>;
  slack: Map<string, number>;
  es: Map<string, number>;
  ef: Map<string, number>;
};

export function cpm(ops: NetOp[], deps: { predecessor_id: string; successor_id: string }[]): NetCpm {
  const ids = new Set(ops.map((o) => o.id));
  const byId = new Map(ops.map((o) => [o.id, o]));
  const succ = new Map<string, string[]>();
  const preds = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const o of ops) indeg.set(o.id, 0);
  for (const d of deps) {
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id)) continue;
    const s = succ.get(d.predecessor_id);
    if (s) s.push(d.successor_id);
    else succ.set(d.predecessor_id, [d.successor_id]);
    const p = preds.get(d.successor_id);
    if (p) p.push(d.predecessor_id);
    else preds.set(d.successor_id, [d.predecessor_id]);
    indeg.set(d.successor_id, (indeg.get(d.successor_id) || 0) + 1);
  }

  // Топологический порядок
  const queue = ops.filter((o) => (indeg.get(o.id) || 0) === 0).map((o) => o.id);
  const order: string[] = [];
  const left = new Map(indeg);
  while (queue.length) {
    const cur = queue.shift() as string;
    order.push(cur);
    for (const s of succ.get(cur) || []) {
      left.set(s, (left.get(s) || 0) - 1);
      if ((left.get(s) || 0) === 0) queue.push(s);
    }
  }
  for (const o of ops) if (!order.includes(o.id)) order.push(o.id);

  // Прямой проход
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const own = byId.get(id);
    if (!own) continue;
    let start = 0;
    for (const p of preds.get(id) || []) start = Math.max(start, ef.get(p) || 0);
    es.set(id, start);
    ef.set(id, start + Math.max(0, own.duration));
  }
  const length = Math.max(0, ...ops.map((o) => ef.get(o.id) || 0));

  // Обратный проход: поздний срок = минимум по последователям от (их поздний срок − их длительность)
  const lf = new Map<string, number>();
  for (const o of ops) lf.set(o.id, Number.POSITIVE_INFINITY);
  for (let iter = 0; iter < ops.length + 2; iter++) {
    let changed = false;
    for (const o of ops) {
      const followers = succ.get(o.id) || [];
      const finish = followers.length
        ? Math.min(...followers.map((f) => (lf.get(f) ?? Number.POSITIVE_INFINITY) - (byId.get(f)?.duration || 0)))
        : length;
      if (lf.get(o.id) !== finish) {
        lf.set(o.id, finish);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const slack = new Map<string, number>();
  for (const o of ops) slack.set(o.id, (lf.get(o.id) ?? length) - Math.max(0, o.duration) - (es.get(o.id) || 0));
  const criticalIds = new Set(ops.filter((o) => Math.abs(slack.get(o.id) || 0) < 0.001).map((o) => o.id));
  const variance = ops.filter((o) => criticalIds.has(o.id)).reduce((s, o) => s + (o.sigma || 0) * (o.sigma || 0), 0);
  return { length, sigma: Math.sqrt(variance), criticalIds, slack, es, ef };
}

/** Сценарный диапазон: один и тот же расчёт при всех длительностях, умноженных на коэффициент. */
export function scenario(
  ops: NetOp[],
  deps: { predecessor_id: string; successor_id: string }[],
  factor: number,
): number {
  return cpm(
    ops.map((o) => ({ ...o, duration: o.duration * factor, sigma: (o.sigma || 0) * factor })),
    deps,
  ).length;
}
