'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_V1 } from '@/lib/api';

const API = API_V1;

const fmt = (s?: string | null) => {
  if (!s) return '—';
  const d = String(s).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0].slice(2)}` : String(s);
};

/** Дашборд ресурса: часы, мощность, проекты, конфликты, потери. */
export default function ResourceDashboard({
  resource,
  onClose,
}: {
  resource: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const [load, setLoad] = useState<any>(null);
  const [lost, setLost] = useState<any>(null);

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
    if (!resource?.id) return;
    setLoading(true);
    try {
      const [us, ov, lh] = await Promise.all([
        af('/ccm/resource-usage').catch(() => null),
        af('/ccm/resource-overload').catch(() => null),
        af('/reports/lost-hours').catch(() => null),
      ]);
      setUsage(((us || []).find((x: any) => x.id === resource.id)) || null);
      setLoad(((ov?.resources || []).find((x: any) => x.id === resource.id)) || null);
      setLost(((lh?.by_resource || []).find((x: any) => x.resource_id === resource.id)) || null);
    } finally { setLoading(false); }
  }, [resource?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!resource) return null;

  const caps = usage?.capacity_factor;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,12,24,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#0F1E36', border: '1px solid #1E3A5F', borderRadius: 12, padding: 18, width: 640, maxWidth: '94vw', maxHeight: '86vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📊 Ресурс: {resource.name}</span>
          <button type="button" onClick={refresh} disabled={loading}
            style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {loading ? '…' : '▶ Обновить'}
          </button>
          <button type="button" onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Закрыть</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          <div className="kpi-card" title="Плановые часы по всем проектам, где задействован ресурс">
            <div className="kpi-label">Часы (план)</div>
            <div className="kpi-val" style={{ fontSize: 17 }}>{usage?.total_text || '—'}</div>
            <div className="kpi-sub">{usage?.project_count ?? 0} проектов</div>
          </div>
          <div className="kpi-card" title="Часы с учётом эффективной мощности: доля ресурса в проекте и квота подразделения">
            <div className="kpi-label">С мощностью</div>
            <div className="kpi-val g" style={{ fontSize: 17 }}>{usage?.capacity_text || '—'}</div>
            <div className="kpi-sub">{caps && caps !== 1 ? '×' + caps : 'норма'}</div>
          </div>
          <div className="kpi-card" title="Потери по событиям мощности: простой и снижение мощности">
            <div className="kpi-label">Потери</div>
            <div className="kpi-val r" style={{ fontSize: 17 }}>{usage?.lost_text || '0 мин'}</div>
            <div className="kpi-sub">событий: {usage?.events_count ?? 0}</div>
          </div>
          <div className="kpi-card" title="Дополнительная выработка за счёт форсажа">
            <div className="kpi-label">Выработка</div>
            <div className="kpi-val" style={{ fontSize: 17, color: '#86EFAC' }}>{usage?.extra_text || '0 мин'}</div>
            <div className="kpi-sub">форсаж</div>
          </div>
        </div>

        <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>🏗 Проекты, использующие ресурс</div>
          {!(load?.assignments || []).length && <div style={{ fontSize: 12, color: '#5A7090' }}>Ресурс пока не задействован в проектах.</div>}
          {(load?.assignments || []).map((a: any) => (
            <div key={a.project_id} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#CBD5E1', padding: '3px 0', borderBottom: '1px dashed rgba(30,58,95,.5)' }}
              title={`доля мощности: ${a.capacity_share}${a.quota_share && a.quota_share !== 1 ? ' · квота: ' + a.quota_share : ''}`}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.project_name}</span>
              <span className="t-mono" style={{ color: '#8FA3BD' }}>{a.hours_text}</span>
              <span className="t-mono" style={{ color: '#5A7090', width: 150, textAlign: 'right' }}>{fmt(a.start)} – {fmt(a.finish)}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>⚠ Конфликты по общим ресурсам</div>
            {!(load?.conflicts || []).length && <div style={{ fontSize: 12, color: '#86EFAC' }}>Конфликтов нет.</div>}
            {(load?.conflicts || []).slice(0, 5).map((c: any, i: number) => (
              <div key={i} style={{ fontSize: 11.5, color: '#CBD5E1', padding: '3px 0' }}>
                <span style={{ color: c.severity === 'high' ? '#F87171' : c.severity === 'medium' ? '#FCD34D' : '#8FA3BD' }}>●</span>{' '}
                {c.a} × {c.b} · {c.days} дн ({fmt(c.from)}–{fmt(c.to)})
              </div>
            ))}
          </div>
          <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8FA3BD', marginBottom: 8 }}>📉 Потери по причинам</div>
            {!(lost?.by_reason || []).length && <div style={{ fontSize: 12, color: '#5A7090' }}>Потерь нет.</div>}
            {(lost?.by_reason || []).slice(0, 5).map((r: any) => (
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
