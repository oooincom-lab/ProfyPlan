/* Временный аудит CPM-сети: реальные модули + реальные данные. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { computeLayoutMetrics, type LayoutMetrics } from '../../../lib/cpm-metrics';
import { computeLayout, type GOp, type Mode } from '../../../lib/cpm-layout';
import { checkCpmStructure, intensityK, type StructureIssue } from '../../../lib/cpm-structure';

const API = process.env.CPM_API || 'http://localhost:8000';
const STRETCH_K = 0.8;

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
    const sep = fullName.indexOf('\u00b7');
    const code = sep > 0 ? fullName.slice(0, sep).trim() : fullName;
    const detail = sep > 0 ? fullName.slice(sep + 1).trim() : '';
    const crit = !!(n.is_critical != null ? n.is_critical : n.critical);
    return {
      id,
      num: n.number != null ? n.number : (n.num != null ? n.num : i + 1),
      name: fullName, code, detail, durDays, es, ef, ls, lf, tf, crit,
      branch: branchSet.has(id) && !mainSet.has(id), hpd,
    };
  });
}

async function api(pathName: string, token: string, init: RequestInit = {}) {
  const res = await fetch(API + pathName, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(init.headers as any) },
  });
  if (!res.ok) throw new Error(pathName + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function liveData() {
  const login = await fetch(API + '/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }),
  }).then((r) => r.json());
  let token = login.access_token;
  if (login.tenants && login.tenants.length) {
    try {
      const sel = await api('/v1/auth/select-tenant', token, { method: 'POST', body: JSON.stringify({ tenant_id: login.tenants[0].id }) });
      if (sel && sel.access_token) token = sel.access_token;
    } catch { /* оставляем исходный токен */ }
  }
  const projects = await api('/v1/projects', token);
  const list: any[] = projects.items || projects;
  const proj = list.find((p) => /Полигон A|\u041c\u043e\u0441\u0442\u044b/i.test(p.name)) || list[0];
  const cpm = await api('/v1/projects/' + proj.id + '/calculate/cpm', token, { method: 'POST', body: JSON.stringify({}) });
  let deps: [string, string][] = [];
  if (Array.isArray(cpm.dependencies) && cpm.dependencies.length) {
    deps = cpm.dependencies.map((d: any) => [String(d.from ?? d.predecessor_id), String(d.to ?? d.successor_id)] as [string, string]);
  } else {
    const dm = await api('/v1/projects/' + proj.id + '/operations/dependencies-map', token);
    deps = ((dm && dm.items) || []).map((x: any) => [String(x.from), String(x.to)] as [string, string]);
  }
  return { projectId: String(proj.id), projectName: String(proj.name), cpm, deps };
}

async function load() {
  try {
    const d = await liveData();
    console.log('[данные] загружены с живого стенда ' + API);
    return d;
  } catch (e: any) {
    const dir = path.join(__dirname, '..', 'cpm-lab');
    const d = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    console.log('[данные] стенд недоступен (' + (e && e.message) + '), взят снимок data.json');
    return { projectId: String(d.projectId), projectName: String(d.projectName), cpm: d.cpm, deps: d.deps as [string, string][] };
  }
}

function reportMetrics(tag: string, m: LayoutMetrics, layout: any) {
  console.log(
    '  ' + tag.padEnd(16) +
    ' пересечений=' + String(m.crossings).padStart(4) +
    '  сквозь_узлы=' + String(m.edgeNodeHits).padStart(3) +
    '  наложений_узлов=' + String(m.nodeOverlaps).padStart(3) +
    '  плотность=' + String(m.density).padStart(5) + '%' +
    '   [узлов=' + m.nodes + ' связей=' + m.edges + ' полотно ' +
    Math.round(layout.maxX - layout.minX) + 'x' + Math.round(layout.maxY - layout.minY) + ']',
  );
}

