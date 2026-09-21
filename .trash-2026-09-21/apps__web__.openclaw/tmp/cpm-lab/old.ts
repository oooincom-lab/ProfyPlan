/* Временная копия прежней раскладки (до выноса в модуль) — для сравнения «до/после». */
import fs from 'node:fs';
import path from 'node:path';
import { CARD_W, CARD_H, computeLayoutMetrics, type LayoutMetrics } from '../../../lib/cpm-metrics';
import type { GOp, Mode, Layout } from '../../../lib/cpm-layout';

const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(process.env.CPM_DATA || path.join(DIR, 'data.json'), 'utf8'));
function num(v: any, f = 0): number { const x = Number(v); return Number.isFinite(x) ? x : f; }
function mapOps(c: any): GOp[] {
  const raw: any[] = (c && c.nodes) || [];
  const main = new Set(((c && c.critical_path) || []).map(String));
  const branchSet = new Set<string>();
  ((c && c.critical_paths) || []).forEach((b: any) => (b && b.operations ? b.operations : []).forEach((id: any) => branchSet.add(String(id))));
  return raw.map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, 0) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const id = String(n.id); const fn = String(n.name || id); const sep = fn.indexOf('·');
    return { id, num: n.number != null ? n.number : i + 1, name: fn, code: sep > 0 ? fn.slice(0, sep).trim() : fn, detail: '', durDays, es, ef, ls: es, lf: ef, tf: 0, crit: !!(n.is_critical != null ? n.is_critical : n.critical), branch: branchSet.has(id) && !main.has(id), hpd };
  });
}
const ops = mapOps(data.cpm);
const ids = new Set(ops.map((o) => o.id));
const deps: [string, string][] = (data.deps || []).map((d: any) => [String(d[0]), String(d[1])] as [string, string]).filter(([a, b]) => ids.has(a) && ids.has(b));

const MIN_GAP = 12, COL_GAP = 34, ROW_GAP = 22;
const COL_PITCH = CARD_W + COL_GAP;
const ROW_PITCH = CARD_H + ROW_GAP;
const PAD = 70;

function oldLayout(ops: GOp[], deps: [string, string][], mode: Mode): Layout {
  const ids = new Set(ops.map((o) => o.id));
  const preds: Record<string, string[]> = {}; const succs: Record<string, string[]> = {};
  ops.forEach((o) => { preds[o.id] = []; succs[o.id] = []; });
  deps.forEach(([a, b]) => { if (ids.has(a) && ids.has(b)) { succs[a].push(b); preds[b].push(a); } });
  const minEs = Math.min(0, ...ops.map((o) => o.es));
  const maxEf = Math.max(1, ...ops.map((o) => o.ef));
  const span = Math.max(maxEf - minEs, 1);
  let bucketDays = 1; let colOf: (o: GOp) => number;
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
  colKeys.forEach((c) => { const g = groups.get(c)!; g.sort((a, b) => (a.es - b.es) || (b.durDays - a.durDays) || a.name.localeCompare(b.name)); g.forEach((o, i) => { orderY[o.id] = i; }); });
  for (let pass = 0; pass < 4; pass++) {
    colKeys.forEach((c) => {
      const g = groups.get(c)!;
      const bary = g.map((o) => { const ns = preds[o.id].concat(succs[o.id]).map((id) => orderY[id]).filter((v) => v != null); return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : orderY[o.id]; });
      const idx = g.map((_, i) => i).sort((i, j) => bary[i] - bary[j]);
      const reordered = idx.map((i) => g[i]);
      reordered.forEach((o, i) => { orderY[o.id] = i; });
      groups.set(c, reordered);
    });
  }
  const pos: Record<string, [number, number]> = {};
  colKeys.forEach((c) => { const g = groups.get(c)!; const ci = colIndex.get(c)!; const x = PAD + ci * COL_PITCH + CARD_W / 2; const total = g.length * ROW_PITCH; const y0 = -total / 2 + ROW_PITCH / 2; g.forEach((o, i) => { pos[o.id] = [x, y0 + i * ROW_PITCH]; }); });
  const resolveColumn = (c: number): void => {
    const g = groups.get(c)!; if (!g.length) return;
    const arr = g.slice().sort((p, q) => (pos[p.id][1] - pos[q.id][1]) || (orderY[p.id] - orderY[q.id]));
    for (let i = 1; i < arr.length; i++) { if (pos[arr[i].id][1] - pos[arr[i - 1].id][1] < ROW_PITCH) pos[arr[i].id][1] = pos[arr[i - 1].id][1] + ROW_PITCH; }
    const mid = (pos[arr[0].id][1] + pos[arr[arr.length - 1].id][1]) / 2;
    arr.forEach((o) => { pos[o.id][1] -= mid; });
  };
  colKeys.forEach(resolveColumn);
  for (let pass = 0; pass < 3; pass++) {
    const desired: Record<string, number> = {};
    ops.forEach((o) => { const ns = preds[o.id].concat(succs[o.id]).filter((id) => pos[id]); if (!ns.length) { desired[o.id] = pos[o.id][1]; return; } let sum = 0; ns.forEach((id) => { sum += pos[id][1]; }); desired[o.id] = sum / ns.length; });
    ops.forEach((o) => { pos[o.id][1] += (desired[o.id] - pos[o.id][1]) * 0.55; });
    colKeys.forEach(resolveColumn);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  Object.keys(pos).forEach((id) => { const [x, y] = pos[id]; if (x - CARD_W / 2 < minX) minX = x - CARD_W / 2; if (x + CARD_W / 2 > maxX) maxX = x + CARD_W / 2; if (y - CARD_H / 2 < minY) minY = y - CARD_H / 2; if (y + CARD_H / 2 > maxY) maxY = y + CARD_H / 2; });
  if (!ops.length) { minX = 0; maxX = 100; minY = 0; maxY = 100; }
  return { pos, minX, maxX, minY, maxY, pxPerDay: COL_PITCH / (mode === 'byDate' ? bucketDays : 1), bucketDays, minEs };
}

const nodeMeta = ops.map((o) => ({ id: o.id, crit: o.crit }));
for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  const layout = oldLayout(ops, deps, mode);
  const m: LayoutMetrics = computeLayoutMetrics(layout, nodeMeta, deps, false);
  console.log('СТАРО (до правок) ' + mode + ': перес=' + m.crossings + ' сквозь=' + m.edgeNodeHits + ' налож=' + m.nodeOverlaps + ' плотн=' + m.density + '%');
}
