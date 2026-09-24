/**
 * Чистая раскладка сети CPM: колонки по датам/слоям, упорядочивание узлов
 * внутри колонки (барицентр по соседям + локальные улучшения по счётчику
 * качества) и мягкая подтяжка узла к средней линии соседей. Модуль намеренно
 * не зависит от React — одни и те же функции используют отрисовка (`CpmGraph`),
 * счётчик качества раскладки и автотест.
 *
 * Важные свойства раскладки:
 *   • вертикальный ПЕРЕНОС узла и колонки (`translateRange`) — та же свобода
 *     сдвигать кружки по вертикали, которой человек разводит сеть вручную;
 *     включается там, где укладка без пересечений вообще достижима;
 *   • итог выбирается по числу пересечений НАРИСОВАННОЙ геометрии
 *     (`drawnCrossingCost`: границы узлов + обходы, как на полотне), а среди
 *     кандидатов всегда есть «классическая» укладка без переноса — поэтому
 *     новая раскладка не может оказаться хуже прежней по этому числу.
 */
import {
  CARD_W, CARD_H, segRectHit, segCross, borderPoint, quadPt, edgeControl, DRAWN_EDGE_DETOUR_SAMPLES,
  BASE_COL_GAP, BASE_ROW_GAP, BASE_PAD, resolveGeometry, type Rect, type LayoutGeometry,
} from './cpm-metrics';
import { detectVisibleEndpoints } from './cpm-structure';

export type Mode = 'byDate' | 'byLayer';

/** Как строится колонка структурной укладки: по раннему старту или по глубине связей. */
type ColKind = 'es' | 'topo';

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
  /**
   * Полуширина перебора вертикального ПЕРЕНОСА узла/колонки, в шагах ряда.
   * Это та «свобода сдвигать кружки по вертикали», которой человек разводит
   * укладку вручную: сдвиг узла в его колонке и сдвиг колонки целиком. 0 — выкл.
   */
  translateRange?: number;
  /**
   * Компановка обрезок периода (только структурная укладка «По слоям»).
   * Крайние видимые операции цепочек, чьё продолжение осталось за периодом,
   * получают в раскладке маркеры обрезки. Если включено, их узлы выносятся на
   * общую вертикаль слева и справа (по одной на каждую сторону), а порядок
   * узлов в затронутых слоях пересобирается по барицентру соседей с сохранением
   * шага ряда — так выравнивание выходит без наложения узлов и без новых
   * пересечений связей: видимое окно читается прямоугольником, а подписи
   * остаются при своих узлах. По умолчанию выключено — поведение ровно как без
   * компановки.
   */
  alignCutEnds?: boolean;
  /**
   * Требовать от компановки обрезок не увеличивать число пересечений итоговой
   * геометрии. Включается в раскладке «Без пересечений», где обещан ноль: если
   * выравнивание не удержало бы его, результат откатывается. В «Обычно»/«Плотно»
   * компановка применяется по явному выбору пользователя без такой проверки.
   */
  alignCutEndsGuard?: boolean;
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
  /**
   * Число стартов оптимизации. Структурная укладка — разовый расчёт (не покадровый),
   * поэтому дорогие проходы можно повторять из разных начальных порядков и брать
   * лучший результат по числовому критерию: так укладка выходит из локального
   * минимума, в который упирается единственный старт. 1 — единственный старт.
   */
  restarts?: number;
  /**
   * Геометрия раскладки (размер узлов, зазоры, отступ). От неё зависят и позиции
   * узлов, и метрики качества, и отрисовка — поэтому переключатель раскладки
   * меняет вид и числа, а не только внутренние проходы оптимизации.
   */
  geometry?: LayoutGeometry;
  /**
   * Нижняя граница вертикального шага ряда (мировые единицы). В компактном режиме
   * узел вместе с подписями (имя сверху, «продолжительность + резерв» снизу) выше
   * карточки, поэтому раскладка должна раздвигать узлы столбца так, чтобы подписи
   * помещались. 0/undefined — обычный шаг (cardH + rowGap).
   */
  minRowPitch?: number;
  /**
   * Добавлять старты оптимизации «по топологической глубине столбцов» (структурная
   * укладка «по связям»), когда стартов больше одного. false — только старты «по
   * раннему старту» (сохраняет слоистость по времени/раннему старту).
   */
  topologicalStarts?: boolean;
}

