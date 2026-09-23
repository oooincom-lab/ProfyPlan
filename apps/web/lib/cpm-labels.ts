/**
 * Каноническая расстановка подписей узлов сети CPM и вертикальное разведение узлов.
 *
 * В компактном режиме (мелкий масштаб, узлы — окружности) у каждого узла две
 * подписи, жёстко привязанные к СВОЕМУ узлу: имя работы (`code`) — над
 * окружностью, «продолжительность + резерв» (`dur`) — под ней. Место подписи
 * всегда фиксировано относительно узла: подпись не «гуляет» по полотну, поэтому
 * привязка подписи к узлу не теряется никогда.
 *
 * Наложения подписей снимаются не смещением подписи, а вертикальным смещением
 * САМОГО УЗЛА вместе со всеми его подписями. Узлы обходятся в фиксированном
 * порядке (слой, затем позиция внутри слоя); если подписи очередного узла задевают
 * уже расставленные подписи или узлы — узел сдвигается вниз небольшими шагами до
 * первого свободного места (с минимальным необходимым зазором). Порядок обхода и
 * шаг фиксированы, поэтому результат воспроизводим.
 *
 * `requiredRowPitch` даёт минимальный вертикальный шаг между соседними узлами
 * столбца, при котором их подписи гарантированно не налезают друг на друга; этим
 * значением пользуется раскладка (`cpm-layout`) как нижней границей шага ряда, так
 * что основная часть разведения решается ещё на этапе укладки, а разведение
 * остаётся страховкой от редких «диагональных» наложений между столбцами.
 * `cleanupColumnOrder` — детерминированная доводка порядка внутри столбца по
 * счётчику пересечений: узлы лишь меняются местами в своих же слотах, поэтому
 * подписи остаются на местах и не налезают.
 *
 * Модуль чистый (без React и DOM): координаты и размеры — в мировых единицах
 * раскладки, поэтому результат детерминирован и воспроизводим, а итоговое число
 * наложений подписей не зависит от зума. Те же функции используют отрисовка
 * (`CpmGraph`) и отчёт о качестве.
 */
import {
  borderPoint, computeLayoutMetrics, edgeControl, quadPt, resolveGeometry,
  segRectHit, rectsOverlap,
  type LayoutGeometry, type MetricNode, type Rect,
} from './cpm-metrics';

/** Позиция подписи относительно узла (канон: имя — сверху, числа — снизу). */
export type LabelSide = 'top' | 'bottom';

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

/**
 * Геометрия подписей узла в компактном режиме (мировые единицы). Нужна, чтобы
 * вычислить минимальный вертикальный шаг ряда до самой раскладки.
 */
export interface CompactLabelGeom {
  /** Мировой радиус окружности узла. */
  radius: number;
  /** Зазор между окружностью и рамкой подписи. */
  gap: number;
  /** Высота рамки подписи имени (сверху). */
  codeH: number;
  /** Высота рамки подписи «продолжительность + резерв» (снизу). */
  durH: number;
}

/** Зазор между окружностью узла и рамкой подписи по умолчанию (совпадает с отрисовкой). */
export const LABEL_GAP = 3;

/**
 * Минимальный вертикальный шаг между соседними узлами столбца, при котором их
 * подписи (имя сверху, числа снизу) не налезают друг на друга. Верхняя подпись
 * нижнего узла начинается выше, чем заканчивается нижняя подпись верхнего.
 */
export function requiredRowPitch(g: CompactLabelGeom): number {
  return (g.radius + g.gap + g.codeH) + (g.radius + g.gap + g.durH);
}

/** Центр рамки подписи `side` для узла `n` (каноническое, фиксированное место). */
function anchorCenter(n: LabelNodeBox, side: LabelSide, w: number, h: number, gap: number): [number, number] {
  if (side === 'top') return [n.x, n.y - n.hh - gap - h / 2];
  return [n.x, n.y + n.hh + gap + h / 2];
}

/** Каноническая подпись: имя — над узлом, числа — под узлом (центр рамки). */
function canonicalPlacement(it: LabelItem, n: LabelNodeBox, side: LabelSide, gap: number): LabelPlacement {
  const c = anchorCenter(n, side, it.w, it.h, gap);
  return { id: it.id, nodeId: it.nodeId, kind: it.kind, side, x: c[0], y: c[1], w: it.w, h: it.h };
}

/** Сторона канонического места подписи по её виду. */
function sideOf(it: LabelItem): LabelSide {
  return it.kind === 'code' ? 'top' : 'bottom';
}

function rectOf(p: LabelPlacement, margin: number): Rect {
  return { x: p.x, y: p.y, hw: p.w / 2 + margin, hh: p.h / 2 + margin };
}

