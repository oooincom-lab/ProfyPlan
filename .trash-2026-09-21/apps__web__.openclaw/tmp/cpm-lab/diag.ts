/* Временная диагностика обхода узлов связями. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_W, CARD_H, borderPoint, pathHits, edgeControl, DETOUR_OFFSETS, EDGE_PAD, OBSTACLE_PAD, PATH_SAMPLES, type Rect,
} from '../../../lib/cpm-metrics';
import { computeLayout, COL_PITCH, PAD, type GOp, type LayoutOptions } from '../../../lib/cpm-layout';

const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(process.env.CPM_DATA || path.join(DIR, 'data.json'), 'utf8'));
function num(v: any, f = 0): number { const x = Number(v); return Number.isFinite(x) ? x : f; }
function mapOps(c: any): GOp[] {
  return ((c && c.nodes) || []).map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, 0) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const id = String(n.id); const fn = String(n.name || id); const sep = fn.indexOf('·');
    return { id, num: n.number != null ? n.number : i + 1, name: fn, code: sep > 0 ? fn.slice(0, sep).trim() : fn, detail: '', durDays, es, ef, ls: es, lf: ef, tf: 0, crit: !!n.is_critical, branch: false, hpd };
  });
}
const ops = mapOps(data.cpm);
const ids = new Set(ops.map((o) => o.id));
const deps: [string, string][] = (data.deps || []).map((d: any) => [String(d[0]), String(d[1])] as [string, string]).filter(([a, b]) => ids.has(a) && ids.has(b));
const byId: Record<string, GOp> = {};
ops.forEach((o) => { byId[o.id] = o; });

const MODE = (process.env.LAB_MODE as any) || 'byDate';
const OPTS: LayoutOptions = { baryPasses: 4, localPasses: 10, pullStep: 0.6, moveWindow: 14, maxEvals: 8000, hitWeight: 1 };
const layout = computeLayout(ops, deps, MODE, OPTS);
const pos = layout.pos;
const colOf = (id: string) => Math.round((pos[id][0] - PAD - CARD_W / 2) / COL_PITCH);

const bare: (Rect & { id: string })[] = ops.map((o) => ({ id: o.id, x: pos[o.id][0], y: pos[o.id][1], hw: CARD_W / 2, hh: CARD_H / 2 }));
const padded = (a: string, b: string): Rect[] => bare.filter((r) => r.id !== a && r.id !== b).map((r) => ({ x: r.x, y: r.y, hw: r.hw + OBSTACLE_PAD, hh: r.hh + OBSTACLE_PAD }));
const actualOf = (a: string, b: string): Rect[] => bare.filter((r) => r.id !== a && r.id !== b);

const OFFS = [...DETOUR_OFFSETS, 190, -190, 230, -230, 280, -280, 340, -340, 420, -420];
const PS = [0.5, 0.42, 0.35, 0.3, 0.58, 0.65, 0.7];

function geom(a: string, b: string) {
  const pa = pos[a]; const pb = pos[b];
  const s = borderPoint(pa[0], pa[1], CARD_W / 2 + EDGE_PAD, CARD_H / 2 + EDGE_PAD, pb[0], pb[1]);
  const e = borderPoint(pb[0], pb[1], CARD_W / 2 + EDGE_PAD, CARD_H / 2 + EDGE_PAD, pa[0], pa[1]);
  return { s, e };
}

function bestOver(a: string, b: string, ps: number[], offs: number[], ob: Rect[], actual: Rect[]) {
  const { s, e } = geom(a, b);
  const dx = e[0] - s[0]; const dy = e[1] - s[1]; const len = Math.hypot(dx, dy) || 1;
  let best = Infinity; let bt = '';
  for (const p of ps) {
    const bx = s[0] + dx * p; const by = s[1] + dy * p;
    for (const off of offs) {
      const cx = off === 0 ? (s[0] + e[0]) / 2 : bx + (-dy / len) * off * 2;
      const cy = off === 0 ? (s[1] + e[1]) / 2 : by + (dx / len) * off * 2;
      const h = pathHits(s[0], s[1], cx, cy, e[0], e[1], actual, PATH_SAMPLES);
      if (h < best) { best = h; bt = 'p=' + p + ' off=' + off; }
    }
  }
  return { best, bt, straight: pathHits(s[0], s[1], (s[0] + e[0]) / 2, (s[1] + e[1]) / 2, e[0], e[1], actual, PATH_SAMPLES) };
}

function metricHits(a: string, b: string, ob: Rect[], actual: Rect[]): number {
  const { s, e } = geom(a, b);
  const c = edgeControl(s[0], s[1], e[0], e[1], ob);
  return pathHits(s[0], s[1], c[0], c[1], e[0], e[1], actual, PATH_SAMPLES);
}

console.log('Режим: ' + MODE);
let badCur = 0; let badWide = 0;
for (const [a, b] of deps) {
  const ob = padded(a, b); const actual = actualOf(a, b);
  const cur = bestOver(a, b, [0.5], [0, ...DETOUR_OFFSETS], ob, actual);
  const wide = bestOver(a, b, PS, [0, ...OFFS], ob, actual);
  const mHits = metricHits(a, b, ob, actual);
  if (cur.best > 0) badCur++;
  if (wide.best > 0) badWide++;
  if (cur.best > 0 || wide.best > 0 || mHits > 0) {
    console.log(`№${byId[a].num}->№${byId[b].num} кол.${colOf(a)}->${colOf(b)}  прямая=${cur.straight} метрика=${mHits} тек.обход=${cur.best}  расширенный=${wide.best} (${wide.bt})`);
    if (wide.best > 0) {
      const hitN: string[] = [];
      const pa = pos[a]; const pb = pos[b];
      const s = borderPoint(pa[0], pa[1], CARD_W / 2 + EDGE_PAD, CARD_H / 2 + EDGE_PAD, pb[0], pb[1]);
      const e = borderPoint(pb[0], pb[1], CARD_W / 2 + EDGE_PAD, CARD_H / 2 + EDGE_PAD, pa[0], pa[1]);
      for (const r of actual) if (pathHits(s[0], s[1], (s[0] + e[0]) / 2, (s[1] + e[1]) / 2, e[0], e[1], [r], PATH_SAMPLES) > 0) hitN.push((r as any).id);
      console.log(`   прямая задевает: ${hitN.map((id) => '№' + byId[id].num + '@к' + colOf(id)).join(', ')}`);
    }
  }
}
console.log('\nОстаточный проход: текущий=' + badCur + ', расширенный(p/off)=' + badWide + ' из ' + deps.length);
