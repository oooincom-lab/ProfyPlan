'use client';

/**
 * ReferenceField — универсальное поле-ссылка на элемент справочника (Шаг 1 модуля справочников).
 * Состав: кнопка с именем выбранного элемента + ▾ (dropdown быстрого выбора с поиском),
 * ⊞ (открыть окно списка справочника в режиме выбора — CRUD доступен там же),
 * ✕ (очистить). Модальность окна открытия регулируется настройкой panelMode (Настройки Рабочего стола).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  entity: string;
  value: string | null;
  onChange: (id: string | null) => void;
  onOpenBrowser?: (entity: string, onPick: (row: any) => void) => void;
  onPickItem?: (row: any) => void;
  apiBase?: string;
  displayField?: string;
  placeholder?: string;
  style?: React.CSSProperties;
};

export default function ReferenceField({
  entity, value, onChange, onOpenBrowser, onPickItem,
  apiBase = 'https://profyplan.ru/api',
  displayField = 'name',
  placeholder = 'Выбрать…',
  style,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const hdr = (): Record<string, string> => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
  };

  const load = async (q: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/v1/${entity}/` + (q ? `?search=${encodeURIComponent(q)}` : ''), { headers: hdr() });
      if (r.ok) setItems(await r.json());
    } catch { }
    setLoading(false);
  };

  const syncRect = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 280) });
  };

  useEffect(() => {
    if (open) load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);

  // одноразовая загрузка для отображения имени выбранного значения
  useEffect(() => {
    if (value) load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest && t.closest('[data-rf-dropdown]')) return; // клики внутри dropdown (portal)
      if (ref.current && !ref.current.contains(t)) { setOpen(false); setSearch(''); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setSearch(''); } };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  const sel = value ? items.find(i => String(i.id) === String(value)) : null;
  const q = search.trim().toLowerCase();
  const filtered = q ? items.filter(i => String(i[displayField] || i.name || '').toLowerCase().includes(q)) : items;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center', minWidth: 130, flex: 1, ...style }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { syncRect(); setOpen(o => !o); }}
        title={sel ? String(sel[displayField] || '') : placeholder}
        style={{
          background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6,
          color: sel ? '#E8EEF5' : '#5A7090',
          padding: '6px 12px', fontSize: 13, cursor: 'pointer', flex: 1, textAlign: 'left',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'inherit',
        }}
      >
        {sel ? String(sel[displayField] || sel.name || sel.id) : placeholder} <span style={{ color: '#3B82F6' }}>▾</span>
      </button>
      {onOpenBrowser && (
        <button
          type="button"
          title="Открыть справочник: список, добавление, редактирование, удаление"
          onClick={() => onOpenBrowser(entity, (row: any) => { onChange(String(row.id)); onPickItem?.(row); setOpen(false); })}
          style={{
            background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.4)', color: '#93C5FD',
            borderRadius: 6, width: 30, height: 30, fontSize: 13, cursor: 'pointer', flex: '0 0 auto', fontFamily: 'inherit',
          }}
        >⊞</button>
      )}
      {value && (
        <button
          type="button"
          title="Очистить"
          onClick={() => onChange(null)}
          style={{
            background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.35)', color: '#F87171',
            borderRadius: 6, width: 26, height: 30, fontSize: 11, cursor: 'pointer', flex: '0 0 auto', fontFamily: 'inherit',
          }}
        >✕</button>
      )}
      {open && rect && createPortal(
        <div data-rf-dropdown style={{
          position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 6000,
          background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,.6)', maxHeight: 280, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск…"
            style={{ background: '#0A1628', border: 'none', borderBottom: '1px solid #1E3252', color: '#E8EEF5', padding: '8px 10px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }}
          />
          <div style={{ overflow: 'auto' }}>
            {loading && <div style={{ color: '#5A7090', padding: 8, fontSize: 12 }}>Загрузка…</div>}
            {!loading && filtered.length === 0 && <div style={{ color: '#5A7090', padding: 8, fontSize: 12 }}>Ничего не найдено</div>}
            {filtered.map((it: any) => (
              <div
                key={String(it.id)}
                onClick={() => { onChange(String(it.id)); onPickItem?.(it); setOpen(false); setSearch(''); }}
                style={{
                  padding: '7px 10px', fontSize: 12.5, cursor: 'pointer',
                  borderBottom: '1px dashed rgba(30,58,95,.4)',
                  color: String(it.id) === String(value) ? '#93C5FD' : '#E8EEF5',
                }}
              >
                {String(it[displayField] || it.name || it.id)}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
