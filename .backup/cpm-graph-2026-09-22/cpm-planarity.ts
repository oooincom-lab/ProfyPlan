/**
 * Проверка планарности сети CPM построением укладки и прямой вердикт панели.
 *
 * Зачем модуль. Раскладка сети — эвристика: она умеет понижать число
 * пересечений связей, но ноль пересечений в одной укладке ничего не говорит о
 * планарности графа. Поэтому здесь выполняется отдельная проверка укладкой — и
 * по её исходу панель выводит прямой вердикт одним из трёх состояний:
 *
 *   • «планарность подтверждена построением» — конструктивно построена укладка
 *     без пересечений (метод добавления путей с обходом по граням,
 *     Демукрон–Мальгранж–Пертуизе). Успех построения — сертификат планарности:
 *     ноль пересечений достижим в структурной укладке.
 *   • «граф непланарный» — укладку без пересечений построить не удалось либо
 *     нарушено необходимое условие (для планарного графа E ≤ 3·V − 6, для
 *     двудольного E ≤ 2·V − 4). Ноль пересечений невозможен; сообщается
 *     достигнутый минимум оптимизации раскладки.
 *   • «планарность не подтверждена» — метод не смог дать ответ (внутренний сбой
 *     построения). Оставлено как защитная ветка.
 *
 * Проверка идёт по каждой компоненте связности и пробует несколько начальных
 * рёбер (укладка зависит от старта): если хотя бы при одном старте укладка без
 * пересечений построена и прошла контроль формулы Эйлера — компонента планарна.
 *
 * Модуль намеренно не зависит от React: его используют отрисовка сети и панель.
 */

export type PlanarityState = 'confirmed' | 'nonplanar' | 'unconfirmed';

export interface PlanarityNode {
  id: string;
  crit: boolean;
}

export interface PlanarityResult {
  /** Один из трёх исходов проверки. */
  state: PlanarityState;
  /** Вершин в рассматриваемой части сети (после фильтра критического пути). */
  V: number;
  /** Рёбер простого неориентированного графа (петли и кратные исключены). */
  E: number;
  /** Двудольный ли граф (для двудольных действует усиленная оценка 2·V − 4). */
  bipartite: boolean;
  /** Название применённой оценки: «3·V − 6» либо «2·V − 4». */
  boundName: string;
  /** Значение оценки (Infinity, когда ограничение неприменимо — менее трёх вершин). */
  bound: number;
  /** Выполнено ли необходимое условие (E ≤ оценка). */
  boundOk: boolean;
  /** Короткая формулировка состояния — строка состояния панели. */
  shortLabel: string;
  /** Одна строка пояснения к состоянию. */
  explanation: string;
}

/* ─────────────────────────── построение графа ─────────────────────────── */

interface SimpleGraph {
  V: number;
  edges: [number, number][];
}

/**
 * Простой неориентированный граф текущей части сети: вершины — операции
 * (с учётом фильтра «только крит. путь»), рёбра — связи зависимостей без
 * направления, петель и кратных. Нумерация вершин локальная (0…V−1).
 */
