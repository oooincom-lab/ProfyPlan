/* Временная итоговая проверка на данных из API. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { computeLayoutMetrics, type LayoutMetrics } from '../../../lib/cpm-metrics';
import { computeLayout, type GOp, type Mode } from '../../../lib/cpm-layout';
import { checkCpmStructure } from '../../../lib/cpm-structure';

const DIR = __dirname;
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
    const ls = n.late_start_day != null ? num(n.late_start_day) : es;
    const lf = n.late_finish_day != null ? num(n.late_finish_day) : ef;
    const tf = n.total_float_days != null ? num(n.total_float_days) : 0;
    const id = String(n.id); const fn = String(n.name || id); const sep = fn.indexOf('·');
    return { id, num: n.number != null ? n.number : i + 1, name: fn, code: sep > 0 ? fn.slice(0, sep).trim() : fn, detail: sep > 0 ? fn.slice(sep + 1).trim() : '', durDays, es, ef, ls, lf, tf, crit: !!(n.is_critical != null ? n.is_critical : n.critical), branch: branchSet.has(id) && !main.has(id), hpd };
  });
}

const BASE = process.env.CPM_DIR || DIR;
const cpmPath = process.env.CPM_FILE || path.join(BASE, 'api-cpm.json');
const depsPath = process.env.DEPS_FILE || path.join(BASE, 'api-deps.json');
const cpm = JSON.parse(fs.readFileSync(cpmPath, 'utf8'));
const depsRaw = JSON.parse(fs.readFileSync(depsPath, 'utf8'));
const ops = mapOps(cpm);
const ids = new Set(ops.map((o) => o.id));
const deps: [string, string][] = (((depsRaw.items || depsRaw) as any[]).map((d) => [String(d.from != null ? d.from : d[0]), String(d.to != null ? d.to : d[1])]) as [string, string][]).filter(([a, b]) => ids.has(a) && ids.has(b));
const nodeMeta = ops.map((o) => ({ id: o.id, crit: o.crit }));

console.log('Проект: ' + (cpm.project_id) + (cpm.order_id ? ' (заказ ' + cpm.order_id + ')' : ''));
console.log('Операций: ' + ops.length + ', связей: ' + deps.length);
for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  const t0 = Date.now();
  const layout = computeLayout(ops, deps, mode);
  const t1 = Date.now();
  const m: LayoutMetrics = computeLayoutMetrics(layout, nodeMeta, deps, false);
  console.log('  ' + mode + ': пересечений=' + m.crossings + ' сквозь_узлы=' + m.edgeNodeHits + ' наложений_узлов=' + m.nodeOverlaps + ' плотность=' + m.density + '%  [t_layout=' + (t1 - t0) + 'мс]');
}
const issues = checkCpmStructure(ops.map((o) => ({ id: o.id, num: o.num, name: o.name })), deps);
console.log('  предупреждений структуры: ' + issues.length);
issues.forEach((w) => console.log('    [' + w.kind + '] ' + w.title + ' — ' + w.detail));