export interface DeconflictOptions {
  /** Зазор между окружностью и рамкой подписи. */
  gap?: number;
  /** Шаг вертикального смещения узла (мировые единицы). */
  step?: number;
  /** Максимальное суммарное смещение узла — страховка от «убегания». */
  maxShift?: number;
  /** Дополнительный зазор рамок при проверке пересечений. */
  margin?: number;
  /** Порог «далёкого» сдвига (в высотах узла), после которого нужна линия-поводок. */
  leaderHeights?: number;
}

const DECONFLICT_DEFAULTS: Required<DeconflictOptions> = {
  gap: LABEL_GAP, step: 2, maxShift: 240, margin: 0, leaderHeights: 2,
};

export interface DeconflictResult {
  /** Сдвинутые позиции узлов (x без изменений, y — с учётом разведения). */
  pos: Record<string, [number, number]>;
  /** Положения подписей (канонические относительно сдвинутых узлов). */
  placements: LabelPlacement[];
  byItem: Record<string, LabelPlacement>;
  stats: LabelStats;
  /** Смещение узла от исходного положения (мировые единицы), только > 0. */
  shift: Record<string, number>;
  /** Узлы, сдвинутые дальше порога (нужна линия-поводок для однозначной привязки). */
  leaders: string[];
}

/**
 * Разводит узлы по вертикали, сохраняя подписи в их каноническом месте у узла.
 * Обход — в фиксированном порядке (слой по x, затем позиция по y); при наложении
 * подписей узел сдвигается вниз небольшими шагами. Результат воспроизводим.
 */
export function deconflictLabels(
  items: LabelItem[],
  nodes: LabelNodeBox[],
  opts: DeconflictOptions = {},
): DeconflictResult {
  const o = { ...DECONFLICT_DEFAULTS, ...opts };
  const nodeById = new Map<string, LabelNodeBox>();
  nodes.forEach((n) => nodeById.set(n.id, n));

  const own = new Map<string, LabelItem[]>();
  for (const it of items) {
    if (!nodeById.has(it.nodeId) || it.w <= 0 || it.h <= 0) continue;
    if (!own.has(it.nodeId)) own.set(it.nodeId, []);
    own.get(it.nodeId)!.push(it);
  }

  // Фиксированный порядок обхода: слой (x), затем позиция в слое (y).
  const order = [...own.keys()].sort((a, b) => {
    const na = nodeById.get(a)!;
    const nb = nodeById.get(b)!;
    return (na.x - nb.x) || (na.y - nb.y) || (a < b ? -1 : a > b ? 1 : 0);
  });

  const placedRect: Rect[] = [];
  const placedBox: LabelNodeBox[] = [];
  const pos: Record<string, [number, number]> = {};
  const placements: LabelPlacement[] = [];
  const byItem: Record<string, LabelPlacement> = {};
  const shift: Record<string, number> = {};
  const leaders: string[] = [];

  for (const id of order) {
    const nb = nodeById.get(id)!;
    const list = own.get(id)!;
    let y = nb.y;
    for (;;) {
      const box: LabelNodeBox = { id, x: nb.x, y, hw: nb.hw, hh: nb.hh };
      let bad = false;
      for (const it of list) {
        const r = rectOf(canonicalPlacement(it, box, sideOf(it), o.gap), o.margin);
        for (const p of placedRect) if (rectsOverlap(r, p)) { bad = true; break; }
        if (bad) break;
        for (const p of placedBox) if (rectsOverlap(r, p)) { bad = true; break; }
        if (bad) break;
      }
      if (!bad) {
        for (const p of placedBox) if (rectsOverlap({ x: box.x, y: box.y, hw: box.hw, hh: box.hh }, p)) { bad = true; break; }
      }
      if (!bad) {
        for (const p of placedRect) if (rectsOverlap({ x: box.x, y: box.y, hw: box.hw, hh: box.hh }, p)) { bad = true; break; }
      }
      if (!bad) break;
      if (y - nb.y >= o.maxShift) break;
      y += o.step;
    }

    pos[id] = [nb.x, y];
    const d = y - nb.y;
    if (d > 0.01) {
      shift[id] = d;
      if (d > o.leaderHeights * 2 * nb.hh) leaders.push(id);
    }
    const box: LabelNodeBox = { id, x: nb.x, y, hw: nb.hw, hh: nb.hh };
    for (const it of list) {
      const pl = canonicalPlacement(it, box, sideOf(it), o.gap);
      placements.push(pl);
      byItem[it.id] = pl;
      placedRect.push(rectOf(pl, o.margin));
    }
    placedBox.push({ id, x: nb.x, y, hw: nb.hw, hh: nb.hh });
  }

  // Считаем только наложения подписей друг на друга и на посторонние узлы;
  // наложения на связи отрисовка допускает (подпись остаётся у своего узла).
  const shiftedBoxes = nodes.map((n) => (pos[n.id] ? { ...n, x: pos[n.id][0], y: pos[n.id][1] } : n));
  const stats = countOverlaps(placements, shiftedBoxes, [], o.margin);
  return { pos, placements, byItem, stats, shift, leaders };
}

