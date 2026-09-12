'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_V1 } from '@/lib/api';

const API = API_V1;

const fmt = (s?: string | null) => {
  if (!s) return '—';
  const d = String(s).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0].slice(2)}` : String(s);
};

/** Отчёты: загрузка подразделений и предложение межпроектного выравнивания. */
export default function ReportsPanel({ projects }: { projects: any[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // загрузка подразделений
  const [projId, setProjId] = useState<string>('');
  const [deptLoad, setDeptLoad] = useState<any>(null);

  // межпроектное выравнивание
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<any>(null);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...((opts?.headers as any) || {}) };
    if (tok) h['Authorization'] = 'Bea' + 'rer ' + tok;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  useEffect(() => {
    if (!projId && projects?.length) setProjId(projects[0].id);
  }, [projects, projId]);

  const loadDept = useCallback(async () => {
    if (!projId) return;
    setBusy(true); setMsg(null);
    try {
      setDeptLoad(await af(`/reports/department-loading?project_id=${projId}`));
    } catch (e: any) { setMsg(String(e.message || e).slice(0, 160)); setDeptLoad(null); }
    setBusy(false);
  }, [projId]);

  const runLeveling = async () => {
    const ids = Object.keys(picked).filter(k => picked[k]);
    if (ids.length < 2) { setMsg('Выберите минимум два проекта для выравнивания'); return; }
    setBusy(true); setMsg(null);
    try {
      setPlan(await af('/ccm/multi-leveling', { method: 'POST', body: JSON.stringify(ids) }));
    } catch (e: any) { setMsg(String(e.message || e).slice(0, 160)); setPlan(null); }
    setBusy(false);
  };

  const depts: any[] = deptLoad?.departments || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {msg && <div style={{ fontSize: 12, color: '#FCD34D' }}>{msg}</div>}

      {/* ── Загрузка подразделений ── */}
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">🏭 Загрузка подразделений</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={projId} onChange={(e) => { setProjId(e.target.value); setDeptLoad(null); }}
              title="Проект, по которому считается загрузка подразделений"
              style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit' }}>
              {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" onClick={loadDept} disabled={busy || !projId}
              style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {busy ? '…' : '▶ Рассчитать'}
            </button>
          </span>
        </div>
        {!deptLoad && <div style={{ fontSize: 12.5, color: '#8FA3BD', padding: '8px 0' }}>
          Выберите проект и нажмите «Рассчитать»: спрос и доступное время по подразделениям, процент загрузки. Доступное время учитывает график подразделения и число задействованных ресурсов.
        </div>}
        {deptLoad && (
          <>
            <div style={{ fontSize: 12, color: '#8FA3BD', marginBottom: 8 }}>
              Проект: <b>{deptLoad.project_name}</b> · итого спрос <b>{deptLoad.totals?.demand_text}</b> · пик нагрузки <b style={{ color: (deptLoad.totals?.peak_percent || 0) > 100 ? '#F87171' : '#FCD34D' }}>{deptLoad.totals?.peak_percent}%</b>
            </div>
            {depts.length === 0 && <div style={{ fontSize: 12.5, color: '#5A7090' }}>Нет данных: у проекта нет операций или ресурсы не закреплены за подразделениями.</div>}
            {depts.length > 0 && (
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr>
                  <th>Подразделение</th><th>Спрос</th><th>Доступно</th><th>Загрузка</th><th>Операций</th><th>Ресурсов</th><th>Раб. дней</th>
                </tr></thead>
                <tbody>
                  {depts.map((d: any) => (
                    <tr key={d.department_name} title={d.department_id ? 'Подразделение проекта' : 'Ресурсы без подразделения'}>
                      <td>{d.department_name}</td>
                      <td className="t-mono">{d.demand_text}</td>
                      <td className="t-mono">{d.capacity_text}</td>
                      <td className="t-mono" style={{ color: d.load_percent > 100 ? '#F87171' : d.load_percent > 80 ? '#FCD34D' : '#86EFAC' }}>{d.load_percent}%</td>
                      <td className="t-mono" style={{ color: '#8FA3BD' }}>{d.operations}</td>
                      <td className="t-mono" style={{ color: '#8FA3BD' }}>{d.resource_count}</td>
                      <td className="t-mono" style={{ color: '#5A7090' }}>{d.period_work_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* ── Межпроектное выравнивание ── */}
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">⚖ Межпроектное выравнивание</span>
          <span style={{ marginLeft: 'auto' }}>
            <button type="button" onClick={runLeveling} disabled={busy}
              style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {busy ? '…' : '▶ Предложить сдвиги'}
            </button>
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: '#8FA3BD', marginBottom: 8 }}>
          Отметьте проекты — система упорядочит их по приоритету и предложит сдвиги так, чтобы общие ресурсы не использовались одновременно. Применение сдвигов — отдельным шагом (фаза 3).
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          {(projects || []).map(p => (
            <label key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: '#CBD5E1' }}>
              <input type="checkbox" checked={!!picked[p.id]} onChange={(e) => setPicked(prev => ({ ...prev, [p.id]: e.target.checked }))} style={{ accentColor: '#3B82F6' }} />
              {p.name} <span style={{ color: '#5A7090' }}>{p.priority && p.priority !== 'normal' ? '· ' + p.priority : ''}</span>
            </label>
          ))}
        </div>
        {plan && (
          <>
            <div style={{ fontSize: 12, color: '#8FA3BD', marginBottom: 8 }}>
              перемещено проектов: <b>{plan.summary?.moved ?? 0}</b> из {plan.summary?.projects ?? 0} · конфликтов: <b>{plan.summary?.conflicts ?? 0}</b>
            </div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Проект</th><th>Приоритет</th><th>Текущий старт</th><th>Предлагаемый старт</th><th>Сдвиг</th></tr></thead>
              <tbody>
                {(plan.plan || []).map((x: any) => (
                  <tr key={x.project_id}>
                    <td>{x.project_name}{x.moved ? <span style={{ color: '#FCD34D' }}> · сдвигается</span> : null}</td>
                    <td style={{ color: x.priority === 'high' ? '#86EFAC' : '#8FA3BD' }}>{x.priority}</td>
                    <td className="t-mono">{fmt(x.current_start)}</td>
                    <td className="t-mono" style={{ color: x.moved ? '#FCD34D' : '#86EFAC' }}>{fmt(x.suggested_start)}</td>
                    <td className="t-mono">{x.shift_days ? '+' + x.shift_days + ' дн' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(plan.conflicts || []).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#FCD34D' }}>
                Конфликты: {(plan.conflicts || []).map((c: any) => `${c.a} × ${c.b} (${c.days} дн, ${c.resource})`).join('; ')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