async function main() {
  const data = await load();
  const ops = mapOps(data.cpm);
  const ids = new Set(ops.map((o) => o.id));
  let deps: [string, string][] = (data.deps || []).map((d: any) => [String(d[0]), String(d[1])] as [string, string]);
  deps = deps.filter(([a, b]) => a !== 'undefined' && b !== 'undefined' && ids.has(a) && ids.has(b));
  const rawDepsCount = (data.deps || []).length;

  console.log('Проект: ' + data.projectName + ' (' + data.projectId + ')');
  console.log('Операций: ' + ops.length + ' | связей после фильтра: ' + deps.length + ' (сырых ' + rawDepsCount + ')');
  console.log('');

  /* ── 1. Напряжённость K ── */
  const ks = ops.map((o) => ({ o, k: intensityK(o.durDays, o.tf) }));
  const kOver = ks.filter((x) => x.k > STRETCH_K);
  const kOverNonCrit = kOver.filter((x) => !x.o.crit);
  const kOverNonCritNonBranch = kOver.filter((x) => !x.o.crit && !x.o.branch);
  const kExactly1 = ks.filter((x) => x.k >= 0.999);
  console.log('=== 1. НАПРЯЖЁННОСТЬ K = длительность/(длительность+резерв) ===');
  console.log('  всего работ: ' + ops.length);
  console.log('  K > ' + STRETCH_K + ': ' + kOver.length + '  (из них не-критические: ' + kOverNonCrit.length + ', не-критические и не-ветвь: ' + kOverNonCritNonBranch.length + ')');
  console.log('  K = 1 (нулевой резерв): ' + kExactly1.length);
  const pairs = ks.map((x) => x.k);
  console.log('  K min=' + Math.min(...pairs).toFixed(3) + ' max=' + Math.max(...pairs).toFixed(3) +
    ' среднее=' + (pairs.reduce((s, v) => s + v, 0) / pairs.length).toFixed(3));
  console.log('  работы с K>0,8 (номер/код/K):');
  kOver.sort((a, b) => b.k - a.k).forEach((x) =>
    console.log('    \u2116' + x.o.num + ' ' + x.o.code + '  K=' + x.k.toFixed(2) +
      '  (длит=' + x.o.durDays.toFixed(0) + 'д, резерв=' + x.o.tf.toFixed(0) + 'д)' +
      (x.o.crit ? ' [крит]' : (x.o.branch ? ' [ветвь]' : ''))));
  console.log('');

  /* ── 2. Проверки структуры ── */
  console.log('=== 2. ПРОВЕРКИ СТРУКТУРЫ СЕТИ (реальный проект) ===');
  const issues: StructureIssue[] = checkCpmStructure(
    ops.map((o) => ({ id: o.id, num: o.num, name: o.name })),
    deps,
  );
  console.log('  предупреждений: ' + issues.length);
  issues.forEach((w) => console.log('    [' + w.kind + '] ' + w.title + ' — ' + w.detail));
  if (!issues.length) console.log('    (пусто — циклов, висящих операций и дублей связей нет)');

  // дубли/циклы вручную для контроля
  const seen = new Set<string>();
  let rawDup = 0;
  deps.forEach(([a, b]) => { const k = a + '|' + b; if (seen.has(k)) rawDup++; else seen.add(k); });
  console.log('  контроль: точных дублей связей в данных = ' + rawDup);
  console.log('');

  /* ── 3. Метрики раскладки ── */
  console.log('=== 3. СЧЁТЧИК КАЧЕСТВА РАСКЛАДКИ (после правок) ===');
  const layDate = computeLayout(ops, deps, 'byDate');
  const mDate = computeLayoutMetrics(layDate, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, false);
  const layLayer = computeLayout(ops, deps, 'byLayer');
  const mLayer = computeLayoutMetrics(layLayer, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, false);
  const mDateCrit = computeLayoutMetrics(layDate, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, true);
  const mLayerCrit = computeLayoutMetrics(layLayer, ops.map((o) => ({ id: o.id, crit: o.crit })), deps, true);

  const fmt = (m: LayoutMetrics) => m.crossings + ' / ' + m.edgeNodeHits + ' / ' + m.nodeOverlaps + ' / ' + m.density + '%';
  console.log('  (пересечения / сквозь узлы / наложения узлов / плотность)');
  reportMetrics('по датам', mDate, layDate);
  reportMetrics('по слоям', mLayer, layLayer);
  reportMetrics('по датам крит', mDateCrit, layDate);
  reportMetrics('по слоям крит', mLayerCrit, layLayer);

  const OLD_DATE = [178, 18, 0, 5.1];
  const OLD_LAYER = [214, 30, 0, 3.6];
  console.log('');
  console.log('  ЦЕЛИ: пересечения < 30, сквозь узлы = 0, наложения узлов = 0');
  console.log('  по датам : было ' + OLD_DATE.join(' / ') + '  ->  стало ' + fmt(mDate) +
    '   [цель по пересечениям ' + (mDate.crossings < 30 ? 'ДОСТИГНУТА' : 'НЕ достигнута') + ']');
  console.log('  по слоям : было ' + OLD_LAYER.join(' / ') + '  ->  стало ' + fmt(mLayer) +
    '   [цель по пересечениям ' + (mLayer.crossings < 30 ? 'ДОСТИГНУТА' : 'НЕ достигнута') + ']');
  console.log('');
  console.log('ИТОГ-СТРОКА (для отчёта):');
  console.log('  по датам: ' + mDate.crossings + ' / ' + mDate.edgeNodeHits + ' / ' + mDate.nodeOverlaps + ' / ' + mDate.density + ' %');
  console.log('  по слоям: ' + mLayer.crossings + ' / ' + mLayer.edgeNodeHits + ' / ' + mLayer.nodeOverlaps + ' / ' + mLayer.density + ' %');
  console.log('  напряжённых K>0,8: ' + kOver.length);
  console.log('  предупреждений структуры: ' + issues.length);
}

main().catch((e) => { console.error('ОШИБКА: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
