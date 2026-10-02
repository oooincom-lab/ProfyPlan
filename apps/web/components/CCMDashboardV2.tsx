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

export default function CCMV2Dashboard({ onOpenResourceEdit }: { onOpenResourceEdit?: (id: string) => void } = {}) {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('network-graph');
  const [ccmResult, setCcmResult] = useState<any>(null);
  const [levelResult, setLevelResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineNodes, setBaselineNodes] = useState<any>(null);
  const [authed, setAuthed] = useState(false);
  const [loginEmail, setLoginEmail] = useState(DEMO_EMAIL);
  const [loginPass, setLoginPass] = useState(DEMO_PASSWORD);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [resourceUsage, setResourceUsage] = useState<any[]>([]);
  const [overload, setOverload] = useState<any>(null);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [sugBusy, setSugBusy] = useState(false);
  const [occId, setOccId] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'resources' | 'occupancy' | 'graph'>('overview');
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [shiftsLog, setShiftsLog] = useState<any[]>([]);
  const [sugFor, setSugFor] = useState<string | null>(null);
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
  };

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
      loadShifts();
    }
  }, []);

  // Результат «Предложить сдвиг» показываем сразу; карта — на своей вкладке (без автопрокрутки).

  useEffect(() => {
    if (suggestion && sugRef.current) {
      try { sugRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* noop */ }
    }
  }, [suggestion]);

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

  const applyShift = useCallback(async () => {
    const sg = suggestion?.suggestion;
    if (!sg?.suggested_start || !suggestion?.project_id) return;
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shifts/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: JSON.stringify({ project_id: suggestion.project_id, new_start: sg.suggested_start, kind: 'self', shift_days: sg.shift_days || 0 }),
      });
      const d = await r.json().catch(() => null);
      setSuggestion({ ...suggestion, applied: true, shiftRecordId: d?.record?.id || null, recalc: d?.recalc || null });
      await reloadPortfolioData();
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, [suggestion]);

  const applyShiftOther = useCallback(async () => {
    const tgt = suggestion?.priority?.target_project;
    const days = (suggestion?.plan && suggestion.plan[0]?.overlap_days) || 0;
    if (!tgt?.project_id || !days) return;
    const pr = projects.find((x: any) => x.id === tgt.project_id);
    const base = pr?.start_date ? new Date(pr.start_date) : new Date();
    const nd = new Date(base.getTime() + days * 86400000);
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shifts/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
        body: JSON.stringify({ project_id: tgt.project_id, new_start: nd.toISOString(), kind: 'other', shift_days: days }),
      });
      const d = await r.json().catch(() => null);
      setSuggestion({ ...suggestion, applied: true, appliedOther: true, shiftRecordId: d?.record?.id || null, recalc: d?.recalc || null });
      await reloadPortfolioData();
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, [suggestion, projects]);

  /** Возврат сдвига: восстановить дату старта и пересчитать проект. */
  const revertShift = async (shiftId: string) => {
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/shifts/' + shiftId + '/revert', {
        method: 'POST',
        headers: { ...(t ? { Authorization: 'Bea' + 'rer ' + t } : {}) },
      });
      if (!r.ok) throw new Error('Не удалось вернуть сдвиг');
      await reloadPortfolioData();
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
      setTab('graph');
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
    const minI = list[0].s as number;
    const maxI = list.reduce((m: number, a: any) => Math.max(m, a.f as number), list[0].f as number);
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
          {([['overview', 'Обзор'], ['resources', 'Ресурсы и конфликты'], ['occupancy', 'Карта занятости'], ['graph', 'Сводный график']] as const).map(([k, label]) => (
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
              <span style={{ fontSize: 11.5, color: '#5A7090' }}>«Объединить» построит сводный график и откроет вкладку «Сводный график»</span>
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
                        {(r.conflicts || []).slice(0, 2).map((c: any) => c.a + ' × ' + c.b + ' (' + c.days + ' дн)').join('; ') || '—'}
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
                      План: {(suggestion.plan || []).map((x: any) => `${x.resource_name} (освободится ${x.free_at ? String(x.free_at).slice(0, 10) : '?'}, с ${x.other_projects.join('/')}, перекрытие ${x.overlap_days} дн)`).join('; ')}
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
                  <span style={{ color: '#5A7090', fontSize: 11.5 }}>мой приоритет:</span>
                  <select value={(suggestion.priority?.mine || 'normal')} disabled={sugBusy}
                    onChange={(e) => setMyPriority(String(suggestion.project_id), e.target.value)}
                    style={{ background: '#0F1E36', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '3px 6px', fontSize: 11.5 }}>
                    <option value="low">низкий</option>
                    <option value="normal">обычный</option>
                    <option value="high">высокий</option>
                  </select>
                  {suggestion.applied && <span style={{ color: '#86EFAC' }}>{suggestion.appliedOther ? 'сдвинут другой проект' : 'сдвиг применён'}</span>}
                  <button onClick={() => setSuggestion(null)}
                    style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Скрыть</button>
                </>
              ) : (
                <span>Для этого проекта конфликтов по общим ресурсам нет.</span>
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
                      <span style={{ color: s.kind === 'other' ? '#FCD34D' : '#93C5FD' }}>{s.kind === 'other' ? 'сдвиг другому' : 'свой сдвиг'} · +{s.shift_days} дн</span>
                      <span style={{ color: '#8FA3BD' }}>старт {fmtD(s.old_start)} → {fmtD(s.new_start)}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        {s.reverted ? (
                          <span style={{ color: '#5A7090' }}>(возвращено)</span>
                        ) : (
                          <button onClick={() => revertShift(s.id)} disabled={blocked || sugBusy}
                            title={blocked ? 'Сначала верните более поздние сдвиги этого проекта' : 'Вернуть дату старта как было (с автопересчётом)'}
                            style={{ background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: blocked ? 'default' : 'pointer', fontFamily: 'inherit', opacity: blocked ? 0.5 : 1 }}>Вернуть</button>
                        )}
                      </span>
                    </div>
                  );
                })}
                <div style={{ fontSize: 11, color: '#5A7090', marginTop: 4 }}>После каждого сдвига и возврата проект пересчитывается автоматически — свежий запуск виден в «Запусках» проекта.</div>
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
                      {occ.list.map((a: any) => (
                        <div key={a.project_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                          <span title={a.project_name} style={{ fontSize: 11, color: '#CBD5E1', width: 190, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.project_name}</span>
                          <div style={{ position: 'relative', flex: 1, height: 12, background: 'rgba(15,30,54,.7)', borderRadius: 3 }}>
                            <div title={a.project_name + ': ' + fmtDm(a.s) + ' — ' + fmtDm(a.f) + ' · ' + (a.hours_text || '') + (a.capacity_share && a.capacity_share !== 1 ? ' · доля мощности ×' + a.capacity_share : '')}
                              style={{ position: 'absolute', left: ((a.s - occ.minI) / occ.span * 100) + '%', width: Math.max(((a.f - a.s) / occ.span) * 100, 0.8) + '%', top: 0, height: '100%', borderRadius: 3, background: 'rgba(59,130,246,.55)', border: '1px solid rgba(96,165,250,.7)' }} />
                          </div>
                          <span style={{ fontSize: 10.5, color: '#8FA3BD', width: 142, textAlign: 'right', flexShrink: 0 }}>{fmtDm(a.s)}–{fmtDm(a.f)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 6 }}>
                      Свободные окна: {occ.free.length ? occ.free.map(([s0, e0]: [number, number]) => fmtDm(s0) + ' – ' + fmtDm(e0) + ' (' + Math.round((e0 - s0) / MS_DAY) + ' дн)').join(' · ') : 'нет — ресурс занят весь период'}
                    </div>
                    <div style={{ fontSize: 11, color: '#5A7090', marginTop: 4 }}>Бронь — окно проекта (старт → плановый финиш); перекрытия подсвечены. Следующий куст можно ставить в свободные окна.</div>
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

        {tab === 'graph' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 20px 12px', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD' }}>Сводный сетевой график</div>
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
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, border: '1px solid #1E3252', borderRadius: 10, overflow: 'hidden' }}>
              <NetworkGraphV2
                cpmResult={ccmResult}
                levelResult={levelResult}
                baselineNodes={showBaseline ? baselineNodes : null}
                showBaseline={showBaseline}
              />
            </div>
          </div>
        )}
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
