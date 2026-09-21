/* Временный стенд замера раскладки CPM. Не часть проекта — удаляется после прогона. */
import fs from 'node:fs';
import path from 'node:path';
import { CARD_W, CARD_H, computeLayoutMetrics, type LayoutMetrics, borderPoint, segRectHit, OBSTACLE_PAD } from '../../../lib/cpm-metrics';
import { computeLayout, COL_PITCH, ROW_PITCH, type GOp, type Mode, type LayoutOptions } from '../../../lib/cpm-layout';

const DIR = __dirname;
const DATA = process.env.CPM_DATA || path.join(DIR, 'data.json');
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

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
    return { id, num: n.number != null ? n.number : (n.num != null ? n.num : i + 1), name: fullName, code, detail, durDays, es, ef, ls, lf, tf, crit, branch: branchSet.has(id) && !mainSet.has(id), hpd };
  });
}

const cpm = data.cpm;
const ops = mapOps(cpm);
let deps: [string, string][] = (data.deps || []).map((d: any) => [String(d[0]), String(d[1])]);
const ids = new Set(ops.map((o) => o.id));
deps = deps.filter(([a, b]) => ids.has(a) && ids.has(b));
console.log('Проект: ' + data.projectName);
console.log('Операций: ' + ops.length + ', связей: ' + deps.length + '\n');

function metrics(mode: Mode, opts: LayoutOptions, critOnly: boolean) {
  const t0 = Date.now();
  const layout = computeLayout(ops, deps, mode, opts);
  const t1 = Date.now();
  const m: LayoutMetrics = computeLayoutMetrics(layout, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, critOnly);
  const t2 = Date.now();
  return { layout, m, tLayout: t1 - t0, tMetrics: t2 - t1 };
}

function report(tag: string, mode: Mode, opts: LayoutOptions) {
  const { layout, m, tLayout, tMetrics } = metrics(mode, opts, false);
  console.log(
    '  ' + tag.padEnd(26) +
    ' пересечений=' + String(m.crossings).padStart(4) +
    '  сквозь_узлы=' + String(m.edgeNodeHits).padStart(3) +
    '  наложений_узлов=' + String(m.nodeOverlaps) +
    '  плотность=' + String(m.density).padStart(4) + '%' +
    '   [полотно ' + Math.round(layout.maxX - layout.minX) + 'x' + Math.round(layout.maxY - layout.minY) + ']' +
    '   t_layout=' + String(tLayout).padStart(4) + 'мс t_metrics=' + tMetrics + 'мс',
  );
  return { m, layout };
}

/* ── диагностика структуры ── */
function diag(mode: Mode) {
  const { layout } = metrics(mode, { localPasses: 0, baryPasses: 0 }, false);
  const pos = layout.pos;
  const byCol = new Map<number, number>();
  const colOfId: Record<string, number> = {};
  ops.forEach((o) => {
    const c = Math.round((pos[o.id][0] - 70 - CARD_W / 2) / COL_PITCH);
    colOfId[o.id] = c;
    byCol.set(c, (byCol.get(c) || 0) + 1);
  });
  const sizes = Array.from(byCol.values());
  let long1 = 0, long2 = 0, long3 = 0;
  deps.forEach(([a, b]) => {
    const d = Math.abs(colOfId[a] - colOfId[b]);
    if (d >= 2) long1++;
    if (d >= 3) long2++;
    if (d >= 5) long3++;
  });
  console.log('  структура ' + mode + ': колонок=' + sizes.length + ', макс.узлов в колонке=' + Math.max(...sizes) +
    ', >1 колонки=' + sizes.filter((s) => s > 1).length +
    ' | связей >1 колонки=' + long1 + ', >2=' + long2 + ', >4=' + long3);
}

console.log('Диагностика раскладки:');
diag('byDate');
diag('byLayer');
console.log('');

console.log('Варианты алгоритма (byDate):');
report('bary4/local3 (тек.)', 'byDate', { baryPasses: 4, localPasses: 3, pullStep: 0.5 });
report('bary4/local6', 'byDate', { baryPasses: 4, localPasses: 6, pullStep: 0.5 });
report('bary8/local3', 'byDate', { baryPasses: 8, localPasses: 3, pullStep: 0.5 });
report('bary8/local8', 'byDate', { baryPasses: 8, localPasses: 8, pullStep: 0.5 });
report('bary8/local12', 'byDate', { baryPasses: 8, localPasses: 12, pullStep: 0.5 });
report('bary8/local8/step.7', 'byDate', { baryPasses: 8, localPasses: 8, pullStep: 0.7 });
report('bary8/local8/step.3', 'byDate', { baryPasses: 8, localPasses: 8, pullStep: 0.3 });
report('local0 (только bary)', 'byDate', { baryPasses: 8, localPasses: 0 });
console.log('');

console.log('Варианты алгоритма (byLayer):');
report('bary4/local3 (тек.)', 'byLayer', { baryPasses: 4, localPasses: 3, pullStep: 0.5 });
report('bary8/local8', 'byLayer', { baryPasses: 8, localPasses: 8, pullStep: 0.5 });
report('bary8/local12', 'byLayer', { baryPasses: 8, localPasses: 12, pullStep: 0.5 });
