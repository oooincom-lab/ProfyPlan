/**
 * Автоподбор положения подписей узлов сети CPM.
 *
 * В компактном режиме (мелкий масштаб, узлы — окружности) у каждого узла есть
 * подписи: имя работы (`code`) и рядом — продолжительность с резервом (`dur`).
 * Раньше они рисовались в фиксированном месте (имя — над окружностью, числа —
 * под ней), поэтому на плотных участках подписи налезали друг на друга, на
 * соседние окружности и на линии связей.
 *
 * Этот модуль расставляет подписи автоматически: для каждой подписи по очереди
 * перебираются позиции вокруг её узла (снизу, сверху, справа, слева, по
 * диагоналям) в ФИКСИРОВАННОМ порядке и берётся первая, которая не пересекается
 * ни с другими подписями, ни с прямоугольниками узлов, ни с отрезками связей.
 * Если всё занято — вертикальный отступ подписи от узла небольшими шагами
 * увеличивается (порядок узлов и их положение при этом не меняются). Подпись
 * всегда остаётся привязанной к своему узлу: дополнительное смещение ограничено.
 *
 * Модуль чистый (без React и без DOM): координаты и размеры — в мировых
 * единицах раскладки, поэтому результат детерминирован и воспроизводим, а
 * итоговое число наложений подписей не зависит от зума. Те же функции
 * используют отрисовка (`CpmGraph`) и отчёт о качестве.
 */
import {
  borderPoint, edgeControl, quadPt, resolveGeometry, segRectHit, rectsOverlap,
  type LayoutGeometry, type Rect,
} from './cpm-metrics';

/** Позиция подписи относительно узла. */
export type LabelSide =
  | 'bottom' | 'top' | 'right' | 'left'
  | 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft';

/**
 * Фиксированный порядок обхода позиций вокруг узла: снизу, сверху, справа,
 * слева, далее по диагоналям. Именно в этом порядке подписи ищут свободное место.
 */
export const LABEL_SIDES: readonly LabelSide[] = [
  'bottom', 'top', 'right', 'left',
  'bottomRight', 'bottomLeft', 'topRight', 'topLeft',
];

/** Вид подписи узла: имя работы либо продолжительность с резервом. */
export type LabelKind = 'code' | 'dur';

/** Описание одной подписи: к какому узлу привязана и какого размера (мировые единицы). */
export interface LabelItem {
  /** Уникальный ключ подписи (в отрисовке — `nodeId:kind`). */
  id: string;
  /** Идентификатор узла, к которому привязана подпись. */
  nodeId: string;
  kind: LabelKind;
  /** Текст (для справки и отладки; на геометрию не влияет). */
  text: string;
  /** Ширина рамки подписи в мировых единицах. */
  w: number;
  /** Высота рамки подписи в мировых единицах. */
  h: number;
  /** Предпочтительная первая позиция; далее обход идёт по общему порядку. */
  prefer?: LabelSide;
}

