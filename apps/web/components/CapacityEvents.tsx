'use client';

import { useState, useEffect } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'https://profyplan.ru/api') + '/v1';

type Ev = {
  id?: string;
  resource_id: string;
  project_id?: string | null;
  event_type: string;
  capacity_multiplier?: number | string | null;
  capacity_absolute?: number | string | null;
  reason: string;
  date_from: string;
  date_to: string;
  is_active?: boolean;
};

const TYPE_META: Record<string, { label: string; dot: string; fg: string }> = {
  boost: { label: 'Форсаж', dot: '#22C55E', fg: '#86EFAC' },
  reduced: { label: 'Снижение', dot: '#F59E0B', fg: '#FCD34D' },
  breakdown: { label: 'Простой/поломка', dot: '#EF4444', fg: '#FCA5A5' },
  maintenance: { label: 'ТО', dot: '#38BDF8', fg: '#7DD3FC' },
  modernization: { label: 'Модернизация', dot: '#A78BFA', fg: '#C4B5FD' },
  condition_change: { label: 'Изм. состояния', dot: '#94A3B8', fg: '#CBD5E1' },
  other: { label: 'Прочее', dot: '#64748B', fg: '#94A3B8' },
};
const meta = (t: string) => TYPE_META[t] || TYPE_META.other;

const fmtDT = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} (${p(d.getHours())}:${p(d.getMinutes())})`;
};
// ISO (2026-09-15T08:30:00) → 'ДД.ММ.ГГ ЧЧ:ММ'
const isoToDisp = (s?: string | null) => {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return String(s).slice(0, 16);
  return `${m[3]}.${m[2]}.${m[1].slice(2)} ${m[4]}:${m[5]}`;
};
// 'ДД.ММ.ГГ ЧЧ:ММ' → ISO 'YYYY-MM-DDTHH:MM'
const parseDisp = (s?: string | null) => {
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{2,4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const yy = m[3].length === 4 ? m[3] : '20' + m[3];
  return `${yy}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
};
// маска ввода: цифры → ДД.ММ.ГГ ЧЧ:ММ
const maskDisp = (raw: string) => {
  const d = String(raw).replace(/\D/g, '').slice(0, 10);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '.' + d.slice(2, 4);
  if (d.length > 4) out += '.' + d.slice(4, 6);
  if (d.length > 6) out += ' ' + d.slice(6, 8);
  if (d.length > 8) out += ':' + d.slice(8, 10);
  return out;
};
// диапазон всегда в формате ДД.ММ.ГГ (ЧЧ:ММ)
const fmtRange = (a?: string | null, b?: string | null) => `${fmtDT(a)} – ${fmtDT(b)}`;
const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

