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
  segCross, segRectHit, rectsOverlap, PATH_SAMPLES, DRAWN_EDGE_DETOUR_SAMPLES,
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
  // Значения по умолчанию подставляем ПОФАЙЛОВО через ?? — иначе явно переданный
  // `undefined` перетёр бы значение по умолчанию (спред копирует ключ как есть) и
  // шаг разведения стал бы undefined: `y += undefined` даёт NaN и узел «улетает»
  // в бесконечность — его связи рисуются вне полотна и пропадают.
  const D = DECONFLICT_DEFAULTS;
  const o: Required<DeconflictOptions> = {
    gap: opts.gap ?? D.gap,
    step: opts.step ?? D.step,
    maxShift: opts.maxShift ?? D.maxShift,
    margin: opts.margin ?? D.margin,
    leaderHeights: opts.leaderHeights ?? D.leaderHeights,
  };
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
      // Страховка: узел никогда не должен получить нечисловую позицию.
      if (!Number.isFinite(y)) { y = nb.y; break; }
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
  /**
   * После разведения подписей ещё раз довести порядок по счётчику пересечений.
   * Нужно режиму «Без пересечений»: его укладка считается «последней», и
   * вертикальный сдвиг узлов при разведении подписей не должен пересобирать
   * достигнутый результат. Изменение принимается только при строгом уменьшении
   * числа пересечений и только если не появилось наложений подписей/узлов и
   * проходов связей сквозь узлы.
   */
  restoreAfterDeconflict?: boolean;
  /**
   * Не двигать узлы вообще (режим «Без пересечений»). Укладка в этом режиме
   * строится ПОСЛЕДНЕЙ и не должна пересобираться: наложения подписей снимаются
   * не сдвигом узлов, а подбором свободного места для самой подписи
   * (см. `placeLabelsFree`). Позиции узлов возвращаются без изменений.
   */
  freezeNodes?: boolean;
}

export interface NudgeResult {
  /** Позиции узлов после разведения (x без изменений). */
  pos: Record<string, [number, number]>;
  /** Величина вертикального сдвига узла (0 — узел остался на месте). */
  dyById: Record<string, number>;
  /** Узлы, сдвинутые дальше порога (для линии-поводка). */
  leaders: string[];
  /** Смещения рамок подписей от их канонического места (мировые единицы). */
  labelOffsets: Record<string, [number, number]>;
  /** Число пересечений связей после разведения — то же, что видит панель. */
  crossings: number;
  /** Качество подписей после разведения (наложения подписей друг на друга и на узлы). */
  stats: LabelStats;
  /** Сколько было бы наложений при каноническом размещении без разведения — для сравнения. */
  statsBefore: LabelStats;
}

/** Рамки узлов по готовым позициям (мировые единицы). */
function boxesAt(pos: Record<string, [number, number]>, idList: string[], radius: number): LabelNodeBox[] {
  const out: LabelNodeBox[] = [];
  for (const id of idList) { const p = pos[id]; if (p) out.push({ id, x: p[0], y: p[1], hw: radius, hh: radius }); }
  return out;
}

/** Число наложений подписей друг на друга и на посторонние узлы при данных позициях. */
function labelStatsAt(
  pos: Record<string, [number, number]>,
  idList: string[],
  items: LabelItem[],
  radius: number,
  gap: number,
): { overlaps: number; nodeHits: number } {
  const nodes = boxesAt(pos, idList, radius);
  const st = countOverlaps(fixedPlacements(items, nodes, gap), nodes, [], 0);
  return { overlaps: st.labelOverlaps, nodeHits: st.labelNodeHits };
}

