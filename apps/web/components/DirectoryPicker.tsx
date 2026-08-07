'use client';

import { useState, useEffect, useRef } from 'react';

type Props = {
  entity: string;
  apiBase: string;
  value: string | null;
  onChange: (id: string | null, name: string) => void;
  placeholder?: string;
};

export default function DirectoryPicker({ entity, apiBase, value, onChange, placeholder }: Props) {
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
  }, [search]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedName = value && items.length > 0 ? items.find(i => i.id === value)?.name : null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', minWidth: 160 }}>
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open) load(''); }}
        style={{
          background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6,
          color: selectedName ? '#E8EEF5' : '#5A7090', padding: '6px 12px', fontSize: 13,
          cursor: 'pointer', width: '100%', textAlign: 'left',
        }}
      >
        {selectedName || placeholder || 'Выбрать...'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: '#0F1E36', border: '1px solid #1E3252', borderRadius: 8,
          minWidth: 260, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
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
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {loading && <div style={{ padding: 12, color: '#5A7090', fontSize: 12 }}>Загрузка...</div>}
            {!loading && items.length === 0 && (
              <div style={{ padding: 12, color: '#5A7090', fontSize: 12 }}>Ничего не найдено</div>
            )}
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange(item.id, item.name); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none',
                  border: 'none', color: value === item.id ? '#60A5FA' : '#B0C4DE',
                  padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {item.name}
                {item.code && <span style={{ color: '#5A7090', marginLeft: 8, fontSize: 11 }}>{item.code}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
