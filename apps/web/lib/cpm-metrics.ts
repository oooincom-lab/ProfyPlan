/**
 * Чистая геометрия раскладки сети CPM и метрики её качества.
 *
 * Модуль намеренно не зависит от React: одни и те же функции используют
 * отрисовка узлов/связей (`CpmGraph`), подсчёт метрик раскладки и автотест.
 *
 * Метрики раскладки (в мировых координатах, т.е. не зависят от зума):
 *   • crossings     — сколько пар связей пересекаются между собой
 *                     (пересечение отрезков; пары с общим концом не считаются);
 *   • edgeNodeHits  — сколько связей проходит сквозь прямоугольник
 *                     постороннего узла (свои концы не считаются);
 *   • nodeOverlaps  — сколько пар узлов перекрываются прямоугольниками;
 *   • density       — суммарная площадь узлов к площади полотна, в процентах.
 */

/** Размер карточки узла в мировых координатах (базовый, «Обычно»). */
export const CARD_W = 208;
export const CARD_H = 60;

/** Зазор, на который линия «отступает» от границы своего узла (как при отрисовке). */
export const EDGE_PAD = 3;
/** Дополнительный зазор прямоугольников-препятствий при выборе обхода (как при отрисовке). */
export const OBSTACLE_PAD = 6;
/** Число точек выборки кривой при проверке прохода сквозь узлы (метрика и отрисовка). */
export const PATH_SAMPLES = 16;

/** Базовые (для раскладки «Обычно») зазоры между узлами и внешний отступ полотна. */
export const BASE_COL_GAP = 34;
export const BASE_ROW_GAP = 22;
export const BASE_PAD = 70;

/**
 * Геометрия раскладки — рамочная, но настраиваемая часть вида сети: размер
 * карточки узла, зазоры между колонками/рядами и внешний отступ полотна.
 *
 * Одна и та же геометрия применяется и к метрикам качества (пересечения,
 * наложения, плотность — всё в мировых координатах), и к раскладке, и к
 * отрисовке. Благодаря этому переключатель раскладки («Плотно» / «Обычно» /
 * «Для печати» / «Без пересечений») реально меняет и вид, и числа, а не только
 * внутренние проходы оптимизации.
 */
export interface LayoutGeometry {
  /** Ширина карточки узла в мировых координатах. */
  cardW: number;
  /** Высота карточки узла в мировых координатах. */
  cardH: number;
  /** Зазор между колонками (COL_PITCH = cardW + colGap). */
  colGap: number;
  /** Зазор между рядами (ROW_PITCH = cardH + rowGap). */
  rowGap: number;
  /** Внешний отступ полотна от крайних узлов. */
  pad: number;
  /** Отступ линии от границы своего узла (по умолчанию EDGE_PAD). */
  edgePad?: number;
  /** Дополнительный зазор препятствий при обходе (по умолчанию OBSTACLE_PAD). */
  obstaclePad?: number;
  /** Множитель базовых кеглей подписей узлов (1 — как в «Обычно»). */
  labelScale?: number;
}

/** Геометрия по умолчанию — состояние «Обычно» (совпадает с прежними константами). */
export const DEFAULT_GEOMETRY: Required<LayoutGeometry> = {
  cardW: CARD_W,
  cardH: CARD_H,
  colGap: BASE_COL_GAP,
  rowGap: BASE_ROW_GAP,
  pad: BASE_PAD,
  edgePad: EDGE_PAD,
  obstaclePad: OBSTACLE_PAD,
  labelScale: 1,
};

/** Достраивает частичную геометрию до полной значениями по умолчанию. */
export function resolveGeometry(g?: LayoutGeometry): Required<LayoutGeometry> {
  return {
    cardW: g?.cardW ?? DEFAULT_GEOMETRY.cardW,
    cardH: g?.cardH ?? DEFAULT_GEOMETRY.cardH,
    colGap: g?.colGap ?? DEFAULT_GEOMETRY.colGap,
    rowGap: g?.rowGap ?? DEFAULT_GEOMETRY.rowGap,
    pad: g?.pad ?? DEFAULT_GEOMETRY.pad,
    edgePad: g?.edgePad ?? DEFAULT_GEOMETRY.edgePad,
    obstaclePad: g?.obstaclePad ?? DEFAULT_GEOMETRY.obstaclePad,
    labelScale: g?.labelScale ?? DEFAULT_GEOMETRY.labelScale,
  };
}

