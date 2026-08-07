'use client';

import { useState, useEffect } from 'react';
import DataImport from './DataImport';

type ColumnDef = {
  key: string;
  label: string;
  width?: number;
  render?: (val: any, row: any) => React.ReactNode;
  editable?: boolean;
};

type Props = {
  entity: string;
  columns: ColumnDef[];
  apiBase: string;
  onSelect?: (row: any) => void;
  compact?: boolean;
  synonyms?: Record<string, string[]>;
};

export default function DirectoryTable({ entity, columns, apiBase, onSelect, compact, synonyms }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [showImport, setShowImport] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;

  const hdr = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/v1/${entity}/`, { headers: hdr() });
      if (r.ok) setRows(await r.json());
    } catch { }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveNew = async () => {
    if (!newRow.name?.trim()) return;
    try {
      const r = await fetch(`${apiBase}/v1/${entity}/`, {
        method: 'POST', headers: hdr(),
        body: JSON.stringify({ name: newRow.name, ntype: newRow.ntype || 'product', unit: newRow.unit || 'pcs', code: newRow.code || null }),
      });
      if (r.ok) { setNewRow({}); setAdding(false); await load(); }
    } catch (e: any) { alert('Ошибка: ' + e.message); }
  };

  const saveEdit = async (id: string) => {
    try {
      const r = await fetch(`${apiBase}/v1/${entity}/${id}`, {
        method: 'PUT', headers: hdr(),
        body: JSON.stringify(editVals),
      });
      if (r.ok) { setEditingId(null); await load(); }
    } catch (e: any) { alert('Ошибка: ' + e.message); }
  };

  const deleteRow = async (id: string) => {
    if (!confirm('Удалить запись?')) return;
    try {
      await fetch(`${apiBase}/v1/${entity}/${id}`, { method: 'DELETE', headers: hdr() });
      await load();
    } catch (e: any) { alert('Ошибка: ' + e.message); }
  };

  const ntypeLabel = (v: string) =>
    v === 'product' ? 'Продукт' : v === 'material' ? 'Материал' : v === 'semi_finished' ? 'Полуфабрикат' : v === 'service' ? 'Услуга' : v;

  const filtered = filter ? rows.filter(r => (r.name || '').toLowerCase().includes(filter.toLowerCase()) || (r.code || '').toLowerCase().includes(filter.toLowerCase())) : rows;

  if (loading) return <div style={{ padding: 16, color: '#5A7090' }}>Загрузка...</div>;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <input
          placeholder="Поиск..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#B0C4DE', padding: '6px 12px', fontSize: 12, width: 200 }}
        />
        <div style={{ flex: 1 }} />
        {!compact && (
          <>
            <button
              className="btn btn-sm"
              style={{ background: '#162844', color: '#5A7090', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
              onClick={() => setShowImport(true)}
            >
              📋 Импорт
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setAdding(true); setNewRow({ name: '', ntype: 'product', unit: 'pcs', code: '' }); }}
            >
              + Добавить
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: 'left', padding: '6px 10px', color: '#60A5FA', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #1E3252', width: c.width }}>
                {c.label}
              </th>
            ))}
            <th style={{ width: 70, padding: '6px 10px', borderBottom: '1px solid #1E3252' }} />
          </tr>
        </thead>
        <tbody>
          {filtered.map(row => (
            <tr key={row.id} style={{ borderBottom: '1px solid #162844' }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '7px 10px', color: '#B0C4DE' }}>
                  {editingId === row.id && c.editable !== false ? (
                    <input
                      value={editVals[c.key] ?? row[c.key] ?? ''}
                      onChange={e => setEditVals({ ...editVals, [c.key]: e.target.value })}
                      style={{ background: '#0A1628', border: '1px solid #3B82F6', borderRadius: 3, color: '#E8EEF5', padding: '3px 6px', fontSize: 12, width: c.width ? c.width - 20 : 100 }}
                    />
                  ) : c.render ? (
                    c.render(row[c.key], row)
                  ) : c.key === 'ntype' ? (
                    ntypeLabel(row[c.key])
                  ) : (
                    row[c.key] ?? '—'
                  )}
                </td>
              ))}
              <td style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                {onSelect && (
                  <button onClick={() => onSelect(row)} style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', fontSize: 12 }} title="Выбрать">✓</button>
                )}
                {editingId === row.id ? (
                  <>
                    <button onClick={() => saveEdit(row.id)} style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontSize: 12 }}>✓</button>
                    <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditingId(row.id); setEditVals({}); }} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }} title="Редактировать">✎</button>
                    <button onClick={() => deleteRow(row.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', opacity: 0.6, fontSize: 12 }} title="Удалить">🗑</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {/* New row */}
          {adding && (
            <tr style={{ borderBottom: '1px solid #162844', background: 'rgba(59,130,246,.05)' }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '7px 10px' }}>
                  {c.key === 'ntype' ? (
                    <select
                      value={newRow.ntype || 'product'}
                      onChange={e => setNewRow({ ...newRow, ntype: e.target.value })}
                      style={{ background: '#0A1628', border: '1px solid #3B82F6', borderRadius: 3, color: '#E8EEF5', padding: '3px 6px', fontSize: 12, width: 110 }}
                    >
                      <option value="product">Продукт</option>
                      <option value="material">Материал</option>
                      <option value="semi_finished">Полуфабрикат</option>
                      <option value="service">Услуга</option>
                    </select>
                  ) : (
                    <input
                      value={newRow[c.key] || ''}
                      onChange={e => setNewRow({ ...newRow, [c.key]: e.target.value })}
                      placeholder={c.label}
                      style={{ background: '#0A1628', border: '1px solid #3B82F6', borderRadius: 3, color: '#E8EEF5', padding: '3px 6px', fontSize: 12, width: c.width ? c.width - 20 : 100 }}
                    />
                  )}
                </td>
              ))}
              <td style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                <button onClick={saveNew} style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>✓</button>
                <button onClick={() => setAdding(false)} style={{ background: 'transparent', color: '#5A7090', border: '1px solid #2A4060', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', fontSize: 11 }}>✕</button>
              </td>
            </tr>
          )}
          {filtered.length === 0 && !adding && (
            <tr><td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Нет данных</td></tr>
          )}
        </tbody>
      </table>

      {/* Import modal */}
      {showImport && synonyms && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowImport(false)}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '90vw', maxHeight: '80vh', overflow: 'auto' }}>
            <DataImport
              entity={entity}
              columns={columns}
              synonyms={synonyms}
              apiBase={apiBase}
              onImport={async (rows) => {
                for (const row of rows) {
                  try {
                    await fetch(`${apiBase}/v1/${entity}/`, { method: 'POST', headers: hdr(), body: JSON.stringify(row) });
                  } catch { }
                }
                await load();
              }}
              onClose={() => setShowImport(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
