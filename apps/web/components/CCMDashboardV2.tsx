/**
 * CCM V2 Dashboard — План (Baseline) + Динамика (Actual).  
 * Две версии графа: предварительный расчёт и рабочий с фактом.
 */
'use client';

// Демо-вход: значения по умолчанию — боевые; локально переопределяются окружением
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL || 'planner@demo.ru';
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'demo123';

function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8000';
  }
  return env || 'https://profyplan.ru/api';
}
const API_BASE = resolveApiBase() + '/v1';

import { useState, useEffect, useCallback, useRef } from 'react';
import NetworkGraphV2 from '@/components/NetworkGraphV2';
import GanttChart from '@/components/ganttchart';
import { login, isAuthenticated, getProjects, mergeProjects, resourceLeveling, createBaseline } from '@/lib/api';

// Помощники карты занятости (блок 6.33, первый срез): интервалы, окна, формат дат.
const MS_DAY = 86400000;
const parseMs = (v: any): number | null => {
  if (!v) return null;
  const str = String(v);
  const d = new Date(str.length <= 10 ? str + 'T00:00:00' : str);
  const t = d.getTime();
  return isFinite(t) ? t : null;
};
const fmtDm = (ms: number): string => {
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
};
const fmtDmShort = (ms: number): string => {
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getFullYear()).slice(2);
};
const fmtD = (v: any): string => {
  const ms = parseMs(v);
  return ms == null ? '—' : fmtDm(ms);
};
const fmtDT = (v: any): string => {
  if (!v) return '—';
  const d = new Date(v);
  const p = (x: number) => String(x).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};
const orderLabel = (o: any): string => {
  const code = o?.ext_id ? String(o.ext_id) + ' · ' : '';
  const nm = o?.specification_name || o?.ext_id || 'Заказ';
  const q = o?.quantity != null ? String(o.quantity).replace(/\.00$/, '') : '';
  return code + nm + (q ? ' · ' + q + (o?.unit ? ' ' + o.unit : '') : '');
};
const mergeIv = (list: [number, number][]): [number, number][] => {
  const arr = list.slice().sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [s0, e0] of arr) {
    const last = out[out.length - 1];
    if (last && s0 <= last[1]) last[1] = Math.max(last[1], e0);
    else out.push([s0, e0]);
  }
  return out;
};

type Tab = 'network-graph';

