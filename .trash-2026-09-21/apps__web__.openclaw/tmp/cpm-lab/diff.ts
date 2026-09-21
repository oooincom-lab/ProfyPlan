/* Временная изоляция расхождения byLayer. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { computeLayoutMetrics } from '../../../lib/cpm-metrics';
import { computeLayout, type GOp } from '../../../lib/cpm-layout';

const DIR = __dirname;
const api = JSON.parse(fs.readFileSync(path.join(process.env.CPM_DIR || DIR, 'api-cpm.json'), 'utf8'));
const snap = JSON.parse(fs.readFileSync(path.join(process.env.CPM_DIR || DIR, 'data.json'), 'utf8')).cpm;
const depsRaw = JSON.parse(fs.readFileSync(path.join(process.env.CPM_DIR || DIR, 'api-deps.json'), 'utf8'));
function num(v: any, f = 0): number { const x = Number(v); return Number.isFinite(x) ? x : f; }
function map(c: any, full: boolean): GOp[] {
  const main = new Set(((c && c.critical_path) || []).map(String));
  const branchSet = new Set<string>();
  ((c && c.critical_paths) || []).forEach((b: any) => (b && b.operations ? b.operations : []).forEach((id: any) => branchSet.add(String(id))));
  return (c.nodes || []).map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, 0) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const id = String(n.id); const fn = String(n.name || id); const sep = fn.indexOf('·');
    return {
      id, num: n.number != null ? n.number : i + 1, name: fn, code: sep > 0 ? fn.slice(0, sep).trim() : fn,
      detail: full ? (sep > 0 ? fn.slice(sep + 1).trim() : '') : '',
      durDays, es, ef,
      ls: full ? (n.late_start_day != null ? num(n.late_start_day) : es) : es,
      lf: full ? (n.late_finish_day != null ? num(n.late_finish_day) : ef) : ef,
      tf: full ? (n.total_float_days != null ? num(n.total_float_days) : 0) : 0,
      crit: !!(n.is_critical != null ? n.is_critical : n.critical),
      branch: branchSet.has(id) && !main.has(id), hpd,
    };
  });
}
const ids = new Set(map(api, true).map((o) => o.id));
const deps: [string, string][] = (depsRaw.items as any[]).map((d) => [String(d.from), String(d.to)] as [string, string]).filter(([a, b]) => ids.has(a) && ids.has(b));
for (const [tag, c] of [['api', api], ['snap', snap]] as [string, any][]) {
  for (const full of [true, false]) {
    const ops = map(c, full);
    const layout = computeLayout(ops, deps, 'byLayer');
    const m = computeLayoutMetrics(layout, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, false);
    console.log(tag + ' full=' + full + ' → byLayer перес=' + m.crossings);
    console.log('   first3 es/ef/dur:', ops.slice(0, 3).map((o) => o.es + '/' + o.ef + '/' + o.durDays).join('  '));
  }
}
