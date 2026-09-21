/* Временный замер метрик на живом проекте. Не часть проекта — удаляется после прогона. */
import { computeLayoutMetrics, CARD_W, CARD_H } from '../../../lib/cpm-metrics';

const API = 'http://localhost:8000';

type Mode = 'byDate' | 'byLayer';

interface GOp {
  id: string; num: number | string; name: string; code: string; detail: string;
  durDays: number; es: number; ef: number; ls: number; lf: number; tf: number;
  crit: boolean; branch: boolean; hpd: number;
}
interface Layout {
  pos: Record<string, [number, number]>;
  minX: number; maxX: number; minY: number; maxY: number;
  pxPerDay: number; bucketDays: number; minEs: number;
}

const MIN_GAP = 12;
const COL_GAP = 34;
const ROW_GAP = 22;
const COL_PITCH = CARD_W + COL_GAP;
const ROW_PITCH = CARD_H + ROW_GAP;
const PAD = 70;

function num(v: any, fallback = 0): number { const x = Number(v); return Number.isFinite(x) ? x : fallback; }

function mapOps(cpmResult: any): GOp[] {
  const raw: any[] = (cpmResult && cpmResult.nodes) || [];
  const critPath: string[] = (cpmResult && cpmResult.critical_path) || [];
  const mainSet = new Set(critPath.map(String));
  const branchSet = new Set<string>();
  ((cpmResult && cpmResult.critical_paths) || []).forEach((b: any) => {
    (b && b.operations ? b.operations : []).forEach((id: any) => branchSet.add(String(id)));
  });
  return raw.map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, num(n.duration_base, 0)) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const ls = n.late_start_day != null ? num(n.late_start_day) : num(n.late_start, es);
    const lf = n.late_finish_day != null ? num(n.late_finish_day) : num(n.late_finish, ef);
    const tf = n.total_float_days != null ? num(n.total_float_days) : num(n.total_float, 0) / hpd;
    const id = String(n.id);
    const fullName = String(n.name || id);
    const sep = fullName.indexOf('·');
    const code = sep > 0 ? fullName.slice(0, sep).trim() : fullName;
    const detail = sep > 0 ? fullName.slice(sep + 1).trim() : '';
    const crit = !!(n.is_critical != null ? n.is_critical : n.critical);
    return {
      id, num: n.number != null ? n.number : (n.num != null ? n.num : i + 1),
      name: fullName, code, detail, durDays, es, ef, ls, lf, tf, crit,
      branch: branchSet.has(id) && !mainSet.has(id), hpd,
    };
  });
}