/** Минимальный зазор между узлами по обеим осям. */
export const MIN_GAP = 12;
/** Колонки: COL_PITCH = CARD_W + COL_GAP (> CARD_W + MIN_GAP). */
export const COL_GAP = BASE_COL_GAP;
/** Ряды: ROW_PITCH = CARD_H + ROW_GAP (> CARD_H + MIN_GAP). */
export const ROW_GAP = BASE_ROW_GAP;
export const COL_PITCH = CARD_W + COL_GAP;
export const ROW_PITCH = CARD_H + ROW_GAP;
export const PAD = BASE_PAD;

/**
 * Раскладка: колонки по датам/слоям, порядок внутри колонки (барицентр),
 * затем локальные улучшения по счётчику качества (перестановки соседних узлов
 * и подтяжка к средней линии соседей), затем «разведение рядов» с зазором.
 *
 * При `restarts > 1` те же проходы повторяются из нескольких начальных
 * порядков (детерминированные старты) и берётся лучший по числовому критерию.
 * Это дороже, но структурная укладка считается разово, а не покадрово, и на
 * ней этот приём выводит раскладку из локального минимума.
 */
export function computeLayout(
  ops: GOp[],
  deps: [string, string][],
  mode: Mode,
  opts: LayoutOptions = {},
): Layout {
  const restarts = Math.max(1, Math.floor(opts.restarts ?? 1));
  const key = layoutCacheKey(ops, deps, mode, opts, restarts);
  const hit = layoutCache.get(key);
  if (hit) return { ...hit, pos: { ...hit.pos } };

  const ids = new Set(ops.map((o) => o.id));
  // Связи видимого подграфа — тот же набор, что строит один старт раскладки
  // (используется для оценки итоговой «нарисованной» геометрии при выборе старта).
  const selEdges: [string, string][] = [];
  deps.forEach(([a, b]) => { if (a !== b && ids.has(a) && ids.has(b)) selEdges.push([a, b]); });

  // Кандидаты: несколько стартов структурной укладки + «классическая» укладка
  // без вертикального переноса (как считалось раньше). Выбор — по числу
  // пересечений ИТОГОВОЙ (нарисованной) геометрии, поэтому новая укладка не может
  // оказаться хуже классической по этому числу: классика всегда среди кандидатов.
  const translateRange = opts.translateRange ?? 6;

  // Структурная укладка при нескольких стартах перебирает детерминированные старты
  // по равному раннему старту И столько же стартов по топологической глубине (слой
  // «по связям», без времени).
  const multi = mode === 'byLayer' && restarts > 1;
  const topoStarts = opts.topologicalStarts !== false;
  // Для «по датам» старты идентичны (детерминированный порядок) — достаточно одного;
  // для «по слоям» перебираем старты «по раннему старту» и (если разрешено) «по связям».
  const total = multi ? restarts * (topoStarts ? 2 : 1) : 1;
  const candidates: Layout[] = [];
  for (let s = 0; s < total; s++) {
    const colKind: ColKind = multi && topoStarts && s >= restarts ? 'topo' : 'es';
    const seed = multi ? (s % restarts) : null;
    candidates.push(computeLayoutOnce(ops, deps, mode, opts, seed, colKind, translateRange).layout);
    // Тот же старт БЕЗ вертикального переноса — страховка от регресса: набор
    // содержит и «классические» укладки, по которым раньше и выбирался результат,
    // а итог берётся по числу пересечений нарисованной геометрии.
    if (translateRange > 0) {
      candidates.push(computeLayoutOnce(ops, deps, mode, opts, seed, colKind, 0).layout);
    }
  }

  let result = candidates[0];
  let bestCost = drawnCrossingCost(result.pos, ops, selEdges, opts);
  for (let i = 1; i < candidates.length; i++) {
    const cost = drawnCrossingCost(candidates[i].pos, ops, selEdges, opts);
    if (cost < bestCost) { bestCost = cost; result = candidates[i]; }
  }

  // Компановка обрезок периода (только структурная укладка «По слоям» и только
  // по явному флагу): узлы с маркерами обрезки выносятся на общие вертикали
  // слева/справа, а слои внутри окна пересобираются так, чтобы выравнивание
  // получилось без наложения узлов. Результат принимается, только если число
  // пересечений итоговой геометрии (включая наложения узлов) не выросло —
  // компановка не может сделать укладку хуже, чем без неё.
  if (opts.alignCutEnds) {
    const aligned = compactPeriodCuts(result, ops, deps, mode, opts);
    if (aligned) {
      const alignCost = drawnCrossingCost(aligned.pos, ops, selEdges, opts);
      // В режиме «Без пересечений» (alignCutEndsGuard) результат принимается
      // только если пересечений не стало больше — там обещан ноль, и крыжик не
      // должен его ломать. В остальных раскладках компановка применяется по
      // явному выбору пользователя: это его прямое указание, а не оптимизация,
      // и она должна быть видна на картинке.
      if (!opts.alignCutEndsGuard || alignCost <= bestCost + 1e-9) {
        bestCost = alignCost;
        result = aligned;
      }
    }
  }
  if (layoutCache.size >= LAYOUT_CACHE_MAX) {
    const oldest = layoutCache.keys().next().value as string | undefined;
    if (oldest !== undefined) layoutCache.delete(oldest);
  }
  layoutCache.set(key, result);
  return { ...result, pos: { ...result.pos } };
}