export default function CCMV2Dashboard({ onOpenResourceEdit, onOpenOrder }: { onOpenResourceEdit?: (id: string) => void; onOpenOrder?: (order: any) => void } = {}) {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('network-graph');
  const [ccmResult, setCcmResult] = useState<any>(null);
  const [levelResult, setLevelResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineNodes, setBaselineNodes] = useState<any>(null);
  /** Слой «было» на сводном графике: пометки узлов проектов с активными сдвигами. */
  const [showGraphShifts, setShowGraphShifts] = useState(false);
  /** «Сводный график»: все проекты со сдвигами на одной шкале (последняя запись каждого). */
  const [sgTabData, setSgTabData] = useState<any>(null);
  const [sgTabExp, setSgTabExp] = useState<Record<string, boolean>>({});
  const [sgTabOpOpen, setSgTabOpOpen] = useState<Record<string, boolean>>({});
  const [sgTabOps, setSgTabOps] = useState<Record<string, any>>({});
  /** Масштаб сводного графика (×1 — весь период по ширине) и ширина области. */
  const [sgZoom, setSgZoom] = useState(1);
  const sgWrapRef = useRef<HTMLDivElement | null>(null);
  const sgLeftRef = useRef<HTMLDivElement | null>(null);
  const sgMidRef = useRef<HTMLDivElement | null>(null);
  const sgRightRef = useRef<HTMLDivElement | null>(null);
  const [sgWrapW, setSgWrapW] = useState(1000);
  const [authed, setAuthed] = useState(false);
  const [loginEmail, setLoginEmail] = useState(DEMO_EMAIL);
  const [loginPass, setLoginPass] = useState(DEMO_PASSWORD);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [resourceUsage, setResourceUsage] = useState<any[]>([]);
  const [overload, setOverload] = useState<any>(null);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [sugBusy, setSugBusy] = useState(false);
  const [occId, setOccId] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'resources' | 'occupancy' | 'shiftgraph' | 'gantt' | 'graph'>('overview');
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [shiftsLog, setShiftsLog] = useState<any[]>([]);
  const [autoRecalc, setAutoRecalc] = useState(false);
  const [recalcList, setRecalcList] = useState<any[]>([]);
  /** Сдвиг: «сразу, без шагов» или мастер из двух шагов (по умолчанию — мастер). */
  const [shiftAuto, setShiftAuto] = useState(false);
  /** Мастер сдвига: шаг 1 — проверка, шаг 2 — применение, шаг 3 — итог. */
  const [stepPanel, setStepPanel] = useState<any>(null);
  const [ordersByProject, setOrdersByProject] = useState<Record<string, any[]>>({});
  /** Раскрытие проекта в карте занятости: список заказов с этим ресурсом. */
  const [expOrders, setExpOrders] = useState<Record<string, boolean>>({});
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [sugFor, setSugFor] = useState<string | null>(null);
  /** «Показать „как было"»: призраки полос заказов до активных сдвигов (журнал). */
  const [ghosts, setGhosts] = useState(false);
  const [ghostsData, setGhostsData] = useState<any>(null);
  /** Фокус из окна «График сдвига»: подсветить заказы записи на карте. */
  const [mapFocus, setMapFocus] = useState<any>(null);
  const occRef = useRef<HTMLDivElement | null>(null);
  const sugRef = useRef<HTMLDivElement | null>(null);

  /** Журнал сдвигов: последние записи (переживают перезагрузку). */
  const loadShifts = useCallback(async () => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shifts', { headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) } });
      if (r.ok) {
        const d = await r.json();
        setShiftsLog(Array.isArray(d?.items) ? d.items : []);
      }
    } catch { /* журнал не критичен для работы раздела */ }
  }, []);

  /** Призраки «как было»: активные записи журнала → старые даты заказов (для карты занятости). */
  const loadGhosts = useCallback(async () => {
    setGhostsData({ loading: true });
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const h = { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) };
      const r = await fetch(API_BASE + '/ccm/shifts', { headers: h });
      const d = r.ok ? await r.json() : null;
      const items = (Array.isArray(d) ? d : (d?.items || [])).filter((x: any) => !x.reverted);
      const byOrder: Record<string, any[]> = {};
      let n = 0;
      for (const it of items.slice(0, 20)) {
        try {
          const r2 = await fetch(API_BASE + '/ccm/shifts/' + it.id, { headers: h });
          if (!r2.ok) continue;
          const dd = await r2.json();
          const rec = dd?.record || it;
          for (const m of (dd?.orders_moved || [])) {
            const oid = String(m.id || '');
            if (!oid) continue;
            (byOrder[oid] = byOrder[oid] || []).push({ oldStart: m.old_start, oldDue: m.old_due, projectName: rec.project_name || it.project_name || '', created: rec.created_at || it.created_at || '', recordId: it.id });
            n++;
          }
        } catch { /* запись пропускаем */ }
      }
      setGhostsData({ byOrder, n, active: items.length });
    } catch (e: any) { setGhostsData({ err: String(e?.message || e), byOrder: {}, n: 0, active: 0 }); }
  }, []);

  /** График сдвига («призрак» до/после): окно поверх раздела. */
  const [shiftGraph, setShiftGraph] = useState<any>(null);
  const [sgBusy, setSgBusy] = useState(false);
  const [sgExp, setSgExp] = useState<Record<string, boolean>>({});
  const [sgOpOpen, setSgOpOpen] = useState<Record<string, boolean>>({});
  const [sgOpsData, setSgOpsData] = useState<any>(null);
  /** Операции заказов сдвига: раскрытие «▸ оп.» — расчёт проекта + список операций (один раз на окно). */
  const loadSgOps = useCallback(async () => {
    if (sgOpsData && (sgOpsData.loading || sgOpsData.byOrder)) return;
    const pid = shiftGraph?.projectId;
    if (!pid) return;
    setSgOpsData({ loading: true });
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const h = { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) };
      const sr = await fetch(API_BASE + '/projects/' + String(pid) + '/calculate/schedule', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
      const sched = sr.ok ? await sr.json() : null;
      const byOrder: Record<string, any[]> = {};
      for (const n of ((sched && sched.nodes) || [])) {
        const oid = n.order_id ? String(n.order_id) : '';
        if (!oid) continue;
        (byOrder[oid] = byOrder[oid] || []).push({ id: String(n.id), name: n.name || '—', start: n.start_datetime || (n.early_start_date ? n.early_start_date + 'T08:00' : null), finish: n.finish_datetime || (n.early_finish_date ? n.early_finish_date + 'T18:00' : null), crit: !!n.is_critical });
      }
      setSgOpsData({ byOrder });
    } catch (e: any) { setSgOpsData({ err: String(e?.message || e) }); }
  }, [sgOpsData, shiftGraph]);

  /** «Сводный график»: собрать последние записи по каждому проекту — заказы, шкала. */
  const loadShiftSummary = useCallback(async () => {
    if (sgTabData && (sgTabData.loading || sgTabData.blocks)) return;
    setSgTabData({ loading: true });
    try {
      const latest: Record<string, any> = {};
      for (const s of shiftsLog) {
        const pid = String(s.project_id || '');
        if (!pid) continue;
        if (!latest[pid] || String(s.created_at || '') > String(latest[pid].created_at || '')) latest[pid] = s;
      }
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const h = { ...(t ? { Authorization: 'Be' + 'arer ' + t } : {}) };
      const blocks: any[] = [];
      let mn: number | null = null; let mx: number | null = null;
      for (const rec of Object.values(latest)) {
        const r = await fetch(API_BASE + '/ccm/shifts/' + rec.id, { headers: h });
        const d = r.ok ? await r.json() : null;
        let ords: any[] = [];
        try { const r2 = await fetch(API_BASE + '/production-orders/?project_id=' + rec.project_id, { headers: h }); if (r2.ok) ords = await r2.json(); } catch { /* подписи будут по коду */ }
        const byId: Record<string, any> = {};
        for (const o of ords || []) byId[String(o.id)] = o;
        const days = Number(d && d.record ? d.record.shift_days : (rec.shift_days || 0));
        const moved = ((d && d.orders_moved) || []).map((m: any) => {
          const oldS = parseMs(m.old_start); const oldD = parseMs(m.old_due);
          const nw = [oldS != null ? oldS + days * MS_DAY : null, oldD != null ? oldD + days * MS_DAY : null];
          return { o: byId[String(m.id)] || { id: m.id, ext_id: m.ext_id }, old: [oldS, oldD], new: nw };
        });
        const skipped = ((d && d.orders_skipped) || []).map((s2: any) => ({ o: byId[String(s2.id)] || { id: s2.id, ext_id: s2.ext_id }, reason: s2.reason || 'пропущен' }));
        for (const m of moved) {
          for (const v of (m.old || [])) { if (v != null && (mn == null || v < mn)) mn = v; }
          for (const v of (m.new || [])) { if (v != null && (mx == null || v > mx)) mx = v; }
        }
        blocks.push({ rec, projectId: String(rec.project_id), projectName: String(rec.project_name || ''), days, reverted: !!rec.reverted, moved, skipped });
      }
      setSgTabData({ blocks, mn, mx });
    } catch (e: any) { setSgTabData({ err: String(e && e.message ? e.message : e), blocks: [] }); }
  }, [shiftsLog, sgTabData]);

  /** Операции для «Сводного графика»: один расчёт на проект (лениво). */
  const loadTabOps = useCallback(async (pid: string) => {
    if (!pid || sgTabOps[pid]) return;
    setSgTabOps((m: any) => ({ ...m, [pid]: { loading: true } }));
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const h = { ...(t ? { Authorization: 'Be' + 'arer ' + t } : {}) };
      const sr = await fetch(API_BASE + '/projects/' + String(pid) + '/calculate/schedule', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
      const sched = sr.ok ? await sr.json() : null;
      const byOrder: Record<string, any[]> = {};
      for (const n of ((sched && sched.nodes) || [])) {
        const oid = n.order_id ? String(n.order_id) : '';
        if (!oid) continue;
        (byOrder[oid] = byOrder[oid] || []).push({ id: String(n.id), name: n.name || '—', start: n.start_datetime || (n.early_start_date ? n.early_start_date + 'T08:00' : null), finish: n.finish_datetime || (n.early_finish_date ? n.early_finish_date + 'T18:00' : null), crit: !!n.is_critical });
      }
      setSgTabOps((m: any) => ({ ...m, [pid]: { byOrder } }));
    } catch (e: any) { setSgTabOps((m: any) => ({ ...m, [pid]: { err: String(e && e.message ? e.message : e) } })); }
  }, [sgTabOps]);
  const openShiftGraph = useCallback(async (rec: any) => {
    if (!rec || sgBusy) return;
    setSgBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const h = { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) };
      const r = await fetch(API_BASE + '/ccm/shifts/' + rec.id, { headers: h });
      if (!r.ok) throw new Error('Не удалось получить детали сдвига');
      const d = await r.json();
      let ords: any[] = [];
      try {
        const r2 = await fetch(API_BASE + '/production-orders/?project_id=' + rec.project_id, { headers: h });
        if (r2.ok) ords = await r2.json();
      } catch { /* подписи будут по коду/ид */ }
      const byId: Record<string, any> = {};
      for (const o of ords || []) byId[String(o.id)] = o;
      const days = Number(d?.record?.shift_days ?? rec.shift_days ?? 0);
      const addDays = (iso: any, n: number) => { const m = parseMs(iso); return m == null ? null : m + n * MS_DAY; };
      setSgExp({}); setSgOpOpen({}); setSgOpsData(null);
      setShiftGraph({
        mode: 'record',
        recordId: rec.id,
        projectId: rec.project_id,
        title: 'График сдвига — «' + String(d?.record?.project_name || rec.project_name) + '»',
        meta: { days, scope: d?.record?.scope || rec.scope, reverted: !!rec.reverted, kind: rec.kind, created: rec.created_at },
        oldStart: parseMs(d?.record?.old_start),
        newStart: parseMs(d?.record?.new_start),
        moved: (d?.orders_moved || []).map((m: any) => ({
          o: byId[String(m.id)] || { id: m.id, ext_id: m.ext_id },
          old: [parseMs(m.old_start), parseMs(m.old_due)],
          new: [addDays(m.old_start, days), addDays(m.old_due, days)],
        })),
        skipped: (d?.orders_skipped || []).map((s2: any) => ({
          o: byId[String(s2.id)] || { id: s2.id, ext_id: s2.ext_id },
          reason: s2.reason || 'пропущен',
        })),
      });
    } catch (e: any) { setError(String(e?.message || e)); }
    setSgBusy(false);
  }, [sgBusy]);
  const openShiftGraphPreview = useCallback(() => {
    const p = stepPanel?.preview;
    if (!p) return;
    setSgExp({}); setSgOpOpen({}); setSgOpsData(null);
    setShiftGraph({
      mode: 'preview',
      title: 'График сдвига (проверка) — «' + String(p.project_name || '') + '»',
      meta: { days: Number(p.days || 0) },
      oldStart: parseMs(p.old_start),
      newStart: parseMs(p.new_start),
      bushes: (p.bushes || []).map((b: any) => ({
        title: b.title,
        old: [parseMs(b.window_before?.[0]), parseMs(b.window_before?.[1])],
        new: [parseMs(b.window_after?.[0]), parseMs(b.window_after?.[1])],
        skipped: b.orders_skipped || 0,
      })),
      skippedList: (p.totals?.skipped || []),
    });
  }, [stepPanel]);

  /** «Показать на карте»: закрыть график, открыть карту с призраками и подсветкой заказов записи. */
  const showOnMap = useCallback(() => {
    const g = shiftGraph;
    if (!g || g.mode !== 'record') return;
    const pid = g.projectId ? String(g.projectId) : '';
    const oids = Array.from(new Set((g.moved || []).map((m: any) => (m.o && m.o.id ? String(m.o.id) : '')).filter(Boolean)));
    setGhosts(true);
    try { localStorage.setItem('profyplan_ccm_ghosts', '1'); } catch { /* noop */ }
    setShiftGraph(null);
    setTab('occupancy');
    if (!occId && overload) {
      const rr = ((overload.resources || []) as any[]).find((x: any) => ((x.assignments || []) as any[]).some((a: any) => String(a.project_id) === pid));
      if (rr) setOccId(String(rr.id));
    }
    if (pid) setExpOrders((mm: any) => ({ ...mm, [pid]: true }));
    setMapFocus({ projectId: pid, orderIds: oids, recordId: g.recordId || null, title: g.title });
    setTimeout(() => { try { occRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* noop */ } }, 300);
  }, [shiftGraph, occId, overload]);

  /** Статусы пересчёта проектов сдвига (панель «Пересчёт проектов сдвига»). */
  const loadRecalc = useCallback(async () => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shift-recalc', { headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) } });
      if (r.ok) {
        const d = await r.json();
        setRecalcList(Array.isArray(d?.items) ? d.items : []);
      }
    } catch { /* панель не критична */ }
  }, []);

  /** Заказы проектов для карточки карты — только с выбранным ресурсом в маршруте; кэш по проекту и ресурсу. */
  const loadOrdersForProjects = async (ids: string[], resourceId: string) => {
    const key = (id: string) => id + '|' + resourceId;
    const missing = ids.filter((id) => !(key(id) in ordersByProject));
    if (!missing.length) return;
    setOrdersLoading(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const encoded = encodeURIComponent(resourceId);
      const next: Record<string, any[]> = {};
      for (const id of missing) {
        try {
          const r = await fetch(API_BASE + '/production-orders/?project_id=' + id + '&resource_id=' + encoded, { headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) } });
          if (r.ok) {
            const d = await r.json();
            const arr = Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : []);
            next[key(id)] = arr.slice().sort((x: any, y: any) => String(x.start_date || '9999').localeCompare(String(y.start_date || '9999')));
          } else {
            next[key(id)] = [];
          }
        } catch { next[key(id)] = []; }
      }
      setOrdersByProject((prev) => ({ ...prev, ...next }));
    } finally {
      setOrdersLoading(false);
    }
  };

  /** После сдвига/возврата обновляем перегрузку, список проектов и журнал сдвигов. */
  const reloadPortfolioData = async () => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/resource-overload', { headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) } });
      if (r.ok) setOverload(await r.json());
    } catch { /* noop */ }
    try {
      const ps: any = await getProjects();
      setProjects(ps?.items || (Array.isArray(ps) ? ps : []));
    } catch { /* noop */ }
    await loadShifts();
    await loadRecalc();
    setGhostsData(null);
    setMapFocus(null);
    setSgTabData(null);
    setSgTabOps({});
  };

  // Галка «Автопересчёт после сдвигов»: по умолчанию выключена (ручной режим).
  useEffect(() => {
    try {
      setAutoRecalc(localStorage.getItem('profyplan_ccm_autorecalc') === '1');
      try { setShiftAuto(localStorage.getItem('profyplan_ccm_shift_auto') === '1'); } catch { /* noop */ }
      try { setGhosts(localStorage.getItem('profyplan_ccm_ghosts') === '1'); } catch { /* noop */ }
      try { setShowGraphShifts(localStorage.getItem('profyplan_ccm_graph_shifts') === '1'); } catch { /* noop */ }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
      loadShifts();
      loadRecalc();
    }
  }, []);

  // Результат «Предложить сдвиг» показываем сразу; карта — на своей вкладке (без автопрокрутки).

  useEffect(() => {
    if (suggestion && sugRef.current) {
      try { sugRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* noop */ }
    }
  }, [suggestion]);

  // Карточка карты открыта — подтянуть заказы показанных проектов (лениво, из кэша).
  useEffect(() => {
    if (!occId || !overload) return;
    const res = ((overload.resources || []) as any[]).find((x: any) => String(x.id) === occId);
    const ids = Array.from(new Set(((res?.assignments || []) as any[]).map((a: any) => String(a.project_id))));
    if (ids.length) loadOrdersForProjects(ids, occId);
  }, [occId, overload]);

  // Галка «Показать „как было"»: разовая загрузка активных записей журнала (призраки).
  useEffect(() => {
    if (tab !== 'occupancy' || !ghosts || ghostsData) return;
    loadGhosts();
  }, [tab, ghosts, ghostsData]);

  // «Сводный график»: собрать картину по последним записям проектов (один раз на данные).
  useEffect(() => {
    if (tab !== 'shiftgraph' || !shiftsLog.length) return;
    if (sgTabData && (sgTabData.loading || sgTabData.blocks)) return;
    loadShiftSummary();
  }, [tab, shiftsLog, sgTabData]);

  // Ширина области сводного графика — для авто-масштаба (масштаб ×1 = по ширине).
  useEffect(() => {
    if (tab !== 'shiftgraph') return;
    const el = sgWrapRef.current;
    if (!el) return;
    const f = () => { const w = el.clientWidth; if (w) setSgWrapW((prev) => (Math.abs(w - prev) > 2 ? w : prev)); };
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [tab, sgTabData]);

  useEffect(() => {
    if (!authed) return;
    const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    fetch(API_BASE + '/ccm/resource-usage', {
      headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
    })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => setResourceUsage(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    fetch(API_BASE + '/ccm/resource-overload', {
      headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
    })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => setOverload(d))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (authed) {
      getProjects().then((res: any) => setProjects(res.items || res || [])).catch(() => {});
    }
  }, [authed]);

  const toggleProject = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const suggestShift = useCallback(async (pid: string) => {
    setSugBusy(true);
    setSugFor(pid);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(`${API_BASE}/ccm/projects/${pid}/overload-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: '{}',
      });
      setSuggestion(await r.json());
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
    setSugFor(null);
  }, []);

  /** Применение сдвига контура: проект (опц.) + заказы выбранных кустов/всех. */
  const applyContourShift = useCallback(async (projectId: string, newStartIso: string, kind: 'self' | 'other', days: number, moveProject: boolean, scopeRootIds: string[] | null) => {
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shifts/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: JSON.stringify({ project_id: projectId, new_start: newStartIso, kind, shift_days: days, auto_recalc: autoRecalc, move_project: moveProject, scope_root_ids: scopeRootIds }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && d.detail) || 'Не удалось применить сдвиг');
      const rec = (d && d.record) || null;
      setStepPanel((p: any) => (p ? { ...p, step: 3, result: rec } : p));
      setSuggestion((prev: any) => (prev ? { ...prev, applied: true, appliedOther: kind === 'other', shiftRecordId: (rec && rec.id) || null, recalc: (d && d.recalc) || null, ordersInfo: (d && d.orders) || null } : prev));
      setOrdersByProject({});
      await reloadPortfolioData();
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, [autoRecalc]);

  /** Запуск сдвига: «сразу, без шагов» или мастер (шаг 1 — проверка). */
  const startShiftFlow = useCallback(async (projectId: string, newStartIso: string, kind: 'self' | 'other', days: number) => {
    setSugBusy(true);
    try {
      if (shiftAuto) {
        await applyContourShift(projectId, newStartIso, kind, days, true, null);
      } else {
        const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
        const r = await fetch(API_BASE + '/ccm/shifts/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
          body: JSON.stringify({ project_id: projectId, new_start: newStartIso }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'Не удалось подготовить сдвиг');
        setStepPanel({ step: 1, preview: d, project_id: projectId, new_start: newStartIso, kind, days });
      }
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, [shiftAuto, applyContourShift]);

  const applyShift = useCallback(async () => {
    const sg = suggestion?.suggestion;
    if (!sg?.suggested_start || !suggestion?.project_id) return;
    await startShiftFlow(suggestion.project_id, sg.suggested_start, 'self', sg.shift_days || 0);
  }, [suggestion, startShiftFlow]);

  const applyShiftOther = useCallback(async () => {
    const tgt = suggestion?.priority?.target_project;
    const days = (suggestion?.plan && suggestion.plan[0]?.overlap_days) || 0;
    if (!tgt?.project_id || !days) return;
    const pr = projects.find((x: any) => x.id === tgt.project_id);
    const base = pr?.start_date ? new Date(pr.start_date) : new Date();
    const nd = new Date(base.getTime() + days * 86400000);
    await startShiftFlow(tgt.project_id, nd.toISOString(), 'other', days);
  }, [suggestion, projects, startShiftFlow]);

  /** Возврат сдвига: восстановить дату старта и пересчитать проект. */
  const revertShift = async (shiftId: string) => {
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shifts/' + shiftId + '/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: JSON.stringify({ auto_recalc: autoRecalc }),
      });
      if (!r.ok) throw new Error('Не удалось вернуть сдвиг');
      await reloadPortfolioData();
      setOrdersByProject({});
      // Панель предложения могла держать статус «сдвиг применён» — после возврата он устаревший.
      setSuggestion((p: any) => (p && p.shiftRecordId === shiftId ? null : p));
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  };

  /** Пересчитать один проект списка (создать запуск расчёта). */
  const recalcProject = async (projectId: string) => {
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/projects/' + projectId + '/calculation-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: '{}',
      });
      if (!r.ok) throw new Error('Не удалось пересчитать проект');
      await loadRecalc();
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  };

  /** Пересчитать все проекты сдвига сверху вниз (по хронологии). */
  const recalcAllShiftProjects = async () => {
    const active = recalcList.filter((r: any) => r.state !== 'reverted');
    if (!active.length) return;
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      for (const it of active) {
        const r = await fetch(API_BASE + '/projects/' + it.project_id + '/calculation-runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
          body: '{}',
        });
        if (!r.ok) break;
      }
      await loadRecalc();
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  };

  const setMyPriority = useCallback(async (pid: string, pr: string) => {
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      await fetch(`${API_BASE}/projects/${pid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: JSON.stringify({ priority: pr }),
      });
      // перезапросить предложение с новым приоритетом
      const t2 = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r2 = await fetch(`${API_BASE}/ccm/projects/${pid}/overload-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t2 ? { Authorization: 'Bea' + 'rer ' + t2 } : {}) },
        body: '{}',
      });
      setSuggestion(await r2.json());
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, []);

  const runMerge = useCallback(async () => {
    if (selectedIds.length === 0) {
      setError('Выберите хотя бы один проект');
      return;
    }
    setLoading(true); setError(null);
    try {
      const result = await mergeProjects(selectedIds);
      setCcmResult(result);
      setTab('gantt');
      if (selectedIds.length === 1) {
        try {
          const lr = await resourceLeveling(selectedIds[0], false);
          setLevelResult(lr);
        } catch {}
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedIds]);

  const approveBaseline = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setLoading(true);
    try {
      // Save current graph as baseline
      if (ccmResult) {
        setBaselineNodes(ccmResult.nodes.map((n: any) => ({ ...n })));
      }
      for (const pid of selectedIds) {
        await createBaseline(pid, `Baseline ${new Date().toLocaleDateString('ru')}`);
      }
      alert('Baseline утверждён!');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedIds, ccmResult]);

  const handleLogin = async () => {
    setLoginErr(null);
    try {
      await login(loginEmail, loginPass);
      setAuthed(true);
    } catch (e: any) {
      setLoginErr(e.message);
    }
  };

  // --- Login screen
  if (!authed) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0A1628', fontFamily: 'Inter, sans-serif',
      }}>
        <div style={{
          background: '#0F1E36', padding: '32px 40px', borderRadius: 12,
          border: '1px solid #1E3252', width: 360,
        }}>
          <h2 style={{ color: '#E8EEF5', fontSize: 18, margin: '0 0 4px' }}>ProfyPlan CCM V2</h2>
          <p style={{ color: '#5A7090', fontSize: 13, margin: '0 0 20px' }}>Войдите для работы с графом</p>
          <input
            value={loginEmail}
            onChange={e => setLoginEmail(e.target.value)}
            placeholder="Email"
            style={inputStyle}
          />
          <input
            type="password"
            value={loginPass}
            onChange={e => setLoginPass(e.target.value)}
            placeholder="Пароль"
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ ...inputStyle, marginTop: 8 }}
          />
          <button onClick={handleLogin} style={{
            width: '100%', marginTop: 16, padding: '10px', borderRadius: 8,
            border: 'none', background: '#3B82F6', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Войти
          </button>
          {loginErr && (
            <div style={{ marginTop: 10, color: '#EF4444', fontSize: 12 }}>{loginErr}</div>
          )}
        </div>
      </div>
    );
  }

  // Карта занятости выбранного ресурса: брони по проектам, перекрытия, свободные окна.
  const occ = (() => {
    if (!occId || !overload) return null;
    const r = (overload.resources || []).find((x: any) => String(x.id) === occId);
    if (!r) return null;
    const list = (r.assignments || [])
      .map((a: any) => ({ ...a, s: parseMs(a.start), f: parseMs(a.finish) }))
      .filter((a: any) => a.s != null && a.f != null && (a.f as number) > (a.s as number))
      .sort((a: any, b: any) => (a.s as number) - (b.s as number));
    if (!list.length) return { r, empty: true as const };
    let minI = list[0].s as number;
    let maxI = list.reduce((m: number, a: any) => Math.max(m, a.f as number), list[0].f as number);
    // Призраки «как было»: расширяем диапазон, чтобы старые положения заказов были видны.
    if (ghosts && ghostsData && ghostsData.byOrder) {
      const projectIds = new Set(list.map((a: any) => String(a.project_id)));
      for (const k2 of Object.keys(ordersByProject)) {
        const sep = k2.indexOf('|');
        if (sep < 0 || k2.slice(sep + 1) !== occId) continue;
        if (!projectIds.has(k2.slice(0, sep))) continue;
        for (const o2 of (ordersByProject[k2] || [])) {
          const gl = ghostsData.byOrder[String(o2.id)];
          if (!gl || !gl.length) continue;
          for (const g0 of gl) {
            const gs2 = parseMs(g0.oldStart);
            const gf2 = parseMs(g0.oldDue);
            if (gs2 != null && gs2 < minI) minI = gs2;
            if (gf2 != null && gf2 > maxI) maxI = gf2;
          }
        }
      }
    }
    const span = (maxI - minI) || MS_DAY;
    const merged = mergeIv(list.map((a: any) => [a.s, a.f] as [number, number]));
    const free: [number, number][] = [];
    for (let i = 0; i < merged.length - 1; i++) {
      if (merged[i + 1][0] > merged[i][1]) free.push([merged[i][1], merged[i + 1][0]]);
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const covering = merged.find(([s0, e0]) => today >= s0 && today <= e0) || null;
    const nextFrom = !covering ? (merged.find(([s0]) => s0 > today) || null) : null;
    const ovz = mergeIv(
      ((r.conflicts || []).map((c: any) => [parseMs(c.from), parseMs(c.to)]) as any).filter(
        (x: any) => x[0] != null && x[1] != null && x[1] > x[0],
      ) as [number, number][],
    );
    return { r, empty: false as const, list, minI, maxI, span, merged, free, today, covering, nextFrom, ovz };
  })();

  // Данные для вкладок: общие ресурсы, конфликты, сводные цифры.
  const sharedRes = ((overload?.resources || []) as any[]).filter((r: any) => r.is_shared);
  const conflictedRes = sharedRes.filter((r: any) => r.has_conflict);
  const sharedN = overload?.totals?.shared ?? sharedRes.length;
  const conflictedN = overload?.totals?.conflicted ?? conflictedRes.length;
  const overlapSum = sharedRes.reduce((acc: number, r: any) => acc + (r.overlap_days || 0), 0);

  // Активные сдвиги по проектам: сумма дней (слой «было» на сводном графике).
  const shiftDeltaByProject: Record<string, number> = {};
  for (const s0 of shiftsLog) {
    if (!s0 || s0.reverted) continue;
    const pid0 = String(s0.project_id || '');
    if (!pid0) continue;
    shiftDeltaByProject[pid0] = (shiftDeltaByProject[pid0] || 0) + Number(s0.shift_days || 0);
  }
  const shiftProjectIds = Object.keys(shiftDeltaByProject).filter((k) => shiftDeltaByProject[k] > 0);
  const shiftMarks = (showGraphShifts && ccmResult && Array.isArray(ccmResult.nodes))
    ? ccmResult.nodes
        .map((n: any) => ({ id: String(n.id), deltaDays: shiftDeltaByProject[String(n.project_id || '')] || 0 }))
        .filter((x: any) => x.deltaDays > 0)
    : null;
  const shiftSummary = shiftProjectIds
    .map((pid0) => {
      const p0 = (projects || []).find((x: any) => String(x.id) === pid0);
      return (p0 ? p0.name : pid0) + ' +' + shiftDeltaByProject[pid0] + ' дн';
    })
    .join(' · ');

  // Имена проектов для сводной диаграммы Ганта.
  const ganttNames: Record<string, string> = {};
  for (const p0 of (projects || [])) ganttNames[String(p0.id)] = String(p0.name || '');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: 'calc(100vh - 146px)',
      background: '#0A1628', color: '#E8EEF5', fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header + вкладки */}
      <div style={{ padding: '10px 20px 0', background: '#0F1E36', borderBottom: '1px solid #1E3252' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>CCM V2 — Динамика</h2>
          <span style={{ fontSize: 12, color: '#5A7090' }}>Межпроектное планирование: ресурсы, конфликты, карта занятости</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {([['overview', 'Обзор'], ['resources', 'Ресурсы и конфликты'], ['occupancy', 'Карта занятости'], ['shiftgraph', 'Сводный график сдвигов'], ['gantt', 'Диаграмма Ганта'], ['graph', 'Сводный сетевой график']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: 'transparent', border: 'none',
              borderBottom: tab === k ? '2px solid #3B82F6' : '2px solid transparent',
              color: tab === k ? '#E8EEF5' : '#8FA3BD',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 12 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'overview' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 6 }}>Проекты для объединения — выберите один или несколько</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {projects.map((p: any) => (
                <button key={p.id} onClick={() => toggleProject(p.id)} style={{
                  padding: '5px 14px', borderRadius: 100,
                  border: selectedIds.includes(p.id) ? '1px solid #3B82F6' : '1px solid #1E3252',
                  background: selectedIds.includes(p.id) ? 'rgba(59,130,246,0.15)' : '#0A1628',
                  color: selectedIds.includes(p.id) ? '#60A5FA' : '#8FA3BD',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>{p.name}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
              <button onClick={runMerge} disabled={loading} style={{
                padding: '6px 16px', borderRadius: 6, border: 'none',
                background: selectedIds.length > 0 ? '#3B82F6' : '#162844',
                color: selectedIds.length > 0 ? '#fff' : '#5A7090',
                fontSize: 12, fontWeight: 600, cursor: selectedIds.length > 0 ? 'pointer' : 'default',
              }}>{loading ? 'Расчёт...' : 'Объединить'}</button>
              <button onClick={approveBaseline} disabled={loading || !ccmResult} style={{
                padding: '6px 16px', borderRadius: 6,
                background: ccmResult ? '#10B981' : '#162844',
                border: 'none', color: ccmResult ? '#fff' : '#5A7090',
                fontSize: 12, fontWeight: 600, cursor: ccmResult ? 'pointer' : 'default',
              }}>Утвердить Baseline</button>
              <button onClick={() => setShowBaseline(!showBaseline)} disabled={!baselineNodes} style={{
                padding: '6px 16px', borderRadius: 6,
                background: showBaseline ? '#F59E0B' : 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.3)', color: showBaseline ? '#0A1628' : '#F59E0B',
                fontSize: 12, fontWeight: 600, cursor: baselineNodes ? 'pointer' : 'default',
              }}>{showBaseline ? 'Скрыть Baseline' : 'Сравнить с Baseline'}</button>
              <button onClick={() => { const v = !showGraphShifts; setShowGraphShifts(v); try { localStorage.setItem('profyplan_ccm_graph_shifts', v ? '1' : '0'); } catch { /* noop */ } }}
                disabled={!ccmResult || shiftProjectIds.length === 0}
                title={!ccmResult ? 'Сначала «Объединить»' : (shiftProjectIds.length === 0 ? 'Активных сдвигов нет' : 'Пометить на графике узлы проектов с активными сдвигами')}
                style={{
                  padding: '6px 16px', borderRadius: 6,
                  background: showGraphShifts ? '#94A3B8' : 'rgba(148,163,184,0.1)',
                  border: '1px solid rgba(148,163,184,0.3)',
                  color: (ccmResult && shiftProjectIds.length) ? (showGraphShifts ? '#0A1628' : '#94A3B8') : '#5A7090',
                  fontSize: 12, fontWeight: 600, cursor: (ccmResult && shiftProjectIds.length) ? 'pointer' : 'default',
                }}>{showGraphShifts ? 'Скрыть сдвиги («было»)' : 'Показать сдвиги («было»)'}</button>
              <span style={{ fontSize: 11.5, color: '#5A7090' }}>«Объединить» рассчитает сводный план и откроет вкладку «Диаграмма Ганта»</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 16, maxWidth: 760 }}>
              {([['Проектов', String(projects.length)], ['Общих ресурсов', String(sharedN)], ['С конфликтами', String(conflictedN)], ['Суммарное пересечение', overlapSum + ' дн']] as const).map(([t, v]) => (
                <div key={t} style={{ border: '1px solid #1E3252', borderRadius: 10, background: '#0C1B31', padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18, maxWidth: 860 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>⚠ Конфликты общих ресурсов</div>
                {conflictedRes.length > 5 && (
                  <button onClick={() => setTab('resources')} style={{ background: 'transparent', border: 'none', color: '#93C5FD', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>все {conflictedRes.length} →</button>
                )}
              </div>
              {conflictedRes.length === 0 && <div style={{ fontSize: 12, color: '#8FA3BD' }}>Конфликтов нет — общие ресурсы не пересекаются.</div>}
              {conflictedRes.slice(0, 5).map((r: any) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px', borderBottom: '1px solid #14263F' }}>
                  <span style={{ fontSize: 12.5, color: '#FCD34D', minWidth: 180 }}>{r.name}</span>
                  <span style={{ fontSize: 11.5, color: '#8FA3BD', flex: 1 }}>перекрытие {r.overlap_days} дн · {(r.conflicts || []).map((c: any) => c.a + ' × ' + c.b).join(', ')}</span>
                  <button onClick={() => { setOccId(String(r.id)); setTab('occupancy'); }} style={{
                    background: 'rgba(52,211,153,.10)', border: '1px solid rgba(52,211,153,.4)', color: '#86EFAC',
                    borderRadius: 6, padding: '2px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  }}>Показать карту</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'resources' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>⚠ Ресурсы и конфликты — {sharedN} общих{conflictedN ? ', ' + conflictedN + ' конфликтных' : ''}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => setOnlyConflicts(false)} style={{
                  padding: '4px 10px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6,
                  border: '1px solid ' + (onlyConflicts === false ? 'rgba(59,130,246,.6)' : '#1E3252'),
                  background: onlyConflicts === false ? 'rgba(59,130,246,.15)' : 'transparent',
                  color: onlyConflicts === false ? '#93C5FD' : '#8FA3BD',
                }}>Все ({sharedRes.length})</button>
                <button onClick={() => setOnlyConflicts(true)} style={{
                  padding: '4px 10px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6,
                  border: '1px solid ' + (onlyConflicts === true ? 'rgba(59,130,246,.6)' : '#1E3252'),
                  background: onlyConflicts === true ? 'rgba(59,130,246,.15)' : 'transparent',
                  color: onlyConflicts === true ? '#93C5FD' : '#8FA3BD',
                }}>Только конфликтные ({conflictedN})</button>
              </div>
            </div>

            {sharedRes.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                <thead>
                  <tr style={{ color: '#5A7090', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>Ресурс</th>
                    <th style={{ padding: '4px 8px' }}>Проекты</th>
                    <th style={{ padding: '4px 8px' }}>Загрузка</th>
                    <th style={{ padding: '4px 8px' }}>Пересечение</th>
                    <th style={{ padding: '4px 8px' }}>Конфликты и действия</th>
                  </tr>
                </thead>
                <tbody>
                  {sharedRes.filter((r: any) => !onlyConflicts || r.has_conflict).map((r: any) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #1E3252', color: r.has_conflict ? '#FCD34D' : '#E8EEF5' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                        <span onClick={() => { if (onOpenResourceEdit) { onOpenResourceEdit(String(r.id)); } else { setOccId(String(r.id)); setTab('occupancy'); } }}
                          title="Карточка ресурса: открыть и отредактировать"
                          style={{ cursor: 'pointer', borderBottom: '1px dotted rgba(96,165,250,.6)' }}>{r.name}</span>
                      </td>
                      <td style={{ padding: '6px 8px', color: '#8FA3BD' }}>{(r.assignments || []).map((a: any) => a.project_name).join(', ') || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.total_text}</td>
                      <td style={{ padding: '6px 8px', color: r.has_conflict ? '#FCD34D' : '#5A7090' }}>{r.overlap_days ? r.overlap_days + ' дн' : '—'}</td>
                      <td style={{ padding: '6px 8px', color: '#8FA3BD' }}>
                        {(r.conflicts || []).slice(0, 2).map((c: any) => c.a + ' × ' + c.b + ' (' + c.days + ' дн' + ((c.a_exclusive || c.b_exclusive) ? ', экскл.' : '') + ')').join('; ') || '—'}
                        {r.has_conflict && (r.conflicts || [])[0] && (
                          <button onClick={() => suggestShift(String((r.conflicts || [])[0].a_id))} disabled={sugBusy}
                            style={{ marginLeft: 8, background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{sugBusy && sugFor === String((r.conflicts || [])[0].a_id) ? 'Считаю…' : 'Предложить сдвиг'}</button>
                        )}
                        <button onClick={() => { setOccId(String(r.id)); setTab('occupancy'); }}
                          style={{ marginLeft: 8, background: 'rgba(52,211,153,.10)', border: '1px solid rgba(52,211,153,.7)', color: '#86EFAC', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>📅 Карта занятости</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 12, color: '#8FA3BD', marginTop: 10 }}>Общих ресурсов пока нет.</div>
            )}

          {suggestion && (
            <div ref={sugRef} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: suggestion.has_conflict ? '#FCD34D' : '#8FA3BD', flexWrap: 'wrap' }}>
              {suggestion.has_conflict ? (
                <>
                  <span>💡 {suggestion.suggestion?.message}</span>
                  {suggestion.suggestion?.new_finish ? <span>· новый финиш: {String(suggestion.suggestion.new_finish).slice(0, 10)}</span> : null}
                  {(suggestion.plan || []).length > 0 && (
                    <div style={{ width: '100%', fontSize: 11.5, color: '#8FA3BD' }}>
                      План: {(suggestion.plan || []).map((x: any) => `${x.resource_name} (освободится ${(x.busy_until || x.free_at) ? String(x.busy_until || x.free_at).slice(0, 10) : '?'}, с ${x.other_projects.join('/')}, перекрытие ${x.overlap_days} дн)`).join('; ')}
                    </div>
                  )}
                  {suggestion.priority?.recommendation === 'shift_other' && suggestion.priority?.target_project && !suggestion.applied ? (
                    <button onClick={applyShiftOther} disabled={sugBusy}
                      style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Ваш проект важнее — сдвинуть «{suggestion.priority.target_project.project_name}»
                    </button>
                  ) : null}
                  {!suggestion.applied && (
                    <button onClick={applyShift} disabled={sugBusy}
                      style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.4)', color: '#86EFAC', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Применить сдвиг мне</button>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: shiftAuto ? '#86EFAC' : '#8FA3BD', cursor: 'pointer' }}>
                    <input type="checkbox" checked={shiftAuto} onChange={(e) => { const v = e.target.checked; setShiftAuto(v); try { localStorage.setItem('profyplan_ccm_shift_auto', v ? '1' : ''); } catch { /* noop */ } }} />
                    Сдвигать сразу, вместе с заказами {shiftAuto ? '(без шагов)' : '(по шагам)'}
                  </label>
                  <span style={{ color: '#5A7090', fontSize: 11.5 }}>мой приоритет:</span>
                  <select value={(suggestion.priority?.mine || 'normal')} disabled={sugBusy}
                    onChange={(e) => setMyPriority(String(suggestion.project_id), e.target.value)}
                    style={{ background: '#0F1E36', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '3px 6px', fontSize: 11.5 }}>
                    <option value="low">низкий</option>
                    <option value="normal">обычный</option>
                    <option value="high">высокий</option>
                  </select>
                  {suggestion.applied && <span style={{ color: '#86EFAC' }}>{suggestion.appliedOther ? 'сдвинут другой проект' : 'сдвиг применён'}{suggestion.ordersInfo?.shifted ? ' · заказов: ' + suggestion.ordersInfo.shifted : ''}{suggestion.ordersInfo?.skipped ? ' · пропущено: ' + suggestion.ordersInfo.skipped : ''}</span>}
                  <button onClick={() => setSuggestion(null)}
                    style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Скрыть</button>
                </>
              ) : (
                <span>Для этого проекта конфликтов по общим ресурсам нет.</span>
              )}
            </div>
          )}

          {stepPanel && (
            <div style={{ marginTop: 10, maxWidth: 980, border: '1px solid #1E3252', borderRadius: 10, background: '#0C1B31', padding: '10px 14px' }}>
              {stepPanel.step === 1 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#93C5FD' }}>↔ Сдвиг с заказами · шаг 1 — проверка</span>
                    <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>«{stepPanel.preview?.project_name}» · старт {fmtD(stepPanel.preview?.old_start)} → {fmtD(stepPanel.preview?.new_start)} (+{stepPanel.preview?.days ?? 0} дн)</span>
                  </div>
                  {stepPanel.preview?.warning ? (<div style={{ fontSize: 11.5, color: '#FCD34D', marginBottom: 4 }}>⚠ {stepPanel.preview.warning}</div>) : null}
                  {(stepPanel.preview?.bushes || []).map((b: any) => (
                    <div key={b.root_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 2px', borderBottom: '1px solid #14263F', fontSize: 12, flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 230, fontWeight: 600, color: '#CBD5E1' }}>🌳 {b.title}</span>
                      <span style={{ color: '#8FA3BD' }}>заказов: {b.orders_total}</span>
                      <span style={{ color: '#93C5FD' }}>{b.window_before ? fmtD(b.window_before[0]) + ' – ' + fmtD(b.window_before[1]) : '—'} → {b.window_after ? fmtD(b.window_after[0]) + ' – ' + fmtD(b.window_after[1]) : '—'}</span>
                      {b.orders_skipped > 0 ? <span style={{ color: '#FCD34D' }}>не поедет: {b.orders_skipped}</span> : <span style={{ color: '#86EFAC' }}>поедет весь</span>}
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>Перенесётся заказов: {stepPanel.preview?.totals?.orders_shifted ?? 0} · пропустится: {stepPanel.preview?.totals?.orders_skipped ?? 0}</span>
                    <button onClick={openShiftGraphPreview}
                      title="Посмотреть «до/после» на графике"
                      style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.45)', color: '#C4B5FD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>📊 График сдвига</button>
                    <button onClick={() => setStepPanel((p: any) => ({ ...p, step: 2 }))} disabled={sugBusy}
                      style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.4)', color: '#86EFAC', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Дальше: применение</button>
                    <button onClick={() => setStepPanel(null)}
                      style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
                  </div>
                </>
              )}
              {stepPanel.step === 2 && (
                <>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#93C5FD', marginBottom: 6 }}>↔ Сдвиг с заказами · шаг 2 — что сдвигаем</div>
                  {(stepPanel.preview?.bushes || []).map((b: any) => (
                    <div key={b.root_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 2px', borderBottom: '1px solid #14263F', fontSize: 12, flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 230, fontWeight: 600, color: '#CBD5E1' }}>🌳 {b.title}</span>
                      <span style={{ color: '#93C5FD' }}>{b.window_before ? fmtD(b.window_before[0]) + ' – ' + fmtD(b.window_before[1]) : '—'} → {b.window_after ? fmtD(b.window_after[0]) + ' – ' + fmtD(b.window_after[1]) : '—'}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        <button onClick={() => applyContourShift(stepPanel.project_id, stepPanel.new_start, stepPanel.kind, stepPanel.days, false, [b.root_id])} disabled={sugBusy || !b.orders_shifted}
                          title="Перенести только этот куст (дата старта проекта не меняется)"
                          style={{ background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', opacity: b.orders_shifted ? 1 : 0.5 }}>Сдвинуть куст</button>
                      </span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => applyContourShift(stepPanel.project_id, stepPanel.new_start, stepPanel.kind, stepPanel.days, true, null)} disabled={sugBusy}
                      style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.4)', color: '#86EFAC', borderRadius: 6, padding: '3px 12px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Сдвинуть всё (проект + заказы)</button>
                    <button onClick={() => setStepPanel((p: any) => ({ ...p, step: 1 }))} disabled={sugBusy}
                      style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Назад</button>
                    <button onClick={() => setStepPanel(null)} disabled={sugBusy}
                      style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
                  </div>
                </>
              )}
              {stepPanel.step === 3 && (
                <>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#86EFAC', marginBottom: 4 }}>✓ Сдвиг применён</div>
                  <div style={{ fontSize: 11.5, color: '#8FA3BD' }}>
                    Перенесено заказов: {stepPanel.result?.orders_shifted ?? 0}{stepPanel.result?.scope === 'roots' ? ' (выборочно — куст)' : ' (весь проект)'} · пропущено: {stepPanel.result?.orders_skipped ?? 0}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => setStepPanel(null)}
                      style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.4)', color: '#86EFAC', borderRadius: 6, padding: '3px 12px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Готово</button>
                  </div>
                </>
              )}
            </div>
          )}

            {shiftsLog.length > 0 && (
              <div style={{ marginTop: 16, maxWidth: 980 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 4 }}>↔ Сдвиги (журнал): {shiftsLog.length}</div>
                {shiftsLog.map((s: any) => {
                  const blocked = !s.reverted && shiftsLog.some((o: any) => !o.reverted && o.project_id === s.project_id && String(o.created_at) > String(s.created_at));
                  return (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 2px', borderBottom: '1px solid #14263F', fontSize: 12, color: s.reverted ? '#5A7090' : '#CBD5E1', flexWrap: 'wrap' }}>
                      <span style={{ width: 118, color: '#8FA3BD' }}>{fmtDT(s.created_at)}</span>
                      <span style={{ minWidth: 170, fontWeight: 600 }}>«{s.project_name}»</span>
                      <span style={{ color: s.kind === 'other' ? '#FCD34D' : '#93C5FD' }}>{s.kind === 'other' ? 'сдвиг другому' : 'свой сдвиг'} · +{s.shift_days} дн{s.orders_shifted ? ' · заказов: ' + s.orders_shifted + (s.scope === 'roots' ? ' (куст)' : '') : ''}{s.orders_skipped ? ' · пропущено: ' + s.orders_skipped : ''}</span>
                      {s.scope === 'roots' ? <span style={{ color: '#8FA3BD' }} title="Сдвиг куста не меняет дату старта проекта">старт проекта не менялся</span> : <span style={{ color: '#8FA3BD' }}>старт {fmtD(s.old_start)} → {fmtD(s.new_start)}</span>}
                      <span style={{ marginLeft: 'auto' }}>
                        <button onClick={() => openShiftGraph(s)} disabled={sgBusy}
                          title="График сдвига: было → стало (заказы, зона сдвига)"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.45)', color: '#C4B5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginRight: 6 }}>📊 График</button>
                        {s.reverted ? (
                          <span style={{ color: '#5A7090' }}>(возвращено)</span>
                        ) : (
                          <button onClick={() => revertShift(s.id)} disabled={blocked || sugBusy}
                            title={blocked ? 'Сначала верните более поздние сдвиги этого проекта' : (s.scope === 'roots' ? 'Вернуть даты заказов куста как было (с автопересчётом)' : 'Вернуть старт и даты заказов как было (с автопересчётом)')}
                            style={{ background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: blocked ? 'default' : 'pointer', fontFamily: 'inherit', opacity: blocked ? 0.5 : 1 }}>Вернуть</button>
                        )}
                      </span>
                    </div>
                  );
                })}
                <div style={{ fontSize: 11, color: '#5A7090', marginTop: 4 }}>После каждого сдвига и возврата проект пересчитывается автоматически — свежий запуск виден в «Запусках» проекта.</div>
              </div>
            )}

            {recalcList.length > 0 && (
              <div style={{ marginTop: 16, maxWidth: 980 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>⟳ Пересчёт проектов сдвига — по хронологии занятости ресурсов</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: autoRecalc ? '#86EFAC' : '#8FA3BD', cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoRecalc} onChange={(e) => { const v = e.target.checked; setAutoRecalc(v); try { localStorage.setItem('profyplan_ccm_autorecalc', v ? '1' : ''); } catch { /* noop */ } }} />
                    Автопересчёт после сдвигов {autoRecalc ? '(включён)' : '(ручной режим)'}
                  </label>
                  <button onClick={recalcAllShiftProjects} disabled={sugBusy || !recalcList.some((x: any) => x.state !== 'reverted')}
                    style={{ background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Пересчитать все по порядку</button>
                </div>
                {recalcList.map((r: any, i: number) => (
                  <div key={r.project_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 2px', borderBottom: '1px solid #14263F', fontSize: 12, color: r.state === 'reverted' ? '#5A7090' : '#CBD5E1', flexWrap: 'wrap' }}>
                    <span style={{ width: 22, color: '#5A7090' }}>{i + 1}.</span>
                    <span style={{ minWidth: 180, fontWeight: 600 }}>«{r.project_name}»</span>
                    <span style={{ color: '#8FA3BD' }}>занимает ресурсы с {fmtD(r.start_date)}</span>
                    <span style={{ color: r.state === 'reverted' ? '#5A7090' : (r.needs_recalc ? '#FCD34D' : '#86EFAC') }}>
                      {r.state === 'reverted' ? 'сдвиг возвращён' : r.needs_recalc ? '⚠ требует пересчёта' : '✓ пересчитан ' + fmtDT(r.last_run_at)}
                    </span>
                    <span style={{ marginLeft: 'auto' }}>
                      <button onClick={() => recalcProject(r.project_id)} disabled={sugBusy}
                        title="Пересчитать проект (создать запуск расчёта)"
                        style={{ background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Пересчитать</button>
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: '#5A7090', marginTop: 4 }}>Пересчитывать сверху вниз: более ранние проекты задают занятость общих ресурсов для более поздних. Галка «Автопересчёт» делает это автоматически после каждого сдвига.</div>
              </div>
            )}

            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: 'pointer', color: '#8FA3BD', fontSize: 12.5, fontWeight: 600 }}>Статистика по всем ресурсам ({resourceUsage.length}) — план, события, потери, выработка</summary>
              {resourceUsage.length > 0 && (
<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#5A7090', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Ресурс</th>
                <th style={{ padding: '4px 8px' }}>Тип</th>
                <th style={{ padding: '4px 8px' }}>Мощность</th>
                <th style={{ padding: '4px 8px' }}>Проекты</th>
                <th style={{ padding: '4px 8px' }}>План</th>
                <th style={{ padding: '4px 8px' }}>Мощность</th>
                <th style={{ padding: '4px 8px' }}>С событиями</th>
                <th style={{ padding: '4px 8px' }}>Потери</th>
                <th style={{ padding: '4px 8px' }}>Выработка</th>
                <th style={{ padding: '4px 8px' }}>Оп.</th>
                <th style={{ padding: '4px 8px' }}>Совм.</th>
              </tr>
            </thead>
            <tbody>
              {resourceUsage.map((r: any) => (
                <tr key={r.id} style={{ borderTop: '1px solid #1E3252', color: r.is_shared ? '#FCD34D' : '#E8EEF5' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '4px 8px', color: '#8FA3BD' }}>{r.type || '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#8FA3BD' }}>{r.capacity_per_unit || '—'} {r.capacity_unit || ''}</td>
                  <td style={{ padding: '4px 8px', color: '#8FA3BD' }}>{r.projects.join(', ') || '—'}</td>
                  <td style={{ padding: '4px 8px' }} title={'Событий: ' + (r.events_count || 0)}>{r.total_text || (r.total_hours + ' ч')}</td>
                  <td style={{ padding: '4px 8px', color: (r.capacity_factor && r.capacity_factor !== 1 ? '#FCD34D' : '#8FA3BD') }}
                    title={'Коэффициент мощности: ×' + (r.capacity_factor ?? 1)}>
                    {r.capacity_text || '—'}{r.capacity_factor && r.capacity_factor !== 1 ? ' (×' + r.capacity_factor + ')' : ''}
                  </td>
                  <td style={{ padding: '4px 8px', color: '#93C5FD' }}>{r.effective_text || '—'}</td>
                  <td style={{ padding: '4px 8px', color: (r.lost_hours ? '#FCA5A5' : '#5A7090') }}
                    title={(r.lost_by_reason || []).map((x: any) => x.reason + ': ' + x.text).join('; ')}>
                    {r.lost_hours ? r.lost_text : '—'}
                  </td>
                  <td style={{ padding: '4px 8px', color: (r.extra_hours ? '#86EFAC' : '#5A7090') }}>{r.extra_hours ? r.extra_text : '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#8FA3BD' }}>{r.operation_count}</td>
                  <td style={{ padding: '4px 8px' }}>
                    {r.is_shared ? <span style={{ color: '#FCD34D', fontWeight: 700 }}>⚠ общий</span> : <span style={{ color: '#5A7090' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
              )}
            </details>
          </div>
        )}

        {tab === 'occupancy' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 24px' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 280, flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', margin: '6px 0 6px' }}>Общие ресурсы — выберите</div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {sharedRes.map((r: any) => (
                    <button key={r.id} onClick={() => setOccId(String(r.id))} style={{
                      textAlign: 'left', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                      background: occId === String(r.id) ? 'rgba(52,211,153,.14)' : 'transparent',
                      border: '1px solid ' + (occId === String(r.id) ? 'rgba(52,211,153,.5)' : '#1E3252'),
                      color: r.has_conflict ? '#FCD34D' : '#CBD5E1',
                    }}>
                      {r.name}{r.has_conflict ? ' ⚠' : ''}
                      <span style={{ display: 'block', fontSize: 10.5, color: '#5A7090', fontWeight: 400, marginTop: 1 }}>{r.total_text}{r.overlap_days ? ' · перекрытие ' + r.overlap_days + ' дн' : ''}</span>
                    </button>
                  ))}
                  {sharedRes.length === 0 && <div style={{ fontSize: 12, color: '#8FA3BD' }}>Нет общих ресурсов.</div>}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {occ && occ.empty === true && (
                  <div ref={occRef} style={{ border: '1px solid #1E3252', borderRadius: 10, background: '#0C1B31', padding: '12px 14px', fontSize: 12, color: '#8FA3BD' }}>
                    📅 Карта занятости: нет интервалов — у проектов не заполнены даты (старт / плановый финиш).
                  </div>
                )}
                {occ && occ.empty === false && (
                  <div ref={occRef} style={{ border: '1px solid #1E3252', borderRadius: 10, background: '#0C1B31', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#93C5FD' }}>📅 Карта занятости: {occ.r.name}</span>
                      <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>проектов: {occ.list.length}{((occ.r.assignments || []).length - occ.list.length) > 0 ? ' (+' + ((occ.r.assignments || []).length - occ.list.length) + ' без дат)' : ''} · загрузка: {occ.r.total_text}</span>
                      <span style={{ fontSize: 11.5, color: occ.covering ? '#FCD34D' : '#86EFAC' }}>
                        {occ.covering ? ('сейчас занят до ' + fmtDm(occ.covering[1])) : occ.nextFrom ? ('свободен до ' + fmtDm(occ.nextFrom[0])) : 'свободен — брони завершены'}
                      </span>
                      {mapFocus && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#93C5FD', border: '1px solid rgba(96,165,250,.4)', borderRadius: 100, padding: '1px 8px' }}>
                          подсвечены заказы сдвига
                          <button onClick={() => setMapFocus(null)} title="Снять подсветку" style={{ background: 'transparent', border: 'none', color: '#93C5FD', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, padding: 0 }}>×</button>
                        </span>
                      )}
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#CBD5E1', cursor: 'pointer', marginLeft: 'auto' }}
                        title="Пунктиром — где заказы были до активных сдвигов (по журналу)">
                        <input type="checkbox" checked={ghosts} onChange={(e) => { const v = e.target.checked; setGhosts(v); try { localStorage.setItem('profyplan_ccm_ghosts', v ? '1' : '0'); } catch { /* noop */ } }} style={{ accentColor: '#94A3B8' }} />
                        Показать «как было»{ghosts && ghostsData ? (ghostsData.loading ? ' · загрузка…' : (ghostsData.n ? ' · заказов: ' + ghostsData.n : ' · активных сдвигов нет')) : ''}
                      </label>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#5A7090', marginBottom: 4, paddingLeft: 215, paddingRight: 159 }}>
                      <span>{fmtDm(occ.minI)}</span>
                      <span>{fmtDm(occ.maxI)}</span>
                    </div>
                    <div style={{ position: 'relative', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, padding: '6px 8px' }}>
                      <div style={{ position: 'absolute', left: 206, right: 150, top: 0, bottom: 0 }}>
                        {occ.free.map(([s0, e0]: [number, number], i: number) => (
                          <div key={'f' + i} title={'свободно: ' + fmtDm(s0) + ' — ' + fmtDm(e0)}
                            style={{ position: 'absolute', left: ((s0 - occ.minI) / occ.span * 100) + '%', width: ((e0 - s0) / occ.span * 100) + '%', top: 0, bottom: 0, background: 'rgba(52,211,153,.10)', borderLeft: '1px dashed rgba(52,211,153,.45)', borderRight: '1px dashed rgba(52,211,153,.45)' }} />
                        ))}
                        {occ.ovz.map(([s0, e0]: [number, number], i: number) => (
                          <div key={'o' + i} title={'пересечение броней: ' + fmtDm(s0) + ' — ' + fmtDm(e0)}
                            style={{ position: 'absolute', left: ((s0 - occ.minI) / occ.span * 100) + '%', width: ((e0 - s0) / occ.span * 100) + '%', top: 0, bottom: 0, background: 'rgba(245,158,11,.12)' }} />
                        ))}
                      </div>
                      {occ.list.map((a: any) => {
                        const ords = ordersByProject[String(a.project_id) + '|' + String(occId)];
                        const exp = !!expOrders[String(a.project_id)];
                        return (
                          <div key={a.project_id}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                              <button onClick={() => setExpOrders((m) => ({ ...m, [String(a.project_id)]: !exp }))}
                                title={a.project_name + ' — нажмите, чтобы раскрыть заказы с этим ресурсом'}
                                style={{ fontSize: 11, color: '#CBD5E1', width: 190, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', background: 'transparent', border: 'none', textAlign: 'left', padding: 0, fontFamily: 'inherit' }}>
                                <span style={{ color: '#5A7090', fontSize: 9 }}>{exp ? '▼' : '▶'} </span>{a.project_name}
                                {ords && ords.length > 0 ? <span style={{ color: '#5A7090', fontSize: 10 }}> · {ords.length}</span> : null}
                              </button>
                              <div style={{ position: 'relative', flex: 1, height: 12, background: 'rgba(15,30,54,.7)', borderRadius: 3 }}>
                                <div title={a.project_name + ': ' + fmtDm(a.s) + ' — ' + fmtDm(a.f) + ' · ' + (a.hours_text || '') + (a.capacity_share && a.capacity_share !== 1 ? ' · доля мощности ×' + a.capacity_share : '') + (a.exclusive ? ' · эксклюзивная бронь' : '')}
                                  style={{ position: 'absolute', left: ((a.s - occ.minI) / occ.span * 100) + '%', width: Math.max(((a.f - a.s) / occ.span) * 100, 0.8) + '%', top: 0, height: '100%', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />
                              </div>
                              <span style={{ fontSize: 10.5, color: '#8FA3BD', width: 142, textAlign: 'right', flexShrink: 0 }}>{fmtDm(a.s)}–{fmtDm(a.f)}</span>
                            </div>
                            {exp && (
                              <div style={{ margin: '2px 0 4px' }}>
                                {!ords && <div style={{ padding: '1px 0 1px 14px', fontSize: 10.5, color: '#5A7090' }}>загрузка…</div>}
                                {ords && ords.length === 0 && <div style={{ padding: '1px 0 1px 14px', fontSize: 10.5, color: '#5A7090' }}>нет заказов с этим ресурсом</div>}
                                {(ords || []).map((o: any) => {
                                  const s0 = parseMs(o.start_date);
                                  const f0 = parseMs(o.due_date);
                                  const has = s0 != null && f0 != null && (f0 as number) > (s0 as number);
                                  const vs = has ? Math.max(s0 as number, occ.minI) : 0;
                                  const vf = has ? Math.min(f0 as number, occ.maxI) : 0;
                                  const vis = has && vf > vs;
                                  const outPrj = has && ((s0 as number) < a.s || (f0 as number) > a.f);
                                  return (
                                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1px 0', ...(mapFocus && mapFocus.orderIds && mapFocus.orderIds.indexOf(String(o.id)) >= 0 ? { background: 'rgba(96,165,250,.07)', borderRadius: 4, boxShadow: '0 0 0 1px rgba(96,165,250,.35)' } : {}) }}>
                                      <span style={{ width: 190, flexShrink: 0, paddingLeft: 14, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                        <span style={{ color: '#5A7090', fontSize: 10 }}>↳ </span>
                                        <span onClick={() => { if (onOpenOrder) onOpenOrder(o); }} title="Открыть окно заказа"
                                          style={{ fontSize: 10.5, color: '#93C5FD', cursor: onOpenOrder ? 'pointer' : 'default', borderBottom: '1px dotted rgba(96,165,250,.6)' }}>{orderLabel(o)}</span>
                                      </span>
                                      <div style={{ position: 'relative', flex: 1, height: 8, background: 'rgba(15,30,54,.7)', borderRadius: 3 }}>
                                        {ghosts && has && (() => {
                                          const gl = ghostsData?.byOrder?.[String(o.id)];
                                          if (!gl || !gl.length) return null;
                                          let g0: any = null;
                                          for (const gx of gl) { if (!g0 || String(gx.created || '') < String(g0.created || '')) g0 = gx; }
                                          const gs0 = parseMs(g0.oldStart); const gf0 = parseMs(g0.oldDue);
                                          if (gs0 == null || gf0 == null || (gf0 as number) <= (gs0 as number)) return null;
                                          const gvs = Math.max(gs0 as number, occ.minI); const gvf = Math.min(gf0 as number, occ.maxI);
                                          if (gvf <= gvs) return null;
                                          const dd0 = Math.round(((s0 as number) - (gs0 as number)) / MS_DAY);
                                          return <div title={'Было до сдвига' + (gl.length > 1 ? ' (записей: ' + gl.length + ')' : '') + ': ' + fmtDm(gs0 as number) + ' — ' + fmtDm(gf0 as number) + (dd0 ? ' · сдвинуто на ' + (dd0 > 0 ? '+' : '') + dd0 + ' дн' : '')}
                                            style={{ position: 'absolute', left: ((gvs - occ.minI) / occ.span * 100) + '%', width: Math.max(((gvf - gvs) / occ.span) * 100, 0.4) + '%', top: -2, bottom: -2, borderRadius: 3, background: 'rgba(148,163,184,.08)', border: '1px dashed rgba(148,163,184,.7)' }} />;
                                        })()}
                                        {vis && <div title={orderLabel(o) + ': ' + fmtDm(s0 as number) + ' — ' + fmtDm(f0 as number) + ((s0 as number) < occ.minI ? ' · начало раньше диапазона карты' : '') + ((f0 as number) > occ.maxI ? ' · финиш позже диапазона карты' : '')}
                                          style={{ position: 'absolute', left: ((vs - occ.minI) / occ.span * 100) + '%', width: Math.max(((vf - vs) / occ.span) * 100, 0.5) + '%', top: 0, height: '100%', borderRadius: 3, background: 'rgba(34,211,238,.32)', border: '1px solid rgba(34,211,238,.65)' }} />}
                                        {!has && <span style={{ position: 'absolute', left: 4, top: -3, fontSize: 9.5, color: '#5A7090' }}>нет дат</span>}
                                        {has && !vis && <span style={{ position: 'absolute', left: 4, top: -3, fontSize: 9.5, color: '#5A7090' }}>вне диапазона карты ({fmtDmShort(s0 as number)}–{fmtDmShort(f0 as number)})</span>}
                                      </div>
                                      <span style={{ fontSize: 10, color: '#8FA3BD', width: 142, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{outPrj ? <span title={'Заказ выходит за окно проекта (' + fmtDm(a.s) + ' – ' + fmtDm(a.f) + ')'} style={{ color: '#FCD34D', marginRight: 4 }}>⚠</span> : null}{has ? fmtDm(s0 as number) + '–' + fmtDm(f0 as number) : '—'}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {(occ.r.queue || []).length >= 2 && (
                      <div style={{ marginTop: 8, borderTop: '1px solid #1E3252', paddingTop: 6 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8FA3BD', marginBottom: 3 }}>Очередь на ресурс — приоритет заказа (Срочный → Высокий → обычные) → ранний старт → FIFO</div>
                        {(occ.r.queue || []).map((q: any, i: number) => (
                          <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, padding: '1px 0', flexWrap: 'wrap' }}>
                            <span style={{ color: '#5A7090', minWidth: 16 }}>{i + 1}.</span>
                            <button onClick={() => { if (onOpenOrder) onOpenOrder(q); }} title="Открыть окно заказа"
                              style={{ color: '#93C5FD', cursor: onOpenOrder ? 'pointer' : 'default', background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', borderBottom: '1px dotted rgba(96,165,250,.6)' }}>{orderLabel(q)}</button>
                            <span style={{ color: '#8FA3BD' }}>{q.project_name}</span>
                            <span style={{ color: q.priority === 'critical' ? '#FCA5A5' : (q.priority === 'high' ? '#86EFAC' : (q.priority === 'low' ? '#5A7090' : '#CBD5E1')) }}>{q.priority_label || q.priority}</span>
                            <span style={{ color: '#5A7090' }}>{q.start_date ? 'с ' + fmtDm(parseMs(q.start_date) as number) : 'без дат'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 6 }}>
                      Свободные окна: {occ.free.length ? occ.free.map(([s0, e0]: [number, number]) => fmtDm(s0) + ' – ' + fmtDm(e0) + ' (' + Math.round((e0 - s0) / MS_DAY) + ' дн)').join(' · ') : 'нет — ресурс занят весь период'}
                    </div>
                    <div style={{ fontSize: 11, color: '#5A7090', marginTop: 4 }}>Бронь — окно проекта (старт → плановый финиш); перекрытия подсвечены. Нажмите на проект — раскроются его заказы с этим ресурсом (полоска — окно заказа); ⚠ — заказ выходит за окно проекта. Галка «Показать „как было“» — пунктиром старые положения заказов (до активных сдвигов из журнала). Следующий куст можно ставить в свободные окна.</div>
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8FA3BD', marginBottom: 4 }}>Проекты и заказы на карте — только заказы с этим ресурсом в маршруте{ordersLoading ? ' · загрузка…' : ''}</div>
                      {occ.list.map((a: any) => {
                        const ords = ordersByProject[String(a.project_id) + '|' + String(occId)];
                        return (
                          <div key={'ord-' + a.project_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '4px 2px', borderBottom: '1px solid #14263F', fontSize: 11.5, flexWrap: 'wrap' }}>
                            <span style={{ minWidth: 180, color: '#CBD5E1', fontWeight: 600 }}>{a.project_name}</span>
                            <span style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {!ords && <span style={{ color: '#5A7090' }}>загрузка…</span>}
                              {ords && ords.length === 0 && <span style={{ color: '#5A7090' }}>нет заказов с этим ресурсом</span>}
                              {(ords || []).map((o: any) => (
                                <button key={o.id} onClick={() => { if (onOpenOrder) onOpenOrder(o); }}
                                  title="Открыть окно заказа"
                                  style={{ background: 'rgba(59,130,246,.10)', border: '1px solid rgba(59,130,246,.35)', color: '#93C5FD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: onOpenOrder ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                                  {orderLabel(o)}
                                </button>
                              ))}
                            </span>
                            <span style={{ color: '#8FA3BD', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtDm(a.s)}–{fmtDm(a.f)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!occ && (
                  <div style={{ border: '1px dashed #2B405E', borderRadius: 10, padding: '18px 16px', fontSize: 12.5, color: '#8FA3BD' }}>
                    Выберите ресурс слева — покажем брони по проектам, перекрытия и свободные окна.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'shiftgraph' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 20px 12px', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>Сводный график сдвигов — все проекты на одном таймлайне</div>
              <span style={{ fontSize: 11.5, color: '#5A7090' }}>пунктир — «было», плотная полоса — «стало»; «▸ оп.» — операции; прокручивается только графика, колонки слева и справа закреплены</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => setSgZoom((z) => Math.max(1, Math.round(z / 2)))} disabled={sgZoom <= 1} title="Уменьшить масштаб"
                  style={{ background: sgZoom <= 1 ? 'transparent' : 'rgba(148,163,184,.10)', border: '1px solid rgba(148,163,184,.3)', color: sgZoom <= 1 ? '#5A7090' : '#CBD5E1', borderRadius: 6, padding: '2px 10px', fontSize: 12.5, cursor: sgZoom <= 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>−</button>
                <span style={{ fontSize: 11, color: '#8FA3BD', minWidth: 48, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>×{sgZoom}</span>
                <button onClick={() => setSgZoom((z) => Math.min(1024, z * 2))} disabled={sgZoom >= 1024} title="Увеличить масштаб"
                  style={{ background: 'rgba(148,163,184,.10)', border: '1px solid rgba(148,163,184,.3)', color: '#CBD5E1', borderRadius: 6, padding: '2px 10px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>＋</button>
                <button onClick={() => setSgZoom(1)} title="Автомасштаб: показать весь период по ширине"
                  style={{ background: sgZoom === 1 ? 'rgba(52,211,153,.12)' : 'rgba(148,163,184,.10)', border: '1px solid ' + (sgZoom === 1 ? 'rgba(52,211,153,.5)' : 'rgba(148,163,184,.3)'), color: sgZoom === 1 ? '#86EFAC' : '#CBD5E1', borderRadius: 6, padding: '2px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>⤢ Авто</button>
              </div>
            </div>
            <div ref={sgWrapRef} style={{ flex: 1, minHeight: 0, border: '1px solid #1E3252', borderRadius: 10, overflow: 'hidden', background: '#0C1B31', display: 'flex' }}>
              {shiftsLog.length === 0 && (
                <div style={{ margin: 12, border: '1px dashed #2B405E', borderRadius: 10, padding: '18px 16px', fontSize: 12.5, color: '#8FA3BD' }}>
                  Сдвигов пока нет — картина появится здесь после применения сдвига («Ресурсы и конфликты» → «Предложить сдвиг»).
                </div>
              )}
              {shiftsLog.length > 0 && (!sgTabData || sgTabData.loading) && (
                <div style={{ fontSize: 12, color: '#8FA3BD', padding: '12px 14px' }}>Загрузка сдвигов…</div>
              )}
              {sgTabData && sgTabData.err && (
                <div style={{ fontSize: 12, color: '#FCA5A5', padding: '12px 14px' }}>Не удалось собрать картину: {sgTabData.err}</div>
              )}
              {sgTabData && sgTabData.blocks && sgTabData.blocks.length > 0 && (() => {
                const b = sgTabData;
                const mn0 = b.mn != null ? b.mn : 0;
                const mx0 = b.mx != null ? b.mx : (b.mn != null ? b.mn + MS_DAY : MS_DAY);
                const span0 = (mx0 - mn0) || MS_DAY;
                const spanMin = span0 / 60000;
                const SGC_LEFT = 268;
                const SGC_RIGHT = 216;
                const RULER_H = 36;
                const H_ORDER = 19;
                const H_OPSMSG = 15;
                const H_OP = 14;
                const H_BLOCK = 28;
                const H_START = 15;
                const H_EMPTY = 17;
                const chartW = Math.max(320, (sgWrapW - SGC_LEFT - SGC_RIGHT - 6) * sgZoom);
                const pxPerMin = chartW / Math.max(spanMin, 1);
                const px = (v: number) => ((v - mn0) / span0) * chartW;
                const pr = (arr: any) => {
                  const s0 = arr && arr[0] != null ? arr[0] : (arr && arr[1] != null ? arr[1] : null);
                  const f0 = arr && arr[1] != null ? arr[1] : s0;
                  return (s0 == null || f0 == null) ? null : [s0, f0];
                };
                const pickStep = (minPx: number, maxCount: number) => {
                  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 7200, 21600, 43200, 86400, 172800, 604800];
                  for (const st of steps) { if (st * pxPerMin >= minPx && spanMin / st <= maxCount) return st; }
                  return 604800;
                };
                const lblStep = pickStep(36, 60);
                const gridStep = pickStep(7, 2000);
                const gridPx = Math.max(gridStep * pxPerMin, 4);
                const pdd = (ms: number) => { const d = new Date(ms); return (d.getDate() < 10 ? '0' : '') + d.getDate() + '.' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2); };
                const pHHMM = (ms: number) => { const d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };
                const tickLbl = (ms: number) => {
                  const d = new Date(ms);
                  if (lblStep < 60) return d.getMinutes() === 0 ? (d.getHours() === 0 ? pdd(ms) : pHHMM(ms)) : pHHMM(ms);
                  if (lblStep < 1440) return d.getHours() === 0 ? pdd(ms) : pHHMM(ms);
                  return pdd(ms);
                };
                const ticks: number[] = [];
                {
                  const firstT = Math.ceil(mn0 / (lblStep * 60000)) * (lblStep * 60000);
                  for (let t = firstT; t <= mx0 && ticks.length < 80; t += lblStep * 60000) ticks.push(t);
                }
                const gridBg = 'repeating-linear-gradient(to right, rgba(60,90,130,.15) 0, rgba(60,90,130,.15) 1px, transparent 1px, transparent ' + gridPx + 'px)';
                const buildRows = (blk: any) => {
                  const all: any[] = [];
                  (blk.moved || []).forEach((m: any) => all.push({ o: m.o, old: pr(m.old), neww: pr(m.new) }));
                  (blk.skipped || []).forEach((s2: any) => all.push({ o: s2.o, old: null, neww: null, skippedText: s2.reason }));
                  const byId: Record<string, any> = {};
                  all.forEach((r2) => { if (r2.o) byId[String(r2.o.id)] = r2; });
                  const kids: Record<string, any[]> = {};
                  const roots: any[] = [];
                  for (const r2 of all) {
                    const p2 = r2.o && r2.o.parent_order_id ? String(r2.o.parent_order_id) : '';
                    if (p2 && byId[p2]) (kids[p2] = kids[p2] || []).push(r2); else roots.push(r2);
                  }
                  const build = (r2: any, d: number): any => ({ ...r2, depth: d, kids: (kids[String(r2.o && r2.o.id)] || []).map((k2: any) => build(k2, d + 1)) });
                  return roots.map((r2) => build(r2, 0));
                };
                const flat: any[] = [];
                for (const blk of b.blocks) {
                  flat.push({ t: 'block', blk });
                  flat.push({ t: 'start', blk });
                  if (!blk.moved || !blk.moved.length) flat.push({ t: 'empty', blk });
                  const walk = (r2: any) => {
                    const o = r2.o;
                    const isOpen = !(o && sgTabExp[String(o.id)] === false);
                    flat.push({ t: 'order', blk, r2 });
                    if (o && sgTabOpOpen[String(o.id)]) {
                      const ops = sgTabOps[blk.projectId];
                      if (!ops || ops.loading) flat.push({ t: 'opsmsg', blk, r2, text: 'операции: загрузка…' });
                      else if (ops.err) flat.push({ t: 'opsmsg', blk, r2, text: 'операции: ' + ops.err, isErr: true });
                      else {
                        const list = (ops.byOrder || {})[String(o.id)] || [];
                        if (!list.length) flat.push({ t: 'opsmsg', blk, r2, text: 'нет операций в расчёте' });
                        else list.forEach((op2: any, oi: number) => flat.push({ t: 'op', blk, r2, op2, oi }));
                      }
                    }
                    if (isOpen && r2.kids) for (const k2 of r2.kids) walk(k2);
                  };
                  buildRows(blk).forEach(walk);
                }
                const heightOf = (d: any) => d.t === 'block' ? H_BLOCK : d.t === 'start' ? H_START : d.t === 'empty' ? H_EMPTY : d.t === 'opsmsg' ? H_OPSMSG : d.t === 'op' ? H_OP : H_ORDER;
                const renderLeft = (d: any, key: string) => {
                  const h = heightOf(d);
                  if (d.t === 'block') {
                    const blk = d.blk;
                    return (
                      <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8, background: '#101F38', borderBottom: '1px dashed rgba(30,58,95,.6)' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }} title={blk.projectName}>« {blk.projectName} »</span>
                        <span style={{ fontSize: 10.5, color: blk.reverted ? '#5A7090' : '#FCD34D', whiteSpace: 'nowrap' }}>+{blk.days} дн{blk.reverted ? ' · (возвращено)' : ''}</span>
                      </div>
                    );
                  }
                  if (d.t === 'start') {
                    const blk = d.blk;
                    return (
                      <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 10, color: '#5A7090', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        старт {blk.rec && blk.rec.old_start ? fmtDmShort(parseMs(blk.rec.old_start) as number) : '—'} → {blk.rec && blk.rec.new_start ? fmtDmShort(parseMs(blk.rec.new_start) as number) : '—'}{blk.rec && blk.rec.scope === 'roots' ? ' · куст' : ''}
                      </div>
                    );
                  }
                  if (d.t === 'empty') {
                    return <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', paddingLeft: 20, fontSize: 11, color: '#5A7090' }}>перенесённых заказов в записи нет</div>;
                  }
                  if (d.t === 'opsmsg') {
                    return <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', paddingLeft: 32, fontSize: 10.5, color: d.isErr ? '#FCA5A5' : '#5A7090', whiteSpace: 'nowrap', overflow: 'hidden' }}>{d.text}</div>;
                  }
                  if (d.t === 'op') {
                    const op2 = d.op2; const r2 = d.r2;
                    return (
                      <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', paddingLeft: 32 + (r2.depth || 0) * 10, fontSize: 10.5, color: '#B0C4DE', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{(op2.crit ? '◆ ' : '• ')}{op2.name}</div>
                    );
                  }
                  const r2 = d.r2; const o = r2.o; const isOpen = !(o && sgTabExp[String(o.id)] === false);
                  return (
                    <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 2 }}>
                      <span style={{ width: 16, flexShrink: 0, textAlign: 'center' }}>
                        {r2.kids && r2.kids.length > 0 ? (
                          <button onClick={() => setSgTabExp((m2: any) => ({ ...m2, [String(o.id)]: !isOpen }))} title={isOpen ? 'Свернуть' : 'Развернуть'}
                            style={{ background: 'transparent', border: 'none', color: '#8FA3BD', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, padding: 0 }}>{isOpen ? '▼' : '▶'}</button>
                        ) : null}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: (r2.depth || 0) * 10 }}>
                        {o ? (
                          <button onClick={() => { if (onOpenOrder) onOpenOrder(o); }} title="Открыть окно заказа"
                            style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 11, color: r2.skippedText ? '#8FA3BD' : '#93C5FD', cursor: 'pointer', borderBottom: '1px dotted rgba(96,165,250,.6)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orderLabel(o)}</button>
                        ) : <span style={{ color: '#CBD5E1' }}>{r2.label}</span>}
                        {r2.skippedText ? <span style={{ color: '#FCD34D', fontSize: 10 }}> · не поедет</span> : null}
                      </span>
                      {o ? (
                        <button onClick={() => { if (!sgTabOpOpen[String(o.id)]) loadTabOps(d.blk.projectId); setSgTabOpOpen((m2: any) => ({ ...m2, [String(o.id)]: !m2[String(o.id)] })); }}
                          title="Операции заказа: «было → стало»"
                          style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 5, padding: '0px 5px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {sgTabOpOpen[String(o.id)] ? '▾ оп.' : '▸ оп.'}
                        </button>
                      ) : null}
                    </div>
                  );
                };
                const renderMid = (d: any, key: string) => {
                  const h = heightOf(d);
                  const cell = (inner?: any, extra?: any) => (
                    <div key={key} style={{ height: h, width: chartW, position: 'relative', background: 'rgba(15,30,54,.55)', backgroundImage: gridBg, ...(extra || {}) }}>{inner}</div>
                  );
                  if (d.t === 'block') return cell(null, { background: 'rgba(30,50,82,.28)', backgroundImage: 'none', borderTop: '1px dashed rgba(30,58,95,.6)' });
                  if (d.t === 'start') return cell(null, { borderTop: '1px dashed rgba(30,58,95,.3)' });
                  if (d.t === 'empty' || d.t === 'opsmsg') return cell();
                  if (d.t === 'op') {
                    const op2 = d.op2; const blk = d.blk; const r2 = d.r2;
                    const cs = parseMs(op2.start); const cf = parseMs(op2.finish);
                    const NN = Number(blk.days || 0);
                    const isMoved = (blk.moved || []).some((m2: any) => String(m2.o && m2.o.id) === String(r2.o && r2.o.id));
                    const gS = isMoved && !blk.reverted ? -NN : 0;
                    const sS = isMoved && blk.reverted ? NN : 0;
                    const ow2 = cs != null && cf != null ? [cs + gS * MS_DAY, cf + gS * MS_DAY] : null;
                    const nw2 = cs != null && cf != null ? [cs + sS * MS_DAY, cf + sS * MS_DAY] : null;
                    const noMove = !isMoved || NN === 0;
                    return cell(<>
                      {noMove && nw2 && <div title={op2.name + ': ' + fmtDm(nw2[0]) + ' — ' + fmtDm(nw2[1]) + ' (не двигался)'} style={{ position: 'absolute', top: 4, bottom: 4, left: ((nw2[0] - mn0) / span0) * 100 + '%', width: Math.max(px(nw2[1]) - px(nw2[0]), 0.5) + 'px', borderRadius: 3, background: 'rgba(59,130,246,.35)', border: '1px dashed rgba(148,163,184,.6)' }} />}
                      {!noMove && ow2 && <div title={'было: ' + fmtDm(ow2[0]) + ' — ' + fmtDm(ow2[1])} style={{ position: 'absolute', top: 4, bottom: 4, left: ((ow2[0] - mn0) / span0) * 100 + '%', width: Math.max(px(ow2[1]) - px(ow2[0]), 0.5) + 'px', borderRadius: 3, border: '1px dashed rgba(148,163,184,.75)', background: 'rgba(148,163,184,.10)' }} />}
                      {!noMove && nw2 && <div title={'стало: ' + fmtDm(nw2[0]) + ' — ' + fmtDm(nw2[1])} style={{ position: 'absolute', top: 4, bottom: 4, left: ((nw2[0] - mn0) / span0) * 100 + '%', width: Math.max(px(nw2[1]) - px(nw2[0]), 0.5) + 'px', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />}
                    </>);
                  }
                  const r2 = d.r2; const o = r2.o;
                  const barTop = (h - 12) / 2;
                  return cell(<>
                    {r2.old && r2.neww && (
                      <div title={'зона сдвига: +' + Math.round((r2.neww[0] - r2.old[0]) / MS_DAY) + ' дн'}
                        style={{ position: 'absolute', top: 2, bottom: 2, left: ((r2.old[0] - mn0) / span0) * 100 + '%', width: Math.max(Math.abs(px(r2.neww[0]) - px(r2.old[0])) / chartW * 100, 0.6) + '%', background: 'rgba(245,158,11,.10)', borderLeft: '1px dashed rgba(245,158,11,.5)', borderRight: '1px dashed rgba(245,158,11,.5)' }} />
                    )}
                    {r2.old && (
                      <div title={orderLabel(o) + ' · было: ' + fmtDm(r2.old[0]) + ' — ' + fmtDm(r2.old[1])}
                        style={{ position: 'absolute', top: barTop, height: 12, left: ((r2.old[0] - mn0) / span0) * 100 + '%', width: Math.max(px(r2.old[1]) - px(r2.old[0]), 0.5) + 'px', borderRadius: 3, border: '1px dashed rgba(148,163,184,.75)', background: 'rgba(148,163,184,.10)' }} />
                    )}
                    {r2.neww && (
                      <div title={orderLabel(o) + ' · стало: ' + fmtDm(r2.neww[0]) + ' — ' + fmtDm(r2.neww[1])}
                        style={{ position: 'absolute', top: barTop, height: 12, left: ((r2.neww[0] - mn0) / span0) * 100 + '%', width: Math.max(px(r2.neww[1]) - px(r2.neww[0]), 0.5) + 'px', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />
                    )}
                  </>);
                };
                const renderRight = (d: any, key: string) => {
                  const h = heightOf(d);
                  if (d.t === 'block') {
                    return (
                      <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, background: '#101F38', borderBottom: '1px dashed rgba(30,58,95,.6)' }}>
                        <button onClick={() => openShiftGraph(d.blk.rec)} disabled={sgBusy} title="Отдельное окно записи (с кнопкой «Показать на карте»)"
                          style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '1px 8px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>📊 окно записи</button>
                      </div>
                    );
                  }
                  if (d.t === 'order') {
                    const r2 = d.r2;
                    return (
                      <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, fontSize: 10, color: '#8FA3BD', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {r2.old && r2.neww ? (fmtDmShort(r2.old[0]) + '–' + fmtDmShort(r2.old[1]) + ' → ' + fmtDmShort(r2.neww[0]) + '–' + fmtDmShort(r2.neww[1])) : (r2.skippedText ? 'не поедет' : '—')}
                      </div>
                    );
                  }
                  if (d.t === 'op') {
                    const op2 = d.op2; const blk = d.blk; const r2 = d.r2;
                    const cs = parseMs(op2.start); const cf = parseMs(op2.finish);
                    const NN = Number(blk.days || 0);
                    const isMoved = (blk.moved || []).some((m2: any) => String(m2.o && m2.o.id) === String(r2.o && r2.o.id));
                    const gS = isMoved && !blk.reverted ? -NN : 0;
                    const sS = isMoved && blk.reverted ? NN : 0;
                    const ow2 = cs != null && cf != null ? [cs + gS * MS_DAY, cf + gS * MS_DAY] : null;
                    const nw2 = cs != null && cf != null ? [cs + sS * MS_DAY, cf + sS * MS_DAY] : null;
                    const noMove = !isMoved || NN === 0;
                    return (
                      <div key={key} style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, fontSize: 10, color: '#8FA3BD', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {nw2 == null ? '—' : noMove ? (fmtDmShort(nw2[0]) + '–' + fmtDmShort(nw2[1])) : (ow2 == null ? '—' : (fmtDmShort(ow2[0]) + '–' + fmtDmShort(ow2[1]) + ' → ' + fmtDmShort(nw2[0]) + '–' + fmtDmShort(nw2[1])))}
                      </div>
                    );
                  }
                  return <div key={key} style={{ height: h }} />;
                };
                return (
                  <>
                    <div ref={sgLeftRef} style={{ width: SGC_LEFT, flexShrink: 0, overflow: 'hidden', borderRight: '1px solid rgba(30,58,95,.7)' }}>
                      <div style={{ height: RULER_H, background: '#0E2038', borderBottom: '1px solid #1E3252', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 10.5, color: '#5A7090' }}>Проект · заказ · операции</div>
                      {flat.map((d, i) => renderLeft(d, 'L' + i))}
                    </div>
                    <div ref={sgMidRef} onScroll={(e) => { const st = e.currentTarget.scrollTop; if (sgLeftRef.current) sgLeftRef.current.scrollTop = st; if (sgRightRef.current) sgRightRef.current.scrollTop = st; }}
                      style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                      <div style={{ width: chartW, position: 'relative' }}>
                        <div style={{ position: 'sticky', top: 0, zIndex: 5, height: RULER_H, background: '#0E2038', borderBottom: '1px solid #1E3252', overflow: 'hidden' }}>
                          {ticks.map((t, ti) => (
                            <div key={'tk' + ti} style={{ position: 'absolute', left: px(t) + 'px', top: 0, bottom: 0, borderLeft: '1px solid rgba(60,90,130,.45)' }}>
                              <span title={fmtDm(t)} style={{ position: 'absolute', top: 6, left: 4, fontSize: 9.5, color: '#8FA3BD', whiteSpace: 'nowrap' }}>{tickLbl(t)}</span>
                            </div>
                          ))}
                        </div>
                        {flat.map((d, i) => renderMid(d, 'M' + i))}
                      </div>
                    </div>
                    <div ref={sgRightRef} style={{ width: SGC_RIGHT, flexShrink: 0, overflow: 'hidden', borderLeft: '1px solid rgba(30,58,95,.7)' }}>
                      <div style={{ height: RULER_H, background: '#0E2038', borderBottom: '1px solid #1E3252', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, fontSize: 10.5, color: '#5A7090' }}>было → стало</div>
                      {flat.map((d, i) => renderRight(d, 'R' + i))}
                    </div>
                  </>
                );
              })()}
            </div>
            <div style={{ fontSize: 11, color: '#5A7090' }}>
              Пунктир — «было», плотная полоса — «стало», янтарная зона — область сдвига; слева имена и кнопки закреплены, справа колонка «было → стало» — после графика; прокручивается только график (таймлайн с датами/часами/минутами закреплён сверху); масштаб «−/＋», «⤢ Авто» — весь период по ширине.
            </div>
          </div>
        )}

        {tab === 'gantt' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 20px 12px', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>Диаграмма Ганта — по выбранным проектам</div>
              <span style={{ fontSize: 11.5, color: '#5A7090' }}>
                {selectedIds.length > 0 ? ('проектов выбрано: ' + selectedIds.length + ' — на «Обзоре»') : 'выберите проекты на вкладке «Обзор»'}
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0, border: '1px solid #1E3252', borderRadius: 10, overflow: 'hidden', background: '#0A1628' }}>
              {selectedIds.length > 0 ? (
                <GanttChart projectIds={selectedIds} projectNames={ganttNames} />
              ) : (
                <div style={{ padding: 48, textAlign: 'center', color: '#5A7090', fontSize: 13 }}>
                  Выберите один или несколько проектов на вкладке «Обзор» — здесь появится сводная диаграмма Ганта по ним.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'graph' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 20px 12px', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>Сводный сетевой график</div>
              {showGraphShifts && shiftSummary ? <span style={{ fontSize: 11, color: '#94A3B8' }}>активные сдвиги: {shiftSummary} — узлы помечены янтарным ободком</span> : null}
              {!ccmResult && <span style={{ fontSize: 11.5, color: '#5A7090' }}>Выберите проекты на «Обзоре» и нажмите «Объединить»</span>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={runMerge} disabled={loading} style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: selectedIds.length > 0 ? '#3B82F6' : '#162844',
                  color: selectedIds.length > 0 ? '#fff' : '#5A7090',
                  fontSize: 12, fontWeight: 600, cursor: selectedIds.length > 0 ? 'pointer' : 'default',
                }}>{loading ? 'Расчёт...' : 'Объединить'}</button>
                <button onClick={approveBaseline} disabled={loading || !ccmResult} style={{
                  padding: '5px 14px', borderRadius: 6,
                  background: ccmResult ? '#10B981' : '#162844',
                  border: 'none', color: ccmResult ? '#fff' : '#5A7090',
                  fontSize: 12, fontWeight: 600, cursor: ccmResult ? 'pointer' : 'default',
                }}>Утвердить Baseline</button>
                <button onClick={() => setShowBaseline(!showBaseline)} disabled={!baselineNodes} style={{
                  padding: '5px 14px', borderRadius: 6,
                  background: showBaseline ? '#F59E0B' : 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.3)', color: showBaseline ? '#0A1628' : '#F59E0B',
                  fontSize: 12, fontWeight: 600, cursor: baselineNodes ? 'pointer' : 'default',
                }}>{showBaseline ? 'Скрыть Baseline' : 'Сравнить с Baseline'}</button>
                <button onClick={() => { const v = !showGraphShifts; setShowGraphShifts(v); try { localStorage.setItem('profyplan_ccm_graph_shifts', v ? '1' : '0'); } catch { /* noop */ } }}
                  disabled={!ccmResult || shiftProjectIds.length === 0}
                  title={!ccmResult ? 'Сначала «Объединить»' : (shiftProjectIds.length === 0 ? 'Активных сдвигов нет' : 'Пометить на графике узлы проектов с активными сдвигами')}
                  style={{
                    padding: '5px 14px', borderRadius: 6,
                    background: showGraphShifts ? '#94A3B8' : 'rgba(148,163,184,0.1)',
                    border: '1px solid rgba(148,163,184,0.3)',
                    color: (ccmResult && shiftProjectIds.length) ? (showGraphShifts ? '#0A1628' : '#94A3B8') : '#5A7090',
                    fontSize: 12, fontWeight: 600, cursor: (ccmResult && shiftProjectIds.length) ? 'pointer' : 'default',
                  }}>{showGraphShifts ? 'Скрыть сдвиги («было»)' : 'Показать сдвиги («было»)'}</button>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, border: '1px solid #1E3252', borderRadius: 10, overflow: 'hidden' }}>
              <NetworkGraphV2
                cpmResult={ccmResult}
                levelResult={levelResult}
                baselineNodes={showBaseline ? baselineNodes : null}
                showBaseline={showBaseline}
                shiftMarks={shiftMarks}
              />
            </div>
          </div>
        )}

        {shiftGraph && (() => {
          const g = shiftGraph;
          let mn = Infinity, mx = -Infinity;
          const push = (v: any) => { if (v != null && isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } };
          push(g.oldStart); push(g.newStart);
          const all: any[] = [];
          (g.moved || []).forEach((m: any) => { all.push({ o: m.o, old: m.old, neww: m.new }); (m.old || []).forEach(push); (m.new || []).forEach(push); });
          (g.skipped || []).forEach((s2: any) => { all.push({ o: s2.o, old: null, neww: null, skippedText: s2.reason }); });
          const bushRows: any[] = [];
          (g.bushes || []).forEach((b: any) => { bushRows.push({ label: '🌳 ' + b.title, old: b.old, neww: b.new, skipped: b.skipped }); (b.old || []).forEach(push); (b.new || []).forEach(push); });
          // Дерево заказов: родитель → дети (куст едет целиком); операции — раскрытием «▸ оп.»
          const byId2: Record<string, any> = {};
          all.forEach((r2) => { if (r2.o) byId2[String(r2.o.id)] = r2; });
          const kidsMap: Record<string, any[]> = {};
          const treeRoots: any[] = [];
          for (const r2 of all) {
            const pid2 = r2.o && r2.o.parent_order_id ? String(r2.o.parent_order_id) : '';
            if (pid2 && byId2[pid2]) (kidsMap[pid2] = kidsMap[pid2] || []).push(r2);
            else treeRoots.push(r2);
          }
          const buildTree = (r2: any, d: number): any => ({ ...r2, depth: d, kids: (kidsMap[String(r2.o && r2.o.id)] || []).map((k2: any) => buildTree(k2, d + 1)) });
          const tree = treeRoots.map((r2) => buildTree(r2, 0));
          const ok = isFinite(mn) && isFinite(mx) && mx > mn;
          const span = ok ? (mx - mn) : 1;
          const pos = (v: number) => ((v - mn) / span) * 100;
          const pair = (arr: any) => {
            const s0 = arr && arr[0] != null ? arr[0] : (arr && arr[1] != null ? arr[1] : null);
            const f0 = arr && arr[1] != null ? arr[1] : s0;
            return (s0 == null || f0 == null) ? null : [s0, f0];
          };
          const barRow = (key: string, label: string, oldArr: any, newArr: any, o: any, skipped?: string) => {
            const ow = pair(oldArr); const nw = pair(newArr);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                <span style={{ width: 190, flexShrink: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o ? (
                    <button onClick={() => { if (onOpenOrder) onOpenOrder(o); }} title="Открыть окно заказа"
                      style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 11, color: '#93C5FD', cursor: 'pointer', borderBottom: '1px dotted rgba(96,165,250,.6)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</button>
                  ) : <span style={{ color: '#CBD5E1' }}>{label}</span>}
                  {skipped ? <span style={{ color: '#FCD34D' }}> · не поедет: {skipped}</span> : null}
                </span>
                <div style={{ position: 'relative', flex: 1, height: 12, background: 'rgba(15,30,54,.7)', borderRadius: 3 }}>
                  {ow && nw && (
                    <div title={'зона сдвига: +' + Math.round((nw[0] - ow[0]) / MS_DAY) + ' дн'}
                      style={{ position: 'absolute', top: 0, bottom: 0, left: Math.min(pos(ow[0]), pos(nw[0])) + '%', width: Math.max(Math.abs(pos(nw[0]) - pos(ow[0])), 0.6) + '%', background: 'rgba(245,158,11,.10)', borderLeft: '1px dashed rgba(245,158,11,.5)', borderRight: '1px dashed rgba(245,158,11,.5)' }} />
                  )}
                  {ow && (
                    <div title={label + ' · было: ' + fmtDm(ow[0]) + ' — ' + fmtDm(ow[1])}
                      style={{ position: 'absolute', top: 1, bottom: 1, left: pos(ow[0]) + '%', width: Math.max(((ow[1] - ow[0]) / span) * 100, 0.5) + '%', borderRadius: 3, border: '1px dashed rgba(148,163,184,.75)', background: 'rgba(148,163,184,.10)' }} />
                  )}
                  {nw && (
                    <div title={label + ' · стало: ' + fmtDm(nw[0]) + ' — ' + fmtDm(nw[1])}
                      style={{ position: 'absolute', top: 1, bottom: 1, left: pos(nw[0]) + '%', width: Math.max(((nw[1] - nw[0]) / span) * 100, 0.5) + '%', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />
                  )}
                </div>
                <span style={{ width: 190, textAlign: 'right', flexShrink: 0, fontSize: 10, color: '#8FA3BD', fontVariantNumeric: 'tabular-nums' }}>
                  {ow && nw ? (fmtDmShort(ow[0]) + '–' + fmtDmShort(ow[1]) + ' → ' + fmtDmShort(nw[0]) + '–' + fmtDmShort(nw[1])) : '—'}
                </span>
              </div>
            );
          };
          const treeRow = (r2: any, key: string): any => {
            const o = r2.o;
            const isOpen = !(o && sgExp[String(o.id)] === false);
            const ow = pair(r2.old); const nw = pair(r2.neww);
            return (
              <div key={key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <span style={{ width: 18, flexShrink: 0, textAlign: 'center' }}>
                    {r2.kids && r2.kids.length > 0 ? (
                      <button onClick={() => setSgExp((m2: any) => ({ ...m2, [String(o.id)]: !isOpen }))} title={isOpen ? 'Свернуть' : 'Развернуть'}
                        style={{ background: 'transparent', border: 'none', color: '#8FA3BD', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, padding: 0 }}>{isOpen ? '▼' : '▶'}</button>
                    ) : null}
                  </span>
                  <span style={{ width: 168, flexShrink: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: (r2.depth || 0) * 12 }}>
                    {o ? (
                      <button onClick={() => { if (onOpenOrder) onOpenOrder(o); }} title="Открыть окно заказа"
                        style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 11, color: r2.skippedText ? '#8FA3BD' : '#93C5FD', cursor: 'pointer', borderBottom: '1px dotted rgba(96,165,250,.6)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orderLabel(o)}</button>
                    ) : <span style={{ color: '#CBD5E1' }}>{r2.label}</span>}
                  </span>
                  {o ? (
                    <button onClick={() => { if (!sgOpOpen[String(o.id)]) loadSgOps(); setSgOpOpen((m2: any) => ({ ...m2, [String(o.id)]: !m2[String(o.id)] })); }}
                      title="Операции заказа: «было → стало»"
                      style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 5, padding: '0px 6px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {sgOpOpen[String(o.id)] ? '▾ оп.' : '▸ оп.'}
                    </button>
                  ) : null}
                  <div style={{ position: 'relative', flex: 1, height: 12, background: 'rgba(15,30,54,.7)', borderRadius: 3 }}>
                    {ow && nw && (
                      <div title={'зона сдвига: +' + Math.round((nw[0] - ow[0]) / MS_DAY) + ' дн'}
                        style={{ position: 'absolute', top: 0, bottom: 0, left: Math.min(pos(ow[0]), pos(nw[0])) + '%', width: Math.max(Math.abs(pos(nw[0]) - pos(ow[0])), 0.6) + '%', background: 'rgba(245,158,11,.10)', borderLeft: '1px dashed rgba(245,158,11,.5)', borderRight: '1px dashed rgba(245,158,11,.5)' }} />
                    )}
                    {ow && (
                      <div title={orderLabel(o) + ' · было: ' + fmtDm(ow[0]) + ' — ' + fmtDm(ow[1])}
                        style={{ position: 'absolute', top: 1, bottom: 1, left: pos(ow[0]) + '%', width: Math.max(((ow[1] - ow[0]) / span) * 100, 0.5) + '%', borderRadius: 3, border: '1px dashed rgba(148,163,184,.75)', background: 'rgba(148,163,184,.10)' }} />
                    )}
                    {nw && (
                      <div title={orderLabel(o) + ' · стало: ' + fmtDm(nw[0]) + ' — ' + fmtDm(nw[1])}
                        style={{ position: 'absolute', top: 1, bottom: 1, left: pos(nw[0]) + '%', width: Math.max(((nw[1] - nw[0]) / span) * 100, 0.5) + '%', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />
                    )}
                  </div>
                  <span style={{ width: 186, textAlign: 'right', flexShrink: 0, fontSize: 10, color: '#8FA3BD', fontVariantNumeric: 'tabular-nums' }}>
                    {ow && nw ? (fmtDmShort(ow[0]) + '–' + fmtDmShort(ow[1]) + ' → ' + fmtDmShort(nw[0]) + '–' + fmtDmShort(nw[1])) : (r2.skippedText ? 'не поедет: ' + r2.skippedText : '—')}
                  </span>
                </div>
                {r2.kids && r2.kids.length > 0 && isOpen && r2.kids.map((k2: any, ki: number) => treeRow(k2, key + '-' + ki))}
                {o && sgOpOpen[String(o.id)] && (() => {
                  if (!sgOpsData || sgOpsData.loading) return <div style={{ padding: '1px 0 1px 250px', fontSize: 10.5, color: '#5A7090' }}>операции: загрузка…</div>;
                  if (sgOpsData.err) return <div style={{ padding: '1px 0 1px 250px', fontSize: 10.5, color: '#FCA5A5' }}>операции: {sgOpsData.err}</div>;
                  const list = (sgOpsData.byOrder || {})[String(o.id)] || [];
                  if (!list.length) return <div style={{ padding: '1px 0 1px 250px', fontSize: 10.5, color: '#5A7090' }}>нет операций в расчёте</div>;
                  const rev = !!(g.meta && g.meta.reverted);
                  const NN = Number(g.meta?.days || 0);
                  const isMoved = (g.moved || []).some((m2: any) => String(m2.o?.id) === String(o.id));
                  return (
                    <div>
                      {list.map((op2: any, oi: number) => {
                        const cs = parseMs(op2.start); const cf = parseMs(op2.finish);
                        const gS = isMoved && !rev ? -NN : 0;
                        const sS = isMoved && rev ? NN : 0;
                        const ow2 = cs != null && cf != null ? [cs + gS * MS_DAY, cf + gS * MS_DAY] : null;
                        const nw2 = cs != null && cf != null ? [cs + sS * MS_DAY, cf + sS * MS_DAY] : null;
                        const noMove = !isMoved || NN === 0 || gS === 0 && sS === 0;
                        return (
                          <div key={key + '-op' + oi} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
                            <span style={{ width: 186, flexShrink: 0, paddingLeft: 24 + (r2.depth || 0) * 12, fontSize: 10.5, color: '#B0C4DE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(op2.crit ? '◆ ' : '• ')}{op2.name}</span>
                            <div style={{ position: 'relative', flex: 1, height: 8, background: 'rgba(15,30,54,.7)', borderRadius: 3 }}>
                              {noMove && nw2 && <div title={op2.name + ': ' + fmtDm(nw2[0]) + ' — ' + fmtDm(nw2[1]) + ' (не двигался)'} style={{ position: 'absolute', top: 1, bottom: 1, left: pos(nw2[0]) + '%', width: Math.max(((nw2[1] - nw2[0]) / span) * 100, 0.5) + '%', borderRadius: 3, background: 'rgba(59,130,246,.35)', border: '1px dashed rgba(148,163,184,.6)' }} />}
                              {!noMove && ow2 && <div title={'было: ' + fmtDm(ow2[0]) + ' — ' + fmtDm(ow2[1])} style={{ position: 'absolute', top: 1, bottom: 1, left: pos(ow2[0]) + '%', width: Math.max(((ow2[1] - ow2[0]) / span) * 100, 0.5) + '%', borderRadius: 3, border: '1px dashed rgba(148,163,184,.75)', background: 'rgba(148,163,184,.10)' }} />}
                              {!noMove && nw2 && <div title={'стало: ' + fmtDm(nw2[0]) + ' — ' + fmtDm(nw2[1])} style={{ position: 'absolute', top: 1, bottom: 1, left: pos(nw2[0]) + '%', width: Math.max(((nw2[1] - nw2[0]) / span) * 100, 0.5) + '%', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />}
                            </div>
                            <span style={{ width: 186, textAlign: 'right', flexShrink: 0, fontSize: 10, color: '#8FA3BD', fontVariantNumeric: 'tabular-nums' }}>
                              {nw2 == null ? '—' : noMove ? (fmtDmShort(nw2[0]) + '–' + fmtDmShort(nw2[1])) : (ow2 == null ? '—' : (fmtDmShort(ow2[0]) + '–' + fmtDmShort(ow2[1]) + ' → ' + fmtDmShort(nw2[0]) + '–' + fmtDmShort(nw2[1])))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          };
          const projRow = (g.oldStart != null && g.newStart != null) ? (
            <div key="proj" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderBottom: '1px dashed rgba(30,58,95,.7)', marginBottom: 3 }}>
              <span style={{ width: 190, flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: '#CBD5E1' }}>Проект · старт</span>
              <div style={{ position: 'relative', flex: 1, height: 14 }}>
                <div title={'старт: было ' + fmtDm(g.oldStart) + ' → стало ' + fmtDm(g.newStart)}
                  style={{ position: 'absolute', top: 6, left: Math.min(pos(g.oldStart), pos(g.newStart)) + '%', width: Math.max(Math.abs(pos(g.newStart) - pos(g.oldStart)), 0.8) + '%', height: 2, background: 'rgba(245,158,11,.55)' }} />
                <div title={'было: ' + fmtDm(g.oldStart)}
                  style={{ position: 'absolute', top: 2, left: pos(g.oldStart) + '%', width: 10, height: 10, marginLeft: -5, transform: 'rotate(45deg)', border: '1.5px dashed #94A3B8', background: 'rgba(148,163,184,.15)' }} />
                <div title={'стало: ' + fmtDm(g.newStart)}
                  style={{ position: 'absolute', top: 2, left: pos(g.newStart) + '%', width: 10, height: 10, marginLeft: -5, transform: 'rotate(45deg)', background: '#3B82F6', border: '1px solid #93C5FD' }} />
              </div>
              <span style={{ width: 190, textAlign: 'right', flexShrink: 0, fontSize: 10, color: '#8FA3BD' }}>{fmtDm(g.oldStart)} → {fmtDm(g.newStart)}</span>
            </div>
          ) : null;
          return (
            <div style={{ position: 'fixed', left: 320, top: 64, right: 40, bottom: 70, zIndex: 60, background: '#0C1B31', border: '1px solid #1E3252', borderRadius: 12, boxShadow: '0 18px 60px rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #1E3252', background: '#0E2038', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#93C5FD' }}>📊 {g.title}</span>
                <span style={{ fontSize: 11.5, color: (g.meta && g.meta.reverted) ? '#5A7090' : '#FCD34D' }}>
                  +{g.meta?.days ?? 0} дн{g.meta?.scope === 'roots' ? ' · куст (старт проекта не менялся)' : ''}{g.meta?.reverted ? ' · (возвращено)' : ''}
                </span>
                {g.mode === 'record' && (
                  <button onClick={showOnMap} title="Открыть карту занятости: призраки «как было» и подсветка заказов этого сдвига"
                    style={{ marginLeft: 'auto', background: 'rgba(52,211,153,.10)', border: '1px solid rgba(52,211,153,.5)', color: '#86EFAC', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>🗺 Показать на карте</button>
                )}
                <button onClick={() => setShiftGraph(null)} style={{ marginLeft: g.mode === 'record' ? 0 : 'auto', background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕ Закрыть</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 14px' }}>
                {!ok && <div style={{ fontSize: 12, color: '#8FA3BD' }}>Нет дат для графика.</div>}
                {ok && (<>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#5A7090', marginBottom: 4, paddingLeft: 200, paddingRight: 200 }}>
                    <span>{fmtDm(mn)}</span>
                    <span>{fmtDm(mx)}</span>
                  </div>
                  <div style={{ border: '1px solid #1E3252', borderRadius: 6, background: '#0A1628', padding: '6px 8px' }}>
                    {projRow}
                    {tree.map((r2: any, i: number) => treeRow(r2, 'r' + i))}
                    {bushRows.map((r2: any, i: number) => barRow('b' + i, r2.label, r2.old, r2.neww, undefined, r2.skipped))}
                    {tree.length === 0 && bushRows.length === 0 && !projRow && <div style={{ fontSize: 11.5, color: '#5A7090', padding: '4px 0' }}>Нет строк для отображения.</div>}
                  </div>
                  {g.mode === 'record' && (g.skipped || []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8FA3BD', marginBottom: 3 }}>Пропущены (не поехали)</div>
                      {(g.skipped || []).map((s2: any, i: number) => (
                        <div key={'sk' + i} style={{ fontSize: 11, color: '#8FA3BD', padding: '1px 0' }}>
                          — {orderLabel(s2.o)} <span style={{ color: '#5A7090' }}>· {s2.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {g.mode === 'preview' && (g.skippedList || []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8FA3BD', marginBottom: 3 }}>Пропуски (не поедут)</div>
                      {(g.skippedList || []).map((s2: any, i: number) => (
                        <div key={'sk' + i} style={{ fontSize: 11, color: '#8FA3BD', padding: '1px 0' }}>— {s2.ext_id || s2.id} <span style={{ color: '#5A7090' }}>· {s2.reason}</span></div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#5A7090', marginTop: 6 }}>
                    Пунктир — что было · синяя полоса — что стало · янтарная зона — область сдвига. Клик по заказу — его окно; «▸ оп.» — операции заказа из расчёта (раскрываются деревом).
                  </div>
                </>)}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 6,
  border: '1px solid #1E3252', background: '#0A1628',
  color: '#E8EEF5', fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};