/** Быстрый счётчик пересечений связей по геометрии граничных точек (как в панели). */
function fastCrossings(
  pos: Record<string, [number, number]>,
  deps: ReadonlyArray<[string, string]>,
  geometry: LayoutGeometry,
): number {
  const G = resolveGeometry(geometry);
  const cw = G.cardW;
  const ch = G.cardH;
  const ep = G.edgePad;
  const edges: { a: string; b: string; s: [number, number]; e: [number, number] }[] = [];
  const seen = new Set<string>();
  for (const [a, b] of deps) {
    if (a === b || !pos[a] || !pos[b]) continue;
    const key = a + '\u0001' + b;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = pos[a];
    const pb = pos[b];
    const s = borderPoint(pa[0], pa[1], cw / 2 + ep, ch / 2 + ep, pb[0], pb[1]);
    const e = borderPoint(pb[0], pb[1], cw / 2 + ep, ch / 2 + ep, pa[0], pa[1]);
    edges.push({ a, b, s, e });
  }
  let c = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const A = edges[i];
      const B = edges[j];
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
      if (segCross(A.s[0], A.s[1], A.e[0], A.e[1], B.s[0], B.s[1], B.e[0], B.e[1])) c++;
    }
  }
  return c;
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

  /* ── режим «Без пересечений»: узлы НЕ двигаем ──
     Укладка этого режима строится последней, поэтому ни доводка порядка,
     ни разведение подписей не имеют права её пересобрать. Наложения подписей
     снимаются подбором свободного места для самой подписи. */
  if (opts.freezeNodes) {
    const items0: LabelItem[] = boxes.map((b) => ({ id: b.id, nodeId: b.nodeId, kind: b.kind, text: '', w: b.w, h: b.h }));
    const nodes0: LabelNodeBox[] = [];
    for (const id of nodeIds) { const p = pos[id]; if (p) nodes0.push({ id, x: p[0], y: p[1], hw: opts.radius, hh: opts.radius }); }
    const gap0 = opts.gap ?? LABEL_GAP;
    const statsBefore0 = countOverlaps(fixedPlacements(items0, nodes0, gap0), nodes0, [], 0);
    const free = placeLabelsFree(items0, nodes0, { gap: gap0 });
    const kept: Record<string, [number, number]> = {};
    for (const id in pos) kept[id] = [pos[id][0], pos[id][1]];
    return {
      pos: kept,
      dyById: {},
      leaders: [],
      crossings: fastCrossings(kept, deps, geometry),
      stats: free.stats,
      statsBefore: statsBefore0,
      labelOffsets: free.offsets,
    };
  }

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

  // Передаём только заданные опции: ключ со значением `undefined` перетёр бы
  // значение по умолчанию внутри deconflictLabels.
  const deOpts: DeconflictOptions = { gap: opts.gap ?? LABEL_GAP };
  if (opts.step != null) deOpts.step = opts.step;
  if (opts.maxShift != null) deOpts.maxShift = opts.maxShift;
  if (opts.leaderHeights != null) deOpts.leaderHeights = opts.leaderHeights;
  const de = deconflictLabels(items, nodeBoxes, deOpts);

  const out: Record<string, [number, number]> = {};
  for (const id in cur) out[id] = de.pos[id] ? de.pos[id] : cur[id];

  /* ── выравнивание колонок по счётчику пересечений ──
     Разведение подписей сдвигает узлы по вертикали и может добавить пересечений
     связей. Колонки (по x) обходятся в фиксированном порядке; для каждой
     подбирается одинаковый сдвиг ВСЕЙ колонки, который уменьшает число
     пересечений и не возвращает наложений подписей/узлов и проходов линии
     сквозь узлы. Сдвиг колонки не меняет зазоры внутри неё, поэтому подписи
     остаются при своих узлах. Порядок обхода, набор шагов и правило выбора
     фиксированы — результат воспроизводим. */
  const RELIEF_STEP = 12;
  const RELIEF_MAX = 240;
  const RELIEF_PASSES = 3;
  if (opts.cleanup !== false) {
    const colIds: Record<string, string[]> = {};
    for (const id of nodeIds) { if (!out[id]) continue; const x = out[id][0]; if (!colIds[x]) colIds[x] = []; colIds[x].push(id); }
    const xs = Object.keys(colIds).sort((a, b) => Number(a) - Number(b));
    const gap = opts.gap ?? LABEL_GAP;
    let curCross = fastCrossings(out, deps, geometry);
    for (let pass = 0; pass < RELIEF_PASSES; pass++) {
      let improved = false;
      for (const x of xs) {
        const list = colIds[x];
        const base: Record<string, [number, number]> = {};
        for (const id in out) base[id] = [out[id][0], out[id][1]];
        let bestD = 0;
        let bestCross = curCross;
        for (let k = RELIEF_STEP; k <= RELIEF_MAX; k += RELIEF_STEP) {
          for (const d of [k, -k]) {
            for (const id of list) out[id] = [base[id][0], base[id][1] + d];
            const v = fastCrossings(out, deps, geometry);
            if (v < bestCross) { bestCross = v; bestD = d; }
          }
        }
        for (const id of list) out[id] = [base[id][0], base[id][1]];
        if (bestD !== 0) {
          for (const id of list) out[id] = [base[id][0], base[id][1] + bestD];
          const mm = computeLayoutMetrics({ pos: out, ...boundsOf(out, geometry) }, metricNodes, deps, false, geometry);
          const lab = labelStatsAt(out, nodeIds, items, opts.radius, gap);
          if (mm.edgeNodeHits === 0 && mm.nodeOverlaps === 0 && lab.overlaps === 0 && lab.nodeHits === 0) {
            curCross = bestCross;
            improved = true;
          } else {
            for (const id of list) out[id] = [base[id][0], base[id][1]];
          }
        }
      }
      if (!improved) break;   // больше улучшить нельзя — выходим
    }
  }

  /* ── доводка «последней» (режим «Без пересечений») ──
     Разведение подписей сдвигает узлы по вертикали и потому может пересобрать
     достигнутую укладку. Здесь порядок внутри столбцов ещё раз доводится по
     счётчику пересечений УЖЕ ПОСЛЕ разведения; изменение принимается только
     при строгом уменьшении числа пересечений и при чистой картинке (нет
     наложений подписей/узлов и проходов связей сквозь узлы). Так результат
     укладки без пересечений не теряется на последующих проходах. */
  if (opts.restoreAfterDeconflict) {
    const gapR = opts.gap ?? LABEL_GAP;
    const beforeCross = fastCrossings(out, deps, geometry);
    const cleaned = cleanupColumnOrder(out, metricNodes, deps, geometry);
    if (cleaned.crossings < beforeCross) {
      const lab = labelStatsAt(cleaned.pos, nodeIds, items, opts.radius, gapR);
      const mm = computeLayoutMetrics(
        { pos: cleaned.pos, ...boundsOf(cleaned.pos, geometry) },
        metricNodes, deps, false, geometry,
      );
      if (lab.overlaps === 0 && lab.nodeHits === 0 && mm.edgeNodeHits === 0 && mm.nodeOverlaps === 0) {
        for (const id in cleaned.pos) { if (out[id]) out[id] = cleaned.pos[id]; }
      }
    }
  }

  const crossings = computeLayoutMetrics(
    { pos: out, ...boundsOf(out, geometry) },
    metricNodes,
    deps,
    false,
    geometry,
  ).crossings;

  // Итоговый сдвиг и линии-поводки — по суммарному смещению от исходных позиций.
  const dyById: Record<string, number> = {};
  const leaders: string[] = [];
  const leaderLimit = (opts.leaderHeights ?? DECONFLICT_DEFAULTS.leaderHeights) * 2 * opts.radius;
  for (const id in out) {
    const orig = pos[id];
    const d = orig ? out[id][1] - orig[1] : 0;
    if (Math.abs(d) > 0.01) dyById[id] = d;
    if (Math.abs(d) > leaderLimit) leaders.push(id);
  }
  leaders.sort();

  return { pos: out, dyById, leaders, crossings, stats: de.stats, statsBefore, labelOffsets: {} };
}

