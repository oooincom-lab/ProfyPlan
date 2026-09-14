'use client';
/**
 * Справочник операций: таблица, поиск, создание и правка, архив и мастер удаления.
 *
 * Работает через /v1/catalog-operations. Мастер удаления опрашивает связи
 * (/relations) и предлагает: заменить ссылки на другую операцию, удалить вместе
 * со связанными или отменить. При совпадении названия или кода сервер отвечает
 * 409 — текст показывается в форме.
 */
import React, { useEffect, useMemo, useState } from 'react';
import CatalogOpsImport from '@/components/CatalogOpsImport';

type Item = {
  id: string; name: string; code?: string | null; article?: string | null; article_source?: string | null;
  op_type?: string; unit?: string; norm_typical?: string | number | null; norm_min?: string | number | null;
  norm_max?: string | number | null; setup_time?: string | number | null; teardown_time?: string | number | null;
  tags?: string | null; notes?: string | null; is_active?: boolean; updated_by?: string | null;
  updated_at?: string | null; last_change?: any;
};

const EMPTY: Partial<Item> = { op_type: 'work', unit: 'hour', is_active: true };

const TYPE_LABEL: Record<string, string> = { work: 'работа', wait: 'ожидание', milestone: 'веха' };
const UNIT_LABEL: Record<string, string> = { hour: 'ч', shift: 'смена', day: 'день' };

