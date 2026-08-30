'use client';

import { useState, useEffect, useMemo } from 'react';
import DataImport from './DataImport';
import DeleteCheckDialog from './DeleteCheckDialog';

type ColumnDef = {
  key: string;
  label: string;
  width?: number;
  render?: (val: any, row: any) => React.ReactNode;
  editable?: boolean;
  sortable?: boolean;
};

type Props = {
  entity: string;
  columns: ColumnDef[];
  apiBase: string;
  onSelect?: (row: any) => void;
  onManageEdit?: (row: any) => void;
  onManageDelete?: (row: any) => void;
  onManageCalendar?: (row: any) => void;
  compact?: boolean;
  synonyms?: Record<string, string[]>;
  /** Счётчик — при изменении список перезагружается (после удаления извне) */
  refreshKey?: number;
  /** Переопределение URL (проектные справочники: этапы и т.п.). Если задан — используется вместо /v1/{entity}/... */
  endpoints?: {
    list?: string;
    create?: string;
    item?: (id: string) => string;
    method?: 'PUT' | 'PATCH';
  };
};

export default function DirectoryTable({ entity, columns, apiBase, onSelect, onManageEdit, onManageDelete, onManageCalendar, compact, synonyms, refreshKey = 0, endpoints }: Props) {
  // ── User preferences (localStorage) ──
  const prefKey = `profyplan_prefs_${entity}`;
  const loadPrefs = () => {
    if (typeof window === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(prefKey) || 'null'); } catch { return null; }
  };
  const savePrefs = (patch: Record<string, any>) => {
    if (typeof window === 'undefined') return;
    const curr = loadPrefs() || {};
    localStorage.setItem(prefKey, JSON.stringify({ ...curr, ...patch }));
  };

  // Default search/sort field: prefer 'name' if it exists
  const defaultSearchField = columns.find(c => c.key === 'name') ? 'name' : columns[0]?.key || 'name';
  const defaultSortKey = columns[0]?.key || 'name';

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [errNew, setErrNew] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [searchField, setSearchField] = useState(() => {
    const p = loadPrefs();
    return p?.searchField || defaultSearchField;
  });
  const [sortKey, setSortKey] = useState<string | null>(() => {
    const p = loadPrefs();
    return p?.sortKey ?? defaultSortKey;
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    const p = loadPrefs();
    return p?.sortDir || 'asc';
  });
  const [showImport, setShowImport] = useState(false);
  const [deleteCheckResult, setDeleteCheckResult] = useState<any>(null);
  const [deleteCheckLoading, setDeleteCheckLoading] = useState(false);
  const [deleteCheckError, setDeleteCheckError] = useState<string | null>(null);
  const [deleteCheckTarget, setDeleteCheckTarget] = useState<{ id: string; name: string } | null>(null);
  const [selId, setSelId] = useState<string | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;

  const af = async (url: string, opts?: RequestInit) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as any || {}) };
    if (token) h['Authorization'] = `Bearer ${token}`;
    const r = await fetch(url, { ...opts, headers: h });
    if (r.status === 401) { localStorage.removeItem('profyplan_token'); throw new Error('Unauthorized'); }
    return r;
  };

  const hdr = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await af(endpoints?.list || `${apiBase}/v1/${entity}/`);
      if (r.ok) setRows(await r.json());
    } catch { }
    setLoading(false);
  };

  useEffect(() => { load(); }, [refreshKey]);

  const saveNew = async () => {
    setErrNew(null);
    if (!newRow.name?.trim()) return;
    try {
      // Глобальные справочники: старый body (ntype/unit); проектные (endpoints): {name, code}
      const body = endpoints
        ? {
            name: newRow.name,
            code: newRow.code || null,
            ...(newRow.position !== undefined && newRow.position !== '' ? { position: Number(newRow.position) } : {}),
          }
        : { name: newRow.name, ntype: newRow.ntype || 'product', unit: newRow.unit || 'pcs', code: newRow.code || null };
      const r = await af(endpoints?.create || `${apiBase}/v1/${entity}/`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try { const j = await r.json(); detail = j.detail || detail; } catch { }
        setErrNew('Не сохранено: ' + detail);
        return;
      }
      if (r.ok) { setNewRow({}); setAdding(false); setFilter(''); await load(); }
    } catch (e: any) { alert('Ошибка: ' + e.message); }
  };

  const saveEdit = async (id: string) => {
    try {
      const r = await af(endpoints?.item ? endpoints.item(id) : `${apiBase}/v1/${entity}/${id}`, {
        method: endpoints?.item ? (endpoints.method || 'PATCH') : 'PUT',
        body: JSON.stringify(editVals),
      });
      if (r.ok) { setEditingId(null); await load(); }
    } catch (e: any) { alert('Ошибка: ' + e.message); }
  };

  const deleteRow = async (id: string, name: string) => {
    setDeleteCheckTarget({ id, name });
    setDeleteCheckLoading(true);
    setDeleteCheckError(null);
    setDeleteCheckResult(null);
    try {
      const r = await af(`${apiBase}/v1/delete-check/${entity}/${id}`);
      if (!r.ok) { setDeleteCheckError('Ошибка проверки: ' + r.status); setDeleteCheckLoading(false); return; }
      setDeleteCheckResult(await r.json());
    } catch (e: any) {
      setDeleteCheckError(e.message || 'Ошибка');
    }
    setDeleteCheckLoading(false);
  };

  const ntypeLabel = (v: string) =>
    v === 'product' ? 'Продукт' : v === 'material' ? 'Материал' : v === 'semi_finished' ? 'Полуфабрикат' : v === 'service' ? 'Услуга' : v;

  const handleSort = (colKey: string) => {
    if (sortKey === colKey) {
      const newDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(newDir);
      savePrefs({ sortKey: colKey, sortDir: newDir });
    } else {
      setSortKey(colKey);
      setSortDir('asc');
      savePrefs({ sortKey: colKey, sortDir: 'asc' });
    }
  };

  const handleSearchFieldChange = (field: string) => {
    setSearchField(field);
    savePrefs({ searchField: field });
  };

  // Filter → Sort chain
  const filtered = useMemo(() => {
    let result = rows;
    if (filter) {
      const q = filter.toLowerCase();
      result = rows.filter(r => String(r[searchField] ?? '').toLowerCase().includes(q));
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const va = (a[sortKey] ?? '').toString().toLowerCase();
        const vb = (b[sortKey] ?? '').toString().toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return result;
  }, [rows, filter, searchField, sortKey, sortDir]);

  if (loading) return <div style={{ padding: 16, color: '#5A7090' }}>Загрузка...</div>;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search field selector */}
        <select
          value={searchField}
          onChange={e => handleSearchFieldChange(e.target.value)}
          style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#B0C4DE', padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif', minWidth: 100 }}
          title="Поле поиска"
        >
          {columns.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        {/* Search input */}
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <input
            placeholder="Поиск..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#B0C4DE', padding: '6px 10px 6px 30px', fontSize: 12, width: 180 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 7, fontSize: 12, color: '#5A7090' }}>🔍</span>
        </div>
        <div style={{ flex: 1 }} />
        {!compact && !onSelect && (
          <button
            className="btn btn-sm"
            style={{ background: '#162844', color: '#5A7090', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
            onClick={() => setShowImport(true)}
          >
            📋 Импорт
          </button>
        )}
        {!compact && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              const hasPos = columns.some(c => c.key === 'position');
              const maxPos = rows.reduce((m, r) => Math.max(m, Number((r as any).position) || 0), 0);
              setNewRow({ name: '', ntype: 'product', unit: 'pcs', code: '', ...(hasPos ? { position: String(maxPos + 1) } : {}) });
              setAdding(true);
              setErrNew(null);
            }}
          >
            + Добавить
          </button>
        )}
        {onSelect && (
          <>
            <button
              disabled={!selId}
              onClick={() => { const row = filtered.find(r => r.id === selId); if (!row) return; if (onManageEdit) onManageEdit(row); else { setEditingId(String(row.id)); setEditVals({}); } }}
              style={{ background: selId ? '#162844' : '#1E3252', border: '1px solid #2A4060', borderRadius: 6, color: selId ? '#FCD34D' : '#5A7090', cursor: selId ? 'pointer' : 'not-allowed', padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
            >
              ✏️ Редактировать
            </button>
            <button
              disabled={!selId}
              onClick={() => { const row = filtered.find(r => r.id === selId); if (!row) return; if (onManageDelete) onManageDelete(row); else deleteRow(String(row.id), row.name || row.specification_name || ''); }}
              title="Удалить через мастер удаления (проверка связей)"
              style={{ background: selId ? 'rgba(239,68,68,.12)' : '#1E3252', border: '1px solid ' + (selId ? 'rgba(239,68,68,.4)' : '#2A4060'), borderRadius: 6, color: selId ? '#F87171' : '#5A7090', cursor: selId ? 'pointer' : 'not-allowed', padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
            >
              🗑 Удалить
            </button>
            {onManageCalendar && (
              <button
                disabled={!selId}
                onClick={() => { const row = filtered.find(r => r.id === selId); if (row) onManageCalendar(row); }}
                title="Календарь ресурса: эффективный график, версии, исключения"
                style={{ background: selId ? 'rgba(34,211,238,.12)' : '#1E3252', border: '1px solid ' + (selId ? 'rgba(34,211,238,.45)' : '#2A4060'), borderRadius: 6, color: selId ? '#22D3EE' : '#5A7090', cursor: selId ? 'pointer' : 'not-allowed', padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                🗓 Календарь
              </button>
            )}
            <button
              disabled={!selId}
              onClick={() => { const row = filtered.find(r => r.id === selId); if (row) onSelect(row); }}
              style={{ background: selId ? 'linear-gradient(135deg,#3B82F6,#2563EB)' : '#1E3252', border: '1px solid ' + (selId ? '#3B82F6' : '#2A4060'), borderRadius: 6, color: selId ? '#fff' : '#5A7090', cursor: selId ? 'pointer' : 'not-allowed', padding: '6px 14px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              ✓ Выбрать
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                onClick={() => { if (c.sortable !== false) handleSort(c.key); }}
                style={{
                  textAlign: 'left', padding: '6px 10px', color: sortKey === c.key ? '#93C5FD' : '#60A5FA',
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '.06em',
                  borderBottom: '1px solid #1E3252', width: c.width,
                  cursor: c.sortable !== false ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {c.label}
                  {sortKey === c.key && (
                    <span style={{ fontSize: 10, color: '#93C5FD', lineHeight: 1 }}>
                      {sortDir === 'asc' ? '▼' : '▲'}
                    </span>
                  )}
                </span>
              </th>
            ))}
            {!onSelect && <th style={{ width: 70, padding: '6px 10px', borderBottom: '1px solid #1E3252' }} />}
          </tr>
        </thead>
        <tbody>
          {filtered.map(row => (
            <tr
              key={row.id}
              onClick={onSelect ? () => setSelId(row.id) : undefined}
              onDoubleClick={onSelect ? () => onSelect(row) : undefined}
              style={{
                borderBottom: '1px solid #162844',
                background: onSelect && selId === row.id ? 'rgba(59,130,246,.12)' : undefined,
                cursor: onSelect ? 'pointer' : undefined,
              }}
            >
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
              {(
                <td style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                  {editingId === row.id ? (
                    <>
                      <button onClick={() => saveEdit(row.id)} style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontSize: 12 }}>✓</button>
                      <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(row.id); setEditVals({}); }} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }} title="Редактировать">✎</button>
                      <button onClick={() => deleteRow(row.id, row.name || row.specification_name || '')} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', opacity: 0.6, fontSize: 12 }} title="Удалить">🗑</button>
                    </>
                  )}
                </td>
              )}
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
                  {errNew && <span style={{ color: '#F87171', fontSize: 11, marginLeft: 8 }}>{errNew}</span>}
              </td>
            </tr>
          )}
          {filtered.length === 0 && !adding && (
            <tr><td colSpan={columns.length + (onSelect ? 0 : 1)} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Нет данных</td></tr>
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
                    await af(`${apiBase}/v1/${entity}/`, { method: 'POST', body: JSON.stringify(row) });
                  } catch { }
                }
                await load();
              }}
              onClose={() => setShowImport(false)}
            />
          </div>
        </div>
      )}

      {/* Delete-check dialog */}
      {deleteCheckTarget && (
        <DeleteCheckDialog
          entityType={entity}
          entityId={deleteCheckTarget.id}
          entityName={deleteCheckTarget.name}
          result={deleteCheckResult}
          loading={deleteCheckLoading}
          error={deleteCheckError}
          onClose={() => { setDeleteCheckTarget(null); setDeleteCheckResult(null); }}
          onDeleted={load}
        />
      )}
    </div>
  );
}