/**
 * Кандидаты свободного места для подписи — в порядке от ближайшего:
 * каноническое место (имя над узлом, числа под узлом), затем смещения по
 * горизонтали (в пределах половины ширины рамки — узел остаётся под рамкой,
 * привязка подписи к узлу не теряется), затем те же смещения с отходом от узла
 * по вертикали. Подбор места НЕ сдвигает сам узел.
 */
function labelCandidates(it: LabelItem, n: LabelNodeBox, side: LabelSide, gap: number): [number, number][] {
  const canon = anchorCenter(n, side, it.w, it.h, gap);
  const hStep = Math.max(6, Math.round(it.w * 0.06));
  const maxH = Math.max(0, Math.floor((it.w / 2 - 6) / hStep) * hStep);
  const vStep = it.h + gap;
  const dys: number[] = [];
  for (let k = 1; k <= 3; k++) { dys.push(-k * vStep, k * vStep); }
  const cands: { dx: number; dy: number; d: number }[] = [];
  for (let i = 0; i * hStep <= maxH; i++) {
    const xs = i === 0 ? [0] : [i * hStep, -i * hStep];
    for (const dx of xs) {
      for (const dy of dys) {
        if (dx === 0 && dy === 0) continue;
        cands.push({ dx, dy, d: Math.abs(dx) + Math.abs(dy) * 1.4 });
      }
    }
  }
  cands.sort((a, b) => (a.d - b.d) || (a.dx - b.dx) || (a.dy - b.dy));
  const out: [number, number][] = [[canon[0], canon[1]]];
  for (const c of cands) out.push([canon[0] + c.dx, canon[1] + c.dy]);
  return out;
}