export default function CatalogOps({ panelMode }: { panelMode?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<Partial<Item> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Item[]>([]);
  const [del, setDel] = useState<{ item: Item; rel: any } | null>(null);
  const [replaceWith, setReplaceWith] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const api = useMemo(() => (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api').replace(/\/$/, ''), []);

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bea' + 'rer ' + (localStorage.getItem('profyplan_token') || localStorage.getItem('token') || ''),
  });

  const load = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      if (showArchived) q.set('include_archived', 'true');
      const r = await fetch(api + '/v1/catalog-operations?' + q.toString(), { headers: headers() });
      setItems(r.ok ? await r.json() : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [search, showArchived]);

  const checkSimilar = async (name: string) => {
    if (!name || name.trim().length < 4) { setSimilar([]); return; }
    const r = await fetch(api + '/v1/catalog-operations/similar?name=' + encodeURIComponent(name), { headers: headers() });
    if (r.ok) setSimilar((await r.json()).filter((x: Item) => x.id !== form?.id));
  };

  const save = async () => {
    if (!form) return;
    setErr(null);
    const body: any = { ...form };
    delete body.id; delete body.last_change;
    const isNew = !form.id;
    const r = await fetch(api + '/v1/catalog-operations' + (isNew ? '' : '/' + form.id), {
      method: isNew ? 'POST' : 'PATCH', headers: headers(), body: JSON.stringify(body),
    });
    if (!r.ok) {
      let d: any = null;
      try { d = await r.json(); } catch {}
      setErr(typeof d?.detail === 'string' ? d.detail : 'Не удалось сохранить: ' + r.status);
      return;
    }
    setForm(null); setSimilar([]); setMsg(isNew ? 'Операция добавлена' : 'Изменения сохранены');
    load();
  };

  const openDelete = async (item: Item) => {
    const r = await fetch(api + '/v1/catalog-operations/' + item.id + '/relations', { headers: headers() });
    setDel({ item, rel: r.ok ? await r.json() : null });
    setReplaceWith('');
  };

  const doDelete = async (mode: 'plain' | 'replace' | 'force') => {
    if (!del) return;
    const q = mode === 'replace' ? '?replace_with=' + replaceWith : (mode === 'force' ? '?force=true' : '');
    if (mode === 'replace' && !replaceWith) { setErr('Выберите операцию для замены'); return; }
    const r = await fetch(api + '/v1/catalog-operations/' + del.item.id + q, { method: 'DELETE', headers: headers() });
    if (r.status === 204) { setDel(null); setMsg('Удалено'); load(); return; }
    let d: any = null;
    try { d = await r.json(); } catch {}
    setErr(typeof d?.detail === 'string' ? d.detail : 'Не удалось удалить: ' + r.status);
  };

  const field = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{ color: '#8FA3BD' }}>{label}</span>{node}
    </label>
  );
  const inp = (key: keyof Item, type = 'text') => (
    <input type={type} value={(form?.[key] as any) ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>⚙️ Операции</b>
        <input placeholder="поиск: название, код, артикул, теги" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 280 }} />
        <label style={{ fontSize: 12, color: '#8FA3BD', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> показывать архив
        </label>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>{loading ? 'загрузка…' : 'записей: ' + items.length}</span>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setForm({ ...EMPTY }); setErr(null); setSimilar([]); }}>+ Операция</button>{' '}
        <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>📋 Импорт из буфера</button>
      </div>

      {msg ? <div style={{ fontSize: 12.5, color: '#7FD3BB' }}>{msg}</div> : null}

      <div style={{ overflow: 'auto', border: '1px solid #26364F', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1B2A44', color: '#CBD8EA', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }}>
              {['Код', 'Название', 'Тип', 'Норма (вилка)', 'Ед.', 'Теги', 'Изменил', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #26364F' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} style={{ opacity: it.is_active === false ? 0.5 : 1 }}>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42', color: '#8FA3BD' }}>{it.code || '—'}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42' }}>{it.name}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42', color: '#8FA3BD' }}>{TYPE_LABEL[it.op_type || 'work']}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42' }}>
                  {it.norm_typical ?? '—'}
                  {it.norm_min != null || it.norm_max != null ? <span style={{ color: '#8FA3BD' }}> ({it.norm_min ?? '—'}…{it.norm_max ?? '—'})</span> : null}
                </td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42', color: '#8FA3BD' }}>{UNIT_LABEL[it.unit || 'hour']}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42', color: '#8FA3BD' }}>{it.tags || '—'}</td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42', color: '#8FA3BD' }}>
                  {it.updated_by || '—'}{it.last_change?.at ? ' · ' + String(it.last_change.at).slice(0, 10) : ''}
                </td>
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setForm(it); setErr(null); setSimilar([]); }}>✏️</button>{' '}
                  <button className="btn btn-secondary btn-sm" onClick={async () => {
                    await fetch(api + '/v1/catalog-operations/' + it.id, { method: 'PATCH', headers: headers(), body: JSON.stringify({ is_active: !(it.is_active !== false) }) });
                    load();
                  }}>{it.is_active === false ? '↩︎' : '🗄'}</button>{' '}
                  <button className="btn btn-secondary btn-sm" onClick={() => openDelete(it)}>🗑</button>
                </td>
              </tr>
            ))}
            {!items.length && !loading ? (
              <tr><td colSpan={8} style={{ padding: 14, color: '#8FA3BD' }}>Ничего не найдено. Измените поиск или добавьте операцию.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {importOpen ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,22,.72)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 'min(1100px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: '#0F1B2D', border: '1px solid #26364F', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <b style={{ fontSize: 14 }}>📋 Импорт операций из буфера</b>
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setImportOpen(false)}>Закрыть</button>
            </div>
            <CatalogOpsImport apiBase={api} onDone={load} />
          </div>
        </div>
      ) : null}

      {/* форма создания и правки */}
      {form ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,22,.72)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: '#0F1B2D', border: '1px solid #26364F', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <b style={{ fontSize: 14 }}>{form.id ? 'Операция' : 'Новая операция'}</b>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={save}>Сохранить</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setForm(null); setSimilar([]); setErr(null); }}>Отмена</button>
              </span>
            </div>
            {err ? <div style={{ color: '#F87171', fontSize: 12.5, marginBottom: 8 }}>{err}</div> : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
              {field('Название', <input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={(e) => checkSimilar(e.target.value)} />)}
              {field('Код (внутренний)', inp('code'))}
              {field('Артикул', inp('article'))}
              {field('Источник артикула', inp('article_source'))}
              {field('Тип', (
                <select value={form.op_type ?? 'work'} onChange={(e) => setForm({ ...form, op_type: e.target.value })}>
                  <option value="work">работа</option><option value="wait">ожидание</option><option value="milestone">веха</option>
                </select>
              ))}
              {field('Единица', (
                <select value={form.unit ?? 'hour'} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  <option value="hour">час</option><option value="shift">смена</option><option value="day">день</option>
                </select>
              ))}
              {field('Типовая норма', inp('norm_typical', 'number'))}
              {field('Минимум', inp('norm_min', 'number'))}
              {field('Максимум', inp('norm_max', 'number'))}
              {field('Настройка', inp('setup_time', 'number'))}
              {field('Переналадка', inp('teardown_time', 'number'))}
              {field('Теги', inp('tags'))}
              {field('Примечания', <textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />)}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8FA3BD', marginTop: 18 }}>
                <input type="checkbox" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> активна
              </label>
            </div>
            {similar.length ? (
              <div style={{ marginTop: 10, background: '#152238', border: '1px solid #4C3B85', borderRadius: 8, padding: 10, fontSize: 12.5 }}>
                <b style={{ color: '#B7A9EE' }}>Похожие записи — возможно, дубль:</b>
                <div style={{ marginTop: 6, color: '#CBD8EA' }}>{similar.map((s) => s.name).join(' · ')}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* мастер удаления */}
      {del ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,22,.72)', zIndex: 4250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 'min(720px, 96vw)', background: '#0F1B2D', border: '1px solid #26364F', borderRadius: 12, padding: 16 }}>
            <b style={{ fontSize: 14 }}>Удаление операции «{del.item.name}»</b>
            {err ? <div style={{ color: '#F87171', fontSize: 12.5, marginTop: 8 }}>{err}</div> : null}
            <div style={{ fontSize: 12.5, color: '#CBD8EA', marginTop: 10 }}>
              Связанных операций заказов: <b>{del.rel?.total_operations ?? 0}</b>
              {del.rel?.operations_linked ? <span style={{ color: '#8FA3BD' }}> (по ссылке: {del.rel.operations_linked})</span> : null}
              {del.rel?.operations_same_name ? <span style={{ color: '#8FA3BD' }}> (совпадает по названию: {del.rel.operations_same_name})</span> : null}
            </div>
            {del.rel?.sample?.length ? (
              <div style={{ marginTop: 8, maxHeight: 140, overflow: 'auto', fontSize: 12, color: '#8FA3BD', background: '#152238', border: '1px solid #26364F', borderRadius: 8, padding: 8 }}>
                {del.rel.sample.map((s: any) => <div key={s.id}>• {s.name}</div>)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <select value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} style={{ minWidth: 260 }}>
                <option value="">— выбрать замену —</option>
                {items.filter((x) => x.id !== del.item.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => doDelete('replace')}>Заменить на выбранную</button>
              <button className="btn btn-secondary btn-sm" onClick={() => doDelete('force')}>Удалить со связанными</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setDel(null)}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