function buildSimpleGraph(nodes: PlanarityNode[], deps: [string, string][], critOnly: boolean): SimpleGraph {
  const vis = critOnly ? nodes.filter((n) => n.crit) : nodes;
  const idx = new Map<string, number>();
  vis.forEach((n, i) => idx.set(n.id, i));
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (let k = 0; k < deps.length; k++) {
    const a = idx.get(deps[k][0]);
    const b = idx.get(deps[k][1]);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? a + '|' + b : b + '|' + a;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return { V: vis.length, edges };
}

/** Компоненты связности по рёбрам (номера вершин — из SimpleGraph). */
function components(V: number, edges: [number, number][]): { comp: number[]; count: number } {
  const adj: number[][] = Array.from({ length: V }, () => []);
  for (const [u, v] of edges) { adj[u].push(v); adj[v].push(u); }
  const comp = new Array<number>(V).fill(-1);
  let count = 0;
  for (let s = 0; s < V; s++) {
    if (comp[s] !== -1) continue;
    comp[s] = count;
    const stack = [s];
    while (stack.length) {
      const u = stack.pop() as number;
      for (const w of adj[u]) if (comp[w] === -1) { comp[w] = count; stack.push(w); }
    }
    count++;
  }
  return { comp, count };
}

/** Двудольный ли граф (2-раскраска поиском в ширину). */
function isBipartite(V: number, edges: [number, number][]): boolean {
  const adj: number[][] = Array.from({ length: V }, () => []);
  for (const [u, v] of edges) { adj[u].push(v); adj[v].push(u); }
  const col = new Array<number>(V).fill(-1);
  for (let s = 0; s < V; s++) {
    if (col[s] !== -1) continue;
    col[s] = 0;
    const q = [s];
    while (q.length) {
      const u = q.shift() as number;
      for (const w of adj[u]) {
        if (col[w] === -1) { col[w] = 1 - col[u]; q.push(w); }
        else if (col[w] === col[u]) return false;
      }
    }
  }
  return true;
}

/* ───────── проверка построением: добавление путей с обходом по граням ───────── */

type Dart = [number, number];

interface Face { darts: Dart[]; vset: Set<number> }
interface Fragment { verts: Set<number>; eids: number[]; attachments: number[]; adm: Face[] }
interface PathObj { mode: 'two' | 'pendant'; verts: number[]; eids: number[] }

/** Грань (циклическая обходка дротиков) в текущем вращении rot для подграфа H. */
function computeFaces(edges: [number, number][], H: Iterable<number>, rot: number[][]): Face[] {
  const seen = new Set<string>();
  const faces: Face[] = [];
  const key = (u: number, v: number) => u + '|' + v;
  for (const id of H) {
    const [a, b] = edges[id];
    const pairs: Dart[] = [[a, b], [b, a]];
    for (const [u0, v0] of pairs) {
      if (seen.has(key(u0, v0))) continue;
      let cu = u0;
      let cv = v0;
      const darts: Dart[] = [];
      const vset = new Set<number>();
      let guard = 0;
      while (true) {
        if (seen.has(key(cu, cv))) break;
        seen.add(key(cu, cv));
        darts.push([cu, cv]);
        vset.add(cu); vset.add(cv);
        const rv = rot[cv];
        const i = rv.indexOf(cu);
        const w = rv[(i + 1) % rv.length];
        cu = cv; cv = w;
        if (cu === u0 && cv === v0) break;
        if (++guard > 4 * edges.length + 16) break;
      }
      faces.push({ darts, vset });
    }
  }
  return faces;
}

/** Фрагменты (связные куски ещё не уложенных рёбер) с их точками прикрепления. */
function getFragments(edges: [number, number][], Reds: number[], inH: boolean[]): Fragment[] {
  const adj = new Map<number, Dart[]>();
  const active = new Set<number>();
  for (const id of Reds) {
    const [u, v] = edges[id];
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u)!.push([v, id]);
    adj.get(v)!.push([u, id]);
    active.add(u); active.add(v);
  }
  const visited = new Set<number>();
  const out: Fragment[] = [];
  for (const s of active) {
    if (visited.has(s)) continue;
    const stack = [s];
    visited.add(s);
    const verts = new Set<number>([s]);
    const eids = new Set<number>();
    while (stack.length) {
      const u = stack.pop() as number;
      for (const [w, id] of adj.get(u)!) {
        eids.add(id);
        if (!visited.has(w)) { visited.add(w); verts.add(w); stack.push(w); }
      }
    }
    out.push({ verts, eids: [...eids], attachments: [...verts].filter((v) => inH[v]), adm: [] });
  }
  return out;
}