/**
 * Числовой критерий укладки для ВЫБОРА лучшего старта — число пересечений
 * ИТОГОВОЙ (нарисованной) геометрии: связи строятся тем же построителем границ
 * и обходов (`borderPoint` + `edgeControl`), что и на полотне, и сравниваются
 * как ломаные. Именно это число видит пользователь в счётчике, поэтому выбор
 * лучшего старта по нему согласован с картинкой и не может выбрать укладку,
 * «красивую по скелету, но с кучей обходов и пересечений».
 */
function drawnCrossingCost(
  pos: Record<string, [number, number]>,
  ops: GOp[],
  edges: [string, string][],
  opts: LayoutOptions,
): number {
  const G = resolveGeometry(opts.geometry);
  const cw = G.cardW;
  const ch = G.cardH;
  const ep = G.edgePad;
  const op = G.obstaclePad;
  const overlapWeight = opts.overlapWeight ?? 50;

  const n = ops.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  ops.forEach((o, i) => { const p = pos[o.id]; cx[i] = p ? p[0] : 0; cy[i] = p ? p[1] : 0; });

  // Наложения узлов (страховка от вырожденной укладки).
  let overlaps = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(cx[i] - cx[j]) < cw && Math.abs(cy[i] - cy[j]) < ch) overlaps++;
    }
  }

  interface DrawnPt { a: string; b: string; pts: number[]; minx: number; maxx: number; miny: number; maxy: number }
  const lines: DrawnPt[] = [];
  const seen = new Set<string>();
  const samples = 16;
  for (const [aId, bId] of edges) {
    if (aId === bId || !pos[aId] || !pos[bId]) continue;
    const key = aId + '\u0001' + bId;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = pos[aId];
    const pb = pos[bId];
    const s = borderPoint(pa[0], pa[1], cw / 2 + ep, ch / 2 + ep, pb[0], pb[1]);
    const e = borderPoint(pb[0], pb[1], cw / 2 + ep, ch / 2 + ep, pa[0], pa[1]);
    const obstacles: Rect[] = [];
    for (let i = 0; i < n; i++) {
      const o = ops[i];
      if (o.id === aId || o.id === bId) continue;
      obstacles.push({ x: cx[i], y: cy[i], hw: cw / 2 + op, hh: ch / 2 + op });
    }
    const c = edgeControl(s[0], s[1], e[0], e[1], obstacles, DRAWN_EDGE_DETOUR_SAMPLES);
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
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < minx) minx = pts[i];
      if (pts[i] > maxx) maxx = pts[i];
      if (pts[i + 1] < miny) miny = pts[i + 1];
      if (pts[i + 1] > maxy) maxy = pts[i + 1];
    }
    lines.push({ a: aId, b: bId, pts, minx, maxx, miny, maxy });
  }

  const polyCross = (A: number[], B: number[]): boolean => {
    for (let i = 0; i + 3 < A.length; i += 2) {
      for (let j = 0; j + 3 < B.length; j += 2) {
        if (segCross(A[i], A[i + 1], A[i + 2], A[i + 3], B[j], B[j + 1], B[j + 2], B[j + 3])) return true;
      }
    }
    return false;
  };

  let crossings = 0;
  for (let i = 0; i < lines.length; i++) {
    const A = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const B = lines[j];
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
      if (A.minx > B.maxx || B.minx > A.maxx || A.miny > B.maxy || B.miny > A.maxy) continue;
      if (polyCross(A.pts, B.pts)) crossings++;
    }
  }

  return crossings + overlapWeight * overlaps;
}

