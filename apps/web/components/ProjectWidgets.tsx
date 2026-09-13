'use client';

import { useCallback, useEffect, useState } from 'react';

function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8000';
  }
  return env || 'https://profyplan.ru/api';
}
const API = resolveApiBase() + '/v1';

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = String(s).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0].slice(2)}` : String(s);
};

/** Виджеты проекта: KPI расчёта, загрузка по неделям, события мощности и потери, риск PERT. */
export default function ProjectWidgets({ projectId }: { projectId?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sched, setSched] = useState<any>(null);
  const [load, setLoad] = useState<any>(null);
  const [lost, setLost] = useState<any>(null);
  const [pert, setPert] = useState<any>(null);
  const [conflicts, setConflicts] = useState<number | null>(null);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...((opts?.headers as any) || {}) };
    if (tok) h['Authorization'] = 'Bea' + 'rer ' + tok;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (!r.ok) throw new Error(`${r.status}`);
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setErr(null);
    try {
      const [sc, rl, lh, pt, ov] = await Promise.all([
        af(`/projects/${projectId}/calculate/schedule`, { method: 'POST', body: JSON.stringify({}) }).catch(() => null),
        af(`/reports/resource-loading?project_id=${projectId}&weeks=6`).catch(() => null),
        af(`/reports/lost-hours?project_id=${projectId}`).catch(() => null),
        af(`/ccm/projects/${projectId}/pert`, { method: 'POST', body: JSON.stringify({}) }).catch(() => null),
        af('/ccm/resource-overload').catch(() => null),
      ]);
      setSched(sc); setLoad(rl); setLost(lh); setPert(pt);
      let n = 0;
      for (const r of ((ov || {}).resources || [])) {
        const mine = (r.assignments || []).some((a: any) => a.project_id === projectId);
        if (mine) n += (r.conflicts || []).length;
      }
      setConflicts(n);
    } catch (e: any) { setErr(String(e?.message || e)); }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!projectId) return null;

  const finish = sched?.project_finish_date;
  const days = sched?.total_duration_days;
  const critCount = (sched?.critical_path || []).length;
  const warns = (sched?.warnings || []).length;
  const weeks: any[] = (load?.weeks || []).filter((w: any) => w.demand_hours > 0);
  const peak = load?.totals?.peak_percent ?? 0;
  const sigma = pert?.total_std_dev;

  const kpi = 'kpi-card';
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#93C5FD' }}>📊 Сводка расчёта проекта</span>
        <button type="button" onClick={refresh} disabled={loading}
          style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: loading ? .6 : 1 }}>
          {loading ? 'Расчёт…' : '▶ Рассчитать проект'}
        </button>
        {err && <span style={{ fontSize: 11.5, color: '#FCA5A5' }}>ошибка: {err}</span>}
        {loading && !sched && <span style={{ fontSize: 11.5, color: '#5A7090' }}>считаем…</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
        <div className={kpi} title="Дата окончания проекта по календарному расчёту с учётом графиков работы, событий мощности, долей и квот">
          <div className="kpi-label">Финиш проекта</div>
          <div className="kpi-val" style={{ fontSize: 20 }}>{fmtDate(finish)}</div>
          <div className="kpi-sub">{days != null ? days + ' дн' : 'нет расчёта'}</div>
        </div>
        <div className={kpi} title="Операции на критическом пути: их задержка сдвигает весь проект">
          <div className="kpi-label">Критический путь</div>
          <div className="kpi-val r" style={{ fontSize: 20 }}>{critCount}</div>
          <div className="kpi-sub">{warns > 0 ? warns + ' предупр.' : 'без предупреждений'}</div>
        </div>
        <div className={kpi} title="Пересечения по общим ресурсам с другими проектами (CCM)">
          <div className="kpi-label">Конфликты ресурсов</div>
          <div className="kpi-val" style={{ fontSize: 20, color: conflicts ? '#FCD34D' : '#86EFAC' }}>{conflicts ?? '—'}</div>
          <div className="kpi-sub">{conflicts ? 'есть пересечения' : 'нет пересечений'}</div>
        </div>
        <div className={kpi} title="Разброс срока по PERT: чем больше σ, тем выше неопределённость оценок операций">
          <div className="kpi-label">Риск PERT</div>
          <div className="kpi-val" style={{ fontSize: 20, color: (sigma ?? 0) > 0 ? '#FCD34D' : '#8FA3BD' }}>σ {sigma ?? '—'}</div>
          <div className="kpi-sub">{pert?.confidence_68 && typeof pert.confidence_68.low === 'number' ? `± ${Number(pert.confidence_68.high - pert.confidence_68.low).toFixed(1).replace('.', ',')} дн` : pert?.confidence_68 ? `68%: ${fmtDateShort(pert.confidence_68.low)}–${fmtDateShort(pert.confidence_68.high)}` : '—'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
        <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>
            📈 Загрузка по неделям {peak ? <span style={{ color: peak > 100 ? '#F87171' : peak > 80 ? '#FCD34D' : '#86EFAC' }}>· пик {peak}%</span> : null}
          </div>
          {weeks.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Нет данных о загрузке — нужен расчёт проекта с операциями.</div>}
          {weeks.map((w: any) => (
            <div key={w.week_start} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span className="t-mono" style={{ fontSize: 11, color: '#8FA3BD', width: 86, flexShrink: 0 }}>
                {w.week_start.slice(8, 10)}.{w.week_start.slice(5, 7)}–{w.week_end.slice(8, 10)}.{w.week_end.slice(5, 7)}
              </span>
              <div style={{ position: 'relative', flex: 1, height: 12, background: '#0F1E36', borderRadius: 3, minWidth: 90 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(w.load_percent, 100)}%`, borderRadius: 3, background: w.load_percent > 100 ? '#EF4444' : w.load_percent > 80 ? '#F59E0B' : '#22C55E' }} />
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: '#8FA3BD', width: 44, textAlign: 'right', flexShrink: 0 }}>{w.load_percent}%</span>
            </div>
          ))}
        </div>

        <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>⚡ События мощности и потери</div>
          {!lost && <div style={{ fontSize: 12, color: '#5A7090' }}>Нет данных.</div>}
          {lost && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#FCA5A5' }}>потери: <b>{lost.totals?.lost_text || '0 мин'}</b></span>
                <span style={{ fontSize: 12, color: '#86EFAC' }}>выработка: <b>{lost.totals?.extra_text || '0 мин'}</b></span>
                <span style={{ fontSize: 12, color: '#8FA3BD' }}>событий: <b>{lost.totals?.events ?? 0}</b></span>
              </div>
              <div style={{ maxHeight: 96, overflow: 'auto' }}>
                {(lost.by_reason || []).slice(0, 4).map((r: any) => (
                  <div key={r.reason} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#CBD5E1', padding: '2px 0' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason}>{r.reason}</span>
                    <span style={{ color: '#FCA5A5' }}>{r.lost_text}</span>
                    <span style={{ color: '#86EFAC' }}>{r.extra_text}</span>
                  </div>
                ))}
                {!(lost.by_reason || []).length && <div style={{ fontSize: 11.5, color: '#5A7090' }}>Событий нет.</div>}
              </div>
            </>
          )}
          {(pert?.warnings || []).length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#FCD34D', borderTop: '1px dashed rgba(30,58,95,.7)', paddingTop: 6 }}>
              ⚠ {pert.warnings[0]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtDateShort(s?: string | null) {
  if (!s) return '—';
  const d = String(s).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}` : String(s);
}