export interface Rect { x: number; y: number; hw: number; hh: number }

/** Точка на границе прямоугольника/окружности по направлению к (tx,ty). */
export function borderPoint(cx: number, cy: number, hw: number, hh: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const tx1 = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty1 = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx1, ty1);
  return [cx + dx * t, cy + dy * t];
}

/** Точка квадратичной кривой Безье при параметре t. */
export function quadPt(
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number,
): [number, number] {
  const mt = 1 - t;
  return [mt * mt * x0 + 2 * mt * t * cx + t * t * x1, mt * mt * y0 + 2 * mt * t * cy + t * t * y1];
}

/** Пересекается ли отрезок (x1,y1)-(x2,y2) с прямоугольником (cx,cy,±hw,±hh) — slab-метод. */
export function segRectHit(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, hw: number, hh: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - (cx - hw), cx + hw - x1, y1 - (cy - hh), cy + hh - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

/** Сколько сэмплов кривой Безье попадает в посторонние узлы-препятствия. */
export function pathHits(
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  obstacles: Rect[], samples: number,
): number {
  // Прямая связь (без отклонения) — быстрая проверка через отрезок.
  if (cx === (x0 + x1) / 2 && cy === (y0 + y1) / 2) {
    let h = 0;
    for (let k = 0; k < obstacles.length; k++) {
      const ob = obstacles[k];
      if (segRectHit(x0, y0, x1, y1, ob.x, ob.y, ob.hw, ob.hh)) h++;
    }
    return h;
  }
  let hits = 0;
  for (let i = 1; i < samples; i++) {
    const [qx, qy] = quadPt(x0, y0, cx, cy, x1, y1, i / samples);
    for (let k = 0; k < obstacles.length; k++) {
      const ob = obstacles[k];
      if (qx > ob.x - ob.hw && qx < ob.x + ob.hw && qy > ob.y - ob.hh && qy < ob.y + ob.hh) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

/**
 * Кандидаты отклонения связи при обходе посторонних узлов (как при отрисовке).
 * Порядок — по возрастанию «крутизны» дуги, поэтому первое отклонение с нулём
 * проходов сквозь узлы и есть обход минимальным отклонением.
 */
export const DETOUR_OFFSETS = [10, -10, 16, -16, 24, -24, 34, -34, 46, -46, 60, -60, 78, -78, 100, -100, 126, -126, 156, -156, 190, -190, 232, -232, 282, -282, 340, -340];

/* ─────────────────────────── метрики раскладки ─────────────────────────── */

export interface LayoutMetrics {
  /** Пары связей, отрезки которых пересекаются (общий конец не считается). */
  crossings: number;
  /** Связи, проходящие сквозь прямоугольник постороннего узла. */
  edgeNodeHits: number;
  /** Пары узлов, перекрывающихся прямоугольниками. */
  nodeOverlaps: number;
  /** Суммарная площадь узлов к площади полотна, в процентах. */
  density: number;
  /** Сколько узлов участвовало в раскладке. */
  nodes: number;
  /** Сколько связей участвовало в раскладке. */
  edges: number;
}

export interface MetricNode { id: string; crit: boolean }
export interface MetricLayout {
  pos: Record<string, [number, number]>;
  minX: number; maxX: number; minY: number; maxY: number;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Знак векторного произведения (b−a)×(c−a). */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Лежит ли точка c на отрезке ab (при коллинеарности). */
function onSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const eps = 1e-9;
  return (
    cx >= Math.min(ax, bx) - eps && cx <= Math.max(ax, bx) + eps &&
    cy >= Math.min(ay, by) - eps && cy <= Math.max(ay, by) + eps
  );
}

/** Пересекаются ли отрезки (p1p2) и (p3p4), включая касание. */
export function segCross(
  p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number, p4x: number, p4y: number,
): boolean {
  const d1 = orient(p3x, p3y, p4x, p4y, p1x, p1y);
  const d2 = orient(p3x, p3y, p4x, p4y, p2x, p2y);
  const d3 = orient(p1x, p1y, p2x, p2y, p3x, p3y);
  const d4 = orient(p1x, p1y, p2x, p2y, p4x, p4y);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (Math.abs(d1) < 1e-9 && onSeg(p3x, p3y, p4x, p4y, p1x, p1y)) return true;
  if (Math.abs(d2) < 1e-9 && onSeg(p3x, p3y, p4x, p4y, p2x, p2y)) return true;
  if (Math.abs(d3) < 1e-9 && onSeg(p1x, p1y, p2x, p2y, p3x, p3y)) return true;
  if (Math.abs(d4) < 1e-9 && onSeg(p1x, p1y, p2x, p2y, p4x, p4y)) return true;
  return false;
}

/** Пересекаются ли прямоугольники (строгое наложение площади, не просто касание). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;
}

/**
 * Контрольная точка квадратичной кривой для связи s→e. Если прямая проходит
 * сквозь посторонние узлы, подбирается минимальное отклонение вбок, при котором
 * путь не задевает узлы; иначе связь остаётся прямой (контрольная точка = середина).
 * Возвращает контрольную точку Безье в мировых координатах.
 */
export function edgeControl(
  sxw: number, syw: number, exw: number, eyw: number,
  obstacles: Rect[],
): [number, number] {
  const dxw = exw - sxw;
  const dyw = eyw - syw;
  const lenw = Math.hypot(dxw, dyw) || 1;
  const pxw = -dyw / lenw;
  const pyw = dxw / lenw;
  const mxw = (sxw + exw) / 2;
  const myw = (syw + eyw) / 2;
  let bestOff = 0;
  let bestHits = pathHits(sxw, syw, mxw, myw, exw, eyw, obstacles, PATH_SAMPLES);
  if (bestHits > 0) {
    for (const off of DETOUR_OFFSETS) {
      const cxx = mxw + pxw * off * 2;
      const cyy = myw + pyw * off * 2;
      const hits = pathHits(sxw, syw, cxx, cyy, exw, eyw, obstacles, PATH_SAMPLES);
      if (hits === 0) { bestOff = off; bestHits = 0; break; }
      if (hits < bestHits) { bestHits = hits; bestOff = off; }
    }
  }
  return [mxw + pxw * bestOff * 2, myw + pyw * bestOff * 2];
}

/**
 * Считает метрики текущей раскладки. Работает в мировых координатах,
 * поэтому не зависит от масштаба просмотра; учитывает фильтр критического пути.
 */
export function computeLayoutMetrics(
  layout: MetricLayout,
  nodes: MetricNode[],
  deps: [string, string][],
  critOnly: boolean,
  geometry?: LayoutGeometry,
): LayoutMetrics {
  const G = resolveGeometry(geometry);
  const cw = G.cardW;
  const ch = G.cardH;
  const ep = G.edgePad;
  const op = G.obstaclePad;
  const vis = nodes.filter((n) => layout.pos[n.id] && (!critOnly || n.crit));
  const visIds = new Set(vis.map((n) => n.id));

  const rects: (Rect & { id: string })[] = vis.map((n) => {
    const p = layout.pos[n.id];
    return { id: n.id, x: p[0], y: p[1], hw: cw / 2, hh: ch / 2 };
  });

  // ── наложения узлов ──
  let nodeOverlaps = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) nodeOverlaps++;
    }
  }

  // ── связи: геометрия (старт/финиш + возможный обход посторонних узлов) ──
  interface E { a: string; b: string; s: [number, number]; e: [number, number]; c: [number, number] }
  const edges: E[] = [];
  const seen = new Set<string>();
  for (const [aId, bId] of deps) {
    if (aId === bId) continue;
    if (!visIds.has(aId) || !visIds.has(bId)) continue;
    const key = aId + '\u0001' + bId;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = layout.pos[aId];
    const pb = layout.pos[bId];
    const s = borderPoint(pa[0], pa[1], cw / 2 + ep, ch / 2 + ep, pb[0], pb[1]);
    const e = borderPoint(pb[0], pb[1], cw / 2 + ep, ch / 2 + ep, pa[0], pa[1]);
    const obstacles = rects
      .filter((r) => r.id !== aId && r.id !== bId)
      .map((r) => ({ x: r.x, y: r.y, hw: r.hw + op, hh: r.hh + op }));
    const c = edgeControl(s[0], s[1], e[0], e[1], obstacles);
    edges.push({ a: aId, b: bId, s, e, c });
  }

  // ── наложения связей на посторонние узлы ──
  let edgeNodeHits = 0;
  for (const ed of edges) {
    const actual = rects.filter((r) => r.id !== ed.a && r.id !== ed.b);
    if (pathHits(ed.s[0], ed.s[1], ed.c[0], ed.c[1], ed.e[0], ed.e[1], actual, PATH_SAMPLES) > 0) edgeNodeHits++;
  }

  // ── пересечения связей ──
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const A = edges[i];
      const B = edges[j];
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue; // общий конец
      if (segCross(A.s[0], A.s[1], A.e[0], A.e[1], B.s[0], B.s[1], B.e[0], B.e[1])) crossings++;
    }
  }

  // ── плотность: площадь узлов к площади полотна ──
  // Габарит считается по реальным узлам (а не по layout.minX/maxX): так в
  // геометрию можно добавить виртуальные события «Старт»/«Финиш» (они
  // расширяют полотно), не меняя число плотности в счётчике качества.
  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinY = Infinity;
  let bMaxY = -Infinity;
  for (const n of nodes) {
    const p = layout.pos[n.id];
    if (!p) continue;
    if (p[0] - cw / 2 < bMinX) bMinX = p[0] - cw / 2;
    if (p[0] + cw / 2 > bMaxX) bMaxX = p[0] + cw / 2;
    if (p[1] - ch / 2 < bMinY) bMinY = p[1] - ch / 2;
    if (p[1] + ch / 2 > bMaxY) bMaxY = p[1] + ch / 2;
  }
  const bboxW = Number.isFinite(bMinX) ? bMaxX - bMinX : layout.maxX - layout.minX;
  const bboxH = Number.isFinite(bMinY) ? bMaxY - bMinY : layout.maxY - layout.minY;
  const bboxArea = Math.max(1, bboxW) * Math.max(1, bboxH);
  const nodeArea = rects.length * cw * ch;
  const density = round1((nodeArea / bboxArea) * 100);

  return { crossings, edgeNodeHits, nodeOverlaps, density, nodes: vis.length, edges: edges.length };
}