/**
 * Компановка обрезок периода для структурной укладки «По слоям».
 *
 * Обрезки периода — это маркеры у крайних видимых операций цепочки, чьё
 * продолжение осталось за окном (до или после периода). После фильтрации разные
 * цепочки заканчиваются в разных слоях, поэтому маркеры стоят на разных
 * вертикалях и окно выглядит «рвано».
 *
 * Компановка выносит узлы-обрезки на общую вертикаль: все левые (продолжение
 * раньше окна) — на самый левый слой среди них, все правые (продолжение позже
 * окна) — на самый правый. Наклонённые слои (колонки по x) переупаковываются по
 * вертикали: порядок берётся по барицентру соседей (потому переехавший узел встаёт
 * между своими соседями и не «разрезает» чужие связи — выравнивание выходит без
 * наложения узлов и без новых пересечений), шаг ряда сохраняется, а тай-брейк по
 * id делает результат воспроизводимым. Подписи остаются при своих узлах
 * (узел и его подписи двигаются как одно целое).
 *
 * Возвращает новую укладку или null, если обрезок нет / они уже на одной
 * вертикали (тогда трогать укладку незачем).
 */
function compactPeriodCuts(
  layout: Layout,
  ops: GOp[],
  deps: [string, string][],
  mode: Mode,
  opts: LayoutOptions,
): Layout | null {
  // Компановка осмысленна только в структурной укладке «По слоям»: в «По датам»
  // горизонталь задаётся календарём и сдвигать узлы по x нельзя.
  if (mode !== 'byLayer' || !ops.length) return null;

  const net = detectVisibleEndpoints(ops.map((o) => o.id), deps);
  const pos = layout.pos;
  const cutStart = net.cutStartIds.filter((id) => pos[id]);
  const cutFinish = net.cutFinishIds.filter((id) => pos[id]);
  if (!cutStart.length && !cutFinish.length) return null;

  const LX = cutStart.length ? Math.min(...cutStart.map((id) => pos[id][0])) : null;
  const RX = cutFinish.length ? Math.max(...cutFinish.map((id) => pos[id][0])) : null;
  const onLine = (ids: string[], x: number | null): boolean =>
    x == null || ids.every((id) => Math.abs(pos[id][0] - x) < 1e-6);
  if (onLine(cutStart, LX) && onLine(cutFinish, RX)) return null;   // уже выровнено

  const G = resolveGeometry(opts.geometry);
  const rowPitch = Math.max(G.cardH + G.rowGap, opts.minRowPitch ?? 0);

  const np: Record<string, [number, number]> = {};
  for (const id in pos) np[id] = [pos[id][0], pos[id][1]];
  if (LX != null) cutStart.forEach((id) => { np[id][0] = LX; });
  if (RX != null) cutFinish.forEach((id) => { np[id][0] = RX; });

  // Переупаковка затронутых слоёв по вертикали.
  //
  // Порядок внутри слоя берём по барицентру видимых соседей — средней высоте
  // соседей ПОСЛЕ переноса узлов. Это тот же приём, которым раскладка
  // упорядочивает слои: узел встаёт между своими соседями, поэтому переехавший
  // узел не «разрезает» чужие связи и выравнивание выходит без пересечений.
  // Прежний порядок «как было по y» на окне заказчика давал лишнее пересечение,
  // из-за чего компановка откатывалась защитой и крыжик ничего не менял.
  // Шаг ряда сохраняет зазор между узлами, тай-брейк по id делает результат
  // воспроизводимым. Переносим только слои, реально принявшие узлы-обрезки:
  // остальные не изменились и уже удовлетворяют шагу ряда — их не трогаем.
  const affected = new Set<number>();
  if (LX != null && cutStart.some((id) => Math.abs(pos[id][0] - LX) > 1e-6)) affected.add(LX);
  if (RX != null && cutFinish.some((id) => Math.abs(pos[id][0] - RX) > 1e-6)) affected.add(RX);
  const cols = new Map<number, string[]>();
  for (const id in np) {
    const x = np[id][0];
    if (!affected.has(x)) continue;
    if (!cols.has(x)) cols.set(x, []);
    cols.get(x)!.push(id);
  }
  if (cols.size) {
    const visible = new Set<string>(Object.keys(np));
    const neighbours: Record<string, string[]> = {};
    for (const [a, b] of deps) {
      if (a === b || !visible.has(a) || !visible.has(b)) continue;
      if (!neighbours[a]) neighbours[a] = [];
      if (!neighbours[b]) neighbours[b] = [];
      neighbours[a].push(b);
      neighbours[b].push(a);
    }
    const bary = new Map<string, number>();
    cols.forEach((list) => {
      list.forEach((id) => {
        const ys: number[] = [];
        for (const nId of neighbours[id] || []) { const p = np[nId]; if (p) ys.push(p[1]); }
        bary.set(id, ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : np[id][1]);
      });
    });
    cols.forEach((list) => {
      list.sort((a, b) => ((bary.get(a)! - bary.get(b)!) || (a < b ? -1 : a > b ? 1 : 0)));
      for (let i = 1; i < list.length; i++) {
        if (np[list[i]][1] - np[list[i - 1]][1] < rowPitch) {
          np[list[i]][1] = np[list[i - 1]][1] + rowPitch;
        }
      }
    });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const id in np) {
    const [x, y] = np[id];
    if (x - G.cardW / 2 < minX) minX = x - G.cardW / 2;
    if (x + G.cardW / 2 > maxX) maxX = x + G.cardW / 2;
    if (y - G.cardH / 2 < minY) minY = y - G.cardH / 2;
    if (y + G.cardH / 2 > maxY) maxY = y + G.cardH / 2;
  }
  if (!Number.isFinite(minX)) return null;

  return { ...layout, pos: np, minX, maxX, minY, maxY };
}

