/* Временный совместный перебор (byDate+byLayer). Не часть проекта. */
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

const rows: { tag: string; d: LayoutMetrics; l: LayoutMetrics; td: number; tl: number }[] = [];
for (const bary of [2, 3, 4]) {
  for (const loc of [8, 10, 12, 14]) {
    for (const win of [18, 20, 24, 30]) {
      for (const ev of [6000, 9000]) {
        const opts: LayoutOptions = { baryPasses: bary, localPasses: loc, pullStep: 0.5, moveWindow: win, maxEvals: ev, hitWeight: 1, overlapWeight: 50 };
        const d = measure('byDate', opts);
        const l = measure('byLayer', opts);
        rows.push({ tag: `b${bary} L${loc} w${win} e${ev}`, d: d.m, l: l.m, td: d.t, tl: l.t });
      }
    }
  }
}
const score = (r: any) => Math.max(r.d.crossings, r.l.crossings) * 1000 + r.d.crossings + r.l.crossings;
const ok = rows.filter((r) => r.d.edgeNodeHits === 0 && r.l.edgeNodeHits === 0 && r.d.nodeOverlaps === 0 && r.l.nodeOverlaps === 0).sort((a, b) => score(a) - score(b));
console.log('Всего ' + rows.length + ', пригодных (0/0 в обоих режимах): ' + ok.length);
console.log('ТОП-12 по max(crossings):');
ok.slice(0, 12).forEach((r) => console.log('  ' + r.tag.padEnd(18) + ' byDate=' + String(r.d.crossings).padStart(3) + ' (t=' + String(r.td).padStart(3) + ')  byLayer=' + String(r.l.crossings).padStart(3) + ' (t=' + String(r.tl).padStart(3) + ')  пло ' + r.d.density + '/' + r.l.density + '%'));