/** Прямоугольник узла-препятствия в мировых единицах (центр + полуразмеры). */
export interface LabelNodeBox {
  id: string;
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** Ломаная связи в мировых координатах: плоский список [x0,y0,x1,y1,…]. */
export interface LabelEdge {
  pts: number[];
}

/** Итоговое положение подписи (центр рамки + сторона). */
export interface LabelPlacement {
  id: string;
  nodeId: string;
  kind: LabelKind;
  side: LabelSide;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Числа качества расстановки подписей. */
export interface LabelStats {
  /** Пары подписей, перекрывающихся рамками. */
  labelOverlaps: number;
  /** Подписи, перекрывающиеся с посторонним узлом. */
  labelNodeHits: number;
  /** Подписи, переходящие через отрезок связи. */
  labelEdgeHits: number;
  /** Сколько подписей не удалось разместить без наложений. */
  unplaced: number;
}

export interface LabelResult {
  placements: LabelPlacement[];
  byItem: Record<string, LabelPlacement>;
  stats: LabelStats;
}

export interface LabelOptions {
  /** Зазор между окружностью узла и рамкой подписи. */
  gap?: number;
  /** Шаг увеличения вертикального отступа, если вокруг узла места нет. */
  extendStep?: number;
  /** Сколько шагов увеличения отступа допустимо (ограничение «привязанности»). */
  extendMax?: number;
  /** Дополнительный зазор рамки при проверке пересечений (страховка). */
  margin?: number;
}

const DEFAULT_OPTS: Required<LabelOptions> = { gap: 3, extendStep: 3, extendMax: 26, margin: 1.5 };

/** Порядок позиций для подписи: сначала предпочтительная, затем общий порядок. */
function sideOrder(prefer?: LabelSide): LabelSide[] {
  if (!prefer) return LABEL_SIDES.slice();
  const out: LabelSide[] = [prefer];
  for (const s of LABEL_SIDES) if (s !== prefer) out.push(s);
  return out;
}

/** Центр рамки подписи для узла `n` в позиции `side`, отодвинутой на `extra` вбок. */
function anchorCenter(n: LabelNodeBox, side: LabelSide, extra: number, w: number, h: number, gap: number): [number, number] {
  const g = gap + extra;
  switch (side) {
    case 'bottom': return [n.x, n.y + n.hh + g + h / 2];
    case 'top': return [n.x, n.y - n.hh - g - h / 2];
    case 'right': return [n.x + n.hw + g + w / 2, n.y];
    case 'left': return [n.x - n.hw - g - w / 2, n.y];
    case 'bottomRight': { const c = (Math.max(n.hw, n.hh) + g) / Math.SQRT2; return [n.x + c + w / 2, n.y + c + h / 2]; }
    case 'bottomLeft': { const c = (Math.max(n.hw, n.hh) + g) / Math.SQRT2; return [n.x - c - w / 2, n.y + c + h / 2]; }
    case 'topRight': { const c = (Math.max(n.hw, n.hh) + g) / Math.SQRT2; return [n.x + c + w / 2, n.y - c - h / 2]; }
    case 'topLeft': { const c = (Math.max(n.hw, n.hh) + g) / Math.SQRT2; return [n.x - c - w / 2, n.y - c - h / 2]; }
  }
}

interface Cost { score: number; labelOverlaps: number; nodeHits: number; edgeHits: number }

/**
 * Проверка одного варианта положения: сколько наложений он даёт.
 * Рамка подписи проверяется против уже расставленных подписей, всех узлов и
 * всех отрезков связей. Веса — приоритеты: своё имя/числа важнее узла, узел
 * важнее линии, поэтому ноль достигается сначала по подписям и узлам.
 */
function candidateCost(
  cx: number, cy: number, w: number, h: number,
  nodeBoxes: LabelNodeBox[], placed: LabelPlacement[], edges: LabelEdge[], margin: number,
): Cost {
  const hw = w / 2 + margin;
  const hh = h / 2 + margin;
  let labelOverlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (rectsOverlap({ x: cx, y: cy, hw, hh }, { x: p.x, y: p.y, hw: p.w / 2 + margin, hh: p.h / 2 + margin })) labelOverlaps++;
  }
  let nodeHits = 0;
  for (let i = 0; i < nodeBoxes.length; i++) {
    const nb = nodeBoxes[i];
    if (rectsOverlap({ x: cx, y: cy, hw, hh }, { x: nb.x, y: nb.y, hw: nb.hw, hh: nb.hh })) nodeHits++;
  }
  let edgeHits = 0;
  for (let e = 0; e < edges.length; e++) {
    const pts = edges[e].pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (segRectHit(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], cx, cy, hw, hh)) { edgeHits++; break; }
    }
  }
  return { score: 1000 * labelOverlaps + 100 * nodeHits + edgeHits, labelOverlaps, nodeHits, edgeHits };
}

function mkPlacement(it: LabelItem, side: LabelSide, c: [number, number]): LabelPlacement {
  return { id: it.id, nodeId: it.nodeId, kind: it.kind, side, x: c[0], y: c[1], w: it.w, h: it.h };
}

/**
 * Расставляет подписи узлов. Подписи обрабатываются в переданном порядке
 * (фиксированном), каждая — детерминированно, поэтому результат воспроизводим.
 */
