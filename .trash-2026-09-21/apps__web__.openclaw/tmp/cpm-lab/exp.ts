/* Временный стенд подбора параметров раскладки CPM. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { computeLayoutMetrics, type LayoutMetrics } from '../../../lib/cpm-metrics';
import { computeLayout, type GOp, type Mode, type LayoutOptions } from '../../../lib/cpm-layout';

const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(process.env.CPM_DATA || path.join(DIR, 'data.json'), 'utf8'));
function num(v: any, f = 0): number { const x = Number(v); return Number.isFinite(x) ? x : f; }
function mapOps(cpmResult: any): GOp[] {
  const raw: any[] = (cpmResult && cpmResult.nodes) || [];
  const main = new Set(((cpmResult && cpmResult.critical_path) || []).map(String));
  const branchSet = new Set<string>();
  ((cpmResult && cpmResult.critical_paths) || []).forEach((b: any) => (b && b.operations ? b.operations : []).forEach((id: any) => branchSet.add(String(id))));
  return raw.map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, 0) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const id = String(n.id);
    const fn = String(n.name || id);
    const sep = fn.indexOf('·');
    return {
      id, num: n.number != null ? n.number : i + 1, name: fn,
      code: sep > 0 ? fn.slice(0, sep).trim() : fn, detail: sep > 0 ? fn.slice(sep + 1).trim() : '',
      durDays, es, ef, ls: es, lf: ef, tf: 0,
      crit: !!(n.is_critical != null ? n.is_critical : n.critical),
      branch: branchSet.has(id) && !main.has(id), hpd,
    };
  });
}
const ops = mapOps(data.cpm);
const ids = new Set(ops.map((o) => o.id));
const deps: [string, string][] = (data.deps || []).map((d: any) => [String(d[0]), String(d[1])] as [string, string]).filter(([a, b]) => ids.has(a) && ids.has(b));

function measure(mode: Mode, opts: LayoutOptions): { m: LayoutMetrics; t: number } {
  const t0 = Date.now();
  const layout = computeLayout(ops, deps, mode, opts);
  const t1 = Date.now();
  const m = computeLayoutMetrics(layout, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, false);
  return { m, t: t1 - t0 };
}

const configs: [string, LayoutOptions][] = [
  ['w14 L10 e6000', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 6000 }],
  ['w16 L8 e6000', { baryPasses: 4, localPasses: 8, pullStep: 0.6, moveWindow: 16, maxEvals: 6000 }],
  ['w16 L12 e8000', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 16, maxEvals: 8000 }],
  ['w16 L16 e10000', { baryPasses: 4, localPasses: 16, pullStep: 0.6, moveWindow: 16, maxEvals: 10000 }],
  ['w18 L10 e6000', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 18, maxEvals: 6000 }],
  ['w18 L12 s0.6 e8000', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 18, maxEvals: 8000 }],
  ['w20 L8 e8000', { baryPasses: 4, localPasses: 8, pullStep: 0.6, moveWindow: 20, maxEvals: 8000 }],
  ['w20 L12 e9000', { baryPasses: 4, localPasses: 12, pullStep: 0.6, moveWindow: 20, maxEvals: 9000 }],
  ['w22 L10 e7000', { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 22, maxEvals: 7000 }],
  ['w24 L8 e8000', { baryPasses: 4, localPasses: 8, pullStep: 0.6, moveWindow: 24, maxEvals: 8000 }],
  ['w16 L8 s0.55', { baryPasses: 4, localPasses: 8, pullStep: 0.55, moveWindow: 16, maxEvals: 6000 }],
  ['w16 L8 s0.65', { baryPasses: 4, localPasses: 8, pullStep: 0.65, moveWindow: 16, maxEvals: 6000 }],
  ['b12 w16 L8', { baryPasses: 12, localPasses: 8, pullStep: 0.6, moveWindow: 16, maxEvals: 6000 }],
  ['b20 w16 L10', { baryPasses: 20, localPasses: 10, pullStep: 0.6, moveWindow: 16, maxEvals: 7000 }],
];

for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  console.log('=== ' + mode + ' ===');
  for (const [tag, opts] of configs) {
    const { m, t } = measure(mode, opts);
    console.log('  ' + tag.padEnd(14) + ' пересеч=' + String(m.crossings).padStart(4) + '  сквозь=' + String(m.edgeNodeHits).padStart(3) + '  налож=' + m.nodeOverlaps + '  плотн=' + String(m.density).padStart(4) + '%  t=' + String(t).padStart(4) + 'мс');
  }
  console.log('');
}
