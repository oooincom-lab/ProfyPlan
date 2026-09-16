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
import DeleteCheckDialog from '@/components/DeleteCheckDialog';

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
  const [del, setDel] = useState<{ item: Item; check: any; cands: { id: string; name: string }[] } | null>(null);
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
  useEffect(() => {
    const h = () => { load(); };
    window.addEventListener('profyplan:catalog-ops-changed', h);
    return () => window.removeEventListener('profyplan:catalog-ops-changed', h);
  }, [search, showArchived]);

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
    const r = await fetch(api + '/v1/delete-check/catalog_operation/' + item.id, { headers: headers() });
    const check = r.ok ? await r.json() : null;
    // кандидатов для переноса грузим здесь же — не зависим от того, успел ли загрузиться список панели
    let cands: { id: string; name: string }[] = [];
    try {
      const lr = await fetch(api + '/v1/catalog-operations?limit=500', { headers: headers() });
      if (lr.ok) {
        const lj = await lr.json();
        const arr = Array.isArray(lj) ? lj : (lj.items || []);
        cands = arr.filter((x: any) => x.id !== item.id).map((x: any) => ({ id: x.id, name: x.name }));
      }
    } catch { /* без списка — просто без выбора переноса */ }
    setDel({ item, check, cands });
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
                <td style={{ padding: '7px 10px', borderBottom: '1px solid #1E2C42' }}>{it.name}{it.is_active === false && (<span title="Запись в архиве" style={{ marginLeft: 6, color: '#EF4444', fontSize: 13, lineHeight: 1, cursor: 'help' }}>⊘</span>)}</td>
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
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                  if (panelMode === 'window') {
                    try { window.dispatchEvent(new CustomEvent('profyplan:open-catoped', { detail: it })); return; } catch {}
                  }
                  setForm(it); setErr(null); setSimilar([]);
                }}>✏️</button>{' '}
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

      {/* удаление — общий диалог (перенос ссылок поддерживается) */}
      {del ? (
        <DeleteCheckDialog
          entityType="catalog_operation"
          entityId={del.item.id}
          entityName={del.item.name}
          result={del.check}
          onClose={() => setDel(null)}
          onDeleted={() => { load(); setMsg('Операция удалена'); }}
          replaceOptions={del.cands}
          onArchive={async () => {
            await fetch(api + '/v1/catalog-operations/' + del.item.id, { method: 'PATCH', headers: headers(), body: JSON.stringify({ is_active: false }) });
            load();
            setMsg('Операция убрана в архив');
          }}
          replaceLabel="Перенести связанные операции на:"
        />
      ) : null}
    </div>
  );
}


/** Форма записи справочника операций. Используется и внутри панели, и в отдельном окне. */
export function CatalogOpEditForm({ item, onSaved, onClose }: { item?: any; onSaved: () => void; onClose?: () => void }) {
  const [f, setF] = useState<any>(() => ({
    name: item?.name || '', code: item?.code || '', article: item?.article || '', article_source: item?.article_source || '',
    op_type: item?.op_type || 'work', unit: item?.unit || 'hour',
    norm_typical: item?.norm_typical ?? '', norm_min: item?.norm_min ?? '', norm_max: item?.norm_max ?? '',
    setup_time: item?.setup_time ?? 0, teardown_time: item?.teardown_time ?? 0,
    tags: item?.tags || '', notes: item?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const api = process.env.NEXT_PUBLIC_API_URL || '';
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: '***' + 'rer ' + (localStorage.getItem('profyplan_token') || '') });
  const num = (v: any) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

  const save = async () => {
    if (!f.name.trim()) { setMsg('Укажите название'); return; }
    setBusy(true); setMsg(null);
    const body: any = {
      name: f.name.trim(), code: f.code || null, article: f.article || null, article_source: f.article_source || null,
      op_type: f.op_type || 'work', unit: f.unit || 'hour',
      norm_typical: num(f.norm_typical), norm_min: num(f.norm_min), norm_max: num(f.norm_max),
      setup_time: num(f.setup_time) ?? 0, teardown_time: num(f.teardown_time) ?? 0,
      tags: f.tags || null, notes: f.notes || null,
    };
    try {
      const r = item?.id
        ? await fetch(api + '/v1/catalog-operations/' + item.id, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) })
        : await fetch(api + '/v1/catalog-operations', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      if (r.ok || r.status === 201) {
        onSaved();
        if (onClose) onClose(); else setMsg('Сохранено');
      } else if (r.status === 409) {
        setMsg('Такая операция уже есть в справочнике (совпало название или код)');
      } else {
        const t = await r.text();
        setMsg('Ошибка ' + r.status + ': ' + t.slice(0, 120));
      }
    } catch (e: any) {
      setMsg('Ошибка связи: ' + String(e).slice(0, 80));
    }
    setBusy(false);
  };

  const row = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#8FA3BD' }}>
      {label}
      {node}
    </label>
  );
  const inp = (key: string, type = 'text') => (
    <input type={type} value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value })}
      style={{ background: '#0B1522', color: '#E8EEF8', border: '1px solid #26364F', borderRadius: 6, padding: '6px 8px', fontSize: 12.5 }} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {row('Название', inp('name'))}
        {row('Код (внутренний)', inp('code'))}
        {row('Артикул', inp('article'))}
        {row('Источник артикула', inp('article_source'))}
        {row('Тип', (
          <select value={f.op_type} onChange={(e) => setF({ ...f, op_type: e.target.value })}
            style={{ background: '#0B1522', color: '#E8EEF8', border: '1px solid #26364F', borderRadius: 6, padding: '6px 8px' }}>
            <option value="work">Работа</option><option value="wait">Ожидание</option><option value="milestone">Веха</option>
          </select>
        ))}
        {row('Единица', (
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}
            style={{ background: '#0B1522', color: '#E8EEF8', border: '1px solid #26364F', borderRadius: 6, padding: '6px 8px' }}>
            <option value="hour">Час</option><option value="shift">Смена</option><option value="day">День</option>
          </select>
        ))}
        {row('Типовая норма', inp('norm_typical'))}
        {row('Вилка: минимум', inp('norm_min'))}
        {row('Вилка: максимум', inp('norm_max'))}
        {row('Настройка', inp('setup_time'))}
        {row('Переналадка', inp('teardown_time'))}
        {row('Теги', inp('tags'))}
      </div>
      {row('Примечания', (
        <textarea value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3}
          style={{ background: '#0B1522', color: '#E8EEF8', border: '1px solid #26364F', borderRadius: 6, padding: 8, fontFamily: 'inherit', fontSize: 12.5 }} />
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? '⏳ Сохранение…' : 'Сохранить'}</button>
        {onClose ? <button className="btn btn-secondary btn-sm" onClick={onClose}>Закрыть</button> : null}
        {msg ? <span style={{ fontSize: 12.5, color: '#FBBF24' }}>{msg}</span> : null}
      </div>
    </div>
  );
}