export function placeLabels(
  items: LabelItem[],
  nodes: LabelNodeBox[],
  edges: LabelEdge[],
  opts: LabelOptions = {},
): LabelResult {
  const o = { ...DEFAULT_OPTS, ...opts };
  const nodeById = new Map<string, LabelNodeBox>();
  nodes.forEach((n) => nodeById.set(n.id, n));

  const placed: LabelPlacement[] = [];
  const byItem: Record<string, LabelPlacement> = {};
  let unplaced = 0;

  for (const it of items) {
    const nb = nodeById.get(it.nodeId);
    if (!nb || it.w <= 0 || it.h <= 0) continue;
    const order = sideOrder(it.prefer);

    let found: LabelPlacement | null = null;
    let best: LabelPlacement | null = null;
    let bestScore = Infinity;

    // 1) свободная позиция вокруг узла (фиксированный обход сторон).
    for (const side of order) {
      const c = anchorCenter(nb, side, 0, it.w, it.h, o.gap);
      const cost = candidateCost(c[0], c[1], it.w, it.h, nodes, placed, edges, o.margin);
      if (cost.score === 0) { found = mkPlacement(it, side, c); break; }
      if (cost.score < bestScore) { bestScore = cost.score; best = mkPlacement(it, side, c); }
    }

    // 2) если вокруг узла всё занято — небольшими шагами увеличиваем отступ.
    if (!found) {
      outer: for (let k = 1; k <= o.extendMax; k++) {
        for (const side of order) {
          const c = anchorCenter(nb, side, k * o.extendStep, it.w, it.h, o.gap);
          const cost = candidateCost(c[0], c[1], it.w, it.h, nodes, placed, edges, o.margin);
          if (cost.score === 0) { found = mkPlacement(it, side, c); break outer; }
          if (cost.score < bestScore) { bestScore = cost.score; best = mkPlacement(it, side, c); }
        }
      }
    }

    const chosen = found ?? best ?? mkPlacement(it, order[0], anchorCenter(nb, order[0], 0, it.w, it.h, o.gap));
    if (!found) unplaced++;
    placed.push(chosen);
    byItem[it.id] = chosen;
  }

  const stats = countOverlaps(placed, nodes, edges, 0);
  stats.unplaced = unplaced;
  return { placements: placed, byItem, stats };
}

/**
 * Базовое (прежнее) поведение для сравнения: имя — над окружностью, числа — под
 * ней, без учёта соседей. Используется только для подсчёта «сколько наложений
 * было» (в отрисовке не применяется).
 */
export function fixedPlacements(items: LabelItem[], nodes: LabelNodeBox[], opts: LabelOptions = {}): LabelPlacement[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  const nodeById = new Map<string, LabelNodeBox>();
  nodes.forEach((n) => nodeById.set(n.id, n));
  const out: LabelPlacement[] = [];
  for (const it of items) {
    const nb = nodeById.get(it.nodeId);
    if (!nb || it.w <= 0 || it.h <= 0) continue;
    const side: LabelSide = it.kind === 'code' ? 'top' : 'bottom';
    out.push(mkPlacement(it, side, anchorCenter(nb, side, 0, it.w, it.h, o.gap)));
  }
  return out;
}

/** Считает наложения подписей (пары), а также их наезды на узлы и линии связей. */
export function countOverlaps(
  placements: LabelPlacement[],
  nodes: LabelNodeBox[],
  edges: LabelEdge[],
  margin = 0,
): LabelStats {
  let labelOverlaps = 0;
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      if (rectsOverlap(
        { x: a.x, y: a.y, hw: a.w / 2 + margin, hh: a.h / 2 + margin },
        { x: b.x, y: b.y, hw: b.w / 2 + margin, hh: b.h / 2 + margin },
      )) labelOverlaps++;
    }
  }
  let labelNodeHits = 0;
  for (const a of placements) {
    const r: Rect = { x: a.x, y: a.y, hw: a.w / 2 + margin, hh: a.h / 2 + margin };
    for (const nb of nodes) {
      if (nb.id === a.nodeId) continue;   // своя окружность под подписью не считается
      if (rectsOverlap(r, { x: nb.x, y: nb.y, hw: nb.hw, hh: nb.hh })) { labelNodeHits++; break; }
    }
  }
  let labelEdgeHits = 0;
  for (const a of placements) {
    const hw = a.w / 2 + margin;
    const hh = a.h / 2 + margin;
    let hit = false;
    for (const e of edges) {
      const pts = e.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (segRectHit(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], a.x, a.y, hw, hh)) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) labelEdgeHits++;
  }
  return { labelOverlaps, labelNodeHits, labelEdgeHits, unplaced: 0 };
}

