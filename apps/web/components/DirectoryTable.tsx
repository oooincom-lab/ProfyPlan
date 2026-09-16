'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import DataImport from './DataImport';
import DeleteCheckDialog from './DeleteCheckDialog';
import MassDeleteDialog from './MassDeleteDialog';

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
  /** Открыть окно редактирования записи (вместо inline-редактирования) */
  onEditWindow?: (row: any) => void;
  /** Открыть окно добавления записи (вместо inline-строки) */
  onAddWindow?: () => void;
  compact?: boolean;
  synonyms?: Record<string, string[]>;
  /** Счётчик — при изменении список перезагружается (после удаления извне) */
  refreshKey?: number;
  /** Дополнительное действие строки (например, «дашборд ресурса») */
  onRowDashboard?: (row: any) => void;
  /** id строки, которую нужно выделить/прокрутить при открытии (окно выбора справочника) */
  highlightId?: string | null;
  /** Переопределение URL (проектные справочники: этапы и т.п.). Если задан — используется вместо /v1/{entity}/... */
  endpoints?: {
    list?: string;
    create?: string;
    item?: (id: string) => string;
    method?: 'PUT' | 'PATCH';
  };
};

export default function DirectoryTable({ entity, columns, apiBase, onSelect, onManageEdit, onManageDelete, onManageCalendar, onEditWindow, onAddWindow, onRowDashboard, compact, synonyms, refreshKey = 0, endpoints, highlightId = null }: Props) {
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
  const [archFilter, setArchFilter] = useState<'active' | 'all' | 'archived'>('active');
  const [justArchived, setJustArchived] = useState<{ ids: string[]; name: string } | null>(null);
  // множественное выделение (Ctrl/Shift) + контекстное меню
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  // Режим групповых операций: включается отдельным флажком. Пока выключен —
  // клик по строке выбирает одну запись (предыдущее выделение сбрасывается).
  const [bulkMode, setBulkMode] = useState(false);
  const isOpsDir = entity === 'catalog-operations' || entity === 'operations';
  // Справочники, для которых доступен архив (совпадает со списком на сервере).
  const ARCHIVE_ENTITIES = new Set(['catalog-operations', 'operations', 'nomenclature', 'units', 'counterparties', 'resources', 'departments', 'organizations', 'stages', 'work-schedules', 'work_schedules']);
  const canArchive = ARCHIVE_ENTITIES.has(entity);
  // Тип сущности для проверки связей и безопасного удаления (сервер знает
  // единственное число; справочник операций — catalog_operation).
  const deleteEntityType = isOpsDir ? 'catalog_operation' : entity;
  const entityLabel =
    isOpsDir ? 'Операции'
    : entity === 'nomenclature' ? 'Номенклатура'
    : entity === 'units' ? 'Единицы измерения'
    : entity === 'counterparties' ? 'Контрагенты'
    : entity === 'resources' ? 'Ресурсы'
    : entity === 'departments' ? 'Подразделения'
    : entity === 'organizations' ? 'Организации'
    : entity === 'stages' ? 'Этапы'
    : entity;
  const toggleSel = (id: string, e?: any) => {
    setSelIds(prev => {
      const n = new Set(prev);
      if (e?.shiftKey && selId) {
        const ids = filtered.map((r: any) => String(r.id));
        const a = ids.indexOf(String(selId)), b = ids.indexOf(String(id));
        if (a >= 0 && b >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(ids[i]); return n; }
      }
      if (e?.ctrlKey || e?.metaKey) { if (n.has(id)) n.delete(id); else n.add(id); return n; }
      if (n.size === 1 && n.has(id)) { n.clear(); return n; }
      n.clear(); n.add(id); return n;
    });
    setSelId(id);
  };
  // Выделение строк мышью (как в группах/пулах): клик — накопление, Shift — диапазон от
  // последней выделенной, Ctrl/⌘ — точечно. В режиме выбора (onSelect) клик выбирает одну запись.
  const handleRowClick = (row: any, e: React.MouseEvent) => {
    if (editingId === row.id) return;
    const id = String(row.id);
    // Обычный клик без модификаторов (вне режима групповых операций) — выбрать одну запись.
    if (!bulkMode && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelIds(new Set([id]));
      setSelId(id);
      return;
    }
    const ids = filtered.map((r: any) => String(r.id));
    if (e.shiftKey && selId) {
      const a = ids.indexOf(String(selId));
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        setSelIds(prev => { const n = new Set(prev); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(ids[i]); return n; });
        setSelId(id);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
      setSelId(id);
      return;
    }
    setSelIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setSelId(id);
  };
  // Единый эндпоинт архива для всех справочников.
  const directoryState = async (ids: string[], isActive: boolean) => {
    if (!ids.length) return;
    await af(`${apiBase}/v1/directory/bulk/state`, { method: 'PATCH', body: JSON.stringify({ entity, ids, is_active: isActive }) });
  };
  const bulkState = async (isActive: boolean) => {
    const ids = Array.from(selIds);
    if (!ids.length) return;
    await directoryState(ids, isActive);
    setJustArchived(isActive ? null : { ids, name: `Записей убрано в архив: ${ids.length}` });
    setSelIds(new Set());
    await load();
  };
  const [deleteCheckTarget, setDeleteCheckTarget] = useState<{ id: string; name: string } | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const treeInitRef = useRef(false);
  const toggleExpanded = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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
      const _base = endpoints?.list || `${apiBase}/v1/${entity}/`;
      const _url = canArchive && archFilter !== 'active' ? (_base + (_base.includes('?') ? '&' : '?') + 'include_archived=true') : _base;
      const r = await af(_url);
      if (r.ok) {
        let rows: any[] = await r.json();
        if (canArchive) {
          if (archFilter === 'active') rows = rows.filter((x: any) => x.is_active !== false);
          else if (archFilter === 'archived') rows = rows.filter((x: any) => x.is_active === false);
        }
        // Иерархия подразделений (03.09.2026): обогащение (головное подразделение, глубина) + порядок по дереву
        if (entity === 'departments') {
          const byId = new Map<string, any>(rows.map((x: any) => [String(x.id), x]));
          const depthOf = (x: any): number => {
            let d = 0, cur = x, hops = 0;
            while (cur?.parent_id && hops < 12) {
              const p = byId.get(String(cur.parent_id));
              if (!p) break;
              d += 1; cur = p; hops += 1;
            }
            return d;
          };
          const seen = new Set<string>();
          const ordered: any[] = [];
          const walk = (pid: string | null) => {
            for (const x of rows) {
              const p = x.parent_id ? String(x.parent_id) : null;
              if (p === pid && !seen.has(String(x.id))) {
                seen.add(String(x.id));
                ordered.push({ ...x, _depth: depthOf(x), _parent_name: x.parent_id ? (byId.get(String(x.parent_id))?.name || '') : '' });
                walk(String(x.id));
              }
            }
          };
          walk(null);
          for (const x of rows) if (!seen.has(String(x.id))) ordered.push({ ...x, _depth: 0, _parent_name: '' });
          rows = ordered;
        }
        setRows(rows);
      }
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
      else {
        let detail = `HTTP ${r.status}`;
        try { const j = await r.json(); detail = j.detail || detail; } catch { }
        setErrNew('Не сохранено: ' + detail);
      }
    } catch (e: any) { setErrNew('Ошибка: ' + (e.message || '')); }
  };

  // Перезагрузка списка при смене фильтра «Активные / Все / Только архивные»
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archFilter]);
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
  // Дерево (подразделения): по умолчанию всё развёрнуто + кнопки «Свернуть/Развернуть все»
  useEffect(() => {
    if (entity !== 'departments' || treeInitRef.current) return;
    if (!rows || rows.length === 0) return;
    const parents = rows.filter((r: any) => rows.some((x: any) => x.parent_id && String(x.parent_id) === String(r.id))).map((r: any) => String(r.id));
    if (parents.length) setExpanded(new Set(parents));
    treeInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, entity]);

  // автовыделение строки при открытии окна выбора (currentValue)
  useEffect(() => {
    if (!highlightId || !rows || rows.length === 0) return;
    const found = rows.find((r: any) => String(r.id) === String(highlightId));
    if (!found) return;
    // setSelId устанавливает выделение (если окно в режиме выбора)
    // @ts-ignore
    setSelId(String(highlightId));
    // прокрутка к строке
    requestAnimationFrame(() => {
      const tbody = document.querySelector('[data-dt-row="' + String(highlightId) + '"]');
      if (tbody) tbody.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, highlightId]);

  const filtered = useMemo(() => {
    let result = rows;
    if (filter) {
      const q = filter.toLowerCase();
      result = rows.filter(r => String(r[searchField] ?? '').toLowerCase().includes(q));
    }
    if (sortKey && entity !== 'departments') {
      result = [...result].sort((a, b) => {
        const va = (a[sortKey] ?? '').toString().toLowerCase();
        const vb = (b[sortKey] ?? '').toString().toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return result;
  }, [rows, filter, searchField, sortKey, sortDir]);

  // Иерархическое раскрытие подразделений
  const visibleRows = useMemo(() => {
    if (entity !== 'departments') return filtered;
    const kids = new Map<string, any[]>();
    for (const r of rows) {
      const pid = r.parent_id ? String(r.parent_id) : '';
      if (!kids.has(pid)) kids.set(pid, []);
      kids.get(pid)!.push(r);
    }
    // Сортировка по колонке — в рамках каждого уровня дерева (ствол и каждая ветвь отдельно внутри себя)
    const cmp = (a: any, b: any) => {
      if (!sortKey) return 0;
      const va = String((a as any)[sortKey] ?? '').toLowerCase();
      const vb = String((b as any)[sortKey] ?? '').toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    };
    const out: any[] = [];
    const walk = (pid: string) => {
      const arr = [...(kids.get(pid) || [])];
      if (sortKey) arr.sort(cmp);
      for (const child of arr) {
        out.push(child);
        if (expanded.has(String(child.id))) walk(String(child.id));
      }
    };
    walk('');
    return out;
  }, [rows, filtered, entity, expanded, sortKey, sortDir]);

  // Клавиатура: Esc — снять выделение, Ctrl/⌘+A — выделить всё отфильтрованное.
  useEffect(() => {
    if (onSelect || !bulkMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelIds(new Set()); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф')) {
        const t = e.target as HTMLElement | null;
        const tag = (t?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        e.preventDefault();
        setSelIds(new Set(filtered.map((r: any) => String(r.id))));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, onSelect, bulkMode]);

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
        {canArchive && (
          <select value={archFilter} onChange={(e) => setArchFilter(e.target.value as any)}
            style={{ background: '#162844', color: '#CBD8EA', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
            <option value="active">Активные</option>
            <option value="all">Все</option>
            <option value="archived">Только архивные</option>
          </select>
        )}
        {justArchived && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#CBD8EA', background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 6, padding: '3px 8px' }}>
            {justArchived.name}
            <button className="btn btn-secondary btn-sm"
              onClick={async () => {
                await directoryState(justArchived.ids, true);
                setJustArchived(null);
                await load();
              }}>Вернуть</button>
            <button onClick={() => setJustArchived(null)} style={{ background: 'none', border: 'none', color: '#8FA3BD', cursor: 'pointer' }}>✕</button>
          </span>
        )}
        {!compact && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (onAddWindow) { onAddWindow(); return; }
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
        {!onSelect && filtered.length > 0 && (
          <label
            title="Групповые действия: выделение нескольких строк"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', userSelect: 'none', background: '#162844', border: '1px solid ' + (bulkMode ? '#3B82F6' : '#2A4060'), borderRadius: 6, padding: '4px 10px', color: bulkMode ? '#93C5FD' : '#5A7090' }}
          >
            <input
              type="checkbox"
              checked={bulkMode}
              onChange={(e) => { setBulkMode(e.target.checked); if (!e.target.checked) setSelIds(new Set()); }}
              style={{ cursor: 'pointer' }}
            />
            Выбрать несколько
          </label>
        )}
        {entity === 'departments' && (
          <>
            <button
              className="btn btn-sm"
              style={{ background: '#162844', color: '#93C5FD', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
              onClick={() => setExpanded(new Set(rows.filter((r: any) => rows.some((x: any) => x.parent_id && String(x.parent_id) === String(r.id))).map((r: any) => String(r.id))))}
            >⤵ Развернуть все</button>
            <button
              className="btn btn-sm"
              style={{ background: '#162844', color: '#93C5FD', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
              onClick={() => setExpanded(new Set())}
            >⤴ Свернуть все</button>
          </>
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
            {editingId && (
              <button
                onClick={() => saveEdit(editingId)}
                title="Сохранить изменения"
                style={{ background: 'linear-gradient(135deg,#10B981,#059669)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '6px 14px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                💾 Сохранить
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
          {bulkMode && !onSelect && (
            <tr>
              <th colSpan={columns.length + (onSelect ? 0 : 1)} style={{ borderBottom: '1px solid #1E3252', padding: '6px 10px', background: 'rgba(59,130,246,.12)', textTransform: 'none', letterSpacing: 0, fontFamily: 'Inter, sans-serif', fontWeight: 400, color: '#CBD8EA', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>Выбрано: {selIds.size}</span>
                  {canArchive && (
                    <button className="btn btn-sm" disabled={selIds.size === 0} style={{ background: selIds.size ? '#162844' : 'rgba(30,50,82,.5)', color: selIds.size ? '#93C5FD' : '#5A7090', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: selIds.size ? 'pointer' : 'not-allowed' }} onClick={() => bulkState(false)}>🗄 В архив</button>
                  )}
                  {canArchive && (
                    <button className="btn btn-sm" disabled={selIds.size === 0} style={{ background: selIds.size ? '#162844' : 'rgba(30,50,82,.5)', color: selIds.size ? '#93C5FD' : '#5A7090', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: selIds.size ? 'pointer' : 'not-allowed' }} onClick={() => bulkState(true)}>↩︎ Вернуть</button>
                  )}
                  <button className="btn btn-sm" disabled={selIds.size === 0} style={{ background: selIds.size ? 'rgba(239,68,68,.12)' : 'rgba(30,50,82,.5)', color: selIds.size ? '#F87171' : '#5A7090', border: '1px solid ' + (selIds.size ? 'rgba(239,68,68,.4)' : '#2A4060'), borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: selIds.size ? 'pointer' : 'not-allowed' }} onClick={() => setMassDeleteOpen(true)}>🗑 Удалить</button>
                  <button className="btn btn-sm" style={{ background: 'transparent', color: '#93C5FD', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }} onClick={() => setSelIds(new Set(filtered.map((r: any) => String(r.id))))}>Выделить всё</button>
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-sm" disabled={selIds.size === 0} style={{ background: 'transparent', color: selIds.size ? '#8FA3BD' : '#5A7090', border: '1px solid #2A4060', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: selIds.size ? 'pointer' : 'not-allowed' }} onClick={() => setSelIds(new Set())}>Снять выделение</button>
                </div>
              </th>
            </tr>
          )}
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
          {(entity === 'departments' ? visibleRows : filtered).map(row => (
            <tr
              onContextMenu={(e) => { e.preventDefault(); if (!selIds.has(String(row.id))) toggleSel(String(row.id)); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
              data-dt-row={String(row.id)}
              key={row.id}
              onClick={onSelect ? () => setSelId(row.id) : (e) => handleRowClick(row, e)}
              onMouseEnter={() => setHoverId(String(row.id))}
              onMouseLeave={() => setHoverId((h) => (h === String(row.id) ? null : h))}
              onDoubleClick={() => { if (onEditWindow) onEditWindow(row); else if (onSelect) onSelect(row); }}
              style={{
                borderBottom: '1px solid #162844',
                background: (onSelect ? selId === row.id : selIds.has(String(row.id)))
                  ? 'rgba(59,130,246,.18)'
                  : (hoverId === String(row.id) ? 'rgba(59,130,246,.09)' : undefined),
                boxShadow: !onSelect && selIds.has(String(row.id)) ? 'inset 3px 0 0 0 #3B82F6' : undefined,
                opacity: row.is_active === false ? 0.62 : 1,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {columns.map((c, ci) => (
                <td key={c.key} style={{ padding: '7px 10px', color: '#B0C4DE', ...(entity === 'departments' && c.key === 'name' ? { paddingLeft: 6 + (Number((row as any)._depth) || 0) * 18 } : {}) }}>
                  {entity === 'departments' && c.key === 'name' && (() => {
                    const hasKids = rows.some((r: any) => r.parent_id && String(r.parent_id) === String(row.id));
                    if (!hasKids) return <span style={{ display: 'inline-block', width: 18 }} />;
                    const open = expanded.has(String(row.id));
                    return (
                      <button type="button" title={open ? 'Свернуть' : 'Развернуть'} onClick={(e) => { e.stopPropagation(); toggleExpanded(String(row.id)); }}
                        style={{ background: 'transparent', border: 0, color: '#5A7090', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: '0 6px 0 0', width: 18, textAlign: 'left' }}>
                        {open ? '▾' : '▸'}
                      </button>
                    );
                  })()}
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
                  {ci === 0 && row.is_active === false && (
                    <span title="Запись в архиве" style={{ marginLeft: 6, color: '#EF4444', fontSize: 13, lineHeight: 1, cursor: 'help' }}>⊘</span>
                  )}
                </td>
              ))}
              {!onSelect && (
                <td style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                  {editingId === row.id ? (
                    <>
                      <button onClick={() => saveEdit(row.id)} style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontSize: 12 }}>✓</button>
                      <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </>
                  ) : (
                    <>
                      {onRowDashboard && (
                        <button onClick={(e) => { e.stopPropagation(); onRowDashboard(row); }} style={{ background: 'none', border: 'none', color: '#93C5FD', cursor: 'pointer', opacity: 0.85, fontSize: 12 }} title="Дашборд: часы, мощность, проекты, конфликты, потери">📊</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); if (onEditWindow) onEditWindow(row); else if (onManageEdit) onManageEdit(row); else { setEditingId(row.id); setEditVals({}); } }} style={{ background: 'none', border: 'none', color: onEditWindow ? '#60A5FA' : '#5A7090', cursor: 'pointer', fontSize: 12 }} title="Редактировать">✎</button>
                      <button onClick={(e) => { e.stopPropagation(); if (onManageDelete) onManageDelete(row); else deleteRow(row.id, row.name || row.specification_name || ''); }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', opacity: 0.6, fontSize: 12 }} title="Удалить">🗑</button>
                      {canArchive && (
                        <button title={row.is_active === false ? 'Вернуть из архива' : 'Убрать в архив'}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const restore = row.is_active === false;
                            await directoryState([String(row.id)], restore);
                            setJustArchived(restore ? null : { ids: [String(row.id)], name: `«${row.name}» убрана в архив` });
                            await load();
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, opacity: .8 }}>
                          {row.is_active === false ? '↩︎' : '🗄'}
                        </button>
                      )}
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

      {/* контекстное меню выделенных строк */}
      {ctxMenu && selIds.size > 0 && (
        <div style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 10050, background: '#0F1B2D', border: '1px solid #2A4060', borderRadius: 8, padding: 6, minWidth: 240, boxShadow: '0 10px 30px rgba(0,0,0,.5)' }}
          onMouseLeave={() => setCtxMenu(null)}>
          <div style={{ fontSize: 11, color: '#5A7090', padding: '4px 8px' }}>Выбрано: {selIds.size}</div>
          <button style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, color: '#CBD8EA', padding: '6px 8px', cursor: 'pointer' }} onClick={() => { setCtxMenu(null); bulkState(false); }}>🗄 Убрать в архив</button>
          <button style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, color: '#CBD8EA', padding: '6px 8px', cursor: 'pointer' }} onClick={() => { setCtxMenu(null); bulkState(true); }}>↩︎ Вернуть из архива</button>
          <button style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, color: '#F87171', padding: '6px 8px', cursor: 'pointer' }} onClick={() => { setCtxMenu(null); setMassDeleteOpen(true); }}>🗑 Удалить…</button>
          <button style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, color: '#8FA3BD', padding: '6px 8px', cursor: 'pointer' }} onClick={() => { setCtxMenu(null); setSelIds(new Set()); }}>Снять выделение</button>
        </div>
      )}

      {/* Мастер массового удаления */}
      {massDeleteOpen && selIds.size > 0 && (
        <MassDeleteDialog
          apiBase={apiBase}
          entity={entity}
          entityType={deleteEntityType}
          entityLabel={entityLabel}
          ids={Array.from(selIds)}
          rows={rows.filter((r: any) => selIds.has(String(r.id))).map((r: any) => ({ id: String(r.id), name: r.name || r.specification_name || r.name_ru || String(r.id) }))}
          replaceOptions={rows.filter((r: any) => !selIds.has(String(r.id))).map((r: any) => ({ id: String(r.id), name: r.name || r.specification_name || r.name_ru || String(r.id) })).slice(0, 500)}
          archiveCapable={canArchive}
          onClose={() => setMassDeleteOpen(false)}
          onDone={() => { setSelIds(new Set()); load(); }}
        />
      )}

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
          entityType={deleteEntityType}
          entityId={deleteCheckTarget.id}
          entityName={deleteCheckTarget.name}
          result={deleteCheckResult}
          replaceOptions={(entity === 'catalog-operations' || entity === 'operations')
            ? (rows || []).filter((x: any) => x.id !== deleteCheckTarget.id).map((x: any) => ({ id: x.id, name: x.name }))
            : undefined}
          replaceLabel="Перенести связанные операции на:"
          onArchive={canArchive ? async () => {
            await directoryState([String(deleteCheckTarget.id)], false);
            await load();
          } : undefined}
          loading={deleteCheckLoading}
          error={deleteCheckError}
          onClose={() => { setDeleteCheckTarget(null); setDeleteCheckResult(null); }}
          onDeleted={load}
        />
      )}
    </div>
  );
}
