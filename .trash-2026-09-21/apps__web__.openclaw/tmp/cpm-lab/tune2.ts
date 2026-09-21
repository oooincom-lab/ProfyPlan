/* Временный изолят-подбор параметров. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { computeLayoutMetrics, type LayoutMetrics } from '../../../lib/cpm-metrics';
import { computeLayout, type GOp, type Mode, type LayoutOptions } from '../../../lib/cpm-layout';

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
const nodeMeta = ops.map((o) => ({ id: o.id, crit: o.crit }));

function measure(mode: Mode, opts: LayoutOptions): { m: LayoutMetrics; t: number } {
  const t0 = Date.now();
  const layout = computeLayout(ops, deps, mode, opts);
  const t1 = Date.now();
  const m = computeLayoutMetrics(layout, nodeMeta, deps, false);
  return { m, t: t1 - t0 };
}

const rows: [string, LayoutOptions][] = [];
for (const bm of ['mean', 'median'] as const) {
  for (const hw of [1, 3, 8, 20]) {
    rows.push([`b=${bm} hw=${hw}`, { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 8000, hitWeight: hw, overlapWeight: 100, baryMode: bm, pullMode: 'mean' }]);
  }
}
for (const [tag, opts] of rows) {
  const o1 = measure('byDate', opts);
  const o2 = measure('byLayer', opts);
  console.log(tag.padEnd(14) + '  byDate: п=' + String(o1.m.crossings).padStart(3) + ' c=' + o1.m.edgeNodeHits + ' н=' + o1.m.nodeOverlaps + ' t=' + String(o1.t).padStart(3) +
    '   byLayer: п=' + String(o2.m.crossings).padStart(3) + ' c=' + o2.m.edgeNodeHits + ' н=' + o2.m.nodeOverlaps + ' t=' + o2.t);
}
