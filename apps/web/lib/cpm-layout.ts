/**
 * Чистая раскладка сети CPM: колонки по датам/слоям, упорядочивание узлов
 * внутри колонки (барицентр по соседям + локальные улучшения по счётчику
 * качества) и мягкая подтяжка узла к средней линии соседей. Модуль намеренно
 * не зависит от React — одни и те же функции используют отрисовка (`CpmGraph`),
 * счётчик качества раскладки и автотест.
 */
import { CARD_W, CARD_H, segRectHit, segCross, EDGE_PAD, OBSTACLE_PAD } from './cpm-metrics';

export type Mode = 'byDate' | 'byLayer';

export interface GOp {
  id: string;
  num: number | string;
  name: string;
  code: string;
  detail: string;
  durDays: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  tf: number;
  crit: boolean;
  branch: boolean;
  hpd: number;
}

export interface Layout {
  pos: Record<string, [number, number]>;
  minX: number; maxX: number; minY: number; maxY: number;
  pxPerDay: number;
  bucketDays: number;
  minEs: number;
}

/** Настройки раскладки (значения по умолчанию рассчитаны на интерактив). */
export interface LayoutOptions {
  /** Проходов «барицентр вперёд-назад» (упорядочивание внутри колонок). */
  baryPasses?: number;
  /** Проходов локального улучшения (перестановки + подтяжка). 0 — выключить. */
  localPasses?: number;
  /** Множитель шага подтяжки к средней линии соседей (0..1). */
  pullStep?: number;
  /** Полуширина окна переноса узла внутри колонки (0 — только соседние). */
  moveWindow?: number;
  /** Жёсткий потолок числа оценок счётчика (защита от тормозов). */
  maxEvals?: number;
  /** Вес простого пересечения связей в критерии. */
  crossWeight?: number;
  /** Вес «прохода связи сквозь посторонний узел» в критерии (наложение узлов весит больше). */
  hitWeight?: number;
  /** Вес «наложения узлов» в критерии (пересечение = 1). */
  overlapWeight?: number;
  /** Как считать барицентр по соседям: среднее или медиана. */
  baryMode?: 'mean' | 'median';
  /** Как считать цель подтяжки узла: среднее или медиана соседей. */
  pullMode?: 'mean' | 'median';
}

/** Минимальный зазор между узлами по обеим осям. */
export const MIN_GAP = 12;
/** Колонки: COL_PITCH = CARD_W + COL_GAP (> CARD_W + MIN_GAP). */
export const COL_GAP = 34;
/** Ряды: ROW_PITCH = CARD_H + ROW_GAP (> CARD_H + MIN_GAP). */
export const ROW_GAP = 22;
export const COL_PITCH = CARD_W + COL_GAP;
export const ROW_PITCH = CARD_H + ROW_GAP;
export const PAD = 70;

const EDGE_HW = CARD_W / 2 + EDGE_PAD;
const EDGE_HH = CARD_H / 2 + EDGE_PAD;
const OB_HW = CARD_W / 2 + OBSTACLE_PAD;
const OB_HH = CARD_H / 2 + OBSTACLE_PAD;

/**
 * Раскладка: колонки по датам/слоям, порядок внутри колонки (барицентр),
 * затем локальные улучшения по счётчику качества (перестановки соседних узлов
 * и подтяжка к средней линии соседей), затем «разведение рядов» с зазором.
 */