/**
 * Подбор СВОБОДНОГО МЕСТА для подписей без сдвига узлов (режим «Без пересечений»).
 * Обход — тот же фиксированный (слой по x, затем позиция по y); для каждой подписи
 * перебираются кандидаты (`labelCandidates`) и берётся первый, который не перекрывает
 * ни уже расставленные подписи, ни любой узел. Если ни один не подошёл, подпись
 * остаётся на каноническом месте (наложение будет видно в статистике).
 * Детерминирован и не зависит от зума.
 */
export function placeLabelsFree(
  items: LabelItem[],
  nodes: LabelNodeBox[],
  opts: { gap?: number; margin?: number } = {},
): {
  placements: LabelPlacement[];
  byItem: Record<string, LabelPlacement>;
  offsets: Record<string, [number, number]>;
  stats: LabelStats;
} {
  const gap = opts.gap ?? LABEL_GAP;
  const margin = opts.margin ?? 0;
  const nodeById = new Map<string, LabelNodeBox>();
  nodes.forEach((n) => nodeById.set(n.id, n));

  const own = new Map<string, LabelItem[]>();
  for (const it of items) {
    if (!nodeById.has(it.nodeId) || it.w <= 0 || it.h <= 0) continue;
    if (!own.has(it.nodeId)) own.set(it.nodeId, []);
    own.get(it.nodeId)!.push(it);
  }
  const order = [...own.keys()].sort((a, b) => {
    const na = nodeById.get(a)!;
    const nb = nodeById.get(b)!;
    return (na.x - nb.x) || (na.y - nb.y) || (a < b ? -1 : a > b ? 1 : 0);
  });

  const placed: Rect[] = [];
  const placements: LabelPlacement[] = [];
  const byItem: Record<string, LabelPlacement> = {};
  const offsets: Record<string, [number, number]> = {};
  const nodeRects: Rect[] = nodes.map((n) => ({ x: n.x, y: n.y, hw: n.hw + margin, hh: n.hh + margin }));

  for (const id of order) {
    const nb = nodeById.get(id)!;
    for (const it of own.get(id)!) {
      const side = sideOf(it);
      const canon = canonicalPlacement(it, nb, side, gap);
      let cx = canon.x;
      let cy = canon.y;
      for (const c of labelCandidates(it, nb, side, gap)) {
        const r: Rect = { x: c[0], y: c[1], hw: it.w / 2 + margin, hh: it.h / 2 + margin };
        let bad = false;
        for (const p of placed) if (rectsOverlap(r, p)) { bad = true; break; }
        if (!bad) for (const n of nodeRects) if (rectsOverlap(r, n)) { bad = true; break; }
        if (!bad) { cx = c[0]; cy = c[1]; break; }
      }
      const pl: LabelPlacement = { id: it.id, nodeId: it.nodeId, kind: it.kind, side, x: cx, y: cy, w: it.w, h: it.h };
      placements.push(pl);
      byItem[it.id] = pl;
      offsets[it.id] = [cx - canon.x, cy - canon.y];
      placed.push({ x: cx, y: cy, hw: it.w / 2 + margin, hh: it.h / 2 + margin });
    }
  }
  return { placements, byItem, offsets, stats: countOverlaps(placements, nodes, [], margin) };
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

/** Маркер обрезки периода в мировых единицах (для подсчёта на итоговой геометрии). */
export interface DrawnCutMarker {
  x: number;
  y: number;
  dir: 1 | -1;
  /** Длина обрубка в мировых единицах (считает вызывающий, зная масштаб). */
  len: number;
  /** Операция-владелец обрубка: касание её собственных связей пересечением не считается. */
  opId?: string;
}

/** Линия-поводок подписи (вертикальный пунктир от сдвинутого узла к исходному месту). */
export interface DrawnLeader {
  x: number;
  from: number;
  to: number;
  /** Узел-владелец поводка: касание его собственных связей пересечением не считается. */
  nodeId?: string;
}

/** Класс линии на итоговой схеме. */
export type DrawnLineKind = 'op' | 'service' | 'cut' | 'leader';

/** Одна линия итоговой схемы: тот же путь, что рисуется на полотне. */
export interface DrawnLine {
  /** Идентификатор узла-начала (для обрубков/поводков — синтетический). */
  a: string;
  /** Идентификатор узла-конца (для обрубков/поводков — синтетический). */
  b: string;
  /** Класс линии. */
  kind: DrawnLineKind;
  /** Узлы, к которым линия «привязана» (общий конец — не пересечение). */
  ends: string[];
  /** Ломаная [x0,y0,x1,y1,…] в мировых координатах. */
  pts: number[];
}

/** Параметры построения итоговой геометрии — совпадают с отрисовкой полотна. */
export interface DrawnGeometryOptions {
  /** Компактный режим: узлы — окружности (иначе — карточки). */
  compact?: boolean;
  /** Мировой радиус окружности узла в компактном режиме. */
  radius?: number;
  /** Маркеры обрезки периода (обрубки у крайних видимых операций). */
  cutMarkers?: DrawnCutMarker[];
  /** Линии-поводки узлов, сдвинутых при разведении подписей. */
  leaders?: DrawnLeader[];
  /** Число сэмплов кривой при построении ломаной (точность подсчёта). */
  samples?: number;
}

/**
 * Строит ломаные ВСЕХ линий итоговой схемы — ровно те пути, что рисует полотно:
 *   • операционные связи — точки выхода на границе узлов + минимальное отклонение
 *     вбок для обхода посторонних узлов (квадратичная кривая Безье);
 *   • служебные связи «Старт»/«Финиш» — тот же обход (`edgeControl`);
 *   • маркеры обрезки периода — горизонтальные обрубки;
 *   • линии-поводки подписей, сдвинутых при разведении.
 *
 * Геометрия строится теми же вызовами, что и отрисовка (`borderPoint` +
 * `edgeControl` с тем же числом сэмплов), поэтому счёт пересечений физически не
 * может разойтись с нарисованным.
 */
export function buildDrawnLines(
  pos: Record<string, [number, number]>,
  idList: string[],
  deps: [string, string][],
  serviceEdges: [string, string][],
  geometry: LayoutGeometry,
  opts: DrawnGeometryOptions = {},
): DrawnLine[] {
  const G = resolveGeometry(geometry);
  const compact = !!opts.compact;
  const ahw = compact ? (opts.radius ?? Math.min(G.cardW, G.cardH) / 2) : G.cardW / 2;
  const ahh = compact ? (opts.radius ?? Math.min(G.cardW, G.cardH) / 2) : G.cardH / 2;
  const ehw = ahw + G.edgePad;
  const ehh = ahh + G.edgePad;
  const ohw = ahw + G.obstaclePad;
  const ohh = ahh + G.obstaclePad;
  const samples = Math.max(4, opts.samples ?? 16);

  const rectById: Record<string, Rect> = {};
  const rects: Rect[] = [];
  for (const id of idList) {
    const p = pos[id];
    if (!p) continue;
    const r: Rect = { x: p[0], y: p[1], hw: ahw, hh: ahh };
    rectById[id] = r;
    rects.push(r);
  }

  const out: DrawnLine[] = [];
  const seen = new Set<string>();

  /** Путь связи a→b: точки выхода на границе узлов + обход посторонних узлов. */
  const edgePath = (a: string, b: string, svc: boolean): DrawnLine | null => {
    const ra = rectById[a];
    const rb = rectById[b];
    if (!ra || !rb) return null;
    const s = borderPoint(ra.x, ra.y, ehw, ehh, rb.x, rb.y);
    const e = borderPoint(rb.x, rb.y, ehw, ehh, ra.x, ra.y);
    const obstacles = rects
      .filter((r) => r !== ra && r !== rb)
      .map((r) => ({ x: r.x, y: r.y, hw: ohw, hh: ohh }));
    // Сэмплы выбора обхода — ровно как при отрисовке: операционные 14, служебные 16.
    const c = edgeControl(s[0], s[1], e[0], e[1], obstacles, svc ? PATH_SAMPLES : DRAWN_EDGE_DETOUR_SAMPLES);
    return { a, b, kind: svc ? 'service' : 'op', ends: [a, b], pts: pathPolyline(s, e, c, samples) };
  };

  for (const [a, b] of deps) {
    if (a === b || !rectById[a] || !rectById[b]) continue;
    const k = a + '\u0001' + b;
    if (seen.has(k)) continue;
    seen.add(k);
    const ln = edgePath(a, b, false);
    if (ln) out.push(ln);
  }
  const seenS = new Set<string>();
  for (const [a, b] of serviceEdges) {
    if (a === b || !rectById[a] || !rectById[b]) continue;
    const k = a + '\u0001' + b;
    if (seenS.has(k)) continue;
    seenS.add(k);
    const ln = edgePath(a, b, true);
    if (ln) out.push(ln);
  }
  // Обрубки обрезки периода — горизонтальные, от узла в сторону продолжения.
  (opts.cutMarkers || []).forEach((m, i) => {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.len)) return;
    const x0 = m.x + m.dir * (ahw + 4);
    const x1 = x0 + m.dir * m.len;
    out.push({
      a: '\u0001cut' + i, b: '\u0001cut' + i + '#', kind: 'cut',
      ends: m.opId ? [m.opId] : [],
      pts: [x0, m.y, x1, m.y],
    });
  });
  // Линии-поводки подписей — вертикальный пунктир в исходное место узла.
  (opts.leaders || []).forEach((ld, i) => {
    if (!Number.isFinite(ld.x) || !Number.isFinite(ld.from) || !Number.isFinite(ld.to)) return;
    out.push({
      a: '\u0001lead' + i, b: '\u0001lead' + i + '#', kind: 'leader',
      ends: ld.nodeId ? [ld.nodeId] : [],
      pts: [ld.x, ld.from, ld.x, ld.to],
    });
  });
  return out;
}