export interface EdgePolylineOptions {
  /** Мировой радиус окружности узла (компактный режим); иначе — прямоугольник карточки. */
  radius?: number;
  /** Компактный режим: узлы — окружности, а не карточки. */
  compact?: boolean;
  /** Число сэмплов кривой Безье при построении ломаной. */
  samples?: number;
}

/**
 * Строит ломаные связей в мировых координатах так же, как при отрисовке:
 * точки выхода на границе узлов + минимальное отклонение вбок для обхода
 * посторонних узлов. Служит препятствиями для расстановки подписей.
 */
export function buildEdgePolylines(
  pos: Record<string, [number, number]>,
  idList: string[],
  deps: [string, string][],
  geometry: LayoutGeometry,
  opts: EdgePolylineOptions = {},
): LabelEdge[] {
  const G = resolveGeometry(geometry);
  const compact = !!opts.compact;
  const radius = opts.radius ?? Math.min(G.cardW, G.cardH) / 2;
  const ahw = compact ? radius : G.cardW / 2;
  const ahh = compact ? radius : G.cardH / 2;
  const obhw = ahw + G.obstaclePad;
  const obhh = ahh + G.obstaclePad;
  const samples = opts.samples ?? 10;

  const idset = new Set(idList);
  const rects: Rect[] = [];
  const rectById: Record<string, Rect> = {};
  for (const id of idList) {
    const p = pos[id];
    if (!p) continue;
    const r: Rect = { x: p[0], y: p[1], hw: ahw, hh: ahh };
    rects.push(r);
    rectById[id] = r;
  }

  const out: LabelEdge[] = [];
  const seen = new Set<string>();
  for (const [a, b] of deps) {
    if (a === b || !idset.has(a) || !idset.has(b)) continue;
    const ra = rectById[a];
    const rb = rectById[b];
    if (!ra || !rb) continue;
    const key = a + '\u0001' + b;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = borderPoint(ra.x, ra.y, ahw + 3, ahh + 3, rb.x, rb.y);
    const e = borderPoint(rb.x, rb.y, ahw + 3, ahh + 3, ra.x, ra.y);
    const obstacles = rects
      .filter((r) => r !== ra && r !== rb)
      .map((r) => ({ x: r.x, y: r.y, hw: obhw, hh: obhh }));
    const c = edgeControl(s[0], s[1], e[0], e[1], obstacles);
    out.push(polyline(s, e, c, samples));
  }
  return out;
}

/** Ломаная отрезка/квадратичной кривой Безье в мировых координатах. */
function polyline(s: [number, number], e: [number, number], c: [number, number], samples: number): LabelEdge {
  const pts: number[] = [];
  const straight = c[0] === (s[0] + e[0]) / 2 && c[1] === (s[1] + e[1]) / 2;
  if (straight) {
    pts.push(s[0], s[1], e[0], e[1]);
  } else {
    pts.push(s[0], s[1]);
    for (let i = 1; i <= samples; i++) {
      const q = quadPt(s[0], s[1], c[0], c[1], e[0], e[1], i / samples);
      pts.push(q[0], q[1]);
    }
  }
  return { pts };
}

/** Прямоугольники узлов для проверки пересечений подписей (мировые единицы). */
export function buildNodeBoxes(
  pos: Record<string, [number, number]>,
  idList: string[],
  geometry: LayoutGeometry,
  opts: { radius?: number; compact?: boolean } = {},
): LabelNodeBox[] {
  const G = resolveGeometry(geometry);
  const compact = !!opts.compact;
  const radius = opts.radius ?? Math.min(G.cardW, G.cardH) / 2;
  const out: LabelNodeBox[] = [];
  for (const id of idList) {
    const p = pos[id];
    if (!p) continue;
    out.push({
      id,
      x: p[0],
      y: p[1],
      hw: compact ? radius : G.cardW / 2,
      hh: compact ? radius : G.cardH / 2,
    });
  }
  return out;
}
