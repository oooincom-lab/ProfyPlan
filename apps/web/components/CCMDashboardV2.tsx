/**
 * CCM V2 Dashboard — План (Baseline) + Динамика (Actual).  
 * Две версии графа: предварительный расчёт и рабочий с фактом.
 */
'use client';

function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8000';
  }
  return env || 'https://profyplan.ru/api';
}
const API_BASE = resolveApiBase() + '/v1';

import { useState, useEffect, useCallback } from 'react';
import NetworkGraphV2 from '@/components/NetworkGraphV2';
import { login, isAuthenticated, getProjects, mergeProjects, resourceLeveling, createBaseline } from '@/lib/api';

type Tab = 'network-graph';

export default function CCMV2Dashboard() {
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
  const [loginEmail, setLoginEmail] = useState('planner@demo.ru');
  const [loginPass, setLoginPass] = useState('demo123');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [resourceUsage, setResourceUsage] = useState<any[]>([]);
  const [overload, setOverload] = useState<any>(null);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [sugBusy, setSugBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    fetch(API_BASE + '/ccm/resource-usage', {
      headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => setResourceUsage(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    fetch(API_BASE + '/ccm/resource-overload', {
      headers: { ...(t ? { Authorization: '***' + t } : {}) },
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
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(`${API_BASE}/ccm/projects/${pid}/overload-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: '***' + t } : {}) },
        body: '{}',
      });
      setSuggestion(await r.json());
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, []);

  const applyShift = useCallback(async () => {
    const sg = suggestion?.suggestion;
    if (!sg?.suggested_start || !suggestion?.project_id) return;
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      await fetch(`${API_BASE}/projects/${suggestion.project_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: '***' + t } : {}) },
        body: JSON.stringify({ start_date: sg.suggested_start }),
      });
      setSuggestion({ ...suggestion, applied: true });
      const t2 = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/resource-overload', {
        headers: { ...(t2 ? { Authorization: '***' + t2 } : {}) },
      });
      if (r.ok) setOverload(await r.json());
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
      await fetch(`${API_BASE}/projects/${tgt.project_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: '***' + t } : {}) },
        body: JSON.stringify({ start_date: nd.toISOString() }),
      });
      setSuggestion({ ...suggestion, applied: true, appliedOther: true });
      const t2 = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(API_BASE + '/ccm/resource-overload', {
        headers: { ...(t2 ? { Authorization: '***' + t2 } : {}) },
      });
      if (r.ok) setOverload(await r.json());
    } catch (e: any) { setError(String(e?.message || e)); }
    setSugBusy(false);
  }, [suggestion, projects]);

  const setMyPriority = useCallback(async (pid: string, pr: string) => {
    setSugBusy(true);
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      await fetch(`${API_BASE}/projects/${pid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: '***' + t } : {}) },
        body: JSON.stringify({ priority: pr }),
      });
      // перезапросить предложение с новым приоритетом
      const t2 = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r2 = await fetch(`${API_BASE}/ccm/projects/${pid}/overload-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t2 ? { Authorization: '***' + t2 } : {}) },
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

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: '#0A1628', color: '#E8EEF5', fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', background: '#0F1E36',
        borderBottom: '1px solid #1E3252',
        display: 'flex', alignItems: 'center', gap: 20,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>CCM V2 — Динамика</h2>

        {/* Project selector */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {projects.map((p: any) => (
            <button
              key={p.id}
              onClick={() => toggleProject(p.id)}
              style={{
                padding: '5px 14px', borderRadius: 100,
                border: selectedIds.includes(p.id) ? '1px solid #3B82F6' : '1px solid #1E3252',
                background: selectedIds.includes(p.id) ? 'rgba(59,130,246,0.15)' : '#0A1628',
                color: selectedIds.includes(p.id) ? '#60A5FA' : '#8FA3BD',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Actions */}
        <button onClick={runMerge} disabled={loading} style={{
          padding: '6px 16px', borderRadius: 6, border: 'none',
          background: selectedIds.length > 0 ? '#3B82F6' : '#162844',
          color: selectedIds.length > 0 ? '#fff' : '#5A7090',
          fontSize: 12, fontWeight: 600, cursor: selectedIds.length > 0 ? 'pointer' : 'default',
        }}>
          {loading ? 'Расчёт...' : 'Объединить'}
        </button>
        <button onClick={approveBaseline} disabled={loading || !ccmResult} style={{
          padding: '6px 16px', borderRadius: 6,
          background: ccmResult ? '#10B981' : '#162844',
          border: 'none', color: ccmResult ? '#fff' : '#5A7090',
          fontSize: 12, fontWeight: 600, cursor: ccmResult ? 'pointer' : 'default',
        }}>
          Утвердить Baseline
        </button>
        <button onClick={() => setShowBaseline(!showBaseline)} disabled={!baselineNodes} style={{
          padding: '6px 16px', borderRadius: 6,
          background: showBaseline ? '#F59E0B' : 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', color: showBaseline ? '#0A1628' : '#F59E0B',
          fontSize: 12, fontWeight: 600, cursor: baselineNodes ? 'pointer' : 'default',
        }}>
          {showBaseline ? 'Скрыть Baseline' : 'Сравнить с Baseline'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 12 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      {/* Сводка использования общих ресурсов (межпроектно) */}
      {resourceUsage.length > 0 && (
        <div style={{ padding: '10px 20px', background: '#0A1628', borderBottom: '1px solid #1E3252', maxHeight: 220, overflow: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 6 }}>
            🧰 Общие ресурсы (межпроектные) — {resourceUsage.filter((r: any) => r.is_shared).length} совм. из {resourceUsage.length}
          </div>
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
        </div>
      )}

      {overload && (overload.resources || []).some((r: any) => r.is_shared) && (
        <div style={{ padding: '10px 20px', background: '#0A1628', borderBottom: '1px solid #1E3252', maxHeight: 200, overflow: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 6 }}>
            ⚠ Межпроектные конфликты общих ресурсов — {overload?.totals?.conflicted || 0} из {overload?.totals?.shared || 0} общих
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#5A7090', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Ресурс</th>
                <th style={{ padding: '4px 8px' }}>Проекты</th>
                <th style={{ padding: '4px 8px' }}>Загрузка</th>
                <th style={{ padding: '4px 8px' }}>Пересечение</th>
                <th style={{ padding: '4px 8px' }}>Конфликты</th>
              </tr>
            </thead>
            <tbody>
              {(overload.resources || []).filter((r: any) => r.is_shared).map((r: any) => (
                <tr key={r.id} style={{ borderTop: '1px solid #1E3252', color: r.has_conflict ? '#FCD34D' : '#E8EEF5' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '4px 8px', color: '#8FA3BD' }}>{(r.assignments || []).map((a: any) => a.project_name).join(', ') || '—'}</td>
                  <td style={{ padding: '4px 8px' }}>{r.total_text}</td>
                  <td style={{ padding: '4px 8px', color: r.has_conflict ? '#FCD34D' : '#5A7090' }}>{r.overlap_days ? r.overlap_days + ' дн' : '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#8FA3BD' }}>
                    {(r.conflicts || []).slice(0, 2).map((c: any) => c.a + ' × ' + c.b + ' (' + c.days + ' дн)').join('; ') || '—'}
                    {r.has_conflict && (r.conflicts || [])[0] && (
                      <button onClick={() => suggestShift(String((r.conflicts || [])[0].a_id))} disabled={sugBusy}
                        style={{ marginLeft: 8, background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Предложить сдвиг</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suggestion && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: suggestion.has_conflict ? '#FCD34D' : '#8FA3BD', flexWrap: 'wrap' }}>
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
        </div>
      )}

      {/* Graph */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <NetworkGraphV2
          cpmResult={ccmResult}
          levelResult={levelResult}
          baselineNodes={showBaseline ? baselineNodes : null}
          showBaseline={showBaseline}
        />
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
