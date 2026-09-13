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
const MAX_GANTT = 6;

const fmtDay = (s?: string | null) => {
  if (!s) return '';
  const d = String(s).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}` : '';
};

/** Портфельные виджеты рабочего стола: KPI, мини-Гант проектов, конфликты ресурсов, потери. */
export default function PortfolioWidgets({
  projects,
  onOpen,
}: {
  projects: any[];
  onOpen?: (p: any) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [ov, setOv] = useState<any>(null);
  const [lost, setLost] = useState<any>(null);
  const [bars, setBars] = useState<any[]>([]);

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
    if (!projects?.length) return;
    setLoading(true);
    try {
      const [overload, lh] = await Promise.all([
        af('/ccm/resource-overload').catch(() => null),
        af('/reports/lost-hours').catch(() => null),
      ]);
      setOv(overload);
      setLost(lh);

      // мини-Гант: расписание по первым проектам (ограничиваем, чтобы не грузить систему)
      const list = projects.slice(0, MAX_GANTT);
      const res = await Promise.all(list.map(async (p: any) => {
        try {
          const sc = await af(`/projects/${p.id}/calculate/schedule`, { method: 'POST', body: JSON.stringify({}) });
          return {
            id: p.id, name: p.name, project: p,
            start: sc?.project_start_date, finish: sc?.project_finish_date,
            days: sc?.total_duration_days, warnings: (sc?.warnings || []).length,
          };
        } catch { return { id: p.id, name: p.name, project: p, start: null, finish: null, days: null, warnings: 0 }; }
      }));
      setBars(res);
    } finally { setLoading(false); }
  }, [projects]);

  useEffect(() => { refresh(); }, [refresh]);

  const conflicted = (ov?.resources || []).filter((r: any) => r.has_conflict);
  const totals = ov?.totals || {};
  const lostTotals = lost?.totals || {};

  const starts = bars.map(b => b.start).filter(Boolean).map((s: string) => new Date(s).getTime());
  const finishes = bars.map(b => b.finish).filter(Boolean).map((s: string) => new Date(s).getTime());
  const t0 = starts.length ? Math.min(...starts) : null;
  const t1 = finishes.length ? Math.max(...finishes) : null;
  const span = t0 != null && t1 != null && t1 > t0 ? (t1 - t0) : 0;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#93C5FD' }}>🗂 Портфель проектов</span>
        <button type="button" onClick={refresh} disabled={loading}
          style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: loading ? .6 : 1 }}>
          {loading ? 'Расчёт…' : '▶ Обновить'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
        <div className="kpi-card" title="Проекты, доступные пользователю">
          <div className="kpi-label">Проектов</div>
          <div className="kpi-val">{projects.length}</div>
          <div className="kpi-sub">в портфеле</div>
        </div>
        <div className="kpi-card" title="Общие ресурсы, используемые несколькими проектами в пересекающиеся периоды">
          <div className="kpi-label">Конфликты ресурсов</div>
          <div className="kpi-val" style={{ color: conflicted.length ? '#FCD34D' : '#86EFAC' }}>{conflicted.length}</div>
          <div className="kpi-sub">{totals.conflicts ?? 0} пересечений</div>
        </div>
        <div className="kpi-card" title="Потери времени по событиям мощности (простой, снижение) по всем проектам">
          <div className="kpi-label">Потери (события)</div>
          <div className="kpi-val r" style={{ fontSize: 20 }}>{lostTotals.lost_text || '0 мин'}</div>
          <div className="kpi-sub">выработка: {lostTotals.extra_text || '0 мин'}</div>
        </div>
        <div className="kpi-card" title="Сколько событий мощности зафиксировано в портфеле">
          <div className="kpi-label">Событий мощности</div>
          <div className="kpi-val g" style={{ fontSize: 20 }}>{lostTotals.events ?? 0}</div>
          <div className="kpi-sub">форсаж / простой / ТО</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>📊 Мини-Гант портфеля <span style={{ color: '#5A7090', fontWeight: 400 }}>(первые {MAX_GANTT} проекта){t0 != null && t1 != null ? ` · ${fmtDay(new Date(t0).toISOString())}–${fmtDay(new Date(t1).toISOString())}` : ''}</span></div>
          {bars.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Нет проектов для отображения.</div>}
          {bars.map((b: any) => {
            const s = b.start ? new Date(b.start).getTime() : null;
            const f = b.finish ? new Date(b.finish).getTime() : null;
            const left = (span && s != null && t0 != null) ? ((s - t0) / span) * 100 : 0;
            const width = (span && s != null && f != null) ? Math.max(((f - s) / span) * 100, 2) : 2;
            const hasConflict = conflicted.some((r: any) => (r.assignments || []).some((a: any) => a.project_id === b.id));
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span onClick={() => onOpen && onOpen(b.project)} title={b.name + (b.days ? ` · ${Number(b.days).toFixed(1).replace(".", ",")} дн` : '')}
                  style={{ fontSize: 11.5, color: '#CBD5E1', width: 150, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onOpen ? 'pointer' : 'default' }}>
                  {b.finish ? '🟢' : '⚪'} {b.name}
                </span>
                <div style={{ position: 'relative', flex: 1, height: 14, background: '#0F1E36', borderRadius: 3, minWidth: 120 }}>
                  {b.start && b.finish && (
                    <div style={{ position: 'absolute', left: left + '%', top: 0, height: '100%', width: width + '%', borderRadius: 3,
                      background: hasConflict ? 'rgba(245,158,11,.55)' : 'rgba(59,130,246,.55)',
                      border: '1px solid ' + (hasConflict ? 'rgba(245,158,11,.8)' : 'rgba(96,165,250,.7)') }} />
                  )}
                  {!b.finish && <div style={{ position: 'absolute', left: 6, top: 2, fontSize: 10, color: '#5A7090' }}>нет операций для расчёта</div>}
                </div>
                <span className="t-mono" style={{ fontSize: 11, color: '#8FA3BD', width: 52, textAlign: 'right', flexShrink: 0 }}>{b.days != null ? b.days + ' дн' : '—'}</span>
                {b.warnings > 0 && <span style={{ fontSize: 11, color: '#FCD34D', flexShrink: 0 }} title={`${b.warnings} предупреждений расчёта`}>⚠{b.warnings}</span>}
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: '#5A7090', marginTop: 6 }}>
            Синяя полоса — проект, оранжевая — есть конфликт по общим ресурсам. Клик по названию открывает проект.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>⚠ Конфликтные общие ресурсы</div>
            {conflicted.length === 0 && <div style={{ fontSize: 12, color: '#86EFAC' }}>Конфликтов нет.</div>}
            {conflicted.slice(0, 4).map((r: any) => (
              <div key={r.id} style={{ fontSize: 11.5, color: '#CBD5E1', padding: '3px 0', borderBottom: '1px dashed rgba(30,58,95,.5)' }}
                title={r.name + ' · перекрытие ' + (r.overlap_days || 0) + ' дн'}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ color: r.severity === 'high' ? '#F87171' : r.severity === 'medium' ? '#FCD34D' : '#8FA3BD' }}>{r.overlap_days} дн</span>
                </div>
                <div style={{ fontSize: 10.5, color: '#5A7090' }}>
                  {(r.assignments || []).map((a: any) => a.project_name).join(' · ')}
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>📉 Потери по причинам</div>
            {!(lost?.by_reason || []).length && <div style={{ fontSize: 12, color: '#5A7090' }}>Записей нет.</div>}
            {(lost?.by_reason || []).slice(0, 4).map((r: any) => (
              <div key={r.reason} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#CBD5E1', padding: '3px 0' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason}>{r.reason}</span>
                <span style={{ color: '#FCA5A5' }}>{r.lost_text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