/* ───────────────── единый показатель читаемости ───────────────── */

/** Порог «хорошо» показателя читаемости (%). */
export const READABILITY_GOOD = 90;
/** Нижняя граница «средне»: ниже неё показатель считается плохим. */
export const READABILITY_MID = 70;
/** Плотность (%), начиная с которой полотно считается перегруженным. */
const DENSITY_COMFORT_PCT = 25;

export type ReadabilityBand = 'good' | 'mid' | 'bad';

/**
 * Единый показатель читаемости раскладки, 0…100 %. Считается по тем же метрикам,
 * что раньше показывались четырьмя числами (пересечения, проходы сквозь узлы,
 * наложения узлов, плотность) — без сглаживания:
 *   • каждое пересечение связей   −0.5 %;
 *   • каждый проход сквозь узел    −3 %;
 *   • каждое наложение узлов       −6 %;
 *   • перегрузка плотности (>25 %) −0.8 % за каждый процент.
 * Показатель не заменяет метрики, а сводит их к одному числу; сами числа
 * остаются доступны в детализации по значку «i».
 */
export function readabilityScore(
  m: Pick<LayoutMetrics, 'crossings' | 'edgeNodeHits' | 'nodeOverlaps' | 'density'>,
): number {
  const densityPenalty = Math.max(0, m.density - DENSITY_COMFORT_PCT) * 0.8;
  const raw = 100 - 0.5 * m.crossings - 3 * m.edgeNodeHits - 6 * m.nodeOverlaps - densityPenalty;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Полоса показателя читаемости: зелёная / жёлтая / красная точка. */
export function readabilityBand(score: number): ReadabilityBand {
  if (score >= READABILITY_GOOD) return 'good';
  if (score >= READABILITY_MID) return 'mid';
  return 'bad';
}

/**
 * Числа пересечений зависят от укладки, поэтому в интерфейсе они показываются
 * раздельно («по датам» / «по слоям») как факт. Сама планарность графа здесь не
 * проверяется: ноль пересечений в одной укладке её не доказывает. Отдельная
 * честная проверка планарности вынесена в `cpm-planarity`.
 */
