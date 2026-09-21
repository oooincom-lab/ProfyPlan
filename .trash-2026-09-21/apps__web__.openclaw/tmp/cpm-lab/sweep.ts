/* Временный широкий перебор параметров раскладки (hw=1). Не часть проекта. */
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

const results: { mode: Mode; tag: string; m: LayoutMetrics; t: number }[] = [];
for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  for (const bary of [2, 4, 8]) {
    for (const loc of [3, 6, 10, 16]) {
      for (const win of [10, 16, 20, 26]) {
        for (const step of [0.5, 0.7, 0.85]) {
          const opts: LayoutOptions = { baryPasses: bary, localPasses: loc, pullStep: step, moveWindow: win, maxEvals: 9000, hitWeight: 1, overlapWeight: 50 };
          const { m, t } = measure(mode, opts);
          results.push({ mode, tag: `b${bary} L${loc} w${win} s${step}`, m, t });
        }
      }
    }
  }
}
for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  const rs = results.filter((r) => r.mode === mode);
  const ok = rs.filter((r) => r.m.edgeNodeHits === 0 && r.m.nodeOverlaps === 0).sort((a, b) => a.m.crossings - b.m.crossings);
  console.log('=== ' + mode + ' === всего ' + rs.length + ', с 0 проходов/0 наложений: ' + ok.length);
  console.log('  ТОП-8 по пересечениям (0 hits):');
  ok.slice(0, 8).forEach((r) => console.log('    ' + r.tag.padEnd(18) + ' перес=' + String(r.m.crossings).padStart(4) + ' пло=' + r.m.density + '% t=' + r.t + 'мс'));
  const byCross = rs.slice().sort((a, b) => a.m.crossings - b.m.crossings).slice(0, 5);
  console.log('  ТОП-5 по пересечениям (независимо от hits):');
  byCross.forEach((r) => console.log('    ' + r.tag.padEnd(18) + ' перес=' + String(r.m.crossings).padStart(4) + ' сквозь=' + r.m.edgeNodeHits + ' налож=' + r.m.nodeOverlaps + ' t=' + r.t + 'мс'));
}