/** Ломаная отрезка/квадратичной кривой Безье (та же математика, что при отрисовке). */
function pathPolyline(s: [number, number], e: [number, number], c: [number, number], samples: number): number[] {
  if (c[0] === (s[0] + e[0]) / 2 && c[1] === (s[1] + e[1]) / 2) return [s[0], s[1], e[0], e[1]];
  const pts: number[] = [s[0], s[1]];
  for (let i = 1; i <= samples; i++) {
    const q = quadPt(s[0], s[1], c[0], c[1], e[0], e[1], i / samples);
    pts.push(q[0], q[1]);
  }
  return pts;
}

/** Разбивка пересечений итоговой геометрии: всего и по классам линий. */
export interface DrawnCrossingReport {
  /** Всего пересечений линий на итоговой схеме (как рисуется). */
  total: number;
  /** Пересечения, где участвует хотя бы одна служебная линия (связь «Старт»/«Финиш», обрубок или поводок). */
  service: number;
  /** Операционная связь × операционная связь. */
  opOp: number;
  /** Операционная связь × служебная линия. */
  opSvc: number;
  /** Служебная линия × служебная линия. */
  svcSvc: number;
  /** Пересечения с участием маркеров обрезки периода. */
  cut: number;
  /** Пересечения с участием линий-поводков подписей. */
  leader: number;
}

