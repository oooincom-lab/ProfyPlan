'use client';

import { useState, useEffect, useRef } from 'react';

type Props = {
  entity: string;
  apiBase: string;
  value: string | null;
  onChange: (value: string, display: string) => void;
  placeholder?: string;
  displayField?: string;
  valueField?: string;
  subField?: string;
  onManage?: () => void;
};

export default function DirectoryPicker({ entity, apiBase, value, onChange, placeholder, displayField = 'name', valueField = 'id', subField, onManage }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
  const hdr = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const load = async (q: string) => {
    setLoading(true);
    try {
      const url = q
        ? `${apiBase}/v1/${entity}/?search=${encodeURIComponent(q)}`
        : `${apiBase}/v1/${entity}/`;
      const r = await fetch(url, { headers: hdr() });
      if (r.ok) setItems(await r.json());
    } catch { }
    setLoading(false);
  };

  useEffect(() => {
    load(search);
  }, [search, entity, apiBase]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = value && items.length > 0 ? items.find(i => String(i[valueField]) === String(value)) : null;
  const selectedName = selected ? selected[displayField] : null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', minWidth: 160, width: '100%' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          onClick={() => { setOpen(!open); if (!open) load(''); }}
          style={{
            background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6,
            color: selectedName ? '#E8EEF5' : '#5A7090', padding: '6px 12px', fontSize: 13,
            cursor: 'pointer', flex: 1, textAlign: 'left',
          }}
        >
          {selectedName || placeholder || 'Выбрать...'}
        </button>
        {onManage && (
          <button
            type="button"
            title="Управлять справочником"
            onClick={onManage}
            style={{
              background: 'transparent', border: '1px solid #1E3252', borderRadius: 6,
              color: '#8FA3BD', padding: '6px 9px', fontSize: 12, cursor: 'pointer', flex: '0 0 auto',
            }}
          >
            ⚙️
          </button>
        )}
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: '#0F1E36', border: '1px solid #1E3252', borderRadius: 8,
          minWidth: 280, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            autoFocus
            style={{
              width: '100%', background: '#0A1628', border: 'none', borderBottom: '1px solid #1E3252',
              color: '#B0C4DE', padding: '8px 12px', fontSize: 12, borderRadius: '8px 8px 0 0',
            }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {loading && <div style={{ padding: 12, color: '#5A7090', fontSize: 12 }}>Загрузка...</div>}
            {!loading && items.length === 0 && (
              <div style={{ padding: 12, color: '#5A7090', fontSize: 12 }}>Ничего не найдено</div>
            )}
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange(String(item[valueField]), item[displayField]); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: 'none', color: String(value) === String(item[valueField]) ? '#60A5FA' : '#B0C4DE',
                  padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {item[displayField]}
                {subField && item[subField] ? <span style={{ color: '#5A7090', marginLeft: 8, fontSize: 11 }}>{item[subField]}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
