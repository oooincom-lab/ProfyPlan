'use client';

import { useEffect, useMemo, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit' };
const btn: any = { background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 7, padding: '6px 11px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };
const btnP: any = { ...btn, background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600 };
const kindLabel: any = { service: 'Услуга', work: 'Работа' };
const statusColor: any = { completed: '#4ADE80', closed: '#4ADE80', cancelled: '#F87171', in_progress: '#60A5FA' };

export default function WorkOrdersView({ api, projects, notify, onOpenProject }: {
  api: Api;
  projects: any[];
  notify: (m: string) => void;
  onOpenProject?: (p: any) => void;
}) {
  const active = (projects || []).filter((p: any) => p.status !== 'archived');
  const [pid, setPid] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api('/work-orders' + (pid ? `?project_id=${encodeURIComponent(pid)}` : ''));
      setItems(Array.isArray(r) ? r : (r?.items || []));
    } catch (e: any) {
      setErr('Не удалось загрузить заказ-наряды: ' + String(e?.message || e));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [pid]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((w: any) => {
      const text = `${w.number || ''} ${w.ext_uid || ''} ${(w.lines || []).map((l: any) => `${l.nomenclature_name || ''} ${l.work_type_name || ''} ${l.executor_uid || ''}`).join(' ')}`.toLowerCase();
      return text.includes(s);
    });
  }, [items, q]);

  const projectName = (id: string) => (projects || []).find((p: any) => p.id === id)?.name || id;

  return (
    <div style={{ padding: '4px 2px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Заказ-наряды</div>
        <div style={{ fontSize: 11.5, color: '#5A7090' }}>Работы и услуги, исполнители и КТУ из 1С</div>
      </div>

      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>Проект</span>
        <select style={{ ...inp, minWidth: 240 }} value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">Все проекты</option>
          {active.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input style={{ ...inp, minWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по номеру, работе, исполнителю" />
        <button style={btnP} disabled={loading} onClick={() => void load()}>{loading ? 'Загрузка…' : 'Обновить'}</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8FA3BD' }}>Найдено: {filtered.length}</span>
      </div>

      {err && <div style={{ ...card, borderColor: 'rgba(248,113,113,.5)', color: '#F87171', fontSize: 12.5 }}>{err}</div>}
      {!loading && !err && filtered.length === 0 && (
        <div style={{ ...card, color: '#8FA3BD', fontSize: 12.5 }}>
          Заказ-нарядов пока нет. Они появятся после импорта пакета `orders` с `order_type=work_order`.
        </div>
      )}

      {filtered.map((w: any) => (
        <div key={w.id} style={card}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{w.number || w.ext_id || 'Без номера'}</div>
              <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 2 }}>
                {w.doc_date || '—'} · {w.project_id ? projectName(w.project_id) : (w.pending_project_uid ? 'Проект не сопоставлен' : 'Без проекта')}
              </div>
            </div>
            <span style={{ fontSize: 11.5, color: statusColor[w.status] || '#B0C4DE', border: '1px solid #1E3252', borderRadius: 999, padding: '2px 8px' }}>{w.status || 'draft'}</span>
            {w.project_id && onOpenProject && (
              <button style={btn} onClick={() => { const p = (projects || []).find((x: any) => x.id === w.project_id); if (p) onOpenProject(p); }}>Открыть проект</button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: '#8FA3BD', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <th style={{ padding: '6px' }}>Работа / услуга</th>
                  <th style={{ padding: '6px' }}>Вид</th>
                  <th style={{ padding: '6px' }}>Кол-во</th>
                  <th style={{ padding: '6px' }}>Часы</th>
                  <th style={{ padding: '6px' }}>Исполнители</th>
                </tr>
              </thead>
              <tbody>
                {(w.lines || []).map((l: any) => (
                  <tr key={l.id} style={{ borderTop: '1px solid #1E3252', verticalAlign: 'top' }}>
                    <td style={{ padding: '7px 6px' }}>
                      <div style={{ fontWeight: 600 }}>{l.work_type_name || l.nomenclature_name || 'Работа'}</div>
                      {l.operation_id && <div style={{ fontSize: 10.5, color: '#5A7090', marginTop: 2 }}>операция {String(l.operation_id).slice(0, 8)}…</div>}
                    </td>
                    <td style={{ padding: '7px 6px', color: '#B0C4DE' }}>{kindLabel[l.nomenclature_kind] || l.nomenclature_kind || '—'}</td>
                    <td style={{ padding: '7px 6px', color: '#B0C4DE' }}>{Number(l.quantity || 0)} {l.unit || ''}</td>
                    <td style={{ padding: '7px 6px', color: '#B0C4DE' }}>{Number(l.duration_hours || 0).toFixed(3)}</td>
                    <td style={{ padding: '7px 6px' }}>
                      {(l.executors || []).length === 0 && <span style={{ color: '#F87171' }}>не назначены</span>}
                      {(l.executors || []).map((e: any) => (
                        <span key={e.id} style={{ display: 'inline-flex', gap: 4, margin: '1px 4px 1px 0', padding: '2px 6px', borderRadius: 5, background: e.role === 'primary' ? 'rgba(74,222,128,.12)' : 'rgba(59,130,246,.12)', color: e.role === 'primary' ? '#4ADE80' : '#93C5FD', whiteSpace: 'nowrap' }}>
                          {e.role}: {e.executor_uid || e.resource_uid} · КТУ {Number(e.ktu || 1)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {!(w.lines || []).length && <tr><td colSpan={5} style={{ padding: 12, color: '#8FA3BD' }}>Строк работ нет.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
