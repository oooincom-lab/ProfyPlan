/* Временная проверка кандидатов в значения по умолчанию. Не часть проекта. */
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

function measure(mode: Mode, opts: LayoutOptions | undefined): { m: LayoutMetrics; t: number } {
  const t0 = Date.now();
  const layout = opts ? computeLayout(ops, deps, mode, opts) : computeLayout(ops, deps, mode);
  const t1 = Date.now();
  const m = computeLayoutMetrics(layout, nodeMeta, deps, false);
  return { m, t: t1 - t0 };
}

const cands: [string, LayoutOptions | undefined][] = [
  ['defaults(no opts)', undefined],
  ['b4 L10 w16 s0.5', { baryPasses: 4, localPasses: 10, pullStep: 0.5, moveWindow: 16, maxEvals: 9000 }],
  ['b2 L10 w20 s0.5', { baryPasses: 2, localPasses: 10, pullStep: 0.5, moveWindow: 20, maxEvals: 9000 }],
  ['b2 L8 w20 s0.5 e6000', { baryPasses: 2, localPasses: 8, pullStep: 0.5, moveWindow: 20, maxEvals: 6000 }],
  ['b2 L8 w16 s0.5 e5000', { baryPasses: 2, localPasses: 8, pullStep: 0.5, moveWindow: 16, maxEvals: 5000 }],
  ['b2 L6 w16 s0.5 e4000', { baryPasses: 2, localPasses: 6, pullStep: 0.5, moveWindow: 16, maxEvals: 4000 }],
  ['b4 L8 w16 s0.5 e6000', { baryPasses: 4, localPasses: 8, pullStep: 0.5, moveWindow: 16, maxEvals: 6000 }],
];
for (const [tag, opts] of cands) {
  const d = measure('byDate', opts);
  const l = measure('byLayer', opts);
  console.log(tag.padEnd(24) + ' byDate: ' + String(d.m.crossings).padStart(3) + '/' + d.m.edgeNodeHits + '/' + d.m.nodeOverlaps + ' ' + d.m.density + '% t=' + String(d.t).padStart(3) +
    '   byLayer: ' + String(l.m.crossings).padStart(3) + '/' + l.m.edgeNodeHits + '/' + l.m.nodeOverlaps + ' ' + l.m.density + '% t=' + String(l.t).padStart(3));
}