/** Один старт раскладки: возвращает укладку и её числовой критерий. */
function computeLayoutOnce(
  ops: GOp[],
  deps: [string, string][],
  mode: Mode,
  opts: LayoutOptions,
  seed: number | null,
  colKind: ColKind,
  translateRange: number,
): { layout: Layout; cost: number } {
  const baryPasses = opts.baryPasses ?? 4;
  const localPasses = opts.localPasses ?? 8;
  const pullStep = opts.pullStep ?? 0.5;
  const moveWindow = opts.moveWindow ?? 20;
  const maxEvals = opts.maxEvals ?? 20000;
  const crossWeight = opts.crossWeight ?? 1;
  const hitWeight = opts.hitWeight ?? 1;
  const overlapWeight = opts.overlapWeight ?? 50;
  const baryMode = opts.baryMode ?? 'mean';
  const pullMode = opts.pullMode ?? 'mean';

  // Геометрия текущего пресета: размер узла, зазоры и отступ. Одни и те же
  // значения используют и укладка, и метрики (через computeLayoutMetrics),
  // и отрисовка (через CpmGraph) — поэтому выбор раскладки меняет и вид, и числа.
  const G = resolveGeometry(opts.geometry);
  const cardW = G.cardW;
  const cardH = G.cardH;
  const colPitch = cardW + G.colGap;
  // Шаг ряда: не меньше обычного и не меньше минимума под подписи (компактный режим).
  const rowPitch = Math.max(cardH + G.rowGap, opts.minRowPitch ?? 0);
  const pad = G.pad;
  const edgeHW = cardW / 2 + G.edgePad;
  const edgeHH = cardH / 2 + G.edgePad;
  const obHW = cardW / 2 + G.obstaclePad;
  const obHH = cardH / 2 + G.obstaclePad;

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
  if (mode === 'byLayer' && colKind === 'topo') {
    // Структурная укладка «по связям»: слой — топологическая глубина (длина самого
    // длинного пути от истоков). Время в определении слоя не участвует.
    const depth: Record<string, number> = {};
    ops.forEach((o) => { depth[o.id] = 0; });
    const indeg: Record<string, number> = {};
    ops.forEach((o) => { indeg[o.id] = preds[o.id].length; });
    const q = ops.filter((o) => indeg[o.id] === 0).map((o) => o.id);
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const v of succs[u]) {
        if (depth[u] + 1 > depth[v]) depth[v] = depth[u] + 1;
        if (--indeg[v] === 0) q.push(v);
      }
    }
    const uniq = Array.from(new Set(ops.map((o) => depth[o.id]))).sort((a, b) => a - b);
    const idx = new Map<number, number>(uniq.map((v, i) => [v, i]));
    colOf = (o) => idx.get(depth[o.id]) ?? 0;
  } else if (mode === 'byLayer') {
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
    // Старт с номером seed≠null — детерминированно перемешиваем порядок внутри
    // колонки: разные старты упираются в разные локальные минимумы, при этом
    // результат воспроизводим (тот же старт — тот же порядок).
    if (seed != null && g.length > 1) {
      let st = (seed * 2654435761 + 1) >>> 0;
      const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
      for (let i = g.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = g[i]; g[i] = g[j]; g[j] = t;
      }
    }
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
  // Горизонталь колонки:
  //   • «по датам» — по КАЛЕНДАРЮ: x пропорционален дате колонки (средний ранний
  //     старт её операций) относительно начала отсчёта (minEs). Это тот же
  //     линейный масштаб, что и у шкалы времени (`pxPerDay`), поэтому картинка и
  //     шкала совпадают. Раньше x считался по ПОРЯДКОВОМУ номеру непустой колонки,
  //     из-за чего пустые дни «сжимались» и, особенно после фильтра по периоду,
  //     узлы уезжали от своих дат. Минимальный шаг colPitch не даёт тесным по датам
  //     колонкам наложиться (допускается небольшой сдвиг вправо плотных колонок).
  //   • «по слоям» — по порядковому номеру слоя (хронология не показывается).
  const pos: Record<string, [number, number]> = {};
  const colX = new Map<number, number>();
  if (mode === 'byDate') {
    const ppd = colPitch / bucketDays;
    let prevX = -Infinity;
    colKeys.forEach((c) => {
      const g = groups.get(c)!;
      const colDay = g.reduce((s, o) => s + o.es, 0) / g.length;
      let x = pad + (colDay - minEs) * ppd + cardW / 2;
      if (x < prevX + colPitch) x = prevX + colPitch;
      prevX = x;
      colX.set(c, x);
    });
  } else {
    colKeys.forEach((c) => {
      const ci = colIndex.get(c)!;
      colX.set(c, pad + ci * colPitch + cardW / 2);
    });
  }
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    const x = colX.get(c)!;
    const total = g.length * rowPitch;
    const y0 = -total / 2 + rowPitch / 2;
    g.forEach((o, i) => { pos[o.id] = [x, y0 + i * rowPitch]; });
  });

  // ── локальные улучшения по счётчику качества ──
  // Принимаем изменение только если суммарный критерий
  // (пересечения + проходы сквозь узлы + наложения узлов) строго уменьшился.
  let cost = 0;
  if (localPasses > 0 && ops.length > 1 && edges.length) {
    cost = improveLocally(ops, edges, preds, succs, colKeys, groups, pos, {
      localPasses, pullStep, moveWindow, maxEvals, crossWeight, hitWeight, overlapWeight, pullMode, translateRange,
      cardW, cardH, rowPitch, edgeHW, edgeHH, obHW, obHH,
    });
  }

  // ── финальная гарантия зазора (на случай выключенного локального поиска) ──
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    const arr = g.slice().sort((p, q) => (pos[p.id][1] - pos[q.id][1]) || (orderY[p.id] - orderY[q.id]));
    for (let i = 1; i < arr.length; i++) {
      if (pos[arr[i].id][1] - pos[arr[i - 1].id][1] < rowPitch) {
        pos[arr[i].id][1] = pos[arr[i - 1].id][1] + rowPitch;
      }
    }
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  Object.keys(pos).forEach((id) => {
    const [x, y] = pos[id];
    if (x - cardW / 2 < minX) minX = x - cardW / 2;
    if (x + cardW / 2 > maxX) maxX = x + cardW / 2;
    if (y - cardH / 2 < minY) minY = y - cardH / 2;
    if (y + cardH / 2 > maxY) maxY = y + cardH / 2;
  });
  if (!ops.length) { minX = 0; maxX = 100; minY = 0; maxY = 100; }

  return {
    layout: {
      pos, minX, maxX, minY, maxY,
      pxPerDay: colPitch / (mode === 'byDate' ? bucketDays : 1),
      bucketDays,
      minEs,
    },
    cost,
  };
}