export function computeLayout(
  ops: GOp[],
  deps: [string, string][],
  mode: Mode,
  opts: LayoutOptions = {},
): Layout {
  const baryPasses = opts.baryPasses ?? 4;
  const localPasses = opts.localPasses ?? 8;
  const pullStep = opts.pullStep ?? 0.5;
  const moveWindow = opts.moveWindow ?? 20;
  const maxEvals = opts.maxEvals ?? 6000;
  const crossWeight = opts.crossWeight ?? 1;
  const hitWeight = opts.hitWeight ?? 1;
  const overlapWeight = opts.overlapWeight ?? 50;
  const baryMode = opts.baryMode ?? 'mean';
  const pullMode = opts.pullMode ?? 'mean';

  /** Среднее или медиана массива чисел (медиана устойчивее к выбросам-«дальним» соседям). */
  const central = (vals: number[], mode: 'mean' | 'median'): number => {
    if (!vals.length) return 0;
    if (mode === 'mean') return vals.reduce((s, v) => s + v, 0) / vals.length;
    const s = vals.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const ids = new Set(ops.map((o) => o.id));
  const preds: Record<string, string[]> = {};
  const succs: Record<string, string[]> = {};
  ops.forEach((o) => { preds[o.id] = []; succs[o.id] = []; });
  const edges: [string, string][] = [];
  deps.forEach(([a, b]) => {
    if (ids.has(a) && ids.has(b)) { succs[a].push(b); preds[b].push(a); edges.push([a, b]); }
  });

  const minEs = Math.min(0, ...ops.map((o) => o.es));
  const maxEf = Math.max(1, ...ops.map((o) => o.ef));
  const span = Math.max(maxEf - minEs, 1);

  let bucketDays = 1;
  let colOf: (o: GOp) => number;
  if (mode === 'byLayer') {
    const uniq = Array.from(new Set(ops.map((o) => Math.round(o.es * 1000) / 1000))).sort((a, b) => a - b);
    const idx = new Map<number, number>(uniq.map((v, i) => [v, i]));
    colOf = (o) => idx.get(Math.round(o.es * 1000) / 1000) ?? 0;
  } else {
    bucketDays = Math.max(1, Math.round(span / 48));
    colOf = (o) => Math.floor((o.es - minEs) / bucketDays);
  }

  const groups = new Map<number, GOp[]>();
  ops.forEach((o) => {
    const c = colOf(o);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(o);
  });
  const colKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  const colIndex = new Map<number, number>(colKeys.map((c, i) => [c, i]));
  const colOfId: Record<string, number> = {};
  colKeys.forEach((c) => groups.get(c)!.forEach((o) => { colOfId[o.id] = c; }));

  // ── стартовый порядок внутри колонки: по раннему старту, затем по длительности/имени ──
  const orderY: Record<string, number> = {};
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    // Тай-брейк по имени — сравнение код-поинтов (без зависимости от локали браузера).
    g.sort((a, b) => (a.es - b.es) || (b.durDays - a.durDays) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    g.forEach((o, i) => { orderY[o.id] = i; });
  });

  // ── барицентр: 2–4 прохода «вперёд-назад» (позиция = средняя позиция предшественников,
  //    затем последователей) — снижает число пересечений связей ──
  for (let pass = 0; pass < baryPasses; pass++) {
    const forward = pass % 2 === 0;
    const seq = forward ? colKeys : colKeys.slice().reverse();
    seq.forEach((c) => {
      const g = groups.get(c)!;
      const bary = g.map((o) => {
        const main = (forward ? preds[o.id] : succs[o.id]).map((id) => orderY[id]).filter((v) => v != null);
        const altList = (forward ? succs[o.id] : preds[o.id]).map((id) => orderY[id]).filter((v) => v != null);
        const list = main.length ? main : altList;
        return list.length ? central(list, baryMode) : orderY[o.id];
      });
      const order = g.map((_, i) => i).sort((i, j) => (bary[i] - bary[j]) || (i - j));
      const reordered = order.map((i) => g[i]);
      reordered.forEach((o, i) => { orderY[o.id] = i; });
      groups.set(c, reordered);
    });
  }

  // ── стартовая раскладка: внутри колонки равномерная укладка с центрированием ──
  const pos: Record<string, [number, number]> = {};
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    const ci = colIndex.get(c)!;
    const x = PAD + ci * COL_PITCH + CARD_W / 2;
    const total = g.length * ROW_PITCH;
    const y0 = -total / 2 + ROW_PITCH / 2;
    g.forEach((o, i) => { pos[o.id] = [x, y0 + i * ROW_PITCH]; });
  });

  // ── локальные улучшения по счётчику качества ──
  // Принимаем изменение только если суммарный критерий
  // (пересечения + проходы сквозь узлы + наложения узлов) строго уменьшился.
  if (localPasses > 0 && ops.length > 1 && edges.length) {
    improveLocally(ops, edges, preds, succs, colKeys, groups, pos, {
      localPasses, pullStep, moveWindow, maxEvals, crossWeight, hitWeight, overlapWeight, pullMode,
    });
  }

  // ── финальная гарантия зазора (на случай выключенного локального поиска) ──
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    const arr = g.slice().sort((p, q) => (pos[p.id][1] - pos[q.id][1]) || (orderY[p.id] - orderY[q.id]));
    for (let i = 1; i < arr.length; i++) {
      if (pos[arr[i].id][1] - pos[arr[i - 1].id][1] < ROW_PITCH) {
        pos[arr[i].id][1] = pos[arr[i - 1].id][1] + ROW_PITCH;
      }
    }
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  Object.keys(pos).forEach((id) => {
    const [x, y] = pos[id];
    if (x - CARD_W / 2 < minX) minX = x - CARD_W / 2;
    if (x + CARD_W / 2 > maxX) maxX = x + CARD_W / 2;
    if (y - CARD_H / 2 < minY) minY = y - CARD_H / 2;
    if (y + CARD_H / 2 > maxY) maxY = y + CARD_H / 2;
  });
  if (!ops.length) { minX = 0; maxX = 100; minY = 0; maxY = 100; }

  return {
    pos, minX, maxX, minY, maxY,
    pxPerDay: COL_PITCH / (mode === 'byDate' ? bucketDays : 1),
    bucketDays,
    minEs,
  };
}

