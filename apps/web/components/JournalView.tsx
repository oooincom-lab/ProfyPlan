'use client';
// Полный журнал обмена — окно «Журнал обмена · полный»: фильтры, пагинация, детали по клику (окна MDI).
import { useEffect, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 };
const th: any = { textAlign: 'left', color: '#5A7090', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #16294A', fontSize: 11.5 };
const td: any = { padding: '5px 8px', borderBottom: '1px solid #16294A', fontSize: 12, color: '#E8EEF5' };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '5px 8px', fontSize: 12, fontFamily: 'inherit' };
const btn: any = { background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const STATUS_COLOR: any = { ok: '#4ADE80', partial: '#FBBF24', error: '#F87171' };

export default function JournalView({ api, openXlog }: { api: Api; openXlog?: (e: any, items?: any[]) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [kinds, setKinds] = useState<string[]>([]);
  const [conns, setConns] = useState<any[]>([]);
  const [f, setF] = useState<any>({ connection_id: '', kind: '', status: '', direction: '', days: '30' });
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const LIMIT = 200;

  const buildQuery = (off: number) => {
    const p = new URLSearchParams();
    p.set('limit', String(LIMIT));
    p.set('offset', String(off));
    if (f.connection_id) p.set('connection_id', String(f.connection_id));
    if (f.kind) p.set('kind', f.kind);
    if (f.status) p.set('status', f.status);
    if (f.direction) p.set('direction', f.direction);
    if (f.days) p.set('days', String(f.days));
    return p.toString();
  };

  const fetchPage = async (off: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/integration/log?' + buildQuery(off));
      const its = (r && r.items) || [];
      setTotal((r && r.total) || its.length);
      if (r && Array.isArray(r.kinds)) setKinds(r.kinds);
      setItems(prev => (off === 0 ? its : [...prev, ...its]));
      setOffset(off);
    } catch (e: any) {
      setErr('Не удалось загрузить журнал: ' + String((e && e.message) || e).slice(0, 160));
    }
    setBusy(false);
  };

  /* eslint-disable-next-line */
  useEffect(() => { void fetchPage(0); }, [f]);
  /* eslint-disable-next-line */
  useEffect(() => {
    (async () => {
      try { const r = await api('/integration/connections'); setConns((r && r.items) || []); } catch { /* тихо */ }
    })();
  }, []);

  const openDetails = async (x: any) => {
    if (!openXlog) return;
    try {
      const r = await api('/integration/inbox?limit=500');
      const its = ((r && r.items) || []).filter((it: any) => it.log_id === x.id);
      openXlog(x, its);
    } catch { openXlog(x, []); }
  };

  const upd = (patch: any) => setF((cur: any) => ({ ...cur, ...patch }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#B0C4DE' }}>🗂 Полный журнал обмена</span>
        <span style={{ fontSize: 11, color: '#5A7090' }}>двойной клик по записи — подробнее</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#5A7090' }}>Показано: {items.length} из {total}</span>
        <button style={btn} onClick={() => void fetchPage(0)}>🔄 Обновить</button>
      </div>

      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={inp} value={f.connection_id} onChange={(e) => upd({ connection_id: e.target.value })}>
          <option value="">Все подключения</option>
          {conns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <select style={inp} value={f.kind} onChange={(e) => upd({ kind: e.target.value })}>
          <option value="">Все виды</option>
          {kinds.map((k) => (<option key={k} value={k}>{k}</option>))}
        </select>
        <select style={inp} value={f.status} onChange={(e) => upd({ status: e.target.value })}>
          <option value="">Любой статус</option>
          <option value="ok">ok</option>
          <option value="partial">partial</option>
          <option value="error">error</option>
        </select>
        <select style={inp} value={f.direction} onChange={(e) => upd({ direction: e.target.value })}>
          <option value="">Оба направления</option>
          <option value="in">Приём</option>
          <option value="out">Отправка</option>
        </select>
        <select style={inp} value={f.days} onChange={(e) => upd({ days: e.target.value })}>
          <option value="1">За 24 часа</option>
          <option value="7">За 7 дней</option>
          <option value="30">За 30 дней</option>
        </select>
        <button style={btn} onClick={() => setF({ connection_id: '', kind: '', status: '', direction: '', days: '30' })}>✕ Сбросить</button>
      </div>

      {err && <div style={{ padding: '7px 10px', border: '1px dashed rgba(248,113,113,.5)', borderRadius: 8, color: '#F87171', fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}></th><th style={th}>Вид</th><th style={th}>Статус</th><th style={th}>Элементов</th><th style={th}>Файл</th><th style={th}>Сообщение</th><th style={th}>Когда</th></tr></thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.id}
              onClick={() => { if (selId === x.id) { void openDetails(x); } else { setSelId(x.id); } }}
              onDoubleClick={() => void openDetails(x)}
              title="Двойной клик — подробнее"
              style={{ cursor: 'pointer', background: selId === x.id ? 'rgba(34,211,238,.06)' : 'transparent' }}>
              <td style={td}>{x.direction === 'out' ? '📤' : '📥'}</td>
              <td style={td}>{x.kind}</td>
              <td style={{ ...td, color: STATUS_COLOR[x.status] || '#E8EEF5', fontWeight: 600 }}>{x.status}</td>
              <td style={td}>{x.entities_count}</td>
              <td style={{ ...td, color: '#93C5FD', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.file_name || '—'}</td>
              <td style={{ ...td, color: '#8FA3BD', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.message || ''}</td>
              <td style={{ ...td, color: '#5A7090', whiteSpace: 'nowrap' }}>{String(x.created_at || '').slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
          {!busy && items.length === 0 && <tr><td style={{ ...td, color: '#5A7090' }} colSpan={7}>По выбранным фильтрам записей нет</td></tr>}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        {items.length < total && (
          <button style={{ ...btn, padding: '6px 16px' }} disabled={busy} onClick={() => void fetchPage(offset + LIMIT)}>
            {busy ? 'Загрузка…' : '⬇ Показать ещё (' + (total - items.length) + ')'}
          </button>
        )}
        {busy && items.length === 0 && <span style={{ fontSize: 12, color: '#5A7090' }}>Загрузка…</span>}
      </div>
    </div>
  );
}