/** Путь внутри фрагмента между двумя точками прикрепления (или висячее ребро). */
function buildPath(frag: Fragment, edges: [number, number][], inH: boolean[]): PathObj | null {
  const att = frag.attachments;
  if (att.length >= 2) {
    const x = att[0];
    const rAdj = new Map<number, Dart[]>();
    for (const id of frag.eids) {
      const [u, v] = edges[id];
      if (!rAdj.has(u)) rAdj.set(u, []);
      if (!rAdj.has(v)) rAdj.set(v, []);
      rAdj.get(u)!.push([v, id]);
      rAdj.get(v)!.push([u, id]);
    }
    const par = new Map<number, Dart>();
    const vis = new Set<number>([x]);
    const q = [x];
    let y: number | null = null;
    while (q.length) {
      const u = q.shift() as number;
      const nb = rAdj.get(u);
      if (!nb) continue;
      for (const [w, id] of nb) {
        if (vis.has(w)) continue;
        if (inH[w]) { y = w; par.set(w, [u, id]); break; }
        vis.add(w); par.set(w, [u, id]); q.push(w);
      }
      if (y !== null) break;
    }
    if (y === null) return null;
    const verts: number[] = [y];
    const eids: number[] = [];
    let cur = y;
    while (cur !== x) {
      const pr = par.get(cur);
      if (!pr) return null;
      const [p, id] = pr;
      eids.push(id); verts.push(p); cur = p;
    }
    verts.reverse(); eids.reverse();
    return { mode: 'two', verts, eids };
  }
  const x = att[0];
  for (const id of frag.eids) {
    const [u, v] = edges[id];
    if (u === x) return { mode: 'pendant', verts: [x, v], eids: [id] };
    if (v === x) return { mode: 'pendant', verts: [x, u], eids: [id] };
  }
  return null;
}

/** Вставка пути во вращение rot через выбранную грань (расщепление грани). */
function insertPath(pathObj: PathObj, face: Face, rot: number[][], inH: boolean[]): void {
  const verts = pathObj.verts;
  const m = verts.length - 1;
  if (pathObj.mode === 'pendant') {
    const x = verts[0];
    const z = verts[1];
    let a: number | null = null;
    for (const [du, dv] of face.darts) { if (dv === x) { a = du; break; } }
    if (a === null) throw new Error('insertPath: точка прикрепления не на грани');
    const ix = rot[x].indexOf(a);
    rot[x].splice(ix + 1, 0, z);
    rot[z] = [x];
  } else {
    const x = verts[0];
    const y = verts[m];
    let a: number | null = null;
    let c: number | null = null;
    for (const [du, dv] of face.darts) { if (dv === x) { a = du; break; } }
    for (const [du, dv] of face.darts) { if (dv === y) { c = du; break; } }
    if (a === null || c === null) throw new Error('insertPath: конец пути не на грани');
    const ix = rot[x].indexOf(a);
    rot[x].splice(ix + 1, 0, verts[1]);
    const iy = rot[y].indexOf(c);
    rot[y].splice(iy + 1, 0, verts[m - 1]);
    for (let i = 1; i <= m - 1; i++) rot[verts[i]] = [verts[i - 1], verts[i + 1]];
  }
  for (const v of verts) inH[v] = true;
}

/** Предел числа пробных начальных рёбер на компоненту (защита от долгого перебора больших сетей). */
const SEED_LIMIT = 32;

/**
 * Одна попытка уложить связную компоненту без пересечений при заданном начальном
 * ребре (метод добавления путей / DMP). Возвращает true, только если укладка
 * построена И прошла контроль формулы Эйлера для найденного вращения.
 */
function tryEmbedComponent(V: number, edges: [number, number][], eids: number[], seed: number): boolean {
  const inH = new Array<boolean>(V).fill(false);
  const rot: number[][] = Array.from({ length: V }, () => []);
  const H = new Set<number>();
  const [sa, sb] = edges[seed];
  H.add(seed);
  rot[sa] = [sb];
  rot[sb] = [sa];
  inH[sa] = true; inH[sb] = true;

  let guard = 0;
  while (H.size < eids.length) {
    if (++guard > eids.length + 5) return false;
    const Reds = eids.filter((id) => !H.has(id));
    const frags = getFragments(edges, Reds, inH);
    const faces = computeFaces(edges, H, rot);
    for (const f of frags) {
      f.adm = faces.filter((face) => f.attachments.every((at) => face.vset.has(at)));
      if (!f.adm.length) return false;
    }
    const frag = frags.find((f) => f.adm.length === 1) ?? frags[0];
    const face = frag.adm[0];
    const pathObj = buildPath(frag, edges, inH);
    if (!pathObj) return false;
    insertPath(pathObj, face, rot, inH);
    for (const id of pathObj.eids) H.add(id);
  }

  // Контроль сертификата: у связной плоской укладки число граней = E − V + 2.
  const allH = new Set<number>(eids);
  const vset = new Set<number>();
  for (const id of eids) { vset.add(edges[id][0]); vset.add(edges[id][1]); }
  const faces = computeFaces(edges, allH, rot).length;
  return faces === eids.length - vset.size + 2;
}