/* ───────────────── локальный поиск по счётчику качества ───────────────── */

interface SearchOpts {
  localPasses: number;
  pullStep: number;
  moveWindow: number;
  maxEvals: number;
  crossWeight: number;
  hitWeight: number;
  overlapWeight: number;
  pullMode: 'mean' | 'median';
}

/**
 * Локальные улучшения без аллокаций в горячем цикле: узлы лежат в типизированных
 * массивах px/py, счётчик считается той же формулой, что и в панели (прямые
 * связи, до обхода), — поэтому снижение стоимости ведёт к снижению счётчика.
 */
function improveLocally(
  ops: GOp[],
  edges: [string, string][],
  preds: Record<string, string[]>,
  succs: Record<string, string[]>,
  colKeys: number[],
  groups: Map<number, GOp[]>,
  pos: Record<string, [number, number]>,
  o: SearchOpts,
): void {
  const n = ops.length;
  const ni: Record<string, number> = {};
  ops.forEach((op, i) => { ni[op.id] = i; });
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  ops.forEach((op, i) => { px[i] = pos[op.id][0]; py[i] = pos[op.id][1]; });

  const m = edges.length;
  const ea = new Int32Array(m);
  const eb = new Int32Array(m);
  edges.forEach(([a, b], k) => { ea[k] = ni[a]; eb[k] = ni[b]; });
  const sx = new Float64Array(m);
  const sy = new Float64Array(m);
  const ex = new Float64Array(m);
  const ey = new Float64Array(m);
  const bx0 = new Float64Array(m);
  const bx1 = new Float64Array(m);
  const by0 = new Float64Array(m);
  const by1 = new Float64Array(m);

  // рёбра по узлам (для быстрого пересчёта при правке узла не требуется — cost считается целиком)
  const colNodes: number[][] = colKeys.map((c) => groups.get(c)!.map((g) => ni[g.id]));
  const colOfNode = new Int32Array(n);
  colKeys.forEach((c, ci) => colNodes[ci].forEach((idx) => { colOfNode[idx] = ci; }));

  const neighbours: number[][] = new Array(n);
  ops.forEach((op, i) => {
    const list: number[] = [];
    preds[op.id].forEach((id) => { if (ni[id] != null) list.push(ni[id]); });
    succs[op.id].forEach((id) => { if (ni[id] != null) list.push(ni[id]); });
    neighbours[i] = list;
  });

  /** Пересчёт точек выхода связей на границы узлов (без аллокаций). */
  const refresh = (): void => {
    for (let k = 0; k < m; k++) {
      const a = ea[k];
      const b = eb[k];
      const ax = px[a];
      const ay = py[a];
      const bx = px[b];
      const by = py[b];
      let dx = bx - ax;
      let dy = by - ay;
      if (dx === 0 && dy === 0) { sx[k] = ax; sy[k] = ay; ex[k] = bx; ey[k] = by; }
      else {
        let tx = dx === 0 ? Infinity : EDGE_HW / Math.abs(dx);
        let ty = dy === 0 ? Infinity : EDGE_HH / Math.abs(dy);
        const t1 = tx < ty ? tx : ty;
        sx[k] = ax + dx * t1;
        sy[k] = ay + dy * t1;
        dx = ax - bx;
        dy = ay - by;
        if (dx === 0 && dy === 0) { ex[k] = bx; ey[k] = by; }
        else {
          tx = dx === 0 ? Infinity : EDGE_HW / Math.abs(dx);
          ty = dy === 0 ? Infinity : EDGE_HH / Math.abs(dy);
          const t2 = tx < ty ? tx : ty;
          ex[k] = bx + dx * t2;
          ey[k] = by + dy * t2;
        }
      }
      const x0 = sx[k];
      const x1 = ex[k];
      const y0 = sy[k];
      const y1 = ey[k];
      bx0[k] = x0 < x1 ? x0 : x1;
      bx1[k] = x0 < x1 ? x1 : x0;
      by0[k] = y0 < y1 ? y0 : y1;
      by1[k] = y0 < y1 ? y1 : y0;
    }
  };

  /** Стоимость = пересечения + проходы сквозь узлы + наложения узлов (как счётчик панели). */
  const cost = (): number => {
    refresh();
    let overlaps = 0;
    for (let i = 0; i < n; i++) {
      const axi = px[i];
      const ayi = py[i];
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(axi - px[j]) < CARD_W && Math.abs(ayi - py[j]) < CARD_H) overlaps++;
      }
    }
    let hits = 0;
    for (let k = 0; k < m; k++) {
      const a = ea[k];
      const b = eb[k];
      const x1 = sx[k];
      const y1 = sy[k];
      const x2 = ex[k];
      const y2 = ey[k];
      const lox = bx0[k] - OB_HW;
      const hix = bx1[k] + OB_HW;
      const loy = by0[k] - OB_HH;
      const hiy = by1[k] + OB_HH;
      for (let i = 0; i < n; i++) {
        if (i === a || i === b) continue;
        const nx = px[i];
        const ny = py[i];
        if (nx < lox || nx > hix || ny < loy || ny > hiy) continue;
        if (segRectHit(x1, y1, x2, y2, nx, ny, OB_HW, OB_HH)) hits++;
      }
    }
    let crossings = 0;
    for (let i = 0; i < m; i++) {
      const a1 = ea[i];
      const b1 = eb[i];
      const ix0 = bx0[i];
      const ix1 = bx1[i];
      const iy0 = by0[i];
      const iy1 = by1[i];
      for (let j = i + 1; j < m; j++) {
        const a2 = ea[j];
        const b2 = eb[j];
        if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
        if (ix0 > bx1[j] || bx0[j] > ix1 || iy0 > by1[j] || by0[j] > iy1) continue;
        if (segCross(sx[i], sy[i], ex[i], ey[i], sx[j], sy[j], ex[j], ey[j])) crossings++;
      }
    }
    return o.crossWeight * crossings + o.hitWeight * hits + o.overlapWeight * overlaps;
  };

  const packColumn = (ci: number): void => {
    const nodes = colNodes[ci];
    const arr = nodes.slice().sort((a, b) => py[a] - py[b]);
    for (let i = 1; i < arr.length; i++) {
      if (py[arr[i]] - py[arr[i - 1]] < ROW_PITCH) py[arr[i]] = py[arr[i - 1]] + ROW_PITCH;
    }
  };

  let cur = cost();
  let evals = 0;
  const step = o.pullStep;

  for (let pass = 0; pass < o.localPasses; pass++) {
    let improved = false;

    // 1) сдвиг/перенос узла внутри колонки по позициям Y (соседние + окно)
    for (let ci = 0; ci < colNodes.length; ci++) {
      const nodes = colNodes[ci];
      if (nodes.length < 2) continue;
      const arr = nodes.slice().sort((a, b) => py[a] - py[b]);
      const ys = arr.map((x) => py[x]);
      for (let i = 0; i < arr.length; i++) {
        const lo = Math.max(0, i - o.moveWindow);
        const hi = Math.min(arr.length - 1, i + o.moveWindow);
        for (let j = lo; j <= hi; j++) {
          if (j === i) continue;
          if (evals++ > o.maxEvals) break;
          // переносим узел arr[i] на позицию j, значения Y раздаём по порядку
          const order = arr.slice();
          const moved = order.splice(i, 1)[0];
          order.splice(j, 0, moved);
          for (let t = 0; t < order.length; t++) py[order[t]] = ys[t];
          const nc = cost();
          if (nc < cur - 1e-9) {
            cur = nc;
            improved = true;
            arr.length = 0; order.forEach((x) => arr.push(x));
            // синхронизируем порядок колонки
            colNodes[ci] = order.slice();
            break;
          } else {
            for (let t = 0; t < arr.length; t++) py[arr[t]] = ys[t];
          }
        }
      }
    }

    // 2) подтяжка узла к средней линии соседей (предшественники + последователи)
    for (let i = 0; i < n; i++) {
      if (evals++ > o.maxEvals) break;
      const nb = neighbours[i];
      if (!nb.length) continue;
      let desired: number;
      if (o.pullMode === 'median') {
        const vals = nb.map((t) => py[t]).sort((a, b) => a - b);
        const mm = vals.length >> 1;
        desired = vals.length % 2 ? vals[mm] : (vals[mm - 1] + vals[mm]) / 2;
      } else {
        let sum = 0;
        for (let t = 0; t < nb.length; t++) sum += py[nb[t]];
        desired = sum / nb.length;
      }
      const y0 = py[i];
      const y1 = y0 + (desired - y0) * step;
      if (Math.abs(y1 - y0) < 1e-6) continue;

      const ci = colOfNode[i];
      const nodes = colNodes[ci];
      const backup = nodes.map((x) => py[x]);
      py[i] = y1;
      packColumn(ci);
      const nc = cost();
      if (nc < cur - 1e-9) {
        cur = nc;
        improved = true;
      } else {
        for (let t = 0; t < nodes.length; t++) py[nodes[t]] = backup[t];
      }
    }

    if (!improved) break;
  }

  // записываем результат обратно
  ops.forEach((op, i) => { pos[op.id][1] = py[i]; });
}