function computeLayout(ops: GOp[], deps: [string, string][], mode: Mode): Layout {
  const ids = new Set(ops.map((o) => o.id));
  const preds: Record<string, string[]> = {};
  const succs: Record<string, string[]> = {};
  ops.forEach((o) => { preds[o.id] = []; succs[o.id] = []; });
  deps.forEach(([a, b]) => { if (ids.has(a) && ids.has(b)) { succs[a].push(b); preds[b].push(a); } });

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
  ops.forEach((o) => { const c = colOf(o); if (!groups.has(c)) groups.set(c, []); groups.get(c)!.push(o); });
  const colKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  const colIndex = new Map<number, number>(colKeys.map((c, i) => [c, i]));

  const orderY: Record<string, number> = {};
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    g.sort((a, b) => (a.es - b.es) || (b.durDays - a.durDays) || a.name.localeCompare(b.name));
    g.forEach((o, i) => { orderY[o.id] = i; });
  });

  for (let pass = 0; pass < 4; pass++) {
    colKeys.forEach((c) => {
      const g = groups.get(c)!;
      const bary = g.map((o) => {
        const ns = preds[o.id].concat(succs[o.id]).map((id) => orderY[id]).filter((v) => v != null);
        return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : orderY[o.id];
      });
      const idx = g.map((_, i) => i).sort((i, j) => bary[i] - bary[j]);
      const reordered = idx.map((i) => g[i]);
      reordered.forEach((o, i) => { orderY[o.id] = i; });
      groups.set(c, reordered);
    });
  }

  const pos: Record<string, [number, number]> = {};
  colKeys.forEach((c) => {
    const g = groups.get(c)!;
    const ci = colIndex.get(c)!;
    const x = PAD + ci * COL_PITCH + CARD_W / 2;
    const total = g.length * ROW_PITCH;
    const y0 = -total / 2 + ROW_PITCH / 2;
    g.forEach((o, i) => { pos[o.id] = [x, y0 + i * ROW_PITCH]; });
  });

  const resolveColumn = (c: number): void => {
    const g = groups.get(c)!;
    if (!g.length) return;
    const arr = g.slice().sort((p, q) => (pos[p.id][1] - pos[q.id][1]) || (orderY[p.id] - orderY[q.id]));
    for (let i = 1; i < arr.length; i++) {
      if (pos[arr[i].id][1] - pos[arr[i - 1].id][1] < ROW_PITCH) {
        pos[arr[i].id][1] = pos[arr[i - 1].id][1] + ROW_PITCH;
      }
    }
    const mid = (pos[arr[0].id][1] + pos[arr[arr.length - 1].id][1]) / 2;
    arr.forEach((o) => { pos[o.id][1] -= mid; });
  };
  colKeys.forEach(resolveColumn);

  for (let pass = 0; pass < 3; pass++) {
    const desired: Record<string, number> = {};
    ops.forEach((o) => {
      const ns = preds[o.id].concat(succs[o.id]).filter((id) => pos[id]);
      if (!ns.length) { desired[o.id] = pos[o.id][1]; return; }
      let sum = 0;
      ns.forEach((id) => { sum += pos[id][1]; });
      desired[o.id] = sum / ns.length;
    });
    ops.forEach((o) => { pos[o.id][1] += (desired[o.id] - pos[o.id][1]) * 0.55; });
    colKeys.forEach(resolveColumn);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  Object.keys(pos).forEach((id) => {
    const [x, y] = pos[id];
    if (x - CARD_W / 2 < minX) minX = x - CARD_W / 2;
    if (x + CARD_W / 2 > maxX) maxX = x + CARD_W / 2;
    if (y - CARD_H / 2 < minY) minY = y - CARD_H / 2;
    if (y + CARD_H / 2 > maxY) maxY = y + CARD_H / 2;
  });
  if (!ops.length) { minX = 0; maxX = 100; minY = 0; maxY = 100; }

  return { pos, minX, maxX, minY, maxY, pxPerDay: COL_PITCH / (mode === 'byDate' ? bucketDays : 1), bucketDays, minEs };
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(init.headers as any) },
  });
  if (!res.ok) throw new Error(path + ' → ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

function report(tag: string, layout: Layout, ops: GOp[], deps: [string, string][], critOnly: boolean) {
  const m = computeLayoutMetrics(layout, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, critOnly);
  const bboxW = Math.round(layout.maxX - layout.minX);
  const bboxH = Math.round(layout.maxY - layout.minY);
  console.log(
    '  ' + tag.padEnd(22) +
    ' пересечений=' + m.crossings +
    '  наложений_на_узлы=' + m.edgeNodeHits +
    '  наложений_узлов=' + m.nodeOverlaps +
    '  плотность=' + m.density + '%' +
    '   [узлов=' + m.nodes + ', связей=' + m.edges + ', полотно ' + bboxW + 'x' + bboxH + ']',
  );
  return m;
}

async function main() {
  const login = await fetch(API + '/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }),
  }).then((r) => r.json());
  let token = login.access_token;
  if (login.tenants && login.tenants.length && login.requires_tenant_selection) {
    token = (await api('/v1/auth/select-tenant', token, { method: 'POST', body: JSON.stringify({ tenant_id: login.tenants[0].id }) })).access_token;
  }

  const projects = await api('/v1/projects', token);
  const list: any[] = projects.items || projects;
  console.log('Проектов: ' + list.length);
  const proj = list.find((p) => /Полигон A|Мосты/i.test(p.name)) || list[0];
  console.log('Проект: ' + proj.name + ' (' + proj.id + ')');

  const cpm = await api('/v1/projects/' + proj.id + '/calculate/cpm', token, { method: 'POST', body: JSON.stringify({}) });
  console.log('CPM: node_count=' + cpm.node_count + ', nodes=' + (cpm.nodes ? cpm.nodes.length : '?') + ', deps_in_resp=' + (cpm.dependencies ? cpm.dependencies.length : 'нет'));

  const ops = mapOps(cpm);
  let deps: [string, string][] = [];
  if (Array.isArray(cpm.dependencies) && cpm.dependencies.length) {
    deps = cpm.dependencies.map((d: any) => [String(d.from ?? d.predecessor_id), String(d.to ?? d.successor_id)] as [string, string]);
  } else {
    const dm = await api('/v1/projects/' + proj.id + '/operations/dependencies-map', token);
    deps = ((dm && dm.items) || []).map((x: any) => [String(x.from), String(x.to)] as [string, string]);
  }
  const ids = new Set(ops.map((o) => o.id));
  deps = deps.filter(([a, b]) => a !== 'undefined' && b !== 'undefined' && ids.has(a) && ids.has(b));
  console.log('Операций: ' + ops.length + ', связей: ' + deps.length);
  console.log('');

  const layDate = computeLayout(ops, deps, 'byDate');
  const layLayer = computeLayout(ops, deps, 'byLayer');

  console.log('Метрики раскладки:');
  report('по датам', layDate, ops, deps, false);
  report('по слоям', layLayer, ops, deps, false);
  report('по датам / крит.', layDate, ops, deps, true);
}

main().catch((e) => { console.error('ОШИБКА: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
