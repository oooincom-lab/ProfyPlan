'use client';

import { useState, useEffect } from 'react';
import ReferenceField from '@/components/ReferenceField';

const API = (process.env.NEXT_PUBLIC_API_URL || 'https://profyplan.ru/api') + '/v1';

type Q = {
  id: string;
  department_id: string;
  resource_id: string;
  quota_share: number | string;
  is_active?: boolean;
  resource_name?: string | null;
};

/** Квоты ресурсов подразделения: доля мощности ресурса, доступная подразделению. */
export default function DepartmentQuotas({
  departmentId,
  onOpenDirPick,
}: {
  departmentId: string;
  onOpenDirPick?: (entity: string, ctx?: any) => void;
}) {
  const [list, setList] = useState<Q[]>([]);
  const [resId, setResId] = useState<string | null>(null);
  const [share, setShare] = useState('100');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...((opts?.headers as any) || {}) };
    if (tok) h['Authorization'] = `Bea` + `rer ` + tok;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (!r.ok) {
      let m = String(r.status);
      try {
        const j = await r.json();
        const d = j?.detail;
        m = typeof d === 'string' ? d : Array.isArray(d) ? (d[0]?.msg || JSON.stringify(d)) : (d ? JSON.stringify(d) : m);
      } catch { try { m = await r.text(); } catch { /* ignore */ } }
      throw new Error(m);
    }
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  const load = async () => {
    if (!departmentId) return;
    try {
      setList(await af('/department-quotas?department_id=' + departmentId));
      setErr(null);
    } catch (e: any) { setErr(String(e.message || e)); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [departmentId]);

  const add = async () => {
    if (!resId) { setErr('Выберите ресурс'); return; }
    const pct = parseFloat(String(share).replace(',', '.'));
    if (Number.isNaN(pct) || pct < 0 || pct > 100) { setErr('Доля — от 0 до 100 %'); return; }
    setBusy(true); setErr(null);
    try {
      await af('/department-quotas', {
        method: 'POST',
        body: JSON.stringify({ department_id: departmentId, resource_id: resId, quota_share: pct / 100 }),
      });
      setResId(null); setShare('100');
      await load();
    } catch (e: any) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const upd = async (q: Q, pct: number) => {
    setBusy(true); setErr(null);
    try {
      await af('/department-quotas/' + q.id, { method: 'PUT', body: JSON.stringify({ quota_share: pct / 100 }) });
      await load();
    } catch (e: any) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const del = async (q: Q) => {
    setBusy(true); setErr(null);
    try {
      await af('/department-quotas/' + q.id, { method: 'DELETE' });
      await load();
    } catch (e: any) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const pctOf = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1000) / 10 : 100;
  };

  return (
    <div style={{ marginTop: 6, borderTop: '1px solid #1E3252', paddingTop: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#5A7090', fontWeight: 600, marginBottom: 8 }}>
        ⚖ Квоты ресурсов подразделения
      </div>
      {list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {list.map((q) => (
            <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: '5px 9px' }}>
              <span style={{ flex: 1, fontSize: 12.5, color: '#E8EEF5' }}>{q.resource_name || q.resource_id.slice(0, 8)}</span>
              <input
                type="number" min="0" max="100" step="5"
                defaultValue={pctOf(q.quota_share)}
                key={q.id + ':' + String(q.quota_share)}
                onBlur={(e) => {
                  const v = parseFloat(String(e.target.value).replace(',', '.'));
                  if (!Number.isNaN(v) && v >= 0 && v <= 100 && Math.abs(v - pctOf(q.quota_share)) > 0.01) upd(q, v);
                }}
                style={{ width: 78, background: '#0F1E36', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '4px 7px', fontSize: 12 }}
              />
              <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>% мощности</span>
              <button type="button" title="Удалить квоту" onClick={() => del(q)} disabled={busy}
                style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)', color: '#F87171', borderRadius: 5, width: 22, height: 22, fontSize: 12, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {list.length === 0 && (
        <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>
          Квот нет — ресурсы доступны подразделению на полную мощность.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ReferenceField
          entity="resources"
          value={resId}
          displayValue={undefined}
          onChange={() => {}}
          onPickItem={(row: any) => setResId(String(row.id))}
          onOpenBrowser={onOpenDirPick}
          placeholder="+ Ресурс для квоты"
          style={{ flex: 1, minWidth: 200 }}
        />
        <input type="number" min="0" max="100" step="5" value={share} onChange={(e) => setShare(e.target.value)}
          style={{ width: 78, background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '6px 8px', fontSize: 12 }} />
        <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>%</span>
        <button type="button" onClick={add} disabled={busy}
          style={{ background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Добавить</button>
      </div>
      {err && <div style={{ fontSize: 11.5, color: '#FCA5A5', marginTop: 6 }}>{err}</div>}
    </div>
  );
}