/** Предел числа кэшируемых укладок (одна и та же раскладка запрашивается
 *  несколько раз за отрисовку — кэш убирает повторный дорогой пересчёт). */
const LAYOUT_CACHE_MAX = 8;
const layoutCache = new Map<string, Layout>();

/** Ключ кэша: режим + опции + подписи операций и связей (полное совпадение входа). */
function layoutCacheKey(
  ops: GOp[], deps: [string, string][], mode: Mode, opts: LayoutOptions, restarts: number,
): string {
  let o = '';
  for (let i = 0; i < ops.length; i++) {
    const x = ops[i];
    o += x.id + '\u0001' + x.num + '\u0001' + x.es + '\u0001' + x.ef + '\u0001' + x.durDays + '\u0001' + x.name + '\u0001' + (x.crit ? 1 : 0) + '\u0002';
  }
  let d = '';
  for (let i = 0; i < deps.length; i++) d += deps[i][0] + '\u0001' + deps[i][1] + '\u0002';
  return mode + '\u0003' + restarts + '\u0003' + JSON.stringify(opts) + '\u0003' + o.length + '\u0003' + o + '\u0003' + d.length + '\u0003' + d;
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
  /** Полуширина перебора вертикального переноса узла/колонки в шагах ряда. */
  translateRange: number;
  /** Размер карточки узла текущей геометрии (для подсчёта наложений). */
  cardW: number;
  cardH: number;
  /** Шаг ряда текущей геометрии (cardH + rowGap). */
  rowPitch: number;
  /** Полуширина/полувысота узла с отступом линии (как при отрисовке). */
  edgeHW: number;
  edgeHH: number;
  /** Полуширина/полувысота препятствия (узел + зазор обхода). */
  obHW: number;
  obHH: number;
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
): number {
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
        let tx = dx === 0 ? Infinity : o.edgeHW / Math.abs(dx);
        let ty = dy === 0 ? Infinity : o.edgeHH / Math.abs(dy);
        const t1 = tx < ty ? tx : ty;
        sx[k] = ax + dx * t1;
        sy[k] = ay + dy * t1;
        dx = ax - bx;
        dy = ay - by;
        if (dx === 0 && dy === 0) { ex[k] = bx; ey[k] = by; }
        else {
          tx = dx === 0 ? Infinity : o.edgeHW / Math.abs(dx);
          ty = dy === 0 ? Infinity : o.edgeHH / Math.abs(dy);
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
        if (Math.abs(axi - px[j]) < o.cardW && Math.abs(ayi - py[j]) < o.cardH) overlaps++;
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
      const lox = bx0[k] - o.obHW;
      const hix = bx1[k] + o.obHW;
      const loy = by0[k] - o.obHH;
      const hiy = by1[k] + o.obHH;
      for (let i = 0; i < n; i++) {
        if (i === a || i === b) continue;
        const nx = px[i];
        const ny = py[i];
        if (nx < lox || nx > hix || ny < loy || ny > hiy) continue;
        if (segRectHit(x1, y1, x2, y2, nx, ny, o.obHW, o.obHH)) hits++;
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
      if (py[arr[i]] - py[arr[i - 1]] < o.rowPitch) py[arr[i]] = py[arr[i - 1]] + o.rowPitch;
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

    // 3) вертикальный ПЕРЕНОС узла внутри его колонки.
    //    Это ключевая «свобода сдвигать кружки по вертикали»: без неё узлы в
    //    одиночных колонках жёстко стоят на одной высоте, и длинная связь
    //    (например, «закупка» из первого слоя в последний) вынуждена огибать
    //    весь столбец узлов — обход рождает пачку пересечений. Перенос кратен
    //    шагу ряда; после сдвига колонка переупаковывается, поэтому зазор и
    //    порядок сохраняются, а подписи остаются при своих узлах (меняется y
    //    узла, подпись следует за ним).
    const stepY = o.rowPitch;
    if (o.translateRange > 0) {
      for (let ci = 0; ci < colNodes.length; ci++) {
        const nodes = colNodes[ci];
        if (!nodes.length) continue;
        for (let t = 0; t < nodes.length; t++) {
          const i = nodes[t];
          for (let k = 1; k <= o.translateRange; k++) {
            for (const sgn of (k % 2 === 1 ? [1, -1] : [-1, 1])) {
              if (evals++ > o.maxEvals) break;
              const backup = nodes.map((x) => py[x]);
              py[i] += sgn * k * stepY;
              packColumn(ci);
              const nc = cost();
              if (nc < cur - 1e-9) {
                cur = nc;
                improved = true;
              } else {
                for (let q = 0; q < nodes.length; q++) py[nodes[q]] = backup[q];
              }
            }
          }
        }
      }

      // 4) сдвиг ВСЕЙ колонки целиком: уводит столбец от коридоров длинных
      //    связей, сохраняя взаимные зазоры и порядок внутри колонки.
      for (let ci = 0; ci < colNodes.length; ci++) {
        const nodes = colNodes[ci];
        if (!nodes.length) continue;
        for (let k = 1; k <= o.translateRange; k++) {
          for (const sgn of (k % 2 === 1 ? [1, -1] : [-1, 1])) {
            if (evals++ > o.maxEvals) break;
            const backup = nodes.map((x) => py[x]);
            for (let q = 0; q < nodes.length; q++) py[nodes[q]] += sgn * k * stepY;
            const nc = cost();
            if (nc < cur - 1e-9) {
              cur = nc;
              improved = true;
            } else {
              for (let q = 0; q < nodes.length; q++) py[nodes[q]] = backup[q];
            }
          }
        }
      }
    }

    if (!improved) break;
  }

  // записываем результат обратно
  ops.forEach((op, i) => { pos[op.id][1] = py[i]; });
  return cur;
}