/**
 * Проверка построением по компонентам связности. Для каждой компоненты пробуем
 * несколько начальных рёбер: если хотя бы при одном старте укладка без
 * пересечений построена и прошла контроль Эйлера — компонента планарна.
 * Возвращает true, только если так для всех компонент. Сбой построения не
 * ловится здесь — исключение пробрасывается выше.
 */
function isPlanarGraph(V: number, edges: [number, number][]): boolean {
  if (!edges.length) return true;
  const { comp, count } = components(V, edges);
  for (let c = 0; c < count; c++) {
    const eids: number[] = [];
    for (let i = 0; i < edges.length; i++) if (comp[edges[i][0]] === c) eids.push(i);
    if (!eids.length) continue;

    let ok = false;
    const limit = Math.min(eids.length, SEED_LIMIT);
    for (let s = 0; s < limit && !ok; s++) {
      if (tryEmbedComponent(V, edges, eids, eids[s])) ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

/* ─────────────────────────── публичная проверка ─────────────────────────── */

/** Склонение слова «пересечение» по числу. */
function crossingsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'пересечение';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'пересечения';
  return 'пересечений';
}

/**
 * Единая проверка планарности рассматриваемой части сети.
 *
 * @param nodes   операции (id + признак критичности) — как для метрик раскладки;
 * @param deps    связи зависимостей (ориентированные пары id);
 * @param critOnly учитывать только критический путь (как в панели);
 * @param bestCrossings фактический минимум пересечений, достигнутый оптимизацией
 *                      раскладки (для пояснения к состоянию «не подтверждена»).
 */
export function checkPlanarity(
  nodes: PlanarityNode[],
  deps: [string, string][],
  critOnly: boolean,
  bestCrossings?: number,
): PlanarityResult {
  const { V, edges } = buildSimpleGraph(nodes, deps, critOnly);
  const E = edges.length;
  const bip = V >= 2 ? isBipartite(V, edges) : true;
  const bounded = V >= 3;
  const boundName = bip ? '2·V − 4' : '3·V − 6';
  const bound = bounded ? (bip ? 2 * V - 4 : 3 * V - 6) : Infinity;
  const boundOk = E <= bound;

  const minNote =
    bestCrossings !== undefined
      ? ' Достигнутый минимум — ' + bestCrossings + ' ' + crossingsWord(bestCrossings) + '.'
      : '';

  // 1) Необходимое условие нарушено — строгое доказательство непланарности.
  if (bounded && !boundOk) {
    return {
      state: 'nonplanar', V, E, bipartite: bip, boundName, bound, boundOk,
      shortLabel: 'граф непланарный',
      explanation:
        'Ноль пересечений невозможен: нарушено необходимое условие планарности — рёбер ' + E +
        ' > ' + boundName + ' = ' + bound + (bip ? ' (граф двудольный)' : '') + '.' + minNote,
    };
  }

  // 2) Пробуем построить укладку без пересечений — это доказательство планарности.
  let planar = false;
  let methodFailed = false;
  try {
    planar = isPlanarGraph(V, edges);
  } catch {
    methodFailed = true; // внутренний сбой построения — метод не дал ответа
  }

  if (planar) {
    return {
      state: 'confirmed', V, E, bipartite: bip, boundName, bound, boundOk,
      shortLabel: 'планарность подтверждена построением',
      explanation: 'Укладка без пересечений построена — ноль пересечений достижим в структурной укладке.',
    };
  }

  // 3) Метод не завершился — не берёмся утверждать непланарность.
  if (methodFailed) {
    return {
      state: 'unconfirmed', V, E, bipartite: bip, boundName, bound, boundOk,
      shortLabel: 'планарность не подтверждена',
      explanation: 'Метод построения не смог дать ответ.' + minNote,
    };
  }

  // 4) Уложить не удалось — граф непланарный.
  return {
    state: 'nonplanar', V, E, bipartite: bip, boundName, bound, boundOk,
    shortLabel: 'граф непланарный',
    explanation:
      'Ноль пересечений невозможен: укладку без пересечений построить не удалось' +
      ' (необходимое условие ' + boundName + ' = ' + bound + ' выполнено: ' + E + ' рёбер).' + minNote,
  };
}
