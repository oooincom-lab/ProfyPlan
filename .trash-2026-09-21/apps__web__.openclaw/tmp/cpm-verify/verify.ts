/* Временный замер метрик раскладки CPM на снимке живого проекта. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { computeLayoutMetrics, type LayoutMetrics, CARD_W, CARD_H } from '../../../lib/cpm-metrics';
import { computeLayout, COL_PITCH, type GOp, type Mode } from '../../../lib/cpm-layout';
import { detectEndpoints } from '../../../lib/cpm-structure';

const DIR = __dirname;
const DATA = process.env.CPM_DATA || path.join(DIR, 'data.json');
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

function num(v: any, f = 0): number { const x = Number(v); return Number.isFinite(x) ? x : f; }

function mapOps(c: any): GOp[] {
  const raw: any[] = (c && c.nodes) || [];
  const main = new Set(((c && c.critical_path) || []).map(String));
  const branchSet = new Set<string>();
  ((c && c.critical_paths) || []).forEach((b: any) => (b && b.operations ? b.operations : []).forEach((id: any) => branchSet.add(String(id))));
  return raw.map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, num(n.duration_base, 0)) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const ls = n.late_start_day != null ? num(n.late_start_day) : num(n.late_start, es);
    const lf = n.late_finish_day != null ? num(n.late_finish_day) : num(n.late_finish, ef);
    const tf = n.total_float_days != null ? num(n.total_float_days) : num(n.total_float, 0) / hpd;
    const id = String(n.id); const fn = String(n.name || id); const sep = fn.indexOf('·');
    return {
      id, num: n.number != null ? n.number : i + 1,
      name: fn, code: sep > 0 ? fn.slice(0, sep).trim() : fn, detail: sep > 0 ? fn.slice(sep + 1).trim() : '',
      durDays, es, ef, ls, lf, tf,
      crit: !!(n.is_critical != null ? n.is_critical : n.critical),
      branch: branchSet.has(id) && !main.has(id), hpd,
    };
  });
}

const ops = mapOps(data.cpm);
const ids = new Set(ops.map((o) => o.id));
const deps: [string, string][] = (data.deps || [])
  .map((d: any) => [String(d[0]), String(d[1])] as [string, string])
  .filter(([a, b]) => ids.has(a) && ids.has(b));

// те же опции, что даёт settingsToLayoutOptions(DEFAULT_SETTINGS)
const opts = { localPasses: 8, crossWeight: 1, hitWeight: 1, overlapWeight: 50 };

console.log('Проект: ' + data.projectName);
console.log('Операций: ' + ops.length + ', связей: ' + deps.length);

const nodeMeta = ops.map((o) => ({ id: o.id, crit: o.crit }));
for (const mode of ['byDate', 'byLayer'] as Mode[]) {
  const layout = computeLayout(ops, deps, mode, opts);
  const m: LayoutMetrics = computeLayoutMetrics(layout, nodeMeta, deps, false);
  console.log(
    mode.padEnd(8) +
    ' пересечений=' + m.crossings +
    '  сквозь_узлы=' + m.edgeNodeHits +
    '  наложений_узлов=' + m.nodeOverlaps +
    '  плотность=' + m.density + '%' +
    '  [полотно ' + Math.round(layout.maxX - layout.minX) + 'x' + Math.round(layout.maxY - layout.minY) + ']',
  );

  // ── проверка геометрии виртуальных событий «Старт»/«Финиш» ──
  const ep = detectEndpoints(ops.map((o) => ({ id: o.id, name: o.name, code: o.code })), deps);
  let minCx = Infinity, maxCx = -Infinity;
  ops.forEach((o) => { const p = layout.pos[o.id]; if (p[0] < minCx) minCx = p[0]; if (p[0] > maxCx) maxCx = p[0]; });
  const meanY = (idds: string[]) => { let s = 0, n = 0; for (const id of idds) { const p = layout.pos[id]; if (p) { s += p[1]; n++; } } return n ? s / n : 0; };
  const nodes: { id: string; x: number; y: number }[] = [];
  if (!ep.hasExplicitStart) nodes.push({ id: 'start', x: minCx - COL_PITCH, y: meanY(ep.initialIds) });
  if (!ep.hasExplicitFinish) nodes.push({ id: 'finish', x: maxCx + COL_PITCH, y: meanY(ep.finalIds) });
  // наложения виртуальных узлов с реальными (прямоугольники CARD_W x CARD_H)
  let overlaps = 0;
  for (const v of nodes) for (const o of ops) {
    const p = layout.pos[o.id];
    if (Math.abs(v.x - p[0]) < CARD_W && Math.abs(v.y - p[1]) < CARD_H) overlaps++;
  }
  console.log(
    '  начальных=' + ep.initialIds.length + ' завершающих=' + ep.finalIds.length +
    ' явный_старт=' + ep.hasExplicitStart + ' явный_финиш=' + ep.hasExplicitFinish +
    ' виртуальных=' + nodes.map((n) => n.id).join(',') +
    ' наложений_виртуальных_с_реальными=' + overlaps,
  );
}