/**
 * Считает пересечения ИТОГОВОЙ, реально нарисованной геометрии: пути строятся
 * тем же построителем, что и полотно (`buildDrawnLines`), и сравниваются как
 * ломаные. Пары линий с общим узлом-концом пересечением не считаются (как и в
 * счётчике качества), касание обрубка/поводка со связями своего узла — тоже.
 */
export function countDrawnCrossings(
  pos: Record<string, [number, number]>,
  idList: string[],
  deps: [string, string][],
  serviceEdges: [string, string][],
  geometry: LayoutGeometry,
  opts: DrawnGeometryOptions = {},
): DrawnCrossingReport {
  const lines = buildDrawnLines(pos, idList, deps, serviceEdges, geometry, opts);
  let opOp = 0, opSvc = 0, svcSvc = 0, cut = 0, leader = 0;
  for (let i = 0; i < lines.length; i++) {
    const A = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const B = lines[j];
      if (shareNode(A, B)) continue;
      if (!polylinesCross(A.pts, B.pts)) continue;
      const aSvc = A.kind !== 'op';
      const bSvc = B.kind !== 'op';
      if (!aSvc && !bSvc) opOp++;
      else if (aSvc && bSvc) svcSvc++;
      else opSvc++;
      if (A.kind === 'cut' || B.kind === 'cut') cut++;
      if (A.kind === 'leader' || B.kind === 'leader') leader++;
    }
  }
  const service = opSvc + svcSvc;
  return { total: opOp + service, service, opOp, opSvc, svcSvc, cut, leader };
}

/** Есть ли у двух линий общий узел-конец (общий конец — не пересечение). */
function shareNode(a: DrawnLine, b: DrawnLine): boolean {
  if (!a.ends.length || !b.ends.length) return false;
  for (const x of a.ends) if (b.ends.indexOf(x) >= 0) return true;
  return false;
}

/** Пересекаются ли две ломаные (все пары отрезков, до первого попадания). */
function polylinesCross(a: number[], b: number[]): boolean {
  for (let i = 0; i + 3 < a.length; i += 2) {
    for (let j = 0; j + 3 < b.length; j += 2) {
      if (segCross(a[i], a[i + 1], a[i + 2], a[i + 3], b[j], b[j + 1], b[j + 2], b[j + 3])) return true;
    }
  }
  return false;
}
