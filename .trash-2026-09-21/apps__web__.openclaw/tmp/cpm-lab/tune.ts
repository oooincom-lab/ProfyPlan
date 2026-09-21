/* Временный подбор параметров раскладки. Не часть проекта. */
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
    return { id, num: n.number != null ? n.number : i + 1, name: fn, code: sep > 0 ? fn.slice(0, sep).trim() : fn, detail: sep > 0 ? fn.slice(sep + 1).trim() : '', durDays, es, ef, ls: es, lf: ef, tf: 0, crit: !!(n.is_critical != null ? n.is_critical : n.critical), branch: branchSet.has(id) && !main.has(id), hpd };
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

const configs: [string, LayoutOptions][] = [
  ['base w14 L10 hw25', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 8000, hitWeight: 25 }],
  ['w14 L10 hw60', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 8000, hitWeight: 60 }],
  ['w14 L10 hw25 med', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 8000, hitWeight: 25, baryMode: 'median' }],
  ['w14 L10 hw25 medPull', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 8000, hitWeight: 25, baryMode: 'median', pullMode: 'median' }],
  ['w16 L12 hw60 med', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 16, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
  ['w18 L12 hw60 med', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 18, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
  ['w24 L12 hw60 med', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 24, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
  ['w30 L12 hw60 med', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 30, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
  ['w99 L12 hw60 med', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 99, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
  ['w99 L20 hw60 med', { baryPasses: 4, localPasses: 20, pullStep: 0.6, moveWindow: 99, maxEvals: 14000, hitWeight: 60, baryMode: 'median' }],
  ['w99 L12 hw60 s0.5', { baryPasses: 4, localPasses: 12, pullStep: 0.5, moveWindow: 99, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
  ['w99 L12 hw60 b12', { baryPasses: 12, localPasses: 12, pullStep: 0.6, moveWindow: 99, maxEvals: 9000, hitWeight: 60, baryMode: 'median' }],
];

for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  console.log('=== ' + mode + ' ===');
  const rows: { tag: string; m: LayoutMetrics; t: number }[] = [];
  for (const [tag, opts] of configs) {
    const { m, t } = measure(mode, opts);
    rows.push({ tag, m, t });
    console.log('  ' + tag.padEnd(22) + ' перес=' + String(m.crossings).padStart(4) + ' сквозь=' + String(m.edgeNodeHits).padStart(2) + ' налож=' + m.nodeOverlaps + ' пло=' + String(m.density).padStart(4) + '% t=' + String(t).padStart(4) + 'мс');
  }
  const ok = rows.filter((r) => r.m.edgeNodeHits === 0 && r.m.nodeOverlaps === 0).sort((a, b) => a.m.crossings - b.m.crossings);
  if (ok.length) console.log('  ЛУЧШИЙ (0 hits/0 overlaps): ' + ok[0].tag + ' → перес=' + ok[0].m.crossings + ' t=' + ok[0].t + 'мс');
  else console.log('  нет конфигурации с 0 сквозь/0 налож');
  console.log('');
}