export default function CapacityEvents({
  resourceId,
  projectId = null,
  editing = false,
  refreshKey = 0,
  onChanged,
}: {
  resourceId: string;
  projectId?: string | null;
  editing?: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [list, setList] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<Ev | null>(null);
  const [saving, setSaving] = useState(false);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...((opts?.headers as any) || {}) };
    if (tok) h['Authorization'] = `Bea` + `rer ` + tok;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (!r.ok) {
      let msg = `${r.status}`;
      try {
        const j = await r.json();
        const d = j?.detail;
        msg = typeof d === 'string' ? d : Array.isArray(d) ? (d[0]?.msg || JSON.stringify(d)) : (d ? JSON.stringify(d) : msg);
      } catch { try { msg = await r.text(); } catch { } }
      throw new Error(msg);
    }
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  const load = async () => {
    if (!resourceId) return;
    setLoading(true); setErr(null);
    try {
      const all: Ev[] = await af('/resource-events/?resource_id=' + resourceId);
      // показываем события этого проекта + общепроектные (без проекта)
      setList(all.filter((e) => !e.project_id || e.project_id === projectId));
    } catch (e: any) { setErr(String(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [resourceId, refreshKey]);

  const openNew = (event_type: string) =>
    setModal({
      resource_id: resourceId,
      project_id: projectId || null,
      event_type,
      capacity_multiplier: event_type === 'boost' ? 1.25 : event_type === 'reduced' ? 0.6 : (event_type === 'breakdown' ? 0 : null),
      reason: '',
      date_from: '',
      date_to: '',
    });

  const save = async () => {
    if (!modal) return;
    if (!modal.reason.trim()) { setErr('Укажите причину'); return; }
    const fromIso = parseDisp(modal.date_from);
    const toIso = parseDisp(modal.date_to);
    if (!fromIso || !toIso) { setErr('Укажите период в формате ДД.ММ.ГГ ЧЧ:ММ'); return; }
    setSaving(true); setErr(null);
    try {
      const body: any = {
        resource_id: modal.resource_id,
        project_id: modal.project_id || null,
        event_type: modal.event_type,
        capacity_multiplier: num(modal.capacity_multiplier),
        capacity_absolute: num(modal.capacity_absolute),
        reason: modal.reason.trim(),
        date_from: fromIso,
        date_to: toIso,
      };
      if (modal.id) await af('/resource-events/' + modal.id, { method: 'PUT', body: JSON.stringify(body) });
      else await af('/resource-events/', { method: 'POST', body: JSON.stringify(body) });
      setModal(null);
      await load();
      onChanged?.();
    } catch (e: any) { setErr(String(e)); }
    setSaving(false);
  };

  const del = async () => {
    if (!modal?.id) return;
    setSaving(true); setErr(null);
    try {
      await af('/resource-events/' + modal.id, { method: 'DELETE' });
      setModal(null);
      await load();
      onChanged?.();
    } catch (e: any) { setErr(String(e)); }
    setSaving(false);
  };

  const now = Date.now();
  const isActive = (e: Ev) =>
    e.is_active !== false && new Date(e.date_from).getTime() <= now && new Date(e.date_to).getTime() >= now;

  return (
    <div style={{ marginTop: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#5A7090' }}>Мощность:</span>
        <span style={{ fontSize: 11, color: '#8FA3BD' }}>норма ×1.0</span>
        {list.filter(isActive).map((e) => {
          const m = meta(e.event_type);
          return (
            <span key={e.id} title={`${m.label}${e.capacity_multiplier ? ' ×' + num(e.capacity_multiplier) : ''} · ${e.reason}`}
              style={{ fontSize: 10.5, color: m.fg, border: `1px solid ${m.dot}55`, borderRadius: 10, padding: '1px 7px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, display: 'inline-block' }} />
              {m.label}{e.capacity_multiplier ? ' ×' + num(e.capacity_multiplier) : ''}
            </span>
          );
        })}
        {editing && (
          <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button type="button" onClick={() => openNew('boost')} title="Форсаж — повышение мощности на период"
              style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.4)', color: '#86EFAC', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>＋ Форсаж</button>
            <button type="button" onClick={() => openNew('reduced')} title="Ограничение — снижение мощности на период"
              style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>＋ Ограничение</button>
            <button type="button" onClick={() => openNew('breakdown')} title="Простой/поломка — ресурс недоступен (мощность 0) на период"
              style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>＋ Простой/поломка</button>
          </span>
        )}
      </div>

      {list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
          {list.map((e) => {
            const m = meta(e.event_type);
            return (
              <div key={e.id} onClick={() => editing && setModal({ ...e, date_from: isoToDisp(e.date_from), date_to: isoToDisp(e.date_to) })}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#CBD5E1', cursor: editing ? 'pointer' : 'default', padding: '2px 4px', borderRadius: 5, opacity: e.is_active === false ? 0.45 : 1 }}
                title={editing ? 'Клик — редактировать' : undefined}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                <span style={{ color: '#8FA3BD', flexShrink: 0 }}>{fmtRange(e.date_from, e.date_to)}</span>
                <span style={{ color: m.fg, flexShrink: 0 }}>{m.label}{e.capacity_multiplier ? ' ×' + num(e.capacity_multiplier) : ''}</span>
                <span style={{ color: '#7C93B3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.reason}</span>
              </div>
            );
          })}
        </div>
      )}
      {err && !modal && <div style={{ fontSize: 11, color: '#FCA5A5', marginTop: 4 }}>{err}</div>}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,12,24,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
          onClick={() => !saving && setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#0F1E36', border: '1px solid #1E3A5F', borderRadius: 10, padding: 18, width: 420, maxWidth: '92vw' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#E8EEF5', marginBottom: 12 }}>
              {modal.id ? 'Событие мощности' : 'Новое событие мощности'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>Тип</span>
                <select value={modal.event_type} onChange={(e) => { const et = e.target.value; setModal((m) => m ? { ...m, event_type: et, capacity_multiplier: et === 'breakdown' ? 0 : (m.capacity_multiplier ?? (et === 'boost' ? 1.25 : et === 'reduced' ? 0.6 : null)) } : m); }}
                  style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
                  {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>Коэффициент мощности</span>
                <input type="number" step="0.05" min="0.01" value={modal.capacity_multiplier ?? ''}
                  onChange={(e) => setModal({ ...modal, capacity_multiplier: e.target.value })}
                  placeholder="1.25 / 0.6"
                  style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>С — ДД.ММ.ГГ ЧЧ:ММ</span>
                <input value={modal.date_from} onChange={(e) => setModal({ ...modal, date_from: maskDisp(e.target.value) })}
                  placeholder="15.09.26 08:30" inputMode="numeric"
                  style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>По — ДД.ММ.ГГ ЧЧ:ММ</span>
                <input value={modal.date_to} onChange={(e) => setModal({ ...modal, date_to: maskDisp(e.target.value) })}
                  placeholder="16.09.26 17:45" inputMode="numeric"
                  style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>Причина (обязательно)</span>
                <input value={modal.reason} onChange={(e) => setModal({ ...modal, reason: e.target.value })}
                  placeholder="сдача объекта / ремонт ходовой / аварийный заказ"
                  style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12 }} />
              </label>
            </div>
            {err && <div style={{ fontSize: 11.5, color: '#FCA5A5', marginTop: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={save} disabled={saving}
                style={{ background: '#3B82F6', border: '1px solid #3B82F6', color: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Сохранение…' : '✓ Сохранить'}
              </button>
              {modal.id && (
                <button type="button" onClick={del} disabled={saving}
                  style={{ background: 'transparent', border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>Удалить</button>
              )}
              <button type="button" onClick={() => setModal(null)} disabled={saving}
                style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