/**
 * Каноническое (прежнее) размещение подписей без учёта соседей: имя — над
 * окружностью, числа — под ней. Служит базой отсчёта (и «сколько наложений было»).
 */
export function fixedPlacements(items: LabelItem[], nodes: LabelNodeBox[], gap = LABEL_GAP): LabelPlacement[] {
  const nodeById = new Map<string, LabelNodeBox>();
  nodes.forEach((n) => nodeById.set(n.id, n));
  const out: LabelPlacement[] = [];
  for (const it of items) {
    const nb = nodeById.get(it.nodeId);
    if (!nb || it.w <= 0 || it.h <= 0) continue;
    out.push(canonicalPlacement(it, nb, sideOf(it), gap));
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
      if (rectsOverlap(rectOf(a, margin), rectOf(b, margin))) labelOverlaps++;
    }
  }
  let labelNodeHits = 0;
  for (const a of placements) {
    const r = rectOf(a, margin);
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

/* ─────────────────── единая точка входа расстановки подписей ─────────────────── */

/** Лёгкое описание подписи для разведения (размеры в мировых единицах). */
export interface LabelBox {
  id: string;
  nodeId: string;
  kind: LabelKind;
  w: number;
  h: number;
}

export interface NudgeOptions {
  /** Мировой радиус окружности узла (прямоугольники-препятствия). */
  radius: number;
  /** Зазор между окружностью и рамкой подписи. */
  gap?: number;
  /** Шаг вертикального смещения узла. */
  step?: number;
  /** Максимальное суммарное смещение узла. */
  maxShift?: number;
  /** Порог «далёкого» сдвига в высотах узла (для линии-поводка). */
  leaderHeights?: number;
  /** Доводить порядок внутри столбца по счётчику пересечений (по умолчанию да). */
  cleanup?: boolean;
}

export interface NudgeResult {
  /** Позиции узлов после разведения (x без изменений). */
  pos: Record<string, [number, number]>;
  /** Величина вертикального сдвига узла (0 — узел остался на месте). */
  dyById: Record<string, number>;
  /** Узлы, сдвинутые дальше порога (для линии-поводка). */
  leaders: string[];
  /** Число пересечений связей после разведения — то же, что видит панель. */
  crossings: number;
  /** Качество подписей после разведения (наложения подписей друг на друга и на узлы). */
  stats: LabelStats;
  /** Сколько было бы наложений при каноническом размещении без разведения — для сравнения. */
  statsBefore: LabelStats;
}

/** Габарит полотна по позициям узлов (для счётчика пересечений). */
function boundsOf(pos: Record<string, [number, number]>, geometry: LayoutGeometry) {
  const G = resolveGeometry(geometry);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const id in pos) {
    const [x, y] = pos[id];
    if (x - G.cardW / 2 < minX) minX = x - G.cardW / 2;
    if (x + G.cardW / 2 > maxX) maxX = x + G.cardW / 2;
    if (y - G.cardH / 2 < minY) minY = y - G.cardH / 2;
    if (y + G.cardH / 2 > maxY) maxY = y + G.cardH / 2;
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
  return { minX, maxX, minY, maxY };
}

/**
 * Единая точка расстановки подписей узлов для компактного режима:
 *   1) доводка порядка узлов внутри столбца по счётчику пересечений (узлы лишь
 *      меняются местами в своих слотах — зазоры и привязка подписей сохраняются);
 *   2) вертикальное разведение: подписи остаются в каноническом месте у СВОЕГО
 *      узла, а узел при наложении сдвигается вниз (см. `deconflictLabels`).
 * Возвращает новые позиции узлов, величины сдвига, список узлов под линию-поводок
 * и итоговое число пересечений связей. Всё детерминировано.
 */
export function nudgeForLabels(
  pos: Record<string, [number, number]>,
  nodeIds: string[],
  boxes: LabelBox[],
  deps: [string, string][],
  geometry: LayoutGeometry,
  opts: NudgeOptions,
): NudgeResult {
  const metricNodes: MetricNode[] = nodeIds.map((id) => ({ id, crit: false }));

  const cur: Record<string, [number, number]> = {};
  for (const id in pos) cur[id] = [pos[id][0], pos[id][1]];

  if (opts.cleanup !== false) {
    const cleaned = cleanupColumnOrder(cur, metricNodes, deps, geometry);
    for (const id in cleaned.pos) cur[id] = cleaned.pos[id];
  }

  const items: LabelItem[] = boxes.map((b) => ({ id: b.id, nodeId: b.nodeId, kind: b.kind, text: '', w: b.w, h: b.h }));
  const nodeBoxes: LabelNodeBox[] = [];
  for (const id of nodeIds) {
    const p = cur[id];
    if (p) nodeBoxes.push({ id, x: p[0], y: p[1], hw: opts.radius, hh: opts.radius });
  }
  // Базовые (без разведения) прямоугольники узлов — для числа «сколько было».
  const baseBoxes: LabelNodeBox[] = [];
  for (const id of nodeIds) {
    const p = pos[id];
    if (p) baseBoxes.push({ id, x: p[0], y: p[1], hw: opts.radius, hh: opts.radius });
  }
  const statsBefore = countOverlaps(fixedPlacements(items, baseBoxes, opts.gap ?? LABEL_GAP), baseBoxes, [], 0);

  const de = deconflictLabels(items, nodeBoxes, {
    gap: opts.gap ?? LABEL_GAP,
    step: opts.step,
    maxShift: opts.maxShift,
    leaderHeights: opts.leaderHeights,
  });

  const out: Record<string, [number, number]> = {};
  for (const id in cur) out[id] = de.pos[id] ? de.pos[id] : cur[id];

  const crossings = computeLayoutMetrics(
    { pos: out, ...boundsOf(out, geometry) },
    metricNodes,
    deps,
    false,
    geometry,
  ).crossings;

  return { pos: out, dyById: { ...de.shift }, leaders: de.leaders, crossings, stats: de.stats, statsBefore };
}

const CLEANUP_DEFAULT_ROUNDS = 60;

/**
 * Детерминированная доводка порядка внутри столбца по счётчику пересечений.
 * Узлы лишь меняются местами в своих же вертикальных слотах (сдвиг вверх-вниз
 * между соседями), поэтому вертикальные зазоры — и, значит, отсутствие наложений
 * подписей — сохраняются. Сравнение идёт по тому же счётчику, что и панель
 * качества; изменение принимается только при строгом уменьшении числа пересечений.
 */
export function cleanupColumnOrder(
  pos: Record<string, [number, number]>,
  nodes: ReadonlyArray<MetricNode>,
  deps: ReadonlyArray<[string, string]>,
  geometry: LayoutGeometry,
  maxRounds = CLEANUP_DEFAULT_ROUNDS,
): { pos: Record<string, [number, number]>; crossings: number } {
  const G = resolveGeometry(geometry);
  const out: Record<string, [number, number]> = {};
  for (const id in pos) out[id] = [pos[id][0], pos[id][1]];

  const layoutOf = (p: Record<string, [number, number]>) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id in p) {
      const [x, y] = p[id];
      if (x - G.cardW / 2 < minX) minX = x - G.cardW / 2;
      if (x + G.cardW / 2 > maxX) maxX = x + G.cardW / 2;
      if (y - G.cardH / 2 < minY) minY = y - G.cardH / 2;
      if (y + G.cardH / 2 > maxY) maxY = y + G.cardH / 2;
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    return { pos: p, minX, maxX, minY, maxY };
  };
  const crossings = (p: Record<string, [number, number]>): number =>
    computeLayoutMetrics(layoutOf(p), nodes as MetricNode[], deps as [string, string][], false, geometry).crossings;

  // Столбцы (по x) и порядок узлов в них (по y) — как в раскладке.
  const cols = new Map<number, string[]>();
  for (const id in out) {
    const x = out[id][0];
    if (!cols.has(x)) cols.set(x, []);
    cols.get(x)!.push(id);
  }
  for (const arr of cols.values()) arr.sort((a, b) => out[a][1] - out[b][1]);

  let cur = crossings(out);
  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    for (const arr of cols.values()) {
      for (let i = 0; i + 1 < arr.length; i++) {
        const a = arr[i];
        const b = arr[i + 1];
        const ya = out[a][1];
        const yb = out[b][1];
        out[a][1] = yb;
        out[b][1] = ya;
        const c = crossings(out);
        if (c < cur) {
          cur = c;
          arr[i] = b;
          arr[i + 1] = a;
          improved = true;
        } else {
          out[a][1] = ya;
          out[b][1] = yb;
        }
      }
    }
    if (!improved) break;
  }
  return { pos: out, crossings: cur };
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
