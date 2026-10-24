'use client';

import { useEffect, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const STATUS_LABEL: any = {
  posted: 'проведён',
  cancelled: 'отменён',
  draft: 'черновик',
};

/** Компактная история фактов, пришедших из 1С. */
export default function IntegrationFacts({ projectId, api }: { projectId?: string | null; api: Api }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) { setItems([]); return; }
    let alive = true;
    setLoading(true);
    api(`/integration/projects/${projectId}/facts`)
      .then((r: any) => { if (alive) setItems(r?.items || []); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, api]);

  if (!loading && items.length === 0) return null;

  return (
    <div style={{ background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#E8EEF5' }}>Факты из 1С</span>
        <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>изменения после последнего расчёта</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#60A5FA' }}>{items.length}</span>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {items.slice(0, 10).map((f) => (
          <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5, padding: '4px 6px', borderBottom: '1px solid #16294A' }}>
            <span style={{ color: '#93C5FD', minWidth: 120 }}>{f.fact_label}</span>
            <span style={{ color: '#E8EEF5' }}>
              {f.quantity != null ? `${f.quantity} шт.` : ''}
              {f.hours != null ? ` · ${f.hours} ч` : ''}
            </span>
            <span style={{ color: '#8FA3BD' }}>{f.fact_date || ''}</span>
            <span style={{ color: f.status === 'cancelled' ? '#F87171' : '#4ADE80' }}>{STATUS_LABEL[f.status] || f.status}</span>
          </div>
        ))}
      </div>
      {items.length > 10 && <div style={{ fontSize: 11, color: '#5A7090', marginTop: 5 }}>Показаны первые 10 из {items.length}.</div>}
    </div>
  );
}
