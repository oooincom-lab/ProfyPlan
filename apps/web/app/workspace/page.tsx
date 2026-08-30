'use client';

import { useState, useCallback, Fragment, useRef, useEffect } from 'react';
import ClipboardPaste from '@/components/ClipboardPaste';
import DirectoryTable from '@/components/DirectoryTable';
import { NOMENCLATURE_SYNONYMS, UNIT_SYNONYMS } from '@/components/DataImport';
import DirectoryPicker from '@/components/DirectoryPicker';
import DirectoryManager from '@/components/DirectoryManager';
import WorkScheduleManager from '@/components/WorkScheduleManager';
import ProductionCalendarManager from '@/components/ProductionCalendarManager';
import ResourceManager from '@/components/ResourceManager';
import DebugBadge from '@/components/DebugBadge';
import Sidebar from '@/components/sidebar';
import PoolEditor from '@/components/pooleditor';
import GroupEditor from '@/components/groupeditor';
import DeleteCheckDialog from '@/components/DeleteCheckDialog';
import ExcelImportWizard from '@/components/ExcelImportWizard';
import BomTree from '@/components/bomtree';
import BomExpand from '@/components/bomexpand';
import { importProductionOrders } from '@/lib/api';
import { useWindows, type WinRec } from '@/components/windows/useWindows';
import WindowsLayer from '@/components/windows/WindowsLayer';
import AppModal from '@/components/AppModal';
import ReferenceField from '@/components/ReferenceField';

const API = 'https://profyplan.ru/api/v1';
const C = (s: string) => s;

const DIR_COLUMNS: Record<string, { title: string; columns: { key: string; label: string; width?: number }[] }> = {
  counterparties: {
    title: '👥 Контрагенты',
    columns: [
      { key: 'name', label: 'Наименование', width: 220 },
      { key: 'inn', label: 'ИНН', width: 110 },
      { key: 'kpp', label: 'КПП', width: 100 },
      { key: 'ogrn', label: 'ОГРН', width: 130 },
      { key: 'external_code', label: 'Внешний код', width: 120 },
      { key: 'note', label: 'Примечание' },
    ],
  },
  units: {
    title: '📏 Единицы измерения',
    columns: [
      { key: 'code', label: 'ОКЕИ', width: 80 },
      { key: 'symbol_int', label: 'Межд.', width: 80 },
      { key: 'symbol_ru', label: 'Символ', width: 80 },
      { key: 'name_ru', label: 'Название', width: 160 },
    ],
  },
  nomenclature: {
    title: '📦 Номенклатура',
    columns: [
      { key: 'name', label: 'Название', width: 240 },
      { key: 'code', label: 'Код', width: 120 },
      { key: 'article', label: 'Артикул', width: 150 },
      { key: 'ntype', label: 'Тип', width: 130 },
      { key: 'unit', label: 'Ед.', width: 70 },
    ],
  },
  operations: {
    title: 'Операции', columns: [
      { key: 'name', label: 'Операция' },
      { key: 'default_duration_hours', label: 'Длит., ч' },
      { key: 'notes', label: 'Примечание' },
    ],
  },
  departments: {
    title: 'Подразделения', columns: [
      { key: 'name', label: 'Подразделение' },
      { key: 'code', label: 'Код' },
    ],
  },
  stages: {
    title: 'Этапы проекта', columns: [
      { key: 'position', label: '№', width: 50 },
      { key: 'name', label: 'Этап' },
      { key: 'code', label: 'Код' },
    ],
  },
  resources: {
    title: '🔧 Ресурсы',
    columns: [
      { key: 'name', label: 'Название', width: 220 },
      { key: 'resource_type', label: 'Тип', width: 130 },
      { key: 'capacity_per_unit', label: 'Мощн./ед.', width: 100 },
      { key: 'capacity_unit', label: 'Ед.', width: 70 },
      { key: 'country_code', label: 'Страна', width: 80 },
    ],
  },
};

async function apiF<T>(path: string, opts?: RequestInit): Promise<T> {
  const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as any || {}) };
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers: h });
  if (r.status === 401) {
    localStorage.removeItem('profyplan_token');
    throw new Error('AUTH_REQUIRED');
  }
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  if (r.status === 204) return undefined as any;
  return r.json();
}

type View = 'dashboard' | 'projects' | 'project-dashboard' | 'project-orders' | 'project-gantt' | 'project-pools' | 'project-groups' | 'archive' | 'directories' | 'nomenclature' | 'units' | 'counterparties' | 'resources' | 'work-schedules' | 'departments' | 'organizations' | 'production-calendars' | 'ccm' | 'reports' | 'settings' | 'new-project';

export default function AppShell() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [authError, setAuthError] = useState(false);
  const [pendingTenants, setPendingTenants] = useState<any[]>([]);
  const [loginForm, setLoginForm] = useState({ email: 'planner@demo.ru', password: 'demo123' });
  const [view, setView] = useState<View>('dashboard');
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [groups, setGroups] = useState<Record<string, any[]>>({});
  const [pools, setPools] = useState<Record<string, any[]>>({});
  const [expandedOrders, setExpandedOrders] = useState<string | null>(null);
  const [bomTrees, setBomTrees] = useState<Record<string, any[]>>({});
  const [bomLoading, setBomLoading] = useState<Record<string, boolean>>({});
  const [expandedBomOrder, setExpandedBomOrder] = useState<string | null>(null);
  const [expandedGroupPool, setExpandedGroupPool] = useState<string | null>(null);
  const [bomModalOrder, setBomModalOrder] = useState<any>(null);
  const [bomTimeline, setBomTimeline] = useState<any[] | null>(null);
  const [bomTimelineLoading, setBomTimelineLoading] = useState(false);
  // ── Комбинированный BOM + Маршруты: вид дерева, панель заказа ──
  const [treeMode, setTreeModeState] = useState<'both' | 'bom' | 'routes'>(() => {
    if (typeof window === 'undefined') return 'both';
    const v = localStorage.getItem('profyplan_tree_mode');
    return (v === 'bom' || v === 'routes') ? v : 'both';
  });
  const [panelMode, setPanelModeState] = useState<'side' | 'modal' | 'window'>(() => {
    if (typeof window === 'undefined') return 'side';
    const v = localStorage.getItem('profyplan_panel_mode');
    if (v === 'modal') return 'modal';
    if (v === 'window') return 'window';
    // Миграция старой настройки «Окна для списков» → единый режим
    if (v == null && localStorage.getItem('profyplan_list_windows') === '1') return 'window';
    return 'side';
  });
  // 🧪 Режим отладки: технические идентификаторы окон и форм (для описания проблем)
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('profyplan_debug_mode') === '1';
  });
  const [menuMode, setMenuModeState] = useState<'expanded' | 'manual' | 'auto'>(() => {
    if (typeof window === 'undefined') return 'expanded';
    const v = localStorage.getItem('profyplan_menu_mode');
    return v === 'manual' ? 'manual' : v === 'auto' ? 'auto' : 'expanded';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('profyplan_menu_mode') === 'auto';
  });
  const [autoEnabled, setAutoEnabled] = useState(true); // авто-скрытие включено (режим «Авто»): true — выплывает по наведению, false — закреплено развёрнуто
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [selOrderId, setSelOrderId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'order' | 'bom' | 'route' | 'res' | 'plan'>('order');
  const [panelEditing, setPanelEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [dirManager, setDirManager] = useState<{ title: string; entity: string; columns: any[] } | null>(null);
  const [routings, setRoutings] = useState<any[]>([]);
  const [resourcesList, setResourcesList] = useState<any[]>([]);
  const [workSchedules, setWorkSchedules] = useState<any[]>([]);
  // ── Режим «Окна» (как в ОС: перетаскивание, Snap-раскладки, панель задач) ──
  // Логика и состояние вынесены в useWindows() / WindowsLayer (components/windows).
  const sidebarWidth = menuMode === 'auto' ? 0 : (sidebarCollapsed ? 64 : 260);
  const effCollapsed = menuMode === 'auto' ? (autoEnabled && sidebarCollapsed) : sidebarCollapsed;
  const win = useWindows(sidebarWidth);
  const [pendingList, setPendingList] = useState<{ kind: 'orders' | 'groups' | 'pools'; title: string } | null>(null);
  const dashHeadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pendingList) return;
    if (!dashHeadRef.current) return;
    const r = dashHeadRef.current.getBoundingClientRect();
    const dockTop = Math.max(57, Math.round(r.bottom + 20));
    win.openListWin(pendingList.kind, pendingList.title, dockTop);
    setPendingList(null);
  }, [pendingList, view]);

  const [projectOrders, setProjectOrders] = useState<Record<string, any[]>>({});
  const [sidebarSec, setSidebarSec] = useState<string | null>(null);
  const [orderShowAll, setOrderShowAll] = useState(false);
  const [orderSortKey, setOrderSortKey] = useState<string | null>(null);
  const [orderSortDir, setOrderSortDir] = useState<'asc' | 'desc'>('asc');
  const [orderTypeFilter, setOrderTypeFilter] = useState<string>('free');
  const [collapsedOrderIds, setCollapsedOrderIds] = useState<Set<string>>(new Set());
  const [ganttData, setGanttData] = useState<any>(null);
  const [ganttLoading, setGanttLoading] = useState(false);

  const [newOrder, setNewOrder] = useState({ specification_name: '', quantity: '1', unit: 'pcs', priority: 'normal', client: '' });
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [dupCheck, setDupCheck] = useState<null | { spec: string; existing: any[] }>(null);
  const [editingOrder, setEditingOrder] = useState<string | null>(null);
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkNomenMatches, setBulkNomenMatches] = useState<Record<string, { id: string; name: string } | null>>({});
  const [bulkMatchLoading, setBulkMatchLoading] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  // ── Context menu ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project?: any; pool?: any; group?: any } | null>(null);
  const [sidebarCtx, setSidebarCtx] = useState<{ x: number; y: number; view: string } | null>(null);
  const [directoryModal, setDirectoryModal] = useState<string | null>(null); // e.g. 'nomenclature'

  // ── Inline create inputs (replaces prompt()) ──
  const [newGroupInput, setNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newPoolInput, setNewPoolInput] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');

  // ── Pool detail (dual-list) ──
  const [selectedPool, setSelectedPool] = useState<any>(null);
  const [editingPool, setEditingPool] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [editingGroup, setEditingGroup] = useState(false);
  const [importProjectId, setImportProjectId] = useState<string | null>(null);
  const [selPoolOrders, setSelPoolOrders] = useState<Set<string>>(new Set());
  const [selFreeOrders, setSelFreeOrders] = useState<Set<string>>(new Set());

  // ── Контроль цепочки заказов (куст) ──
  const [orderChainControl, setOrderChainControl] = useState<'off' | 'warning' | 'control'>(() => {
    if (typeof window === 'undefined') return 'off';
    const v = localStorage.getItem('profyplan_order_chain_control');
    return (v === 'warning' || v === 'control') ? v : 'off';
  });
  const [chainDialog, setChainDialog] = useState<null | {
    order: any;
    selectedIds: string[];
    targetGroupId: string | null;
    targetPoolId: string | null;
    cluster: any;
  }>(null);
  const chainResolveRef = useRef<(() => void) | null>(null);

  const setChainControl = (mode: 'off' | 'warning' | 'control') => {
    setOrderChainControl(mode);
    if (typeof window !== 'undefined') localStorage.setItem('profyplan_order_chain_control', mode);
  };

  // ── Полуфабрикаты: политика цепочки (строго / гибко) ──
  const [semiPolicy, setSemiPolicy] = useState<'strict' | 'flexible'>(() => {
    if (typeof window === 'undefined') return 'strict';
    const v = localStorage.getItem('profyplan_semifinished_policy');
    return v === 'flexible' ? 'flexible' : 'strict';
  });
  const [bomAnomalies, setBomAnomalies] = useState<null | {
    checked_nodes: number;
    no_routing: any[];
    no_order: any[];
    self_order: any[];
    total_issues: number;
  }>(null);
  const [bomAnomaliesLoading, setBomAnomaliesLoading] = useState(false);

  const setSemiPolicyMode = (mode: 'strict' | 'flexible') => {
    setSemiPolicy(mode);
    if (typeof window !== 'undefined') localStorage.setItem('profyplan_semifinished_policy', mode);
    if (selectedProject) loadBomAnomalies(selectedProject.id);
  };

  const loadBomAnomalies = async (projId: string) => {
    setBomAnomaliesLoading(true);
    try {
      const res = await apiF<any>(`/bom/projects/${projId}/validate-structure`, { method: 'POST' });
      setBomAnomalies(res || null);
    } catch { setBomAnomalies(null); }
    finally { setBomAnomaliesLoading(false); }
  };

  const createOrderFromNode = async (nodeId: string) => {
    if (!selectedProject) return;
    try {
      const res = await apiF<any>(`/bom/projects/${selectedProject.id}/nodes/${nodeId}/create-order`, {
        method: 'POST', body: JSON.stringify({}),
      });
      setMsg('✅ ' + (res?.message || 'Заказ создан'));
      await reloadBomTree(selectedProject.id);
      await loadProjectOrders(selectedProject.id);
      await loadBomAnomalies(selectedProject.id);
    } catch (e: any) { setMsg('⛔ Ошибка создания заказа: ' + (e.message || String(e))); }
  };

  const createMissingOrders = async () => {
    if (!selectedProject) return;
    try {
      const res = await apiF<any>(`/bom/projects/${selectedProject.id}/create-missing-orders`, {
        method: 'POST', body: JSON.stringify({ strict: semiPolicy === 'strict' }),
      });
      setMsg('✅ ' + (res?.message || 'Готово'));
      await reloadBomTree(selectedProject.id);
      await loadProjectOrders(selectedProject.id);
      await loadBomAnomalies(selectedProject.id);
    } catch (e: any) { setMsg('⛔ Ошибка: ' + (e.message || String(e))); }
  };

  // ── Order CRUD ──
  const loadProjectOrders = async (projId: string) => {
    if (projectOrders[projId]) return;
    try {
      const ords = await apiF<any[]>(`/production-orders/?project_id=${projId}`);
      setProjectOrders(prev => ({ ...prev, [projId]: ords }));
    } catch {}
  };

  const loadBomTree = async (projId: string) => {
    if (bomTrees[projId] || bomLoading[projId]) return;
    await reloadBomTree(projId);
  };

  const reloadBomTree = async (projId: string) => {
    setBomLoading(prev => ({ ...prev, [projId]: true }));
    try {
      const t = await apiF<{ nodes: any[] }>(`/bom/projects/${projId}/tree`);
      setBomTrees(prev => ({ ...prev, [projId]: t.nodes || [] }));
    } catch {}
    finally { setBomLoading(prev => ({ ...prev, [projId]: false })); }
  };

  // ── Централизованная загрузка BOM: защита от повторных поломок ──
  // Раньше loadBomTree вызывалась только в некоторых путях отображения (панель/окно/модалка),
  // поэтому при добавлении нового режима дерево оставалось пустым — детализация и переключатель ломались.
  // Теперь BOM грузится один раз при выборе проекта, независимо от того, какой view/mode его рисует.
  useEffect(() => {
    if (selectedProject?.id) loadBomTree(selectedProject.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  useEffect(() => { apiF<any[]>('/work-schedules/').then(s => { if (Array.isArray(s)) setWorkSchedules(s); }).catch(() => {}); }, []);

  // ── Панель заказа: режимы, данные, действия ──
  const setTreeMode = (m: 'both' | 'bom' | 'routes') => { setTreeModeState(m); try { localStorage.setItem('profyplan_tree_mode', m); } catch {} };
  const setPanelMode = (m: 'side' | 'modal' | 'window') => {
    setPanelModeState(m);
    try { localStorage.setItem('profyplan_panel_mode', m); } catch {}
    if (m === 'modal') { setSelOrderId(null); setPanelEditing(false); }
  };
  const setDebugModeFlag = (v: boolean) => { setDebugMode(v); try { localStorage.setItem('profyplan_debug_mode', v ? '1' : '0'); } catch {} };
  const setMenuMode = (m: 'expanded' | 'manual' | 'auto') => {
    setMenuModeState(m);
    try { localStorage.setItem('profyplan_menu_mode', m); } catch {}
    if (m === 'expanded') { setSidebarCollapsed(false); }
    if (m === 'manual') { setSidebarCollapsed(false); }
    if (m === 'auto') { setAutoEnabled(true); setSidebarCollapsed(true); }
  };

  const loadPanelData = async (p: any) => {
    try {
      const [r, rs] = await Promise.all([
        apiF<any>('/bom/routings?page_size=200').catch(() => null),
        apiF<any[]>('/resources').catch(() => []),
      ]);
      if (r && Array.isArray(r.items)) setRoutings(r.items);
      if (Array.isArray(rs)) setResourcesList(rs);
    } catch {}
  };

  // Сохранение ресурса из MDI-окна «resedit» (режим «окна для списков»)
  const saveResourceEdit = async (w: WinRec) => {
    const f = w.form || {};
    if (!f.name?.trim()) { setMsg('Укажите название ресурса'); return; }
    win.setWins(prev => prev.map(x => x.id === w.id ? { ...x, saving: true } : x));
    const body: Record<string, any> = {
      name: f.name.trim(),
      resource_type: f.resource_type || 'equipment',
      capacity_per_unit: parseFloat(String(f.capacity_per_unit).replace(',', '.')) || 1,
      capacity_unit: f.capacity_unit || 'hour',
      unit: f.unit?.trim() || null,
      country_code: (f.country_code || '').trim().toUpperCase() || null,
      schedule_id: (f.schedule_id || '').trim() || null,
      is_active: true,
    };
    try {
      if (w.data && w.data.id) await apiF(`/resources/${w.data.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiF('/resources', { method: 'POST', body: JSON.stringify(body) });
      win.closeWin(w.id);
      try { const rs = await apiF<any[]>('/resources'); if (Array.isArray(rs)) setResourcesList(rs); } catch {}
    } catch (e: any) {
      setMsg(String(e));
      win.setWins(prev => prev.map(x => x.id === w.id ? { ...x, saving: false } : x));
    }
  };

  const selOrder = selOrderId ? (orders.find((o: any) => o.id === selOrderId) || null) : null;

  const openOrderPanel = (o: any) => {
    if (selectedProject) {
      loadBomTree(selectedProject.id);
      loadPanelData(selectedProject);
    }
    if (panelMode === 'window') { win.openWin(o); return; }
    setSelOrderId(o.id);
    setPanelTab('order');
    setPanelEditing(false);
  };

  const openGroupEditor = (g: any) => {
    if (!selectedProject) return;
    win.setWins(prev => prev.filter(w => !(w.kind === 'list' && w.listKind === 'groups')));
    setSelectedGroup(g); setSelectedProject(selectedProject); setView('project-groups'); setEditingGroup(false);
    (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`); const gs = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/groups`); const pr = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`); setOrders(o); setGroups(prev => ({ ...prev, [selectedProject.id]: gs.items })); setPools(prev => ({ ...prev, [selectedProject.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })();
  };

  const openPoolEditor = (p: any) => {
    if (!selectedProject) return;
    win.setWins(prev => prev.filter(w => !(w.kind === 'list' && w.listKind === 'pools')));
    setSelectedPool(p); setSelectedProject(selectedProject); setView('project-pools'); setSelPoolOrders(new Set()); setSelFreeOrders(new Set()); setEditingPool(false);
    (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`); const pr = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`); setOrders(o); setPools(prev => ({ ...prev, [selectedProject.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })();
  };

  const routingFor = (o: any): any | null => {
    if (!routings.length) return null;
    const root = orderBomNodes(o).find((n: any) => !n.parent_id);
    const key = root?.routing_id || null;
    if (!key) return null;
    return routings.find((r: any) => r.id === key) || null;
  };

  const routingsFor = (o: any): any[] => {
    if (!routings.length) return [];
    const nodes = orderBomNodes(o);
    const ids = Array.from(new Set(nodes.filter((n: any) => n.routing_id && !n._boundary).map((n: any) => n.routing_id)));
    return routings.filter((r: any) => ids.includes(r.id));
  };

  const resName = (rid: any) => {
    if (!rid) return '—';
    const r = resourcesList.find((x: any) => x.id === rid || x.name === rid);
    return r ? r.name : String(rid).slice(0, 8) + '…';
  };

  const openDirectory = (entity: string) => {
    const cfg = DIR_COLUMNS[entity];
    if (!cfg) return;
    if (panelMode === 'window') {
      win.openDirWin(entity, cfg.title, cfg.columns);
    } else {
      setDirManager({ title: cfg.title, entity, columns: cfg.columns });
    }
  };

  const startEditOrder = () => {
    if (!selOrder) return;
    setEditForm({
      client_id: selOrder.client_id || '',
      quantity: String(selOrder.quantity ?? ''),
      unit: selOrder.unit || '',
      priority: selOrder.priority || 'normal',
      start_date: selOrder.start_date || '',
      due_date: selOrder.due_date || '',
      status: selOrder.status || 'draft',
    });
    setPanelTab('order');
    setPanelEditing(true);
  };

  const saveOrderEdit = async () => {
    if (!selOrder) return;
    try {
      const body: any = { quantity: Number(editForm.quantity) || 1, priority: editForm.priority, status: editForm.status, unit: editForm.unit || undefined };
      if (editForm.client_id) body.client_id = editForm.client_id;
      if (editForm.start_date) body.start_date = editForm.start_date;
      if (editForm.due_date) body.due_date = editForm.due_date;
      await apiF(`/production-orders/${selOrder.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setMsg('Заказ обновлён');
      setPanelEditing(false);
      if (selectedProject) await loadProjectOrdersView(selectedProject);
    } catch (e: any) { setMsg('Ошибка сохранения: ' + (e.message || String(e))); }
  };

  const saveWinEdit = async (w: WinRec) => {
    const o = orders.find((x: any) => x.id === w.orderId);
    if (!o) return;
    try {
      const body: any = { quantity: Number(w.form.quantity) || 1, priority: w.form.priority, status: w.form.status, unit: w.form.unit || undefined };
      if (w.form.client_id) body.client_id = w.form.client_id;
      if (w.form.start_date) body.start_date = w.form.start_date;
      if (w.form.due_date) body.due_date = w.form.due_date;
      await apiF(`/production-orders/${o.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setMsg('Заказ обновлён');
      win.setWins(prev => prev.map(x => x.id === w.id ? { ...x, editing: false } : x));
      if (selectedProject) await loadProjectOrdersView(selectedProject);
    } catch (e: any) { setMsg('Ошибка сохранения: ' + (e.message || String(e))); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (win.lay) { win.setLay(null); return; }
        setPanelEditing(false); setSelOrderId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [win.lay]);

  const toggleBomOrder = (o: any) => {
    if (!selectedProject) return;
    const next = expandedBomOrder === o.id ? null : o.id;
    setExpandedBomOrder(next);
    if (next) loadBomTree(selectedProject.id);
  };

  // Переход к заказу по бейджу «производит: …»: раскрыть путь в иерархии,
  // раскрыть его BOM и прокрутить список к строке заказа.
  const focusOrderByBom = (orderId: string) => {
    setCollapsedOrderIds(prev => {
      const next = new Set(prev);
      const all = projectOrders[selectedProject?.id || ''] || orders;
      const byId = new Map(all.map((x: any) => [x.id, x]));
      let cur: any = byId.get(orderId);
      while (cur) { next.delete(cur.id); cur = cur.parent_order_id ? byId.get(cur.parent_order_id) : null; }
      return next;
    });
    setExpandedBomOrder(orderId);
    if (panelMode !== 'window') setView('project-orders');
    setTimeout(() => {
      document.getElementById('ord-' + orderId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 150);
  };

  const toggleOrderCollapse = (id: string) => {
    setCollapsedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const setAllOrdersCollapsed = (collapsed: boolean) => {
    setCollapsedOrderIds(collapsed ? new Set(orders.map((o: any) => o.id)) : new Set());
  };

  const orderBomNodes = (o: any) => {
    const all = bomTrees[selectedProject?.id || ''] || [];
    if (!all.length) return [];
    const oid = o.id;
    const specName = (o.specification_name || '').toLowerCase().trim();
    const specId = (o.specification_id || '').toLowerCase().trim();
    const childrenMap: Record<string, any[]> = {};
    for (const n of all) if (n.parent_id) (childrenMap[n.parent_id] ||= []).push(n);
    const kept = new Set<string>();
    const boundary = new Set<string>();

    // Обход поддерева с учётом границ куста заказов:
    // не переходим в узлы, привязанные через order_id к другому заказу —
    // включаем их как границы-ссылки (без раскрытия материалов и без операций).
    const walk = (start: any) => {
      if (kept.has(start.id)) return;
      kept.add(start.id);
      for (const c of childrenMap[start.id] || []) {
        if (c.order_id && c.order_id !== oid) { kept.add(c.id); boundary.add(c.id); continue; }
        walk(c);
      }
    };

    const result = () => all
      .filter(n => kept.has(n.id))
      .map(n => boundary.has(n.id) ? { ...n, _boundary: true } : n);

    // 0) узлы, напрямую привязанные к заказу через order_id (полуфабрикаты куста)
    const ownByOrder = all.filter(n => n.order_id && n.order_id === oid);
    if (ownByOrder.length) {
      ownByOrder.forEach(walk);
      return result();
    }

    // 1) корни по имени номенклатуры (спецификация заказа = имя корневого изделия)
    const roots = all.filter(n => !n.parent_id);
    const byName = roots.filter(r => specName && (r.nomenclature_name || '').toLowerCase().trim() === specName);
    if (byName.length) { byName.forEach(walk); return result(); }

    // 2) узел (не только корень) по коду = specification_id — заказ, созданный из полуфабриката
    if (specId) {
      const node = all.find(n => (n.nomenclature_id || '').toLowerCase().trim() === specId
        || (n.ext_id || '').toLowerCase().trim() === specId);
      if (node) { walk(node); return result(); }
    }

    // 3) корни, чья спецификация из path == specification_id (импортированные данные: path = Спец/Узел)
    const specOf = (n: any) => (n.path && n.path.includes('/')) ? n.path.split('/')[0].toLowerCase().trim() : '';
    const byPath = roots.filter(r => specId && specOf(r) === specId);
    if (byPath.length) { byPath.forEach(walk); return result(); }

    // 4) спецификация задана, но не найдена — пустой BOM, а не «весь проект»
    if (specName || specId) return [];

    // 5) без спецификации — все корни (ручные заказы без привязки к BOM)
    roots.forEach(walk);
    return result();
  };

  const openBomModal = (o: any) => {
    setBomTimeline(null);
    setBomTimelineLoading(false);
    if (selectedProject) {
      loadProjectOrders(selectedProject.id);
      loadBomAnomalies(selectedProject.id);
      loadBomTree(selectedProject.id);
    }
    if (panelMode === 'window') { win.openBomWin(o); return; }
    setBomModalOrder(o);
  };

  const handleNodeOrderChange = async (nodeId: string, orderId: string | null) => {
    if (!selectedProject) return;
    try {
      if (orderId) {
        const chk = await apiF<any>(`/bom/projects/${selectedProject.id}/validate-node-link`, {
          method: 'POST', body: JSON.stringify({ node_id: nodeId, order_id: orderId })
        });
        if (chk && chk.ok === false) {
          setMsg('⛔ ' + (chk.message || 'Нельзя привязать заказ — создаст цикл в цепочке'));
          return;
        }
      }
      await apiF(`/bom/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify({ order_id: orderId }) });
      await reloadBomTree(selectedProject.id);
      try { await loadProjectOrders(selectedProject.id); } catch {}
      try { await refresh(); } catch {}
    } catch (e: any) { setMsg('Ошибка привязки заказа: ' + (e.message || String(e))); }
  };

  // ── Редактирование BOM-узлов (вкладка «Состав» окна заказа) ──
  const handleBomNodeQuantity = async (nodeId: string, value: number) => {
    try {
      await apiF(`/bom/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify({ quantity_per_parent: value }) });
      if (selectedProject) await reloadBomTree(selectedProject.id);
    } catch (e: any) { setMsg('Ошибка изменения количества: ' + (e.message || String(e))); }
  };

  // ── Мастер удаления узла BOM: проверка поддерева вниз по дереву ──
  const confirmBomNodeDelete = (nodeId: string) => {
    if (!selectedProject) return;
    const all = bomTrees[selectedProject.id] || [];
    const node = all.find((n: any) => n.id === nodeId);
    if (!node) return;
    const childrenMap: Record<string, any[]> = {};
    for (const n of all) if (n.parent_id) (childrenMap[n.parent_id] ||= []).push(n);
    const items: { name: string; type: string }[] = [];
    const walk = (id: string) => {
      for (const c of childrenMap[id] || []) {
        items.push({ name: c.nomenclature_name || c.name || c.ext_id || '—', type: c.node_type || 'node' });
        walk(c.id);
      }
    };
    walk(nodeId);
    setBomDelete({ nodeId, name: node.nomenclature_name || node.name || node.ext_id || nodeId, items });
  };

  const doBomNodeDelete = async () => {
    if (!selectedProject || !bomDelete) return;
    try {
      await apiF(`/bom/projects/${selectedProject.id}/nodes/${bomDelete.nodeId}`, { method: 'DELETE' });
      setBomDelete(null);
      await reloadBomTree(selectedProject.id);
      await reloadRoutings();
    } catch (e: any) { setMsg('Ошибка удаления узла: ' + (e.message || String(e))); }
  };

  const handleBomNodeRemove = confirmBomNodeDelete;

  const confirmBomNodeAdd = async () => {
    if (!selectedProject || !appModal || appModal.kind !== 'node-add') return;
    const name = (modalName || '').trim();
    if (!name) return;
    const { parentId, nodeType } = appModal;
    setAppModal(null); setModalName('');
    try {
      const node = await apiF<any>(`/bom/projects/${selectedProject.id}/nodes`, {
        method: 'POST',
        body: JSON.stringify({ parent_id: parentId, node_type: nodeType, nomenclature_name: name, quantity_per_parent: 1, unit: 'pcs' }),
      });
      await reloadBomTree(selectedProject.id);
      // Новый полуфабрикат (кнопка ⇥) → сразу создаём подчинённый заказ и открываем его окно/панель (п.2)
      if (nodeType === 'semi_finished' && node?.id) {
        try {
          const cr = await apiF<any>(`/bom/projects/${selectedProject.id}/nodes/${node.id}/create-order`, {
            method: 'POST', body: JSON.stringify({}),
          });
          if (cr?.order) {
            const projId = selectedProject.id;
            const o = await apiF<any[]>(`/production-orders/?project_id=${projId}`).catch(() => null);
            if (Array.isArray(o)) { setOrders(o); setProjectOrders(prev => ({ ...prev, [projId]: o })); }
            openOrderPanel(cr.order);
          } else {
            setMsg('✅ Полуфабрикат добавлен, подчинённый заказ создан');
          }
        } catch (e: any) {
          setMsg('Полуфабрикат добавлен, но заказ не создан: ' + (e.message || String(e)));
        }
      }
    } catch (e: any) { setMsg('Ошибка добавления узла: ' + (e.message || String(e))); }
  };

  const handleBomNodeAdd = (parentId: string, nodeType: 'material' | 'semi_finished') => {
    setModalName('');
    setAppModal({ kind: 'node-add', parentId, nodeType });
  };

  // ── Выбор/замена номенклатуры в строке состава (п.5) ──
  const loadNomenclature = async () => {
    try {
      const items = await apiF<any[]>('/nomenclature/');
      setNomenclatureList(items || []);
    } catch {}
  };

  const handleBomNodeNomenclature = (nodeId: string, nodeType: string) => {
    setNomQuery('');
    if (!nomenclatureList.length) loadNomenclature();
    setAppModal({ kind: 'node-nom', nodeId, nodeType, nomId: null });
  };

  const confirmBomNodeNomenclature = async () => {
    if (!selectedProject || !appModal || appModal.kind !== 'node-nom' || !appModal.nomId) return;
    const { nodeId, nomId } = appModal;
    setAppModal(null); setNomQuery('');
    try {
      await apiF(`/bom/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify({ nomenclature_id: nomId }) });
      await reloadBomTree(selectedProject.id);
      setMsg('Номенклатура в строке заменена');
    } catch (e: any) { setMsg('Ошибка замены номенклатуры: ' + (e.message || String(e))); }
  };

  const reloadRoutings = async () => {
    try {
      const r = await apiF<any>('/bom/routings?page_size=200').catch(() => null);
      if (r && Array.isArray(r.items)) setRoutings(r.items);
    } catch {}
  };

  const handleRoutingOpUpdate = async (opId: string, patch: Record<string, any>) => {
    try {
      await apiF(`/bom/routing-operations/${opId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await reloadRoutings();
    } catch (e: any) { setMsg('Ошибка сохранения операции: ' + (e.message || String(e))); }
  };

  const handleRoutingOpAdd = async (routingId: string, nodeId?: string) => {
    if (!selectedProject) return;
    let rid = routingId;
    // У корневого узла может не быть маршрута — создаём его автоматически (п.1)
    if (!rid && nodeId) {
      try {
        const nodes = bomTrees[selectedProject.id] || [];
        const node = nodes.find((n: any) => n.id === nodeId);
        if (!node) return;
        const created = await apiF<any>('/bom/routings', {
          method: 'POST',
          body: JSON.stringify({ name: 'Маршрут · ' + (node.nomenclature_name || nodeId.slice(0, 8)), product_node_id: nodeId, operations: [] }),
        });
        rid = created?.id || '';
        if (rid) {
          await apiF(`/bom/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify({ routing_id: rid }) });
          await reloadBomTree(selectedProject.id);
          await reloadRoutings();
        }
      } catch (e: any) { setMsg('Ошибка создания маршрута: ' + (e.message || String(e))); return; }
    }
    if (!rid) return;
    const rt = routings.find((r: any) => r.id === rid);
    const ops = (rt?.operations || []).slice();
    const maxSeq = ops.reduce((m: number, o: any) => Math.max(m, Number(o.sequence_number) || 0), 0);
    if (panelMode === 'window') {
      // MDI: добавление операции — простое окно рабочего стола, а не модальный диалог
      win.openOpAddWin(rid, 'Добавить операцию в маршрут');
      return;
    }
    setModalName('Операция ' + (maxSeq + 1));
    setAppModal({ kind: 'op-add', routingId: rid });
  };

  // Создание операции из MDI-окна «Добавить операцию в маршрут» (Шаг 1 модуля справочников)
  const handleRoutingOpCreate = async (routingId: string, name: string, resourceId: string, catalogOperationId?: string | null, durationHours?: number | null): Promise<boolean> => {
    try {
      const rt = routings.find((r: any) => r.id === routingId);
      const ops = (rt?.operations || []).slice();
      const maxSeq = ops.reduce((m: number, o: any) => Math.max(m, Number(o.sequence_number) || 0), 0);
      await apiF('/bom/routing-operations', {
        method: 'POST',
        body: JSON.stringify({ routing_id: routingId, name, sequence_number: maxSeq + 1, duration_hours: durationHours || 1, output_quantity: 1, yield_rate: 1, resource_type_id: resourceId, catalog_operation_id: catalogOperationId || null }),
      });
      await reloadRoutings();
      return true;
    } catch (e: any) { setMsg('Ошибка добавления операции: ' + (e.message || String(e))); return false; }
  };

  const confirmRoutingOpAdd = async () => {
    if (!appModal || appModal.kind !== 'op-add') return;
    if (!modalOpId || !modalResId) return; // Операция и Ресурс обязательны: без ресурса операция не участвует в расчёте мощности
    const { routingId } = appModal;
    setAppModal(null); setModalName(''); setModalResId(null); setModalOpId(null); setModalOpName(null); setModalOpDur(null);
    try {
      const rt = routings.find((r: any) => r.id === routingId);
      const ops = (rt?.operations || []).slice();
      const maxSeq = ops.reduce((m: number, o: any) => Math.max(m, Number(o.sequence_number) || 0), 0);
      await apiF('/bom/routing-operations', {
        method: 'POST',
        body: JSON.stringify({ routing_id: routingId, name: modalOpName || 'Операция', sequence_number: maxSeq + 1, duration_hours: modalOpDur || 1, output_quantity: 1, yield_rate: 1, resource_type_id: modalResId, catalog_operation_id: modalOpId }),
      });
      await reloadRoutings();
    } catch (e: any) { setMsg('Ошибка добавления операции: ' + (e.message || String(e))); }
  };

  const handleRoutingOpRemove = async (opId: string) => {
    try {
      await apiF(`/bom/routing-operations/${opId}`, { method: 'DELETE' });
      // Перенумерация оставшихся операций маршрута (1..N) — Шаг 4
      const removed = routings.flatMap((r: any) => (r.operations || []) as any[]).find((o: any) => o.id === opId);
      await reloadRoutings();
      if (removed?.routing_id) {
        const rt = routings.find((r: any) => r.id === removed.routing_id);
        const rest = ((rt?.operations || []) as any[]).filter((o: any) => o.id !== opId).sort((a: any, b: any) => (a.sequence_number || 0) - (b.sequence_number || 0));
        for (let i = 0; i < rest.length; i++) {
          if ((rest[i].sequence_number || 0) !== i + 1) {
            try { await apiF(`/bom/routing-operations/${rest[i].id}`, { method: 'PATCH', body: JSON.stringify({ sequence_number: i + 1 }) }); } catch { }
          }
        }
        await reloadRoutings();
      }
    } catch (e: any) { setMsg('Ошибка удаления операции: ' + (e.message || String(e))); }
  };

  // ── Разрыв связи узла с заказом-производителем: каскадно освобождается весь куст (п.2) ──
  const handleBomNodeUnlink = async (nodeId: string, orderId: string | null) => {
    if (!selectedProject) return;
    try {
      const projId = selectedProject.id;
      const allOrders = projectOrders[projId] || orders;
      // 1) собрать куст заказов: сам заказ + все подчинённые (рекурсивно по parent_order_id)
      const subtree: string[] = [];
      if (orderId) {
        const stack = [orderId];
        while (stack.length) {
          const id = stack.pop()!;
          if (subtree.includes(id)) continue;
          subtree.push(id);
          for (const o of allOrders) if (o.parent_order_id === id && !subtree.includes(o.id)) stack.push(o.id);
        }
      }
      // 2) отвязать сам узел и все BOM-узлы куста (order_id ∈ subtree)
      const allNodes = bomTrees[projId] || [];
      const nodesToFree = allNodes.filter((n: any) => n.id === nodeId || (n.order_id && subtree.includes(n.order_id)));
      for (const n of nodesToFree) {
        await apiF(`/bom/nodes/${n.id}`, { method: 'PATCH', body: JSON.stringify({ order_id: null }) });
      }
      // 3) весь куст заказов становится свободным (без родителя)
      for (const id of subtree) {
        await apiF(`/production-orders/${id}`, { method: 'PUT', body: JSON.stringify({ parent_order_id: null }) });
      }
      await reloadBomTree(projId);
      const o = await apiF<any[]>(`/production-orders/?project_id=${projId}`).catch(() => null);
      if (Array.isArray(o)) { setOrders(o); setProjectOrders(prev => ({ ...prev, [projId]: o })); }
      setMsg('Связь разорвана: заказ и весь его куст теперь свободные');
    } catch (e: any) { setMsg('Ошибка разрыва связи: ' + (e.message || String(e))); }
  };

  // ── Привязка свободного заказа как производителя полуфабриката (п.3) ──
  const handleAttachFreeOrder = async (currentOrderId: string, freeOrderId: string) => {
    if (!selectedProject) return;
    try {
      const cur = orders.find((x: any) => x.id === currentOrderId);
      if (!cur) return;
      const target = orderBomNodes(cur).find((n: any) => n.node_type === 'semi_finished' && !n.order_id);
      if (!target) { setMsg('В составе этого заказа нет свободного полуфабриката для привязки'); return; }
      await apiF(`/bom/nodes/${target.id}`, { method: 'PATCH', body: JSON.stringify({ order_id: freeOrderId }) });
      await apiF(`/production-orders/${freeOrderId}`, { method: 'PUT', body: JSON.stringify({ parent_order_id: currentOrderId }) });
      await reloadBomTree(selectedProject.id);
      try { await loadProjectOrders(selectedProject.id); } catch {}
      try { await refresh(); } catch {}
      setMsg('Свободный заказ привязан как производитель полуфабриката');
    } catch (e: any) { setMsg('Ошибка привязки свободного заказа: ' + (e.message || String(e))); }
  };

  // ── Открыть окно заказа по id (п.5: клик по «производит: …») ──
  const openOrderWinById = (orderId: string) => {
    const o = orders.find((x: any) => x.id === orderId);
    if (o) openOrderPanel(o);
  };

  // ── Универсальное открытие окна справочника в режиме выбора (Шаг 1 модуля справочников) ──
  // Окно рабочего стола: выбор кликом по строке, CRUD доступен там же. Режим «модально»
  // для справочников-обзоров покрывается настройкой panelMode (Настройки Рабочего стола).
  const openDirForPick = (entity: string, onPick: (row: any) => void) => {
    const cfg = DIR_COLUMNS[entity];
    if (!cfg) return;
    const extraEndpoints = entity === 'operations'
      ? { list: 'https://profyplan.ru/api/v1/catalog-operations/', create: 'https://profyplan.ru/api/v1/catalog-operations/', item: (id: string) => `https://profyplan.ru/api/v1/catalog-operations/${id}`, method: 'PATCH' as const }
      : entity === 'stages' && selectedProject
      ? {
          list: `https://profyplan.ru/api/v1/projects/${selectedProject.id}/stages/`,
          create: `https://profyplan.ru/api/v1/projects/${selectedProject.id}/stages/`,
          item: (id: string) => `https://profyplan.ru/api/v1/project-stages/${id}`,
          method: 'PATCH' as const,
        }
      : entity === 'departments'
      ? { item: (id: string) => `https://profyplan.ru/api/v1/departments/${id}`, method: 'PATCH' as const }
      : undefined;
    const wid = win.openDirWin(entity, cfg.title + ' — выбор', cfg.columns,
      (row: any) => { onPick(row); win.closeWin(wid); },
      entity === 'resources' ? (row: any) => win.openResEdit(row) : undefined,
      entity === 'resources' ? (row: any) => runDeleteCheck('resource', row.id, row.name || row.code || row.id) : undefined,
      { zBoost: 4300, endpoints: extraEndpoints,
        onManageCalendar: entity === 'resources' ? (row: any) => win.openCalWin(row.id, row.name || row.code || 'Ресурс') : undefined,
      },
    );
  };

  const openResourcePick = (opId: string) => {
    openDirForPick('resources', (row: any) => handleRoutingOpUpdate(opId, { resource_type_id: row.id }));
  };

  // BOM-узлы заказа + BOM подчинённых заказов (тусклые, через order_id на узлах)
  const orderBomNodesWithSuborders = (o: any) => {
    const projId = selectedProject?.id || '';
    const all = bomTrees[projId] || [];
    if (!all.length) return [];
    const own = orderBomNodes(o)
      .filter((n: any) => !(n.order_id && n.order_id !== o.id))
      .map((n: any) => ({
        ...n,
        _ownerId: o.id,
        _ownerExtId: o.ext_id || o.specification_name || '',
      }));
    const ordersList = projectOrders[projId] || [];

    const result: any[] = [...own];

    const ownIds = new Set(own.map((n: any) => n.id));
    const childrenOf: Record<string, any[]> = {};
    for (const n of all) if (n.parent_id) (childrenOf[n.parent_id] ||= []).push(n);
    const orderLabel = (orderId: string) => {
      const s = ordersList.find((x: any) => x.id === orderId);
      return (s && (s.ext_id || s.specification_name)) || '';
    };

    // Рекурсивно встраиваем поддерево узла-ссылки подчинённого заказа (dimmed).
    // На вложенных уровнях тоже могут быть узлы-ссылки (order_id чужого заказа) —
    // тогда переключаем владельца на более глубокий подчинённый заказ.
    const injectSubtree = (nodeId: string, parentId: string, ownerId: string, dimLevel: number, visited: Set<string>) => {
      for (const c of childrenOf[nodeId] || []) {
        let owner = ownerId;
        let ownerExt = orderLabel(ownerId);
        if (c.order_id && c.order_id !== o.id) {
          if (visited.has(c.order_id)) continue;
          owner = c.order_id;
          ownerExt = orderLabel(c.order_id);
          visited.add(c.order_id);
        }
        const synthId = `sub_${parentId}_${c.id}_${dimLevel}`;
        const clone: any = { ...c, id: synthId, parent_id: parentId, dimmed: dimLevel, _ownerId: owner, _ownerExtId: ownerExt };
        result.push(clone);
        injectSubtree(c.id, synthId, owner, dimLevel, visited);
      }
    };

    // Обходим своё поддерево по реальным детям из `all`: узлы-ссылки на подчинённые
    // заказы (order_id ≠ своего) включаем в цепочку и встраиваем под ними их BOM.
    const visit = (nodeId: string) => {
      for (const c of childrenOf[nodeId] || []) {
        if (c.order_id && c.order_id !== o.id) {
          result.push({ ...c, _ownerId: c.order_id, _ownerExtId: orderLabel(c.order_id), _layerBoundary: ownIds.has(c.parent_id) });
          injectSubtree(c.id, c.id, c.order_id, 1, new Set<string>([o.id, c.order_id]));
        } else if (ownIds.has(c.id)) {
          visit(c.id);
        }
      }
    };
    for (const n of own) visit(n.id);

    return result;
  };

  // Содержимое BOM-окна (оконный режим): то же, что в модалке «Развернуть полностью»
  const renderBomWindow = (w: any) => {
    const o = w.data || orders.find((x: any) => x.id === w.orderId) || (projectOrders[selectedProject?.id || ''] || []).find((x: any) => x.id === w.orderId);
    if (!o) return null;
    return (
      <>
      
      <BomExpand
        order={o}
        nodes={orderBomNodesWithSuborders(o)}
        orders={(projectOrders[selectedProject?.id || ''] || []).map((x: any) => ({ id: x.id, ext_id: x.ext_id, specification_name: x.specification_name }))}
        anomalies={bomAnomalies}
        anomaliesLoading={bomAnomaliesLoading}
        semiPolicy={semiPolicy}
        timeline={bomTimeline?.length ? bomTimeline : buildDraftTimeline(orderBomNodesWithSuborders(o))}
        timelineDraft={!bomTimeline?.length}
        timelineLoading={bomTimelineLoading}
        onLoadTimeline={loadBomTimeline}
        onNodeOrderChange={handleNodeOrderChange}
        onNodeQuantityChange={handleBomNodeQuantity}
        onNodeRemove={confirmBomNodeDelete}
        onNodeAdd={handleBomNodeAdd}
        onOrderFocus={focusOrderByBom}
        onRoutingAdd={handleRoutingOpAdd}
        onCreateMissingOrders={createMissingOrders}
        onCreateOrderFromNode={createOrderFromNode}
        routings={routings}
        resName={resName}
      />
      </>
    );
  };

  const loadBomTimeline = async () => {
    if (!selectedProject) return;
    setBomTimelineLoading(true);
    try {
      const r = await apiF<any>(`/projects/${selectedProject.id}/calculate/cpm`, { method: 'POST' });
      setBomTimeline(r?.nodes || []);
    } catch (e: any) { setMsg('Ошибка расчёта: ' + (e.message || String(e))); }
    setBomTimelineLoading(false);
  };

  // Черновик таймлайна: операции из маршрутов заказа, разложенные последовательно,
  // ДО планового CPM-расчёта. Отображается серым.
  const buildDraftTimeline = (nodes: any[]): any[] => {
    if (!nodes || !nodes.length) return [];
    const byId = new Map(nodes.map((n: any) => [n.id, n]));
    const order: any[] = [];
    const visited = new Set<string>();
    const queue = nodes.filter((n: any) => !n.parent_id || !byId.has(n.parent_id));
    while (queue.length) {
      const n = queue.shift();
      if (!n || visited.has(n.id)) continue;
      visited.add(n.id);
      order.push(n);
      for (const c of nodes) if (c.parent_id === n.id && !visited.has(c.id)) queue.push(c);
    }
    for (const n of nodes) if (!visited.has(n.id)) order.push(n);
    const ops: any[] = [];
    const seen = new Set<string>();
    for (const n of order) {
      if (!n.routing_id) continue;
      if (n._boundary) continue;
      const rt = routings.find((r: any) => r.id === n.routing_id);
      if (!rt || !Array.isArray(rt.operations)) continue;
      const rops = [...rt.operations].sort((a: any, b: any) => (Number(a.sequence_number) || 0) - (Number(b.sequence_number) || 0));
      for (const op of rops) {
        const key = op.id || `${n.routing_id}:${op.sequence_number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ops.push({ id: key, name: op.name || `Оп. ${op.sequence_number}`, duration: Number(op.duration_hours) || 0 });
      }
    }
    let acc = 0;
    return ops.map((op: any) => {
      const es = acc;
      acc += op.duration || 0;
      return { id: op.id, name: op.name, duration: op.duration, early_start: es, early_finish: es + (op.duration || 0) };
    });
  };

  const createOrder = async () => {
    if (!newOrder.specification_name.trim() || !selectedProject) return;
    const spec = newOrder.specification_name.trim();
    try {
      const dup = await apiF<any>(`/production-orders/check-duplicate?project_id=${selectedProject.id}&specification_name=${encodeURIComponent(spec)}`);
      if (dup.duplicate) {
        setDupCheck({ spec, existing: dup.existing || [] });
        return;
      }
      await doCreateOrder();
    } catch (e: any) { alert('Ошибка создания: ' + (e.message || String(e))); }
  };

  const doCreateOrder = async () => {
    if (!selectedProject) return;
    try {
      await apiF(`/production-orders/?project_id=${selectedProject.id}`, {
        method: 'POST', body: JSON.stringify({
          specification_name: newOrder.specification_name, quantity: Number(newOrder.quantity) || 1,
          unit: newOrder.unit, priority: newOrder.priority, client: newOrder.client || null,
        })
      });
      setNewOrder({ specification_name: '', quantity: '1', unit: 'pcs', priority: 'normal', client: '' });
      setShowNewOrder(false);
      setDupCheck(null);
      await refresh();
    } catch (e: any) { alert('Ошибка создания: ' + (e.message || String(e))); }
  };

  const deleteOrder = (orderId: string, orderName: string) => {
    runDeleteCheck('order', orderId, orderName);
  };

  const doMoveOrders = async (orderIds: string[], groupId: string | null, poolId: string | null) => {
    for (const oid of orderIds) {
      await apiF(`/production-orders/${oid}/move`, {
        method: 'PATCH', body: JSON.stringify({ group_id: groupId, pool_id: poolId }),
      });
    }
    await refresh();
    if (selectedProject) { setExpandedOrders(null); loadProjectOrders(selectedProject.id); }
  };

  const moveOrder = async (orderId: string, groupId: string | null, poolId: string | null) => {
    return moveOrdersChecked([orderId], groupId, poolId);
  };

  const moveOrdersChecked = async (orderIds: string[], groupId: string | null, poolId: string | null) => {
    if (orderChainControl === 'off') {
      return doMoveOrders(orderIds, groupId, poolId);
    }
    const allOrders = projectOrders[selectedProject?.id || ''] || orders;
    // Отфильтруем no-op перемещения (заказ уже в целевом месте)
    const effectiveIds = orderIds.filter(oid => {
      const o = allOrders.find((x: any) => x.id === oid);
      if (!o) return true;
      return !(o.group_id === groupId && o.pool_id === poolId);
    });
    if (effectiveIds.length === 0) return;
    const firstOrder = allOrders.find((x: any) => x.id === effectiveIds[0]) || { id: effectiveIds[0] };
    try {
      // Собираем объединённый куст по всем выбранным заказам
      const clusterUnion: any[] = [];
      const seenIds = new Set<string>();
      for (const oid of effectiveIds) {
        const cluster = await apiF<any>(`/bom/projects/${selectedProject?.id}/orders/${oid}/cluster`);
        for (const o of (cluster.orders || [])) {
          if (!seenIds.has(o.id)) { seenIds.add(o.id); clusterUnion.push(o); }
        }
      }
      const related = clusterUnion.filter((x: any) => !effectiveIds.includes(x.id));
      if (related.length === 0) {
        return doMoveOrders(effectiveIds, groupId, poolId);
      }
      return new Promise<void>((resolve) => {
        chainResolveRef.current = () => resolve();
        setChainDialog({ order: firstOrder, selectedIds: effectiveIds, targetGroupId: groupId, targetPoolId: poolId, cluster: { orders: clusterUnion } });
      });
    } catch {
      return doMoveOrders(effectiveIds, groupId, poolId);
    }
  };

  const resolveChainMove = async (action: 'all' | 'current' | 'cancel') => {
    if (!chainDialog) return;
    const { selectedIds, targetGroupId, targetPoolId, cluster } = chainDialog;
    const finish = chainResolveRef.current;
    chainResolveRef.current = null;
    setChainDialog(null);
    if (action === 'cancel') { finish?.(); return; }
    const orderIds = action === 'all'
      ? (cluster.orders || []).map((x: any) => x.id)
      : selectedIds;
    await doMoveOrders(orderIds, targetGroupId, targetPoolId);
    finish?.();
  };

  // Batch pool operations
  const addToPool = async (orderIds: string[], poolId: string) => {
    for (const oid of orderIds) {
      try { await apiF(`/production-orders/${oid}/move`, { method: 'PATCH', body: JSON.stringify({ pool_id: poolId }) }); }
      catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); return; }
    }
    await refresh();
    setSelFreeOrders(new Set());
  };

  const removeFromPool = async (orderIds: string[]) => {
    for (const oid of orderIds) {
      try { await apiF(`/production-orders/${oid}/move`, { method: 'PATCH', body: JSON.stringify({ pool_id: null }) }); }
      catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); return; }
    }
    await refresh();
    setSelPoolOrders(new Set());
  };

  const fillPool = async (poolId: string) => {
    const free = orders.filter((o: any) => !o.pool_id);
    if (free.length === 0) return;
    await addToPool(free.map(o => o.id), poolId);
  };

  const clearPool = async (poolId: string) => {
    const poolOrders = orders.filter((o: any) => o.pool_id === poolId);
    if (poolOrders.length === 0) return;
    await removeFromPool(poolOrders.map(o => o.id));
  };

  const updateOrder = async (orderId: string) => {
    if (!editValues.specification_name?.trim()) { setEditingOrder(null); return; }
    try {
      await apiF(`/production-orders/${orderId}`, {
        method: 'PUT', body: JSON.stringify({
          specification_name: editValues.specification_name,
          quantity: Number(editValues.quantity) || undefined,
          client: editValues.client,
        })
      });
      setEditingOrder(null);
      await refresh();
    } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); }
  };

  // ── Nomenclature search ──
  const searchNomenclature = async (query: string): Promise<{ id: string; name: string; code: string | null; article: string | null }[]> => {
    try {
      const r = await apiF<any[]>(`/nomenclature/search/?q=${encodeURIComponent(query)}&limit=8`);
      return r.map((n: any) => ({ id: n.id, name: n.name, code: n.code || null, article: n.article || null }));
    } catch { return []; }
  };

  // ── Fuzzy score for matching ──
  const fuzzyScore = (query: string, target: string): number => {
    const q = query.toLowerCase().replace(/[^a-zа-яё0-9]/g, '').trim();
    const t = target.toLowerCase().replace(/[^a-zа-яё0-9]/g, '').trim();
    if (!q || !t) return 0;
    if (q === t) return 100;
    if (t.includes(q)) return 90;
    const qWords = q.split(/\s+/).filter(Boolean);
    const tWords = t.split(/\s+/).filter(Boolean);
    if (qWords.length === 0) return 0;
    let matched = 0;
    for (const qw of qWords) { if (tWords.some((tw: string) => tw.startsWith(qw) || qw.startsWith(tw) || tw.includes(qw))) matched++; }
    return Math.round((matched / qWords.length) * 75);
  };

  // ── Bulk paste: parse + match nomenclature ──
  const handleBulkPaste = async (text: string) => {
    setBulkPasteText(text);
    setBulkMatchLoading(true);
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { setBulkMatchLoading(false); return; }
    const sep = lines[0].split('\t').length > 1 ? '\t' : lines[0].split(';').length > 1 ? ';' : ',';
    const grid = lines.map(l => l.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim()));
    const headers = grid[0];
    const specificationIdx = headers.findIndex((h: string) => {
      const n = h.toLowerCase().replace(/[^a-zа-яё]/g, '');
      return ['продукт','изделие','название','номенклатура','name','product','specification','specification_name'].some(s => n.includes(s) || s.includes(n));
    });
    if (specificationIdx === -1) { setBulkMatchLoading(false); return; }
    const dataRows = grid.slice(1);
    const uniqueNames = [...new Set(dataRows.map(r => r[specificationIdx] || '').filter(Boolean))];
    const matches: Record<string, { id: string; name: string } | null> = {};
    await Promise.all(uniqueNames.map(async (name) => {
      try {
        const results = await searchNomenclature(name);
        if (results.length > 0) {
          let best = results[0]; let bestScore = fuzzyScore(name, best.name);
          for (const r of results) { const s = fuzzyScore(name, r.name); if (s > bestScore) { best = r; bestScore = s; } }
          matches[name] = bestScore >= 40 ? { id: best.id, name: best.name } : null;
        } else { matches[name] = null; }
      } catch { matches[name] = null; }
    }));
    setBulkNomenMatches(matches);
    setBulkMatchLoading(false);
  };

  // ── Bulk create orders from pasted data ──
  const bulkCreateOrders = async () => {
    const lines = bulkPasteText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2 || !selectedProject) return;
    const sep = lines[0].split('\t').length > 1 ? '\t' : lines[0].split(';').length > 1 ? ';' : ',';
    const grid = lines.map(l => l.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim()));
    const headers = grid[0];
    const dataRows = grid.slice(1);
    const idxOf = (keys: string[]) => headers.findIndex((h: string) => keys.some(k => h.toLowerCase().replace(/[^a-zа-яё]/g, '') === k));
    const nameIdx = idxOf(['продукт','изделие','название','номенклатура','name','product']);
    const qtyIdx = idxOf(['колво','количество','штук','qty','quantity','amount']);
    const clientIdx = idxOf(['клиент','заказчик','client','customer']);
    const idIdx = idxOf(['id','номер','код','заказ','order']);
    const parentIdx = idxOf(['родительскийзаказ','родитель','подчиненный','подчинённый','parentorder','родительскийid']);
    try {
      let created = 0;
      for (const row of dataRows) {
        const name = nameIdx >= 0 ? row[nameIdx] : (row[0] || 'Без названия');
        const qty = qtyIdx >= 0 ? (parseFloat(row[qtyIdx]) || 1) : 1;
        const client = clientIdx >= 0 ? row[clientIdx] : null;
        const extId = idIdx >= 0 ? row[idIdx] : null;
        const parentExtId = parentIdx >= 0 ? (row[parentIdx] || null) : null;
        if (!name.trim()) continue;
        await apiF(`/production-orders/?project_id=${selectedProject.id}`, {
          method: 'POST', body: JSON.stringify({
            specification_name: name, quantity: qty, unit: 'pcs',
            priority: 'normal', client: client || null, ext_id: extId || null,
            parent_order_id: parentExtId,
          })
        });
        created++;
      }
      setShowBulkPaste(false); setBulkPasteText(''); setBulkNomenMatches({});
      await refresh();
    } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); }
  };

  // ── Project actions ──
  const archiveProject = async (p: any) => {
    try {
      await apiF(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: p.status === 'archived' ? 'draft' : 'archived' }) });
      await load().then(() => navTo('projects'));
    } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); }
  };

  const [deleteCheckEntity, setDeleteCheckEntity] = useState<{ type: string; id: string; name: string } | null>(null);
  const [dirRefreshKey, setDirRefreshKey] = useState(0);
  const [bomDelete, setBomDelete] = useState<{ nodeId: string; name: string; items: { name: string; type: string }[] } | null>(null);
  // Стилизованные диалоги вместо window.prompt / window.confirm
  const [appModal, setAppModal] = useState<null |
    { kind: 'node-add'; parentId: string; nodeType: 'material' | 'semi_finished' }
    | { kind: 'op-add'; routingId: string }
    | { kind: 'op-del'; opId: string; opName: string }
    | { kind: 'node-nom'; nodeId: string; nodeType: string; nomId: string | null }
  >(null);
  const [modalName, setModalName] = useState('');
  const [modalResId, setModalResId] = useState<string | null>(null); // Ресурс * для op-add (обязательный)
  const [modalOpId, setModalOpId] = useState<string | null>(null); // Операция * из каталога (Шаг 3)
  const [modalOpName, setModalOpName] = useState<string | null>(null);
  const [modalOpDur, setModalOpDur] = useState<number | null>(null);
  // Шаг 5: ресурсы заказа {orderId: items[]} + загрузка (из операций маршрутов + переопределения)
  const [orderRes, setOrderRes] = useState<Record<string, any[]>>({});
  const loadOrderResources = async (orderId: string) => {
    try {
      const data = await apiF<any>(`/orders/${orderId}/resources`);
      setOrderRes(prev => ({ ...prev, [orderId]: data }));
    } catch { }
  };
  // Добавление ресурса: только если ресурс уже используется операциями маршрута заказа
  const handleOrderResAdd = async (orderId: string, resourceId: string) => {
    const o = orders.find((x: any) => x.id === orderId);
    const used = new Set<string>();
    for (const r of routingsFor(o)) for (const op of (r.operations || [])) if (op.resource_type_id) used.add(String(op.resource_type_id));
    if (!used.has(String(resourceId))) {
      setMsg('Ресурс не используется в операциях маршрута этого заказа — сначала назначьте его в операции (вкладка «Маршрут»).');
      return;
    }
    try {
      await apiF(`/orders/${orderId}/resources`, { method: 'POST', body: JSON.stringify({ resource_id: resourceId }) });
      await loadOrderResources(orderId);
    } catch (e: any) { setMsg('Ошибка добавления ресурса: ' + (e.message || String(e))); }
  };
  // Изменение переопределения (upsert: если записи нет — создаём)
  const handleOrderResChange = async (orderId: string, item: any, patch: Record<string, any>) => {
    try {
      if (item.id) {
        await apiF(`/order-resources/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      } else {
        await apiF(`/orders/${orderId}/resources`, { method: 'POST', body: JSON.stringify({ resource_id: item.resource_id, ...patch }) });
      }
      await loadOrderResources(orderId);
    } catch (e: any) { setMsg('Ошибка сохранения ресурса заказа: ' + (e.message || String(e))); }
  };
  // Удаление переопределения/связи (ресурс из операций остаётся с дефолтами)
  const handleOrderResRemove = async (orderId: string, item: any) => {
    try {
      if (item.id) await apiF(`/order-resources/${item.id}`, { method: 'DELETE' });
      await loadOrderResources(orderId);
    } catch (e: any) { setMsg('Ошибка удаления ресурса: ' + (e.message || String(e))); }
  };

  // ── v2.16: календарь ресурса (эффективный график + версии + исключения) ──
  const [calData, setCalData] = useState<Record<string, any>>({});
  const loadCalData = async (resourceId: string) => {
    try {
      const [effective, assignments, exceptions] = await Promise.all([
        apiF<any>(`/resources/${resourceId}/effective-schedule?project_id=${selectedProject?.id || ''}`),
        apiF<any>(`/resources/${resourceId}/schedule-assignments`),
        apiF<any>(`/calendar-exceptions?resource_id=${resourceId}`),
      ]);
      setCalData(prev => ({ ...prev, [resourceId]: { effective, assignments, exceptions } }));
    } catch { }
  };
  const handleCalAddAssignment = async (resourceId: string, scheduleId: string, validFrom: string) => {
    try {
      await apiF(`/resources/${resourceId}/schedule-assignments`, { method: 'POST', body: JSON.stringify({ schedule_id: scheduleId, valid_from: validFrom }) });
      await loadCalData(resourceId);
    } catch (e: any) { setMsg('Ошибка назначения графика: ' + (e.message || String(e))); }
  };
  const handleCalDelAssignment = async (assignmentId: string) => {
    try { await apiF(`/schedule-assignments/${assignmentId}`, { method: 'DELETE' }); } catch { }
    // перезагрузить все открытые календари (простой путь: обновить по ключу)
    for (const rid of Object.keys(calData)) loadCalData(rid);
  };
  const handleCalAddException = async (resourceId: string, payload: any) => {
    try {
      await apiF('/calendar-exceptions', { method: 'POST', body: JSON.stringify({ level: 'resource', resource_id: resourceId, ...payload }) });
      await loadCalData(resourceId);
    } catch (e: any) { setMsg('Ошибка добавления исключения: ' + (e.message || String(e))); }
  };
  const handleCalDelException = async (exceptionId: string) => {
    try { await apiF(`/calendar-exceptions/${exceptionId}`, { method: 'DELETE' }); } catch { }
    for (const rid of Object.keys(calData)) loadCalData(rid);
  };
  const [nomQuery, setNomQuery] = useState('');
  const [nomenclatureList, setNomenclatureList] = useState<any[]>([]);
  const [panelShowOps, setPanelShowOps] = useState(false); // чекбокс «показывать операции» в панели заказа
  const [panelAttach, setPanelAttach] = useState<string | null>(null); // модалка привязки свободного заказа в панели
  const [deleteCheckResult, setDeleteCheckResult] = useState<any>(null);
  const [deleteCheckLoading, setDeleteCheckLoading] = useState(false);
  const [deleteCheckError, setDeleteCheckError] = useState<string | null>(null);

  const runDeleteCheck = async (type: string, id: string, name: string) => {
    setDeleteCheckEntity({ type, id, name });
    setDeleteCheckResult(null);
    setDeleteCheckError(null);
    setDeleteCheckLoading(true);
    try {
      const res = await apiF<any>(`/delete-check/${type}/${id}`);
      setDeleteCheckResult(res);
    } catch (e: any) {
      setDeleteCheckError(e.message || 'Ошибка');
    } finally {
      setDeleteCheckLoading(false);
    }
  };

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') || '' : '';

  const deleteProject = async (p: any) => {
    runDeleteCheck('project', p.id, p.name);
    setCtxMenu(null);
  };

  const _deleteProjectDirect = async (p: any) => {
    // Covered by deleteProject → runDeleteCheck flow
    deleteProject(p);
  };

  const renameProject = async (p: any, newName: string) => {
    if (!newName.trim()) return;
    try {
      await apiF(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
      await load().then(() => { if (selectedProject?.id === p.id) setSelectedProject({ ...selectedProject, name: newName }); });
    } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); }
  };
  const load = useCallback(async () => {
    setLoading(true);
    setAuthError(false);
    try {
      const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }) });
      if (!r.ok) throw new Error('LOGIN_FAILED');
      const data = await r.json();
      localStorage.setItem('profyplan_token', data.access_token);
      const tenants = Array.isArray(data.tenants) ? data.tenants : [];
      if (tenants.length > 1) {
        localStorage.setItem('profyplan_tenants', JSON.stringify(tenants));
        setPendingTenants(tenants);
        setLoading(false);
        return;
      }
      const proj = await apiF<{ items: any[] }>('/projects');
      setProjects(proj.items);
      setLoaded(true);
    } catch (e: any) {
      if (e.message === 'LOGIN_FAILED' || e.message === 'AUTH_REQUIRED') {
        setAuthError(true);
      } else {
        setMsg(e.message || String(e));
      }
    }
    setLoading(false);
  }, []);

  const chooseTenant = async (tenantId: string) => {
    setLoading(true);
    try {
      const data = await apiF<any>(`/auth/select-tenant`, { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) });
      localStorage.setItem('profyplan_token', data.access_token);
      setPendingTenants([]);
      const proj = await apiF<{ items: any[] }>('/projects');
      setProjects(proj.items);
      setLoaded(true);
    } catch (e: any) {
      setMsg(e.message || String(e));
    }
    setLoading(false);
  };

  const loadProjectDashboard = async (p: any) => {
    setSelectedProject(p);
    setView('project-dashboard');
    setOrders([]); setGroups({}); setPools({});
    try {
      const [o, g, pl] = await Promise.all([
        apiF<any[]>(`/production-orders/?project_id=${p.id}`),
        apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
        apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
      ]);
      setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
      setMsg(`${o.length} заказов · ${g.items.length} групп · ${pl.items.length} пулов`);
    } catch (e: any) { setMsg(String(e)); }
  };

  const loadProjectOrdersView = async (p: any) => {
    setSelectedProject(p);
    loadBomTree(p.id);
    loadNomenclature();
    reloadRoutings();
    if (panelMode === 'window') {
      try {
        const [o, g, pl] = await Promise.all([
          apiF<any[]>(`/production-orders/?project_id=${p.id}`),
          apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
          apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
        ]);
        setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
        setMsg(`${o.length} заказов · ${g.items.length} групп · ${pl.items.length} пулов`);
      } catch (e: any) { setMsg(String(e)); }
      setView('project-orders');
      setPendingList({ kind: 'orders', title: `Заказы — ${p.name}` });
      return;
    }
    setView('project-orders');
    if (!orders.length || selectedProject?.id !== p.id) {
      try {
        const [o, g, pl] = await Promise.all([
          apiF<any[]>(`/production-orders/?project_id=${p.id}`),
          apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
          apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
        ]);
        setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
      } catch (e: any) { setMsg(String(e)); }
    }
  };

  const refresh = () => {
    if (!selectedProject) return;
    if (view === 'project-orders') loadProjectOrdersView(selectedProject);
    else if (view === 'project-pools') loadProjectPools(selectedProject);
    else if (view === 'project-groups') loadProjectGroups(selectedProject);
    else if (view === 'project-gantt') loadProjectGantt(selectedProject);
    else loadProjectDashboard(selectedProject);
  };

  const onRefresh = () => { if (selectedProject) refresh(); else load(); };

  const navTo = (v: View) => { setView(v); setSelectedProject(null); setOrders([]); setGroups({}); setPools({}); if (['directories','nomenclature','units','resources','work-schedules','production-calendars','departments','organizations','settings'].includes(v)) win.minimizeAll(); };

  // ── Gantt ──
  const loadProjectGantt = async (p: any) => {
    setSelectedProject(p); setView('project-gantt');
    setGanttLoading(true); setGanttData(null);
    try {
      const body = p?.start_date ? { start_date: p.start_date } : {};
      const r = await apiF<any>(`/projects/${p.id}/calculate/schedule`, { method: 'POST', body: JSON.stringify(body) });
      setGanttData(r);
    } catch (e: any) { setMsg('Ошибка загрузки Ганта: ' + (e.message || String(e))); }
    setGanttLoading(false);
  };

  const setProjectStartDate = async (dateStr: string) => {
    if (!selectedProject || !dateStr) return;
    try {
      await apiF(`/projects/${selectedProject.id}`, { method: 'PUT', body: JSON.stringify({ start_date: dateStr + 'T00:00:00' }) });
      const updated = { ...selectedProject, start_date: dateStr + 'T00:00:00' };
      setSelectedProject(updated);
      await loadProjectGantt(updated);
    } catch (e: any) { setMsg('Ошибка: ' + (e.message || String(e))); }
  };

  // ── Groups ──
  const loadProjectGroups = async (p: any) => {
    setSelectedProject(p);
    loadBomTree(p.id);
    if (panelMode === 'window') {
      try {
        const [o, g, pl] = await Promise.all([
          apiF<any[]>(`/production-orders/?project_id=${p.id}`),
          apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
          apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
        ]);
        setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
        setMsg(`${o.length} заказов · ${g.items.length} групп · ${pl.items.length} пулов`);
      } catch (e: any) { setMsg(String(e)); }
      setView('project-groups');
      setPendingList({ kind: 'groups', title: `Группы — ${p.name}` });
      return;
    }
    setView('project-groups');
    try {
      const [o, g, pl] = await Promise.all([
        apiF<any[]>(`/production-orders/?project_id=${p.id}`),
        apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
        apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
      ]);
      setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
      setMsg(`${g.items.length} групп`);
    } catch (e: any) { setMsg(String(e)); }
  };

  const addGroup = async () => {
    if (!selectedProject) return;
    if (!newGroupInput) { setNewGroupInput(true); setNewGroupName(''); return; }
    if (!newGroupName.trim()) { setNewGroupInput(false); return; }
    const created = await apiF<any>(`/projects/${selectedProject.id}/groups`, { method: 'POST', body: JSON.stringify({ name: newGroupName.trim() }) });
    setNewGroupInput(false);
    setNewGroupName('');
    // Сразу открываем «мастер» новой группы — редактор с заказами/пулами
    const g = created && created.id ? created : null;
    const [o, gs, pl] = await Promise.all([
      apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`),
      apiF<{ items: any[] }>(`/projects/${selectedProject.id}/groups`),
      apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`),
    ]);
    setOrders(o); setGroups(prev => ({ ...prev, [selectedProject.id]: gs.items })); setPools(prev => ({ ...prev, [selectedProject.id]: pl.items }));
    if (g) {
      setSelectedGroup(g);
      setEditingGroup(true);
      setView('project-groups');
    }
  };

  const delGroup = (gid: string, gname: string) => {
    runDeleteCheck('order_group', gid, gname);
  };

  // ── Pools ──
  const loadProjectPools = async (p: any) => {
    setSelectedProject(p);
    loadBomTree(p.id);
    if (panelMode === 'window') {
      try {
        const [o, g, pl] = await Promise.all([
          apiF<any[]>(`/production-orders/?project_id=${p.id}`),
          apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
          apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
        ]);
        setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
        setMsg(`${o.length} заказов · ${g.items.length} групп · ${pl.items.length} пулов`);
      } catch (e: any) { setMsg(String(e)); }
      setView('project-pools');
      setPendingList({ kind: 'pools', title: `Пулы — ${p.name}` });
      return;
    }
    setView('project-pools');
    try {
      const [o, g, pl] = await Promise.all([
        apiF<any[]>(`/production-orders/?project_id=${p.id}`),
        apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
        apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
      ]);
      setOrders(o); setGroups(prev => ({ ...prev, [p.id]: g.items })); setPools(prev => ({ ...prev, [p.id]: pl.items }));
      setMsg(`${pl.items.length} пулов`);
    } catch (e: any) { setMsg(String(e)); }
  };

  const addPool = async () => {
    if (!selectedProject) return;
    if (!newPoolInput) { setNewPoolInput(true); setNewPoolName(''); return; }
    if (!newPoolName.trim()) { setNewPoolInput(false); return; }
    await apiF(`/projects/${selectedProject.id}/pools`, { method: 'POST', body: JSON.stringify({ name: newPoolName.trim(), order_ids: [] }) });
    setNewPoolInput(false);
    await loadProjectPools(selectedProject);
  };

  const delPool = (plid: string, plname: string) => {
    runDeleteCheck('order_pool', plid, plname);
  };

  const renderSectionDashboard = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
      <div className="kpi-card" data-module="dash:metric:orders">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:orders]" copy="[dash:metric:orders] «Всего заказов»" />}<div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
      <div className="kpi-card" data-module="dash:metric:dyn">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:dyn]" copy="[dash:metric:dyn] «Динамические»" />}<div className="kpi-label">Динамические</div><div className="kpi-val g">{dynCount}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
      <div className="kpi-card" data-module="dash:metric:work">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:work]" copy="[dash:metric:work] «В работе»" />}<div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress}</div><div className="kpi-sub">{inProgress > 0 ? 'Активных' : 'Нет'}</div></div>
      <div className="kpi-card" data-module="dash:metric:priority">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:priority]" copy="[dash:metric:priority] «Приоритетных»" />}<div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical}</div><div className="kpi-sub">High + Critical</div></div>
      <div className="kpi-card" data-module="dash:metric:groups">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:groups]" copy="[dash:metric:groups] «Групп / Пулов»" />}<div className="kpi-label">Групп / Пулов</div><div className="kpi-val">{projGroups.length + projPools.length}</div><div className="kpi-sub">{projGroups.length} гр. · {projPools.length} пул.</div></div>
    </div>
  );

const renderOrdersView = (mode: 'full' | 'table' = 'full') => {
            const getTypeInfo = (o: any) => {
              if (o.group_id) { const g = projGroups.find(gr => gr.id === o.group_id); return { icon: '📁', label: 'Группа', name: g?.name || '—', id: o.group_id }; }
              if (o.pool_id) { const p = projPools.find(pl => pl.id === o.pool_id); return { icon: '📦', label: 'Пул', name: p?.name || '—', id: o.pool_id }; }
              return { icon: '—', label: 'Свободный', name: '—', id: null };
            };
            let filtered = orderShowAll ? [...orders] : orders.filter((o: any) => !o.group_id && !o.pool_id);
            if (orderShowAll && orderTypeFilter !== 'all' && orderTypeFilter !== 'free') {
              filtered = filtered.filter((o: any) => o.group_id === orderTypeFilter || o.pool_id === orderTypeFilter);
            }
            if (orderShowAll && orderTypeFilter === 'free') {
              filtered = filtered.filter((o: any) => !o.group_id && !o.pool_id);
            }
            if (orderSortKey) {
              filtered.sort((a: any, b: any) => {
                let aVal: string, bVal: string;
                if (orderSortKey === '_type') {
                  aVal = getTypeInfo(a).label; bVal = getTypeInfo(b).label;
                } else if (orderSortKey === '_typeName') {
                  aVal = getTypeInfo(a).name; bVal = getTypeInfo(b).name;
                } else {
                  aVal = (a[orderSortKey] || '').toString().toLowerCase();
                  bVal = (b[orderSortKey] || '').toString().toLowerCase();
                }
                if (orderSortDir === 'asc') return aVal.localeCompare(bVal);
                return bVal.localeCompare(aVal);
              });
            }
            // ── Иерархия: DFS по parent_order_id (защита от циклов) ──
            const childMap = new Map<string, any[]>();
            const idSet = new Set<string>(filtered.map((o: any) => o.id));
            filtered.forEach((o: any) => {
              if (o.parent_order_id && idSet.has(o.parent_order_id)) {
                if (!childMap.has(o.parent_order_id)) childMap.set(o.parent_order_id, []);
                childMap.get(o.parent_order_id)!.push(o);
              }
            });
            const treeRows: { o: any; depth: number; hasChildren: boolean; collapsed: boolean }[] = [];
            const visitedIds = new Set<string>();
            const markVisited = (ord: any) => {
              const kids = childMap.get(ord.id) || [];
              kids.forEach((c: any) => {
                if (visitedIds.has(c.id)) return;
                visitedIds.add(c.id);
                markVisited(c);
              });
            };
            const walkTree = (ord: any, depth: number) => {
              if (visitedIds.has(ord.id)) return;
              visitedIds.add(ord.id);
              const children = childMap.get(ord.id) || [];
              const collapsed = collapsedOrderIds.has(ord.id);
              treeRows.push({ o: ord, depth, hasChildren: children.length > 0, collapsed });
              if (collapsed) { markVisited(ord); return; }
              children.forEach((c: any) => walkTree(c, depth + 1));
            };
            filtered.forEach((o: any) => { if (!o.parent_order_id || !idSet.has(o.parent_order_id)) walkTree(o, 0); });
            filtered.forEach((o: any) => { if (!visitedIds.has(o.id)) walkTree(o, 0); });
            const sortArrow = (key: string) => orderSortKey === key ? (orderSortDir === 'asc' ? ' ▼' : ' ▲') : '';
            const doSort = (key: string) => {
              if (orderSortKey === key) {
                if (orderSortDir === 'asc') { setOrderSortDir('desc'); }
                else { setOrderSortKey(null); setOrderSortDir('asc'); }
              } else { setOrderSortKey(key); setOrderSortDir('asc'); }
            };
            return (
              <>
                <div style={mode === 'table' ? { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 420, overflow: 'hidden' } : { display: 'flex', gap: 6, alignItems: 'flex-start', width: '100%' }}>
                <div style={mode === 'table' ? { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } : { flex: 1, minWidth: 0 }}>
                <div className="panel" style={mode === 'table' ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0, overflow: 'hidden' } : undefined}>
                  <div className="panel-hdr">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div><span className="panel-title">Заказы</span><span className="panel-sub">{filtered.length} из {orders.length}</span></div>
                      <span style={{ display: 'inline-flex', background: '#0B1B33', border: '1px solid #1E3A5F', borderRadius: 8, padding: 2 }}>
                        {([['bom', 'Состав'], ['both', 'Состав + Маршруты'], ['routes', 'Маршруты']] as const).map(([v, label]) => (
                          <button key={v} onClick={() => setTreeMode(v)} style={{ border: 0, background: treeMode === v ? '#3B82F6' : 'transparent', color: treeMode === v ? '#fff' : '#8FA3BD', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</button>
                        ))}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 10px', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8FA3BD', cursor: 'pointer' }}>
                        <input type="checkbox" checked={orderShowAll} onChange={e => { setOrderShowAll(e.target.checked); if (!e.target.checked) setOrderTypeFilter('free'); else setOrderTypeFilter('all'); }} style={{ accentColor: '#3B82F6' }} />
                        Показать все заказы
                      </label>
                      {orderShowAll && (
                        <select value={orderTypeFilter} onChange={e => setOrderTypeFilter(e.target.value)} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#B0C4DE', padding: '4px 8px', fontSize: 12 }}>
                          <option value="all">Все типы</option>
                          <option value="free">Свободные</option>
                          {projGroups.map((g: any) => <option key={'g-'+g.id} value={g.id}>📁 {g.name}</option>)}
                          {projPools.map((p: any) => <option key={'p-'+p.id} value={p.id}>📦 {p.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => setAllOrdersCollapsed(collapsedOrderIds.size === 0)} style={{ background: 'none', border: '1px solid #1E3252', color: '#8FA3BD', borderRadius: 6, cursor: 'pointer', fontSize: 12, padding: '4px 8px', whiteSpace: 'nowrap' }} title={collapsedOrderIds.size === 0 ? 'Свернуть все поддеревья цепочки' : 'Развернуть все поддеревья цепочки'}>{collapsedOrderIds.size === 0 ? '▾ Свернуть всё' : '▸ Развернуть всё'}</button>
                      <button className="btn btn-primary btn-sm" onClick={() => setShowNewOrder(true)}>+ Заказ</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkPaste(!showBulkPaste)}>📋 Вставить</button>
                      <span style={{ fontSize: 11, color: '#5A7090', whiteSpace: 'nowrap' }}>⚡ = CPM</span><span style={{ fontSize: 11, color: '#5A7090', whiteSpace: 'nowrap' }}>○ = План</span>
                    </div>
                  </div>
                  <div style={{
                    padding: '8px 14px', marginBottom: 8, borderRadius: 8,
                    border: '2px dashed #1E3252', textAlign: 'center',
                    color: '#5A7090', fontSize: 12, transition: 'all .15s',
                    cursor: 'default',
                  }} onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#3B82F6'; e.currentTarget.style.color = '#60A5FA'; e.currentTarget.style.background = 'rgba(59,130,246,.06)'; }}
                    onDragLeave={(e) => { e.currentTarget.style.borderColor = '#1E3252'; e.currentTarget.style.color = '#5A7090'; e.currentTarget.style.background = 'transparent'; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#1E3252'; e.currentTarget.style.color = '#5A7090'; e.currentTarget.style.background = 'transparent'; const oid = e.dataTransfer.getData('orderId'); if (oid) moveOrder(oid, null, null); }}>
                    📍 Бросьте заказ сюда — убрать из группы/пула
                  </div>

                  {/* Аномалии структуры BOM (список заказов) */}
                  {(() => {
                    const all: any[] = bomAnomalies ? [...(bomAnomalies.no_routing || []), ...(bomAnomalies.no_order || []), ...(bomAnomalies.self_order || [])] : [];
                    if (bomAnomaliesLoading) return <div style={{ fontSize: 11.5, color: '#F59E0B', padding: '6px 2px' }}>Проверка структуры BOM…</div>;
                    if (!all.length) return null;
                    return (
                      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#FCA5A5' }}>⚠ Аномалии структуры: {all.length}</span>
                          <span style={{ fontSize: 10.5, color: '#8FA3BD' }}>полуфабрикаты без маршрута или без подчинённого заказа</span>
                          <div style={{ flex: 1 }} />
                          {createMissingOrders && all.filter((a: any) => a.category !== 'no_routing').length > 0 && (
                            <button onClick={createMissingOrders} style={{ background: '#3B82F6', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Создать заказы ({all.filter((a: any) => a.category !== 'no_routing').length})</button>
                          )}
                        </div>
                        <div style={{ display: 'grid', gap: 3, maxHeight: 130, overflow: 'auto', marginTop: 5 }}>
                          {all.slice(0, 15).map((a: any, i: number) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 8px', background: 'rgba(4,10,20,.4)', borderRadius: 5 }}>
                              <span style={{ color: '#FCA5A5', fontWeight: 600, flex: '0 0 84px' }}>{a.category === 'no_routing' ? 'нет маршрута' : a.category === 'no_order' ? 'нет заказа' : 'свой заказ'}</span>
                              <span style={{ color: '#E8EEF5', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.path || a.name}>{a.name}</span>
                              {a.category !== 'no_routing' && createOrderFromNode && (
                                <button onClick={() => createOrderFromNode(a.node_id)} style={{ background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 5, padding: '1px 8px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Создать заказ</button>
                              )}
                            </div>
                          ))}
                          {all.length > 15 && <div style={{ fontSize: 10.5, color: '#5A7090', padding: '2px 8px' }}>…и ещё {all.length - 15}</div>}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Bulk paste panel */}
                  {showBulkPaste && (
                    <div style={{
                      background: '#0A1628', border: '1px solid #1E3252', borderRadius: 10, padding: 16, marginBottom: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE' }}>📋 Вставка заказов из таблицы</span>
                        <button onClick={() => { setShowBulkPaste(false); setBulkPasteText(''); setBulkNomenMatches({}); }} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 16 }}>✕</button>
                      </div>
                      <textarea
                        placeholder="Скопируйте таблицу из Excel (Ctrl+C), затем вставьте сюда (Ctrl+V). Первая строка — заголовки."
                        value={bulkPasteText}
                        onChange={e => { const v = e.target.value; setBulkPasteText(v); if (v.includes('\n') || v.includes('\t')) handleBulkPaste(v); }}
                        onPaste={e => { const t = e.clipboardData.getData('text'); setBulkPasteText(t); handleBulkPaste(t); }}
                        style={{
                          width: '100%', minHeight: 80, background: '#0F1E36', border: '1px solid #1E3252',
                          borderRadius: 8, color: '#B0C4DE', padding: 12, fontSize: 12, resize: 'vertical',
                          fontFamily: "'IBM Plex Mono', monospace", marginBottom: 10,
                        }}
                      />
                      {bulkMatchLoading && <div style={{ fontSize: 12, color: '#F59E0B', marginBottom: 8 }}>🔍 Сопоставление с номенклатурой...</div>}
                      {!bulkMatchLoading && Object.keys(bulkNomenMatches).length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#B0C4DE', marginBottom: 6 }}>
                            Сопоставление с номенклатурой:
                            <span style={{ color: '#10B981', marginLeft: 8 }}>
                              ✓ {Object.values(bulkNomenMatches).filter(Boolean).length}
                            </span>
                            <span style={{ color: '#EF4444', marginLeft: 4 }}>
                              ✗ {Object.values(bulkNomenMatches).filter(v => v === null).length} не найдено
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {Object.entries(bulkNomenMatches).map(([name, match]) => (
                              <span key={name} style={{
                                background: match ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                                border: `1px solid ${match ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                                borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#B0C4DE',
                              }}>
                                {name} {match ? <span style={{ color: '#10B981' }}>→ {match.name}</span> : <span style={{ color: '#EF4444' }}>✗</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={bulkCreateOrders} disabled={!bulkPasteText.trim()}
                          style={{
                            background: bulkPasteText.trim() ? 'linear-gradient(135deg, #3B82F6, #2563EB)' : '#1E3252',
                            color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px',
                            cursor: bulkPasteText.trim() ? 'pointer' : 'default', fontSize: 13, fontWeight: 600,
                          }}>
                          ✓ Создать заказы
                        </button>
                        <button onClick={() => { setShowBulkPaste(false); setBulkPasteText(''); setBulkNomenMatches({}); }}
                          style={{ background: 'transparent', border: '1px solid #2A4060', borderRadius: 8, color: '#5A7090', padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={mode === 'table' ? { flex: 1, minHeight: 250, overflow: 'auto' } : { overflowX: 'auto' }}>
                    <table className="tbl" style={{ width: 'max-content' }}>
                      <thead><tr>
                        <th style={{ width: 96 }}></th>
                        <th className="t-graph" style={{ cursor: 'pointer' }} onClick={() => doSort('_type')}>Тип{sortArrow('_type')}</th>
                        {orderShowAll && <th style={{ cursor: 'pointer' }} onClick={() => doSort('_typeName')}>Группа / Пул{sortArrow('_typeName')}</th>}
                        <th className="t-graph">Граф</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('ext_id')}>ID{sortArrow('ext_id')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('specification_name')}>Продукт{sortArrow('specification_name')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('client')}>Клиент{sortArrow('client')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('quantity')}>Кол-во{sortArrow('quantity')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('priority')}>Приоритет{sortArrow('priority')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('status')}>Статус{sortArrow('status')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('start_date')}>Старт{sortArrow('start_date')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('due_date')}>Финиш{sortArrow('due_date')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => doSort('created_at')}>Загружен{sortArrow('created_at')}</th>
                        <th style={{ width: 40 }}></th>
                      </tr></thead>
                      <tbody>
                        {showNewOrder && (
                          <tr>
                            <td></td>
                            <td className="t-mono">—</td>
                            {orderShowAll && <td className="t-mono">—</td>}
                            <td className="t-graph"><span className="g-pln">○</span></td>
                            <td className="t-mono">—</td>
                            <td><input value={newOrder.specification_name} onChange={e => setNewOrder({ ...newOrder, specification_name: e.target.value })} placeholder="Продукт" style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 4, color: '#E8EEF5', padding: '4px 8px', width: 130, fontSize: 12 }} onKeyDown={e => e.key === 'Enter' && createOrder()} autoFocus /></td>
                            <td><input value={newOrder.client} onChange={e => setNewOrder({ ...newOrder, client: e.target.value })} placeholder="Клиент" style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 4, color: '#B0C4DE', padding: '4px 8px', width: 90, fontSize: 12 }} /></td>
                            <td><input value={newOrder.quantity} onChange={e => setNewOrder({ ...newOrder, quantity: e.target.value })} type="number" min="1" style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 4, color: '#B0C4DE', padding: '4px 8px', width: 60, fontSize: 12 }} /></td>
                            <td><select value={newOrder.priority} onChange={e => setNewOrder({ ...newOrder, priority: e.target.value })} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 4, color: '#B0C4DE', padding: '4px 4px', fontSize: 12 }}><option value="normal">Обычный</option><option value="high">Высокий</option><option value="critical">Критич.</option><option value="low">Низкий</option></select></td>
                            <td><span className="badge draft">Новый</span></td>
                            <td className="t-mono">—</td>
                            <td className="t-mono">—</td>
                            <td style={{ display: 'flex', gap: 4 }}>
                              <button onClick={createOrder} style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>✓</button>
                              <button onClick={() => setShowNewOrder(false)} style={{ background: 'transparent', color: '#5A7090', border: '1px solid #2A4060', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', fontSize: 11 }}>✕</button>
                            </td>
                          </tr>
                        )}
                        {treeRows.map(({ o, depth, hasChildren, collapsed }: any) => {
                          const ti = getTypeInfo(o);
                          const bomOpen = expandedBomOrder === o.id;
                          const isFree = !o.parent_order_id;
                          return (
                            <Fragment key={o.id}>
                            <tr id={'ord-' + o.id} draggable onClick={() => openOrderPanel(o)} onDragStart={(e) => { e.dataTransfer.setData('orderId', o.id); e.dataTransfer.effectAllowed = 'move'; }} style={{ cursor: 'grab', background: o.pool_id ? 'rgba(139,92,246,.06)' : (isFree ? 'rgba(245,158,11,.05)' : undefined) }}>
                              <td style={{ textAlign: 'left', paddingLeft: 4 + depth * 16, width: 96, minWidth: 96, maxWidth: 96, overflow: 'visible', boxShadow: depth > 0 ? 'inset 2px 0 0 ' + (depth === 1 ? '#8B5CF6' : '#06B6D4') : undefined }}>
                                <span style={{ display: 'inline-block', width: 22, textAlign: 'center' }}>
                                  {hasChildren ? (
                                    <button onClick={(e) => { e.stopPropagation(); toggleOrderCollapse(o.id); }} title={collapsed ? 'Развернуть поддерево' : 'Свернуть поддерево'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60A5FA', fontSize: 16, padding: 0, margin: 0, verticalAlign: 'middle', lineHeight: 1 }}>{collapsed ? '▸' : '▾'}</button>
                                  ) : null}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleBomOrder(o); }}
                                  title={bomOpen ? 'Свернуть BOM' : 'Показать BOM'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: bomOpen ? '#60A5FA' : '#5A7090', fontSize: 16, padding: '2px 6px', transition: 'color .15s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#60A5FA')}
                                  onMouseLeave={e => (e.currentTarget.style.color = bomOpen ? '#60A5FA' : '#5A7090')}
                                >{bomOpen ? '▾' : '▸'}</button>
                              </td>
                              <td className="t-mono" style={{ fontSize: 14 }}>{ti.icon}</td>
                              {orderShowAll && <td className="t-name" style={{ fontSize: 12 }}>{ti.name}</td>}
                              <td className="t-graph"><span className={isDyn(o) ? 'g-dyn' : 'g-pln'} title={isDyn(o) ? `${o.operations_created || '?'} операций` : 'Нет графа'}>{isDyn(o) ? '⚡' : '○'}</span></td>
                              <td className="t-mono">{o.ext_id || '—'}</td>
                              <td className="t-name" style={{ color: o.pool_id ? '#A78BFA' : undefined }}>{depth > 0 && <span title="Подчинённый заказ (цепочка)" style={{ display: 'inline-block', background: 'rgba(139,92,246,.15)', color: '#C4B5FD', border: '1px solid rgba(139,92,246,.45)', borderRadius: 5, fontSize: 10.5, padding: '0 5px', marginRight: 6, fontWeight: 600, lineHeight: '14px' }}>⛓</span>}{isFree && depth === 0 && <span title="Свободный заказ (без родителя)" style={{ display: 'inline-block', background: 'rgba(245,158,11,.14)', color: '#FBBF24', border: '1px solid rgba(245,158,11,.4)', borderRadius: 5, fontSize: 10.5, padding: '0 5px', marginRight: 6, fontWeight: 600, lineHeight: '14px' }}>своб.</span>}{o.specification_name || o.ext_id || '—'}</td>
                              <td style={o.pool_id ? { color: '#A78BFA' } : undefined}>{o.client || '—'}</td>
                              <td className="t-mono">{o.quantity} {o.unit}</td>
                              <td><span className={`badge ${o.priority}`}>{o.priority === 'high' ? 'Высокий' : o.priority === 'critical' ? 'Критич.' : o.priority === 'low' ? 'Низкий' : 'Обычный'}</span></td>
                              <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черновик' : o.status === 'planned' ? 'План' : o.status === 'in_progress' ? 'В работе' : 'Завершён'}</span></td>
                              <td className="t-mono">{o.start_date || '—'}</td>
                              <td className="t-mono">{o.due_date || '—'}</td>
                              <td className="t-mono" title={o.created_at ? new Date(o.created_at).toLocaleString('ru-RU') : undefined}>{o.created_at ? new Date(o.created_at).toLocaleDateString('ru-RU') : '—'}</td>
                              <td><button onClick={() => deleteOrder(o.id, o.specification_name || ('#' + o.id.slice(0,8)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.5, padding: '2px 4px' }} title="Удалить заказ">🗑</button></td>
                            </tr>
                            {bomOpen && (
                              <tr>
                                <td colSpan={orderShowAll ? 14 : 13} style={{ background: '#0F1E36', padding: 0 }}>
                                  <div style={{ padding: '12px 18px', borderTop: '1px solid #1E3252' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                      <span style={{ fontSize: 12, fontWeight: 600, color: '#B0C4DE', letterSpacing: '.02em' }}>{treeMode === 'bom' ? 'BOM' : treeMode === 'routes' ? 'Маршруты' : 'Состав + Маршруты'} · {o.specification_name || o.ext_id || '—'}</span>
                                      {bomLoading[selectedProject?.id || ''] && <span style={{ fontSize: 11, color: '#F59E0B' }}>загрузка…</span>}
                                      <span style={{ fontSize: 11, color: '#5A7090' }}>{treeMode === 'bom' ? 'структура изделия' : treeMode === 'routes' ? 'технологические маршруты' : 'структура + маршруты'}</span>
                                      <button onClick={() => openBomModal(o)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Развернуть полностью ↗</button>
                                    </div>
                                    <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} orders={orders} currentOrderId={o.id} routings={routings} showOps={treeMode !== 'bom'} showMaterials={treeMode !== 'routes'} resName={resName} onOrderFocus={focusOrderByBom} timeline={bomTimeline?.length ? bomTimeline : buildDraftTimeline(orderBomNodes(o))} timelineDraft={!bomTimeline?.length} timelineLoading={bomTimelineLoading} onLoadTimeline={loadBomTimeline} />
                                  </div>
                                </td>
                              </tr>
                            )}

                            </Fragment>
                          );
                        })}
                        {filtered.length === 0 && !showNewOrder && <tr><td colSpan={orderShowAll ? 14 : 13} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Заказов нет</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                </div>
                {mode === 'full' && (() => {
                  const o = selOrder;
                  const isModal = panelMode === 'modal';
                  if (panelMode === 'window') return null;
                  if (isModal && !o) return null;
                  const base: any = {
                    background: '#0B1B33', border: '1px solid #1E3A5F', borderRadius: 12,
                    overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column',
                    maxHeight: 'calc(100vh - 130px)',
                  };
                  const pStyle: any = isModal
                    ? { ...base, position: 'fixed', top: 76, right: 26, width: 'min(640px, calc(100vw - 330px))', height: 'auto', maxHeight: 'calc(100vh - 152px)', zIndex: 120, borderColor: 'rgba(59,130,246,.6)', boxShadow: '0 24px 70px rgba(0,0,0,.55)' }
                    : { ...base, width: panelWidth ?? '40%', minWidth: 300, maxWidth: '62%', position: 'sticky', top: 16 };
                  const tabs: { v: 'order' | 'bom' | 'route' | 'res' | 'plan'; l: string }[] = [
                    { v: 'order', l: 'Заказ' }, { v: 'bom', l: 'Состав' }, { v: 'route', l: 'Маршрут' }, { v: 'res', l: 'Ресурсы' }, { v: 'plan', l: 'План' },
                  ];
                  const bomNodes = o ? orderBomNodes(o) : [];
                  const rt = o ? routingFor(o) : null;
                  const rtTotal = rt?.operations ? rt.operations.reduce((s: number, op: any) => s + (Number(op.duration_hours) || 0), 0) : 0;
                  return (
                    <>
                      {!isModal && (
                        <div
                          style={{ width: 4, flex: 'none', cursor: 'col-resize', alignSelf: 'stretch', borderRadius: 2, background: 'transparent', transition: 'background .15s' }}
                          title="Перетащите — изменится ширина панели"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const startX = e.clientX;
                            const cw = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
                            const startW = panelWidth ?? Math.round(cw * 0.4);
                            const onMove = (ev: MouseEvent) => {
                              const w = Math.max(280, Math.min(cw - 380, startW - (ev.clientX - startX)));
                              setPanelWidth(Math.round(w));
                              try { localStorage.setItem('profyplan_panel_width', String(Math.round(w))); } catch {}
                            };
                            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                        />
                      )}
                      {isModal && <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,20,.66)', zIndex: 110 }} onClick={() => setSelOrderId(null)} />}
                      <div style={pStyle}>
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid #1E3A5F', background: '#0D1F3A', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o ? (o.ext_id || o.id) : 'Панель заказа'}</div>
                            {debugMode && <DebugBadge debug={debugMode} text="[order:panel]" copy={o ? `[order:panel] «${o.ext_id || o.id}${o.specification_name ? ' · ' + o.specification_name : ''}»` : '[order:panel] «Панель заказа»'} />}
                            <div style={{ fontSize: 12, color: '#8FA3BD', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o ? (o.specification_name || '—') : 'Выберите заказ в списке'}</div>
                          </div>
                          {o && panelTab === 'bom' && (
                            <>
                              <label title="Показывать операции маршрута корневого узла в составе" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#8FA3BD', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={panelShowOps} onChange={e => setPanelShowOps(e.target.checked)} style={{ accentColor: '#3B82F6' }} />
                                операции
                              </label>
                              <button onClick={() => setPanelAttach(selOrderId)} title="Привязать свободный заказ как производителя полуфабриката"
                                style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.4)', color: '#C4B5FD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>⛓ Привязать свободный заказ</button>
                            </>
                          )}
                          {o && !panelEditing && (
                            <button onClick={startEditOrder} style={{ background: 'transparent', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✏️ Редактировать</button>
                          )}
                          {o && panelEditing && (
                            <>
                              <button onClick={saveOrderEdit} style={{ background: '#3B82F6', border: 0, color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>✓ Сохранить</button>
                              <button onClick={() => setPanelEditing(false)} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✕ Отмена</button>
                            </>
                          )}
                          {isModal && (
                            <button onClick={() => setSelOrderId(null)} style={{ background: 'transparent', border: 0, color: '#8FA3BD', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>✕</button>
                          )}
                        </div>
                        <div style={{ display: 'flex', borderBottom: '1px solid #1E3252' }}>
                          {tabs.map(tb => (
                            <button key={tb.v} onClick={() => setPanelTab(tb.v)} style={{ flex: 1, border: 0, background: 'transparent', color: panelTab === tb.v ? '#fff' : '#8FA3BD', borderBottom: '2px solid ' + (panelTab === tb.v ? '#3B82F6' : 'transparent'), padding: '8px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{tb.l}</button>
                          ))}
                        </div>
                        <div style={{ padding: '12px 14px', minHeight: 300, overflowY: 'auto', flex: 1, fontSize: 12.5, color: '#E2E8F0' }}>
                          {!o && !isModal && <div style={{ color: '#5A7090', fontSize: 12.5 }}>Кликните по заказу в списке, чтобы увидеть его карточку: состав, маршрут, ресурсы и план.</div>}
                          {o && panelTab === 'order' && !panelEditing && (
                            <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '6px 10px', fontSize: 13 }}>
                              {[['Клиент', o.client || '—'], ['Кол-во', String(o.quantity ?? '—')], ['Ед.', o.unit || '—'], ['Приоритет', o.priority || '—'], ['Статус', o.status || '—'], ['Старт', o.start_date || '—'], ['Финиш', o.due_date || '—'], ['Загружен', o.created_at ? new Date(o.created_at).toLocaleString('ru-RU') : '—'], ['Заказ родителя', o.parent_order_id || '—']].map(([k, v]) => (
                              <div key={k} style={{ display: 'contents' }}>
                                <div style={{ color: '#5A7090' }}>{k}</div>
                                <div style={{ color: '#E2E8F0' }}>{v}</div>
                              </div>
                              ))}
                            </div>
                          )}
                          {o && panelTab === 'order' && panelEditing && (
                            <div style={{ display: 'grid', gap: 10 }}>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Клиент</span>
                                <DirectoryPicker entity="counterparties" apiBase="https://profyplan.ru/api" value={editForm.client_id || null} onChange={(v) => setEditForm(f => ({ ...f, client_id: v }))} placeholder="Выбрать контрагента..." onManage={() => openDirectory('counterparties')} />
                              </label>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Кол-во</span>
                                <input type="number" value={editForm.quantity || ''} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                              </label>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Ед. изм.</span>
                                <DirectoryPicker entity="units" apiBase="https://profyplan.ru/api" value={editForm.unit || null} onChange={(v) => setEditForm(f => ({ ...f, unit: v }))} displayField="symbol_ru" valueField="symbol_int" subField="symbol_int" placeholder="Выбрать единицу..." onManage={() => openDirectory('units')} />
                              </label>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Приоритет</span>
                                <select value={editForm.priority || ''} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                                  <option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option>
                                </select>
                              </label>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Старт</span>
                                <input type="date" value={editForm.start_date || ''} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                              </label>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Финиш</span>
                                <input type="date" value={editForm.due_date || ''} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                              </label>
                              <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#8FA3BD', fontSize: 12 }}>Статус</span>
                                <select value={editForm.status || ''} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                                  <option value="draft">Черновик</option><option value="active">В работе</option><option value="completed">Завершён</option>
                                </select>
                              </label>
                            </div>
                          )}
                          {o && panelTab === 'bom' && (
                            bomNodes.length ? <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} currentOrderId={o.id} editable={panelEditing} orders={orders} onNodeOrderChange={handleNodeOrderChange} onNodeQuantityChange={handleBomNodeQuantity} onNodeRemove={handleBomNodeRemove} onNodeAdd={handleBomNodeAdd} onOrderFocus={focusOrderByBom} routings={routings} showOps={panelShowOps} showMaterials resName={resName} addRootOnly rootOpsOnly childExpandable={false} onNodeUnlink={handleBomNodeUnlink} onNodeNomenclatureChange={handleBomNodeNomenclature} />
                            : <div style={{ color: '#5A7090' }}>{bomLoading[selectedProject?.id || ''] ? 'Загрузка состава…' : 'Состав пуст — у заказа нет спецификации (BOM).'}</div>
                          )}
                          {o && panelTab === 'route' && (() => {
                            const rts = routingsFor(o);
                            if (!rts.length) return <div style={{ color: '#5A7090' }}>Маршруты не заданы. Привяжите маршруты к узлам спецификации (BOM → узел → routing_id).</div>;
                            const nodes = bomNodes;
                            const rtById: Record<string, any> = {};
                            rts.forEach((r: any) => { rtById[r.id] = r; });
                            const kidsOf = (id: string): any[] => nodes.filter((n: any) => n.parent_id === id);
                            const TYPE_META: Record<string, { c: string; bg: string; l: string }> = {
                              assembly: { c: '#60A5FA', bg: 'rgba(59,130,246,.15)', l: 'Сборка' },
                              semi_finished: { c: '#34D399', bg: 'rgba(16,185,129,.14)', l: 'Полуфабрикат' },
                              material: { c: '#A8B6C8', bg: 'rgba(138,151,173,.13)', l: 'Материал' },
                            };
                            const hasRouteBelow = (n: any): boolean => n.routing_id ? true : kidsOf(n.id).some(k => hasRouteBelow(k));
                            const renderRouteNode = (n: any): any => {
                              const rt = rtById[n.routing_id];
                              const ops = rt ? (rt.operations || []) : [];
                              const tot = ops.reduce((s: number, op: any) => s + (Number(op.duration_hours) || 0), 0);
                              const kids = kidsOf(n.id).filter((k: any) => hasRouteBelow(k));
                              const meta = TYPE_META[n.node_type] || TYPE_META.material;
                              const hasBody = ops.length > 0 || kids.length > 0;
                              const det = (op: any) => [
                                op.department ? 'Подразделение: ' + op.department : '',
                                op.predecessors ? 'Предш.: ' + op.predecessors : '',
                                op.setup_hours ? 'Наладка ' + op.setup_hours + ' ч' : '',
                                op.teardown_hours ? 'Снятие ' + op.teardown_hours + ' ч' : '',
                                Number(op.output_quantity) ? 'Вых. годн. ' + op.output_quantity : '',
                              ].filter(Boolean).join(' · ');
                              return (
                                <div key={n.id}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 7 }}>
                                    <span style={{ width: 20, height: 20, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 20px', background: meta.bg, color: meta.c, fontSize: 11, fontWeight: 700 }}>{meta.l.slice(0, 1)}</span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#E8EEF5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.nomenclature_name || n.name || n.ext_id}</span>
                                    {n.routing_id ? (
                                      <>
                                        <span style={{ fontSize: 11, color: '#22D3EE', whiteSpace: 'nowrap' }}>⛓ {ops.length} оп.</span>
                                        <span style={{ fontSize: 12, color: '#FCD34D', fontWeight: 700, whiteSpace: 'nowrap' }}>{tot} ч</span>
                                      </>
                                    ) : (
                                      <span style={{ fontSize: 10.5, color: '#5A7090', whiteSpace: 'nowrap' }}>{meta.l}</span>
                                    )}
                                    {panelEditing && n.routing_id && (
                                      <button type="button" title="Добавить операцию в маршрут" onClick={() => handleRoutingOpAdd(n.routing_id)}
                                        style={{ background: 'rgba(34,211,238,.12)', border: '1px solid rgba(34,211,238,.35)', color: '#22D3EE', borderRadius: 5, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>＋ оп</button>
                                    )}
                                  </div>
                                  {hasBody && (
                                    <div style={{ marginLeft: 14, paddingLeft: 12, borderLeft: '1px solid #2A4060' }}>
                                      {ops.map((op: any) => {
                                        const d = det(op);
                                        return (
                                          <>
                                          <div key={op.id || op.sequence_number} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6 }}>
                                            <span style={{ width: 18, height: 18, borderRadius: 5, flex: '0 0 18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(59,130,246,.14)', color: '#60A5FA', fontSize: 10.5, fontWeight: 700 }}>{op.sequence_number}</span>
                                            {op.stage ? (
                                              <span style={{ flex: '0 0 auto', fontSize: 10, color: '#C4B5FD', background: 'rgba(139,92,246,.14)', border: '1px solid rgba(139,92,246,.3)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>Этап {op.stage}{op.stage_name ? ' · ' + op.stage_name : ''}</span>
                                            ) : null}
                                            <span style={{ flex: 1, minWidth: 0 }}>
                                              <span style={{ display: 'block', fontSize: 12, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.name}</span>
                                              <span style={{ display: 'block', fontSize: 10.5, color: '#5A7090', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ресурс: {resName(op.resource_type_id)}{d ? ' · ' + d : ''}</span>
                                            </span>
                                            <span style={{ fontSize: 12, color: '#FCD34D', fontWeight: 600, whiteSpace: 'nowrap' }}>{Number(op.duration_hours) || 0} ч</span>
                                            {panelEditing && (
                                              <button type="button" title="Удалить операцию" onClick={() => setAppModal({ kind: 'op-del', opId: op.id, opName: op.name })}
                                                style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)', color: '#F87171', borderRadius: 5, width: 22, height: 22, fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>✕</button>
                                            )}
                                          </div>
                                          {panelEditing && (
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 8px 6px 32px', flexWrap: 'wrap' }}>
                                              <button type="button" onClick={() => openResourcePick(op.id)} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: op.resource_type_id ? '#E8EEF5' : '#5A7090', padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                                                {op.resource_type_id ? ('Ресурс: ' + resName(op.resource_type_id)) : 'Выбрать ресурс...'}
                                              </button>
                                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#FCD34D' }}>
                                                ⏱
                                                <input type="number" min="0" step="any" defaultValue={Number(op.duration_hours) || 0} key={'pd-' + op.id + '-' + (Number(op.duration_hours) || 0)} title="Продолжительность операции, ч"
                                                  onBlur={(e) => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (!Number.isNaN(v) && v >= 0 && Number(v.toFixed(3)) !== Number(op.duration_hours)) { handleRoutingOpUpdate(op.id, { duration_hours: v }); } }}
                                                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                  style={{ width: 74, background: '#0A1628', border: '1px solid rgba(245,158,11,.4)', borderRadius: 5, color: '#FCD34D', padding: '2px 5px', fontSize: 12, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", outline: 'none' }} />
                                                <span>ч</span>
                                              </span>
                                            </div>
                                          )}
                                          </>
                                        );
                                      })}
                                      {kids.map((k: any) => renderRouteNode(k))}
                                    </div>
                                  )}
                                </div>
                              );
                            };
                            const roots = nodes.filter((n: any) => !n.parent_id);
                            return <div>{roots.filter((r: any) => hasRouteBelow(r)).map((r: any) => renderRouteNode(r))}</div>;
                          })()}
                          {o && panelTab === 'res' && (() => {
                            const used = new Set<string>();
                            for (const r of routingsFor(o)) for (const op of (r.operations || [])) if (op.resource_type_id) used.add(String(op.resource_type_id));
                            const ordRes = resourcesList.filter((r: any) => used.has(r.id) || used.has(r.name));
                            return ordRes.length ? (
                              <div>
                                <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>Ресурсы заказа: {ordRes.length}</div>
                                {ordRes.map((r: any) => (
                                  <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed rgba(30,58,95,.5)' }}>
                                    <span style={{ flex: 1 }}>{r.name}</span>
                                    <span style={{ color: '#5A7090', fontSize: 11 }}>{r.resource_type || '—'}</span>
                                    <span style={{ color: '#FCD34D', fontSize: 11 }}>×{r.capacity_per_unit ?? r.capacity_per_day ?? '—'}</span>
                                    <span style={{ color: '#5A7090', fontSize: 11 }}>{r.capacity_unit || r.unit || ''}</span>
                                  </div>
                                ))}
                              </div>
                            ) : <div style={{ color: '#5A7090' }}>У заказа нет задействованных ресурсов.</div>;
                          })()}
                          {o && panelTab === 'plan' && (
                            <div style={{ color: '#8FA3BD', lineHeight: 1.6 }}>
                              План по заказу формируется при расчёте CPM / Ганта (Фаза 2): операции маршрута будут разворачиваться в план с привязкой к ресурсам и датам.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
                </div>
              </>
            );
          };

  // ── Styles ──
  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#0A1628;color:#E8EEF5}
    .kpi-card{background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3252;border-radius:12px;padding:18px 20px;transition:all .15s};position:relative
    .kpi-card:hover{border-color:#2A4060;transform:translateY(-1px)}
    .kpi-label{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#60A5FA;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
    .kpi-val{font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:700;letter-spacing:-.02em;margin-bottom:2px}
    .kpi-val.g{color:#10B981}.kpi-val.r{color:#EF4444}
    .kpi-sub{font-size:12px;color:#5A7090}
    .panel{background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3252;border-radius:12px;padding:20px;margin-bottom:16px}
    .panel-hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;row-gap:8px;margin-bottom:16px}
    .panel-title{font-size:15px;font-weight:600}
    .panel-sub{font-size:12px;color:#5A7090;font-family:'IBM Plex Mono',monospace;margin-left:8px}
    .tbl{width:100%;border-collapse:collapse;font-size:13px}
    .tbl th{text-align:left;padding:8px 12px;color:#60A5FA;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1E3252}
    .tbl td{padding:10px 12px;border-bottom:1px solid #162844;color:#B0C4DE}
    .tbl tr:hover td{background:rgba(59,130,246,.05)}
    .tbl .t-name{color:#E8EEF5;font-weight:600}
    .tbl .t-mono{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5A7090}
    .tbl .t-graph{text-align:center;width:48px}
    .tbl .g-dyn{color:#60A5FA;font-size:16px;cursor:help}
    .tbl .g-pln{color:#374151;font-size:14px}
    .badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:6px;display:inline-block}
    .badge.draft{background:rgba(100,116,139,.15);color:#94a3b8}
    .badge.planned{background:rgba(59,130,246,.15);color:#60A5FA}
    .badge.in_progress{background:rgba(16,185,129,.15);color:#34d399}
    .badge.completed{background:rgba(16,185,129,.2);color:#10B981}
    .badge.high{background:rgba(239,68,68,.12);color:#f87171}
    .badge.critical{background:rgba(239,68,68,.18);color:#ef4444}
    .badge.normal{background:rgba(100,116,139,.15);color:#94a3b8}
    .btn{font-family:Inter,sans-serif;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:all .12s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
    .btn-primary{background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;box-shadow:0 4px 12px rgba(59,130,246,.35),inset 0 1px 0 rgba(255,255,255,.2)}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(59,130,246,.4)}
    .btn-secondary{background:transparent;color:#B0C4DE;border-color:#2A4060}
    .btn-secondary:hover{border-color:#3B82F6;color:#60A5FA}
    .btn-danger{color:#EF4444;border-color:transparent;background:rgba(239,68,68,.08)}
    .btn-danger:hover{background:rgba(239,68,68,.15)}
    .btn-sm{font-size:11px;padding:4px 10px}
    .group-card{background:rgba(59,130,246,.04);border:1px solid #1E3252;border-radius:12px;padding:16px 20px;margin-bottom:12px}
    .s-logo{width:34px;height:34px;background:linear-gradient(135deg,#3B82F6,#2563EB);border-radius:9px;box-shadow:0 4px 14px rgba(59,130,246,.35);flex-shrink:0}
    .proj-card{background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3252;border-radius:12px;padding:20px;transition:all .15s;cursor:pointer};position:relative
    .proj-card:hover{border-color:#2A4060;transform:translateY(-1px)}
    .proj-card .pc-name{font-size:16px;font-weight:600;margin-bottom:4px}
    .proj-card .pc-meta{font-size:12px;color:#5A7090;font-family:'IBM Plex Mono',monospace;margin-bottom:12px}
    .proj-card .pc-actions{display:flex;gap:8px;flex-wrap:wrap}
    .topbar{padding:14px 28px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1E3252;background:#0F1E36;position:sticky;top:0;z-index:10}
    .topbar h1{font-size:20px;font-weight:700;margin:0;letter-spacing:-.015em}
    .topbar .tb-sub{font-size:12px;color:#5A7090;margin-top:2px}
    .dir-card{background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3252;border-radius:12px;padding:24px 20px;text-align:center;cursor:pointer;transition:all .15s;text-decoration:none;color:inherit;display:block}
    .dir-card:hover{border-color:#2A4060;transform:translateY(-1px)}
    .dir-card .dc-icon{font-size:32px;margin-bottom:10px}
    .dir-card .dc-title{font-size:14px;font-weight:600;margin-bottom:4px}
    .dir-card .dc-count{font-size:12px;color:#5A7090;font-family:'IBM Plex Mono',monospace}
    /* ── Режим «Окна» ── */
    .pp-win{position:fixed;display:flex;flex-direction:column;background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3A5F;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.55);overflow:hidden;transition:left .1s,top .1s,width .1s,height .1s}
    .pp-win.dragging{transition:none;box-shadow:0 22px 64px rgba(0,0,0,.7)}
    .pp-win.focus{border-color:rgba(59,130,246,.7)}
    .pp-win.min{display:none}
    .pp-win-title{height:34px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;background:#0D1F3A;border-bottom:1px solid #1E3252;cursor:grab;user-select:none;flex-shrink:0}
    .pp-win-title .ttl{flex:1;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
    .pp-wbtn{width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#8FA3BD;cursor:pointer;background:none;border:0;flex-shrink:0;font-family:inherit}
    .pp-wbtn:hover{background:rgba(59,130,246,.18);color:#fff}
    .pp-wbtn.close:hover{background:rgba(239,68,68,.25);color:#fff}
    .pp-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,#2A4060 50%,#2A4060 58%,transparent 58%);border-bottom-right-radius:9px}
    .pp-snapzone{position:fixed;background:rgba(59,130,246,.14);border:2px solid #3B82F6;border-radius:8px;pointer-events:none;z-index:800;transition:all .05s}
    .pp-taskbar{position:fixed;left:var(--sbw,260px);right:0;bottom:0;height:44px;background:#0B1B33;border-top:1px solid #1E3252;display:flex;align-items:center;gap:6px;padding:0 10px;z-index:500;overflow-x:auto}
    .pp-tchip{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 10px;background:#0F1E36;border:1px solid #1E3252;border-radius:7px;font-size:11.5px;color:#B0C4DE;cursor:pointer;white-space:nowrap;flex-shrink:0;font-family:inherit}
    .pp-tchip:hover{border-color:#3B82F6;color:#fff}
    .pp-tchip.active{background:rgba(59,130,246,.16);border-color:rgba(59,130,246,.5);color:#fff}
    .pp-tchip.min{opacity:.55;border-style:dashed}
    .pp-tchip.over{border-color:#22D3EE;box-shadow:0 0 0 1px #22D3EE}
    .pp-tchip-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-left:2px;border-radius:4px;color:#5A7090;font-size:13px;line-height:1;transition:background .15s,color .15s}
    .pp-tchip-x:hover{background:rgba(239,68,68,.22);color:#FCA5A5}
    .pp-tchip-dirty{width:7px;height:7px;border-radius:50%;background:#F87171;flex-shrink:0;box-shadow:0 0 0 2px rgba(248,113,113,.22)}
    .pp-lay{position:fixed;z-index:900;background:#0B1B33;border:1px solid #2A4060;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.55);padding:12px;width:340px}
    .pp-lay .lh{font-size:11px;color:#60A5FA;letter-spacing:.06em;margin-bottom:10px;font-weight:600}
    .pp-layrow{display:flex;gap:10px;margin-bottom:10px}
    .pp-layopt{border:1px solid #1E3252;border-radius:8px;padding:8px;cursor:pointer;display:flex;flex-direction:column;gap:4px;align-items:center}
    .pp-layopt:hover{border-color:#3B82F6;background:rgba(59,130,246,.06)}
    .pp-layopt .mini{display:flex;gap:3px;width:74px;height:40px}
    .pp-layopt .cell{border:1px solid #3B82F6;border-radius:3px;background:rgba(59,130,246,.12);flex:1}
    .pp-layopt .cell.h{border-color:#2A4060;background:rgba(42,64,96,.15)}
    .pp-layopt .lab{font-size:10px;color:#8FA3BD}
    .pp-laycells{display:grid;gap:6px}
    .pp-laycells .bc{border:1px solid rgba(59,130,246,.5);border-radius:8px;background:rgba(59,130,246,.08);display:flex;align-items:center;justify-content:center;font-size:12px;color:#B0C4DE;cursor:pointer;min-height:60px;flex-direction:column;padding:6px}
    .pp-laycells .bc:hover{background:rgba(59,130,246,.2);border-color:#60A5FA}
    .pp-laycells .bc.done{border-color:#10B981;background:rgba(16,185,129,.1);color:#34D399;cursor:default}
    .pp-laycells .bc small{font-size:10px;color:#5A7090;display:block;margin-top:2px}
  `;

  // ── Loading ──
  if (!loaded) {
    return (
      <div style={{ background: '#0A1628', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div style={{ textAlign: 'center' }}>
          <div className="s-logo" style={{ margin: '0 auto 20px' }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>ProfyPlan</h1>
          <p style={{ color: '#5A7090', marginBottom: 24 }}>{msg || 'Рабочий стол'}</p>
          {pendingTenants.length > 0 ? (
            <div style={{ maxWidth: 360, margin: '0 auto', textAlign: 'left' }}>
              <div style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5', marginBottom: 16 }}>Выберите компанию</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendingTenants.map((t: any) => (
                    <button key={t.id} onClick={() => chooseTenant(t.id)} disabled={loading} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, color: '#E8EEF5', padding: '12px 14px', fontSize: 14, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: '#5A7090' }}>{t.role === 'owner' ? 'Владелец' : t.role}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : authError ? (
            <div style={{ maxWidth: 320, margin: '0 auto', textAlign: 'left' }}>
              <div style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5', marginBottom: 16 }}>Вход</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <input value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="Email" style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '10px 14px', fontSize: 14 }} />
                  <input value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} type="password" placeholder="Пароль" style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '10px 14px', fontSize: 14 }} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
                  <button onClick={load} disabled={loading} className="btn btn-primary" style={{ padding: '10px', fontSize: 14, fontWeight: 600, width: '100%' }}>
                    {loading ? 'Вход...' : 'Войти'}
                  </button>
                  {msg && <div style={{ color: '#EF4444', fontSize: 12, textAlign: 'center' }}>{msg}</div>}
                </div>
              </div>
            </div>
          ) : (
            <button onClick={load} disabled={loading} className="btn btn-primary" style={{ padding: '12px 36px', fontSize: 15 }}>
            {loading ? 'Загрузка...' : 'Загрузить рабочий стол'}
          </button>
          )}
        </div>
      </div>
    );
  }

  // ── Shared data ──
  const rootOrders = orders.filter((o: any) => !o.group_id && !o.pool_id);
  const grpOrders = (gid: string) => orders.filter((o: any) => o.group_id === gid);
  const isDyn = (o: any) => !!o.exploded_at;

  const totalQty = orders.reduce((s: number, o: any) => s + parseFloat(o.quantity || '0'), 0);
  const dynCount = orders.filter(isDyn).length;
  const inProgress = orders.filter((o: any) => o.status === 'in_progress').length;
  const critical = orders.filter((o: any) => o.priority === 'high' || o.priority === 'critical').length;

  // ── Title ──
  const titles: Record<View, string> = {
    'dashboard': 'Рабочий стол',
    'projects': 'Проекты',
    'project-dashboard': selectedProject?.name || 'Проект',
    'project-orders': selectedProject ? `Заказы — ${selectedProject.name}` : 'Заказы',
    'project-gantt': selectedProject ? `Гант — ${selectedProject.name}` : 'Диаграмма Ганта',
    'project-pools': selectedProject ? `Пулы — ${selectedProject.name}` : 'Пулы',
    'project-groups': selectedProject ? `Группы — ${selectedProject.name}` : 'Группы',

    'archive': 'Архив проектов',
    'directories': 'Справочники',
    'nomenclature': 'Номенклатура',
    'units': 'Единицы измерения',
    'counterparties': 'Контрагенты',
    'resources': 'Ресурсы',
    'work-schedules': 'Графики работы',
    'departments': 'Подразделения',
    'organizations': 'Организации',
    'production-calendars': 'Производственные календари',
    'ccm': 'CCM',
    'reports': 'Отчёты',
    'settings': 'Настройки',
    'new-project': 'Новый проект',
  };

  const projGroups = selectedProject ? (groups[selectedProject.id] || []) : [];
  const projPools = selectedProject ? (pools[selectedProject.id] || []) : [];

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: sidebarWidth + 'px 1fr', minHeight: '100vh', ['--sbw' as any]: sidebarWidth + 'px' }}
      onMouseMove={(e) => { if (menuMode === 'auto' && autoEnabled && sidebarCollapsed && e.clientX < 8) setSidebarCollapsed(false); }}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <Sidebar
        view={view}
        navTo={navTo}
        projects={projects}
        selectedProject={selectedProject}
        groups={groups}
        pools={pools}
        projectOrders={projectOrders}
        expandedOrders={expandedOrders}
        setExpandedOrders={setExpandedOrders}
        loadProjectDashboard={loadProjectDashboard}
        loadProjectOrdersView={loadProjectOrdersView}
        loadProjectGantt={loadProjectGantt}
        loadProjectPools={loadProjectPools}
        loadProjectGroups={loadProjectGroups}
        loadProjectOrders={loadProjectOrders}
        setCtxMenu={setCtxMenu}
        setSidebarCtx={setSidebarCtx}
        moveOrder={moveOrder}
        delGroup={(id, name) => runDeleteCheck('order_group', id, name)}
        delPool={(id, name) => runDeleteCheck('order_pool', id, name)}
        selectedPool={selectedPool}
        onSelectPool={(pool, project) => { if (pool) { setSelectedPool(pool); setSelectedProject(project); setView('project-pools'); setSelPoolOrders(new Set()); setSelFreeOrders(new Set()); setEditingPool(false); (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${project.id}`); const pr = await apiF<{ items: any[] }>(`/projects/${project.id}/pools`); setOrders(o); setPools(prev => ({ ...prev, [project.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })(); } else { setSelectedPool(null); setSelPoolOrders(new Set()); setSelFreeOrders(new Set()); setEditingPool(false); } }}
        selectedGroup={selectedGroup}
        onSelectGroup={(group, project) => { if (group) { setSelectedGroup(group); setSelectedProject(project); setView('project-groups'); setEditingGroup(false); (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${project.id}`); const gs = await apiF<{ items: any[] }>(`/projects/${project.id}/groups`); const pr = await apiF<{ items: any[] }>(`/projects/${project.id}/pools`); setOrders(o); setGroups(prev => ({ ...prev, [project.id]: gs.items })); setPools(prev => ({ ...prev, [project.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })(); } else { setSelectedGroup(null); setEditingGroup(false); } }}
        onOpenOrder={openOrderPanel}
        onOpenGroup={openGroupEditor}
        onOpenPool={openPoolEditor}
        setDirectoryModal={setDirectoryModal}
        setSelectedProject={setSelectedProject}
        setView={setView}
        collapsed={effCollapsed}
        menuMode={menuMode}
        onAutoHide={() => { if (autoEnabled) setSidebarCollapsed(true); }}
        debug={debugMode}
      />

      {/* ═══ MAIN ═══ */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', minWidth: 0, gridColumn: 2 }}>
        {/* Topbar */}
        <div className="topbar" style={menuMode === 'auto' ? { paddingLeft: effCollapsed ? 52 : 8, transition: 'padding-left .22s ease' } : undefined}>
          {debugMode && <DebugBadge debug={debugMode} text="[area:header]" />}
          {menuMode !== 'expanded' && (
            <button
              onClick={() => {
                if (menuMode === 'auto') {
                  setAutoEnabled(prev => { const next = !prev; setSidebarCollapsed(next); return next; });
                } else {
                  setSidebarCollapsed(c => !c);
                }
              }}
              title={menuMode === 'auto' ? (autoEnabled ? 'Закрепить меню (выключить авто-скрытие)' : 'Включить авто-скрытие') : (sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню в значки')}
              style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #2A4060', background: '#0B1B33', color: '#8FA3BD', cursor: 'pointer', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 4, ...(menuMode === 'auto' ? { position: 'fixed', left: effCollapsed ? 8 : 272, top: 14, zIndex: 3500, marginRight: 0, transition: 'left .22s ease' } : {}) }}
            >⟨</button>
          )}
          <div>
            <h1>{titles[view]}</h1>
            {view === 'project-dashboard' && <div className="tb-sub">{msg}</div>}
            {view === 'project-orders' && <div className="tb-sub">{msg}</div>}
            {view === 'project-groups' && <div className="tb-sub">{msg}</div>}
            {view === 'project-pools' && <div className="tb-sub">{msg}</div>}
            {view === 'projects' && <div className="tb-sub">{projects.length} проектов</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {view === 'project-dashboard' && (
              <>
                <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
              {newGroupInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewGroupInput(false);else if(e.key==='Enter')addGroup()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addGroup} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewGroupInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
              </>
            )}
            {view === 'project-orders' && (
              <>
                <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
              {newGroupInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewGroupInput(false);else if(e.key==='Enter')addGroup()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addGroup} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewGroupInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
              </>
            )}
            {view === 'project-groups' && panelMode === 'window' && !selectedGroup && (
              <>
                <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
              {newGroupInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewGroupInput(false);else if(e.key==='Enter')addGroup()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addGroup} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewGroupInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
              </>
            )}
            {view === 'project-pools' && panelMode === 'window' && !selectedPool && (
              <>
                <button onClick={addPool} className="btn btn-primary btn-sm">+ Пул</button>
              {newPoolInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newPoolName} onChange={e=>setNewPoolName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewPoolInput(false);else if(e.key==='Enter')addPool()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addPool} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewPoolInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
              </>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => navTo('new-project')}>+ Новый проект</button>
            <button onClick={onRefresh} className="btn btn-secondary btn-sm" title="Обновить данные" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg></button>
          </div>
        </div>

        <div style={{ padding: '20px 28px 48px', flex: 1, overflow: 'auto' }} data-module={`area:content:${view}`}>{debugMode && <DebugBadge debug={debugMode} corner text={`[area:content:${view}]`} />}
          {/* ═══ DASHBOARD ═══ */}
          {view === 'dashboard' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="kpi-card" data-module="dash:metric:projects">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:projects]" copy="[dash:metric:projects] «Всего проектов»" />}<div className="kpi-label">Всего проектов</div><div className="kpi-val">{projects.length}</div><div className="kpi-sub">активных: {projects.filter((p: any) => p.status === 'active').length}</div></div>
                <div className="kpi-card" data-module="dash:metric:orders">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:orders]" copy="[dash:metric:orders] «Заказов»" />}<div className="kpi-label">Заказов</div><div className="kpi-val g">{orders.length || '—'}</div><div className="kpi-sub">выберите проект</div></div>
                <div className="kpi-card" data-module="dash:metric:dyn">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:dyn]" copy="[dash:metric:dyn] «Динамических»" />}<div className="kpi-label">Динамических</div><div className="kpi-val g">{dynCount || '—'}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
                <div className="kpi-card" data-module="dash:metric:work">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:work]" copy="[dash:metric:work] «В работе»" />}<div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress || '—'}</div><div className="kpi-sub">активных заказов</div></div>
                <div className="kpi-card" data-module="dash:metric:priority">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:priority]" copy="[dash:metric:priority] «Приоритетных»" />}<div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical || '—'}</div><div className="kpi-sub">High + Critical</div></div>
              </div>
              <div className="panel">
                <div className="panel-hdr"><span className="panel-title">Последние проекты</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {projects.slice(0, 4).map((p: any, pi: number) => (
                    <div key={p.id} className="proj-card" data-module="dash:card:project" onClick={() => loadProjectDashboard(p)}>{debugMode && <DebugBadge debug={debugMode} corner text={`[dash:card:project #${pi + 1}]`} />}
                      <div className="pc-name">{p.name}</div>
                      <div className="pc-meta">{p.status} · {p.mode || 'cpm'} · {new Date(p.created_at).toLocaleDateString('ru')}</div>
                      <div className="pc-actions">
                        <span className="badge">{p.status === 'draft' ? 'Черновик' : p.status === 'active' ? 'Активный' : p.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ═══ PROJECTS ═══ */}
          {view === 'projects' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              <div onClick={() => navTo('new-project')} style={{ border: '1.5px dashed #3B82F6', borderRadius: 12, background: 'rgba(59,130,246,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 150, cursor: 'pointer', transition: 'all 0.15s' }}>
                <div style={{ fontSize: 34, color: '#3B82F6', lineHeight: 1, fontWeight: 300 }}>+</div>
                <div style={{ fontWeight: 600, color: '#60A5FA', fontSize: 14 }}>Новый проект</div>
              </div>
              {projects.filter((p: any) => p.status !== 'archived').map((p: any, pi: number) => (
                <div key={p.id} className="proj-card" data-module="dash:card:project">{debugMode && <DebugBadge debug={debugMode} corner text={`[dash:card:project #${pi + 1}]`} />}
                  <div className="pc-name">📁 {p.name}</div>
                  <div className="pc-meta">{p.status} · {p.mode || 'cpm'} · {new Date(p.created_at).toLocaleDateString('ru')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => loadProjectDashboard(p)}>Открыть</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setImportProjectId(p.id)}>📥 Импорт</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedProject(p); setView('settings'); }}>⚙️</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteProject(p)}>🗑</button>
                  </div>
                </div>
              ))}
              {projects.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: '#5A7090' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Нет проектов</div>
                  <div>Создайте первый проект, чтобы начать планирование</div>
                  <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navTo('new-project')}>+ Новый проект</button>
                </div>
              )}
            </div>
          )}

          {/* ═══ ARCHIVE ═══ */}
          {view === 'archive' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {projects.filter((p: any) => p.status === 'archived').length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: '#5A7090' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Архив пуст</div>
                  <div>Архивированные проекты появятся здесь</div>
                </div>
              )}
              {projects.filter((p: any) => p.status === 'archived').map((p: any, pi: number) => (
                <div key={p.id} className="proj-card" style={{ opacity: 0.7 }} data-module="dash:card:project">{debugMode && <DebugBadge debug={debugMode} corner text={`[dash:card:project #${pi + 1}]`} />}
                  <div className="pc-name">📦 {p.name}</div>
                  <div className="pc-meta">архив · {p.mode || 'cpm'} · {new Date(p.created_at).toLocaleDateString('ru')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { apiF(`/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }).then(() => load()); }}>📂 Восстановить</button>
                    <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.05)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, fontSize: 12, padding: '3px 8px', cursor: 'pointer' }} onClick={() => deleteProject(p)}>🗑 Удалить</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ═══ PROJECT DASHBOARD ═══ */}
          {view === 'project-dashboard' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="kpi-card" data-module="dash:metric:orders">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:orders]" copy="[dash:metric:orders] «Всего заказов»" />}<div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
                <div className="kpi-card" data-module="dash:metric:dyn">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:dyn]" copy="[dash:metric:dyn] «Динамические»" />}<div className="kpi-label">Динамические</div><div className="kpi-val g">{dynCount}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
                <div className="kpi-card" data-module="dash:metric:work">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:work]" copy="[dash:metric:work] «В работе»" />}<div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress}</div><div className="kpi-sub">{inProgress > 0 ? 'Активных' : 'Нет'}</div></div>
                <div className="kpi-card" data-module="dash:metric:priority">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:priority]" copy="[dash:metric:priority] «Приоритетных»" />}<div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical}</div><div className="kpi-sub">High + Critical</div></div>
                <div className="kpi-card" data-module="dash:metric:groups">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:groups]" copy="[dash:metric:groups] «Групп / Пулов»" />}<div className="kpi-label">Групп / Пулов</div><div className="kpi-val">{projGroups.length + projPools.length}</div><div className="kpi-sub">{projGroups.length} гр. · {projPools.length} пул.</div></div>
              </div>

              {projGroups.length > 0 && projGroups.map((g: any) => {
                const gOrds = grpOrders(g.id);
                return (
                  <div key={g.id} className="group-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: gOrds.length > 0 ? 12 : 0 }}>
                      <div><span style={{ fontWeight: 600, fontSize: 15 }}>📁 {g.name}</span><span className="t-mono" style={{ marginLeft: 10, fontSize: 12 }}>{gOrds.length} заказов</span></div>
                      <button onClick={() => delGroup(g.id, g.name)} className="btn btn-danger btn-sm">🗑</button>
                    </div>
                    {gOrds.length > 0 && (
                      <table className="tbl"><thead><tr><th className="t-graph">Граф</th><th>ID</th><th>Продукт</th><th>Клиент</th><th>Кол-во</th><th>Приор.</th><th>Статус</th><th>Старт</th><th>Финиш</th><th style={{ width: 40 }}></th></tr></thead>
                        <tbody>{gOrds.map((o: any) => (
                          <tr key={o.id}>
                            <td className="t-graph"><span className={isDyn(o) ? 'g-dyn' : 'g-pln'}>{isDyn(o) ? '⚡' : '○'}</span></td>
                            <td className="t-mono">{o.ext_id || '—'}</td><td className="t-name">{o.specification_name || o.ext_id || '—'}</td>
                            <td>{o.client || '—'}</td><td className="t-mono">{o.quantity} {o.unit}</td>
                            <td><span className={`badge ${o.priority}`}>{o.priority === 'high' ? 'Выс.' : 'Обыч.'}</span></td>
                            <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черн.' : o.status}</span></td>
                            <td className="t-mono">{o.start_date || '—'}</td><td className="t-mono">{o.due_date || '—'}</td>
                            <td><button onClick={() => deleteOrder(o.id, o.specification_name || ('#' + o.id.slice(0,8)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.5, padding: '2px 4px' }}>🗑</button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    )}
                  </div>
                );
              })}

              {projGroups.length === 0 && (
                <div className="panel" style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Нет групп</div>
                  <div>Нажмите «+ Группа» или перейдите в «📋 Заказы» для управления заказами</div>
                </div>
              )}
            </>
          )}

          {/* ═══ PROJECT ORDERS ═══ */}
          {view === 'project-orders' && (panelMode === 'window' ? <div ref={dashHeadRef}>{renderSectionDashboard()}</div> : renderOrdersView())}

          {/* ═══ PROJECT GANTT ═══ */}
          {view === 'project-gantt' && (
            <div className="panel">
              <div className="panel-hdr">
                <div><span className="panel-title">📊 Диаграмма Ганта</span><span className="panel-sub">{selectedProject?.name}</span></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 11, color: '#8FA3BD', display: 'inline-flex', alignItems: 'center' }}>Старт:
                    <input type="date" value={(ganttData?.anchor || selectedProject?.start_date || '').slice(0, 10)} onChange={e => setProjectStartDate(e.target.value)} style={{ marginLeft: 6, background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E8EEF5', padding: '3px 6px', fontSize: 12 }} />
                  </label>
                  {ganttData?.project_finish_date && <span style={{ fontSize: 11, color: '#8FA3BD' }}>→ финиш <span style={{ color: '#10B981', fontWeight: 600 }}>{ganttData.project_finish_date.slice(8, 10)}.{ganttData.project_finish_date.slice(5, 7)}.{ganttData.project_finish_date.slice(0, 4)}</span></span>}
                  {ganttData && <span style={{ fontSize: 11, color: '#5A7090' }}>{ganttData.total_duration_days} раб. дн.</span>}
                  <button onClick={() => loadProjectGantt(selectedProject)} className="btn btn-secondary btn-sm">🔄 Обновить</button>
                  <button onClick={() => loadProjectOrdersView(selectedProject)} className="btn btn-secondary btn-sm">📋 К заказам</button>
                </div>
              </div>
              {(() => {
                const allOrders = projectOrders[selectedProject?.id || ''] || [];
                if (!allOrders.length) return null;
                const byId = new Map(allOrders.map((x: any) => [x.id, x]));
                const childrenMap = new Map<string, any[]>();
                const roots: any[] = [];
                for (const o of allOrders) {
                  const pid = o.parent_order_id;
                  if (pid && byId.has(pid)) {
                    const arr = childrenMap.get(pid) || [];
                    arr.push(o);
                    childrenMap.set(pid, arr);
                  } else roots.push(o);
                }
                const CHAIN_COLORS = ['#10B981', '#A78BFA', '#F59E0B', '#EC4899', '#14B8A6', '#F97316'];
                const colorOf = new Map<string, string>();
                let ci = 0;
                for (const r of roots) {
                  const col = CHAIN_COLORS[ci % CHAIN_COLORS.length];
                  ci++;
                  colorOf.set(r.id, col);
                  const stack = [...(childrenMap.get(r.id) || [])];
                  while (stack.length) {
                    const c = stack.pop()!;
                    colorOf.set(c.id, col);
                    stack.push(...(childrenMap.get(c.id) || []));
                  }
                }
                const renderChain = (o: any, depth: number) => {
                  const kids = childrenMap.get(o.id) || [];
                  const col = colorOf.get(o.id) || '#3B82F6';
                  return (
                    <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: depth * 18, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: col, flex: '0 0 8px' }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#E8EEF5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.ext_id || '—'}</span>
                        <span style={{ fontSize: 10.5, color: '#8FA3BD', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.specification_name}</span>
                        {kids.length > 0 && <span style={{ fontSize: 10, color: col, fontWeight: 600 }}>· {kids.length}</span>}
                      </div>
                      {kids.length > 0 && <div style={{ display: 'flex', flexDirection: 'column' }}>{kids.map((k) => renderChain(k, depth + 1))}</div>}
                    </div>
                  );
                };
                return (
                  <div style={{ marginBottom: 14, padding: 12, background: 'rgba(59,130,246,.04)', border: '1px solid #1E3252', borderRadius: 10 }}>
                    <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#5A7090', fontWeight: 600, marginBottom: 8 }}>
                      ⛓ Цепочки заказов проекта
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
                      {roots.map((r) => (
                        <div key={'ch' + r.id} style={{ background: '#0F1E36', border: '1px solid #1E3252', borderRadius: 8, padding: 10 }}>
                          {renderChain(r, 0)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {ganttLoading && <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>Загрузка данных CPM...</div>}
              {!ganttLoading && !ganttData && <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>Нет данных. Запустите CPM-расчёт для проекта.</div>}
              {!ganttLoading && ganttData && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead><tr>
                      <th style={{ width: 280 }}>Операция</th>
                      <th style={{ width: 70 }}>Длит. (дн)</th>
                      <th style={{ width: 105 }}>Старт</th>
                      <th style={{ width: 105 }}>Финиш</th>
                      <th style={{ width: 105 }}>Поздн. старт</th>
                      <th style={{ width: 105 }}>Поздн. финиш</th>
                      <th style={{ width: 72 }}>Резерв</th>
                      <th style={{ minWidth: 300 }}>График</th>
                    </tr></thead>
                    <tbody>
                      {(ganttData.nodes || []).map((n: any) => {
                        const totalDur = ganttData.total_duration_days || ganttData.nodes?.reduce((m: number, x: any) => Math.max(m, x.late_finish_day || x.early_finish_day || 0), 1) || 1;
                        const es = n.early_start_day ?? 0;
                        const ef = n.early_finish_day ?? 0;
                        const dur = n.duration_days || (ef - es) || 0.01;
                        const leftPct = (es / totalDur) * 100;
                        const widthPct = Math.max((dur / totalDur) * 100, 1);
                        const isCritical = n.is_critical === true || n.total_float_days === 0;
                        const tf = n.total_float_days ?? 0;
                        const fmt = (d: string) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—';
                        return (
                          <tr key={n.id}>
                            <td style={{ color: isCritical ? '#f87171' : '#E8EEF5', fontWeight: isCritical ? 600 : 400 }}>
                              {isCritical ? '🔴 ' : ''}{n.name}
                            </td>
                            <td className="t-mono">{Number(dur).toFixed(1)}</td>
                            <td className="t-mono">{fmt(n.early_start_date)}</td>
                            <td className="t-mono">{fmt(n.early_finish_date)}</td>
                            <td className="t-mono">{fmt(n.late_start_date)}</td>
                            <td className="t-mono">{fmt(n.late_finish_date)}</td>
                            <td className="t-mono" style={{ color: tf === 0 ? '#10B981' : '#F59E0B' }}>{tf === 0 ? '0 (КП)' : Number(tf).toFixed(1)}</td>
                            <td>
                              <div style={{ position: 'relative', height: 22, background: '#0A1628', borderRadius: 4 }}>
                                <div style={{
                                  position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`,
                                  height: '100%', borderRadius: 4,
                                  background: isCritical ? 'linear-gradient(90deg, rgba(239,68,68,.4), rgba(239,68,68,.7))' : 'linear-gradient(90deg, rgba(59,130,246,.3), rgba(59,130,246,.6))',
                                  border: isCritical ? '1px solid rgba(239,68,68,.5)' : '1px solid rgba(59,130,246,.3)',
                                  display: 'flex', alignItems: 'center', paddingLeft: 6, fontSize: 10, color: '#E8EEF5',
                                  minWidth: `${widthPct > 3 ? 'auto' : '20px'}`, overflow: 'hidden'
                                }}>
                                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {n.name?.length > 28 ? n.name.slice(0, 26) + '…' : n.name}
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 16, display: 'flex', gap: 20, fontSize: 12, color: '#5A7090' }}>
                    <span>🔴 Критический путь</span>
                    <span>🔵 Некритические операции</span>
                    <span style={{ color: '#10B981' }}>Резерв = 0 — критическая</span>
                    <span style={{ color: '#F59E0B' }}>Резерв {'>'} 0 — есть запас</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ PROJECT GROUPS ═══ */}
          {view === 'project-groups' && !selectedGroup && (panelMode === 'window' ? (<div ref={dashHeadRef}>{renderSectionDashboard()}</div>) : (
            <>
              <div className="panel">
                <div className="panel-hdr">
                  <div><span className="panel-title">📁 Группы</span><span className="panel-sub">{selectedProject?.name}</span></div>
                  <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
              {newGroupInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewGroupInput(false);else if(e.key==='Enter')addGroup()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addGroup} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewGroupInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
                </div>
                {projGroups.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Групп нет</div>
                    <div>Создайте группу для логической организации заказов. Группа — просто папка, не влияет на расчёты.</div>
                  </div>
                )}
                {projGroups.map((g: any) => {
                  const grOrders = orders.filter((o: any) => o.group_id === g.id);
                  const grPools = projPools.filter((p: any) => p.group_id === g.id);
                  const grUnified = [
                    ...grPools.map((p: any) => ({ kind: 'pool', data: p })),
                    ...grOrders.map((o: any) => ({ kind: 'order', data: o })),
                  ];
                  return (
                    <div key={g.id} className="group-card" style={{ borderColor: 'rgba(59,130,246,.3)', background: 'rgba(59,130,246,.04)', cursor: 'pointer' }}
                      onClick={() => { setSelectedGroup(g); setEditingGroup(false); }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,.5)'; e.currentTarget.style.background = 'rgba(59,130,246,.08)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,.3)'; e.currentTarget.style.background = 'rgba(59,130,246,.04)'; }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: grUnified.length > 0 ? 12 : 0 }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>📁 {g.name}</span>
                          <span className="t-mono" style={{ marginLeft: 10, fontSize: 12 }}>{grOrders.length} заказов</span>
                          {grPools.length > 0 && <span className="t-mono" style={{ marginLeft: 8, fontSize: 12, color: '#A78BFA' }}>{grPools.length} пулов</span>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); delGroup(g.id, g.name); }} className="btn btn-danger btn-sm">🗑 Удалить группу</button>
                      </div>
                      {grUnified.length > 0 && (
                        <table className="tbl">
                          <thead><tr>
                            <th style={{ width: 50 }}>Тип</th><th>Название</th><th>Клиент</th><th>Кол-во</th><th>Приор.</th><th>Статус</th>
                            <th style={{ width: 40 }}></th>
                          </tr></thead>
                          <tbody>{grUnified.map(item => {
                            if (item.kind === 'pool') {
                              const p = item.data;
                              const pOrders = orders.filter((o: any) => o.pool_id === p.id);
                              return (
                                <tr key={'gp-' + p.id} style={{ background: 'rgba(139,92,246,.04)' }}>
                                  <td><span style={{ fontSize: 14 }}>📦</span></td>
                                  <td className="t-name" style={{ color: '#A78BFA', fontWeight: 600 }}>{p.name}</td>
                                  <td style={{ color: '#8B5CF6', fontSize: 11 }}>Пул</td>
                                  <td className="t-mono" style={{ color: '#A78BFA' }}>{pOrders.length}</td>
                                  <td></td>
                                  <td><span style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 500 }}>Пул</span></td>
                                  <td></td>
                                </tr>
                              );
                            }
                            const o = item.data;
                            return (
                              <tr key={o.id} draggable onDragStart={(e) => { e.dataTransfer.setData('orderId', o.id); e.dataTransfer.effectAllowed = 'move'; }} style={{ cursor: 'grab' }}>
                                <td><span style={{ fontSize: 14 }}>📋</span></td>
                                <td className="t-name">{o.specification_name || o.ext_id || '—'}</td>
                                <td>{o.client || '—'}</td>
                                <td className="t-mono">{o.quantity} {o.unit}</td>
                                <td><span className={`badge ${o.priority === 'critical' ? 'badge-red' : o.priority === 'high' ? 'badge-yellow' : 'badge-gray'}`}>{o.priority || 'normal'}</span></td>
                                <td><span className={`badge ${o.status === 'planned' ? 'badge-green' : o.status === 'draft' ? 'badge-gray' : 'badge-blue'}`}>{o.status || 'draft'}</span></td>
                                <td><button onClick={() => moveOrder(o.id, null, null)} className="btn btn-sm" style={{ padding: '2px 6px', fontSize: 10 }} title="Убрать из группы">↩</button></td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Свободные заказы */}
              {orders.filter((o: any) => !o.group_id && !o.pool_id).length > 0 && (
                <div className="panel" style={{ marginTop: 10 }}>
                  <div className="panel-hdr">
                    <span className="panel-title">📋 Свободные заказы</span>
                    <span className="panel-sub">Перетащите заказ в сайдбаре на группу</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl">
                      <thead><tr>
                        <th>ID</th><th>Продукт</th><th>Кол-во</th><th>Статус</th><th>Группа</th>
                      </tr></thead>
                      <tbody>{orders.filter((o: any) => !o.group_id && !o.pool_id).map((o: any) => (
                        <tr key={o.id} draggable onDragStart={(e) => { e.dataTransfer.setData('orderId', o.id); e.dataTransfer.effectAllowed = 'move'; }} style={{ cursor: 'grab' }}>
                          <td className="t-mono">{o.ext_id || '—'}</td>
                          <td className="t-name">{o.specification_name || o.ext_id || '—'}</td>
                          <td className="t-mono">{o.quantity} {o.unit}</td>
                          <td><span className={`badge ${o.status === 'planned' ? 'badge-green' : o.status === 'draft' ? 'badge-gray' : 'badge-blue'}`}>{o.status || 'draft'}</span></td>
                          <td className="t-mono">—</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ))}

          {/* ═══ PROJECT POOLS ═══ */}
          {view === 'project-pools' && !selectedPool && (panelMode === 'window' ? (<div ref={dashHeadRef}>{renderSectionDashboard()}</div>) : (
            <>
              {/* ── Dashboard KPI row ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="kpi-card" data-module="dash:metric:pools">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:pools]" copy="[dash:metric:pools] «Пулов»" />}<div className="kpi-label">Пулов</div><div className="kpi-val v">{projPools.length}</div><div className="kpi-sub">CCM-объединений</div></div>
                <div className="kpi-card" data-module="dash:metric:pooled">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:pooled]" copy="[dash:metric:pooled] «В пулах»" />}<div className="kpi-label">В пулах</div><div className="kpi-val g">{orders.filter((o: any) => !!o.pool_id).length}</div><div className="kpi-sub">заказов</div></div>
                <div className="kpi-card" data-module="dash:metric:free">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:free]" copy="[dash:metric:free] «Свободных»" />}<div className="kpi-label">Свободных</div><div className="kpi-val">{orders.filter((o: any) => !o.pool_id).length}</div><div className="kpi-sub">доступно</div></div>
                <div className="kpi-card" data-module="dash:metric:orders">{debugMode && <DebugBadge debug={debugMode} corner text="[dash:metric:orders]" copy="[dash:metric:orders] «Всего заказов»" />}<div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
              </div>

              {/* ── Pool cards grid ── */}
              <div className="panel">
                <div className="panel-hdr">
                  <div><span className="panel-title">📦 Пулы</span><span className="panel-sub" style={{ marginLeft: 8 }}>{selectedProject?.name}</span></div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {newPoolInput ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input value={newPoolName} onChange={e => setNewPoolName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') setNewPoolInput(false); else if (e.key === 'Enter') addPool(); }}
                          placeholder="Название" autoFocus
                          style={{ background: '#0A1628', border: '1px solid #3B82F6', borderRadius: 6, color: '#E8EEF5', padding: '4px 8px', fontSize: 12, width: 130, outline: 'none' }} />
                        <button onClick={addPool} className="btn btn-primary btn-sm" style={{ padding: '4px 8px', fontSize: 12 }}>✓</button>
                        <button onClick={() => setNewPoolInput(false)} className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', fontSize: 12 }}>✕</button>
                      </span>
                    ) : (
                      <button onClick={() => { setNewPoolInput(true); setNewPoolName(''); }} className="btn btn-primary btn-sm">+ Пул</button>
                    )}
                  </div>
                </div>
                {projPools.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Пулов нет</div>
                    <div>Создайте пул для CCM-объединения заказов с общими ресурсами.</div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                    {projPools.map((p: any) => {
                      const plOrders = orders.filter((o: any) => o.pool_id === p.id);
                      return (
                        <div key={p.id} onClick={() => { setSelectedPool(p); setSelPoolOrders(new Set()); setSelFreeOrders(new Set()); }}
                          style={{ cursor: 'pointer', borderRadius: 10, border: '1px solid rgba(139,92,246,.25)', background: 'rgba(139,92,246,.04)', padding: 16, transition: 'border-color .15s, background .15s' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; e.currentTarget.style.background = 'rgba(139,92,246,.08)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; e.currentTarget.style.background = 'rgba(139,92,246,.04)'; }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 15 }}>📦 {p.name}</div>
                              <div style={{ fontSize: 12, color: '#8FA3BD', marginTop: 4 }}>{plOrders.length} заказов</div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); delPool(p.id, p.name); }} className="btn btn-danger btn-sm" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}>🗑</button>
                          </div>
                          {plOrders.length > 0 && (
                            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {plOrders.slice(0, 5).map((o: any) => (
                                <span key={o.id} style={{ fontSize: 10, background: 'rgba(139,92,246,.1)', borderRadius: 4, padding: '2px 6px', color: '#B0C4DE' }}>{o.specification_name || o.ext_id || '—'}</span>
                              ))}
                              {plOrders.length > 5 && <span style={{ fontSize: 10, color: '#5A7090', padding: '2px 4px' }}>+{plOrders.length - 5}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ))}

          {/* ═══ POOL DETAIL — Dual-list ═══ */}
          {view === 'project-pools' && selectedPool && !editingPool && (() => {
            const poolOrders = orders.filter((o: any) => o.pool_id === selectedPool.id);
            return (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setSelectedPool(null); }} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>← К пулам</button>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>📦 {selectedPool.name}</span>
                  <span className="t-mono" style={{ marginLeft: 10, fontSize: 12, color: '#8FA3BD' }}>{poolOrders.length} заказов</span>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => { delPool(selectedPool.id, selectedPool.name); setSelectedPool(null); }} className="btn btn-danger btn-sm">🗑 Удалить пул</button>
                <button onClick={() => setEditingPool(true)} style={{ background: 'var(--btn-primary-bg, #3B82F6)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>✏️ Изменить</button>
              </div>
              <div className="panel" style={{ overflow: 'hidden' }}>
                <div className="panel-hdr">
                  <div><span className="panel-title">📦 Состав пула</span><span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{poolOrders.length}</span></div>
                </div>
                {poolOrders.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 60, color: '#5A7090', fontSize: 13 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
                    <div>Пул пуст. Нажмите «Изменить» чтобы добавить заказы.</div>
                  </div>
                ) : (
                  <table className="tbl">
                    <thead><tr>
                      <th style={{ width: 30 }}></th>
                      <th>Заказ</th><th>Клиент</th><th style={{ width: 80 }}>Кол-во</th><th style={{ width: 80 }}>Статус</th>
                    </tr></thead>
                    <tbody>
                      {poolOrders.map((o: any) => {
                        const bomOpen = expandedBomOrder === o.id;
                        return (
                        <Fragment key={o.id}>
                        <tr>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleBomOrder(o); }}
                              title={bomOpen ? 'Свернуть BOM' : 'Показать BOM'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: bomOpen ? '#60A5FA' : '#5A7090', fontSize: 14, padding: '2px 6px', transition: 'color .15s' }}
                              onMouseEnter={e => (e.currentTarget.style.color = '#60A5FA')}
                              onMouseLeave={e => (e.currentTarget.style.color = bomOpen ? '#60A5FA' : '#5A7090')}
                            >{bomOpen ? '▾' : '▸'}</button>
                          </td>
                          <td className="t-name" style={{ color: '#A78BFA' }}>{o.specification_name || o.ext_id || '—'}</td>
                          <td style={{ color: '#A78BFA' }}>{o.client || '—'}</td>
                          <td className="t-mono">{o.quantity} {o.unit}</td>
                          <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черн.' : o.status === 'planned' ? 'План' : 'Раб.'}</span></td>
                        </tr>
                        {bomOpen && (
                          <tr>
                            <td colSpan={5} style={{ background: '#0F1E36', padding: 0 }}>
                              <div style={{ padding: '12px 18px', borderTop: '1px solid #1E3252' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#B0C4DE', letterSpacing: '.02em' }}>BOM · {o.specification_name || o.ext_id || '—'}</span>
                                  {bomLoading[selectedProject?.id || ''] && <span style={{ fontSize: 11, color: '#F59E0B' }}>загрузка…</span>}
                                  <span style={{ fontSize: 11, color: '#5A7090' }}>структура изделия</span>
                                  <button onClick={() => openBomModal(o)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Развернуть полностью ↗</button>
                                </div>
                                <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} onOrderFocus={focusOrderByBom} />
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>);
          })()}

          {view === 'project-pools' && selectedPool && editingPool && (
            <PoolEditor
              pool={selectedPool}
              debug={debugMode}
              orders={orders}
              onClose={() => setEditingPool(false)}
              onRefresh={() => { (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`); const pr = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`); setOrders(o); setPools(prev => ({ ...prev, [selectedProject.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })(); }}
              onMoveOrders={(orderIds, poolId) => moveOrdersChecked(orderIds, null, poolId)}
            />
          )}

                    {/* ═══ GROUP DETAIL ═══ */}
          {view === 'project-groups' && selectedGroup && !editingGroup && (() => {
            const gOrders = orders.filter((o: any) => o.group_id === selectedGroup.id);
            const gPools = projPools.filter((p: any) => p.group_id === selectedGroup.id);
            // Unified list: pools + orders sorted by start_date
            const unified = [
              ...gPools.map((p: any) => ({ kind: 'pool', id: p.id, data: p, sortKey: p.created_at || '' })),
              ...gOrders.map((o: any) => ({ kind: 'order', id: o.id, data: o, sortKey: o.planned_start || o.created_at || '' })),
            ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
            return (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setSelectedGroup(null); }} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>← К группам</button>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>📁 {selectedGroup.name}</span>
                  <span className="t-mono" style={{ marginLeft: 10, fontSize: 12, color: '#8FA3BD' }}>{gOrders.length + gPools.length} элементов</span>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => { runDeleteCheck('order_group', selectedGroup.id, selectedGroup.name); setSelectedGroup(null); }} className="btn btn-danger btn-sm">🗑 Удалить</button>
                <button onClick={() => setEditingGroup(true)} style={{ background: 'var(--btn-primary-bg, #3B82F6)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>✏️ Изменить</button>
              </div>
              <div className="panel" style={{ overflow: 'hidden' }}>
                <div className="panel-hdr">
                  <div><span className="panel-title">📁 Состав группы</span><span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{unified.length}</span></div>
                </div>
                {unified.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 60, color: '#5A7090', fontSize: 13 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
                    <div>Группа пуста. Нажмите «Изменить» чтобы добавить заказы и пулы.</div>
                  </div>
                ) : (
                  <table className="tbl">
                    <thead><tr>
                      <th style={{ width: 30 }}></th>
                      <th style={{ width: 60 }}>Тип</th>
                      <th>Название</th>
                      <th style={{ width: 100 }}>Кол-во / Заказов</th>
                      <th style={{ width: 80 }}>Статус</th>
                    </tr></thead>
                    <tbody>
                      {unified.map(item => {
                        if (item.kind === 'pool') {
                          const p = item.data;
                          const pOrders = orders.filter((o: any) => o.pool_id === p.id);
                          const poolExpanded = expandedGroupPool === p.id;
                          return (
                            <Fragment key={'gp-' + p.id}>
                            <tr style={{ background: 'rgba(139,92,246,.04)' }}>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExpandedGroupPool(poolExpanded ? null : p.id); }}
                                  title={poolExpanded ? 'Свернуть пул' : 'Развернуть пул'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: poolExpanded ? '#A78BFA' : '#7C6BAF', fontSize: 14, padding: '2px 6px', transition: 'color .15s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#A78BFA')}
                                  onMouseLeave={e => (e.currentTarget.style.color = poolExpanded ? '#A78BFA' : '#7C6BAF')}
                                >{poolExpanded ? '▾' : '▸'}</button>
                              </td>
                              <td><span style={{ fontSize: 16 }}>📦</span></td>
                              <td className="t-name" style={{ color: '#A78BFA', fontWeight: 600 }}>{p.name}</td>
                              <td className="t-mono" style={{ color: '#A78BFA' }}>{pOrders.length}</td>
                              <td><span style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 500 }}>Пул</span></td>
                            </tr>
                            {poolExpanded && pOrders.map((o: any) => {
                              const bomOpen = expandedBomOrder === o.id;
                              return (
                                <Fragment key={'gpo-' + o.id}>
                                <tr style={{ background: 'rgba(139,92,246,.02)' }}>
                                  <td style={{ textAlign: 'center' }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleBomOrder(o); }}
                                      title={bomOpen ? 'Свернуть BOM' : 'Показать BOM'}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: bomOpen ? '#60A5FA' : '#5A7090', fontSize: 14, padding: '2px 6px', transition: 'color .15s' }}
                                      onMouseEnter={e => (e.currentTarget.style.color = '#60A5FA')}
                                      onMouseLeave={e => (e.currentTarget.style.color = bomOpen ? '#60A5FA' : '#5A7090')}
                                    >{bomOpen ? '▾' : '▸'}</button>
                                  </td>
                                  <td><span style={{ fontSize: 14, opacity: 0.5 }}>📋</span></td>
                                  <td className="t-name" style={{ paddingLeft: 20, color: '#A78BFA' }}>{o.specification_name || o.ext_id || '—'}</td>
                                  <td className="t-mono">{o.quantity} {o.unit}</td>
                                  <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черн.' : o.status === 'planned' ? 'План' : 'Раб.'}</span></td>
                                </tr>
                                {bomOpen && (
                                  <tr>
                                    <td colSpan={5} style={{ background: '#0F1E36', padding: 0 }}>
                                      <div style={{ padding: '12px 18px', borderTop: '1px solid #1E3252' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: '#B0C4DE', letterSpacing: '.02em' }}>BOM · {o.specification_name || o.ext_id || '—'}</span>
                                          {bomLoading[selectedProject?.id || ''] && <span style={{ fontSize: 11, color: '#F59E0B' }}>загрузка…</span>}
                                          <span style={{ fontSize: 11, color: '#5A7090' }}>структура изделия</span>
                                          <button onClick={() => openBomModal(o)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Развернуть полностью ↗</button>
                                        </div>
                                        <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} onOrderFocus={focusOrderByBom} />
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                              );
                            })}
                            </Fragment>
                          );
                        } else {
                          const o = item.data;
                          const bomOpen = expandedBomOrder === o.id;
                          return (
                            <Fragment key={'go-' + o.id}>
                            <tr>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleBomOrder(o); }}
                                  title={bomOpen ? 'Свернуть BOM' : 'Показать BOM'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: bomOpen ? '#60A5FA' : '#5A7090', fontSize: 14, padding: '2px 6px', transition: 'color .15s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#60A5FA')}
                                  onMouseLeave={e => (e.currentTarget.style.color = bomOpen ? '#60A5FA' : '#5A7090')}
                                >{bomOpen ? '▾' : '▸'}</button>
                              </td>
                              <td><span style={{ fontSize: 14 }}>📋</span></td>
                              <td className="t-name" style={o.pool_id ? { color: '#A78BFA' } : undefined}>{o.specification_name || o.ext_id || '—'}</td>
                              <td className="t-mono">{o.quantity} {o.unit}</td>
                              <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черн.' : o.status === 'planned' ? 'План' : 'Раб.'}</span></td>
                            </tr>
                            {bomOpen && (
                              <tr>
                                <td colSpan={5} style={{ background: '#0F1E36', padding: 0 }}>
                                  <div style={{ padding: '12px 18px', borderTop: '1px solid #1E3252' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                      <span style={{ fontSize: 12, fontWeight: 600, color: '#B0C4DE', letterSpacing: '.02em' }}>BOM · {o.specification_name || o.ext_id || '—'}</span>
                                      {bomLoading[selectedProject?.id || ''] && <span style={{ fontSize: 11, color: '#F59E0B' }}>загрузка…</span>}
                                      <span style={{ fontSize: 11, color: '#5A7090' }}>структура изделия</span>
                                      <button onClick={() => openBomModal(o)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Развернуть полностью ↗</button>
                                    </div>
                                    <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} onOrderFocus={focusOrderByBom} />
                                  </div>
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          );
                        }
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>);
          })()}

          {/* ═══ GROUP EDITOR ═══ */}
          {view === 'project-groups' && selectedGroup && editingGroup && (
            <GroupEditor
              group={selectedGroup}
              debug={debugMode}
              orders={orders}
              pools={projPools}
              onClose={() => setEditingGroup(false)}
              onRefresh={() => { (async () => { try { const [o, g] = await Promise.all([ apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`), apiF<{ items: any[] }>(`/projects/${selectedProject.id}/groups`), ]); setOrders(o); setGroups(prev => ({ ...prev, [selectedProject.id]: g.items })); const pr = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`); setPools(prev => ({ ...prev, [selectedProject.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })(); }}
              onMoveOrders={(orderIds, groupId) => moveOrdersChecked(orderIds, groupId, null)}
            />
          )}

{/* ═══ DIRECTORIES ═══ */}
          {view === 'directories' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
              {[
                { id: 'nomenclature', icon: '📦', title: 'Номенклатура', desc: 'Продукты, материалы, узлы' },
                { id: 'units', icon: '📏', title: 'Единицы измерения', desc: 'Шт, кг, м, л и другие' },
                { id: 'counterparties', icon: '👥', title: 'Контрагенты', desc: 'Клиенты, поставщики, подрядчики' },
                { id: 'resources', icon: '🔧', title: 'Ресурсы', desc: 'Станки, люди, бригады' },
                { id: 'departments', icon: '🏢', title: 'Подразделения', desc: 'Цеха, участки, отделы' },
                { id: 'organizations', icon: '🏭', title: 'Организации', desc: 'Клиенты, поставщики, юрлица' },
                { id: 'production-calendars', icon: '📅', title: 'Производственные календари', desc: 'Рабочие и праздничные дни по странам' },
                { id: 'work-schedules', icon: '🕒', title: 'Графики работы', desc: 'Смены, интервалы, перерывы' },
              ].map(d => (
                <div key={d.id} className="dir-card" onClick={() => ['work-schedules', 'production-calendars', 'resources'].includes(d.id) ? navTo(d.id as View) : setDirectoryModal(d.id)}>
                  <div className="dc-icon">{d.icon}</div>
                  <div className="dc-title">{d.title}</div>
                  <div className="dc-count">{d.desc}</div>
                </div>
              ))}
            </div>
          )}

          {/* ═══ DIRECTORY DETAIL ═══ */}
          {view === 'nomenclature' && (
            <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
              <div className="panel-hdr" style={{ marginBottom: 16 }}>
                <span className="panel-title" style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>📦 Номенклатура</span>
              </div>
              <DirectoryTable
                entity="nomenclature"
                apiBase="https://profyplan.ru/api"
                synonyms={NOMENCLATURE_SYNONYMS}
                columns={[
                  { key: 'name', label: 'Название', width: 240 },
                  { key: 'code', label: 'Код', width: 120 },
                  { key: 'article', label: 'Артикул', width: 150 },
                  { key: 'ntype', label: 'Тип', width: 130 },
                  { key: 'unit', label: 'Ед.', width: 70 },
                  { key: 'description', label: 'Описание' },
                ]}
              />
            </div>
          )}

          {view === 'units' && (
            <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
              <div className="panel-hdr" style={{ marginBottom: 16 }}>
                <span className="panel-title" style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>📏 Единицы измерения</span>
              </div>
              <DirectoryTable
                entity="units"
                apiBase="https://profyplan.ru/api"
                synonyms={UNIT_SYNONYMS}
                columns={[
                  { key: 'code', label: 'ОКЕИ', width: 80 },
                  { key: 'symbol_int', label: 'Межд.', width: 80 },
                  { key: 'symbol_ru', label: 'Символ', width: 80 },
                  { key: 'name_ru', label: 'Название', width: 160 },
                  { key: 'name_en', label: 'English', width: 160 },
                ]}
              />
            </div>
          )}

          {view === 'counterparties' && (
            <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
              <div className="panel-hdr" style={{ marginBottom: 16 }}>
                <span className="panel-title" style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>👥 Контрагенты</span>
              </div>
              <DirectoryTable
                entity="counterparties"
                apiBase="https://profyplan.ru/api"
                columns={DIR_COLUMNS.counterparties.columns}
              />
            </div>
          )}

          {view === 'work-schedules' && <WorkScheduleManager debug={debugMode} />}
          {view === 'production-calendars' && <ProductionCalendarManager debug={debugMode} />}

          {view === 'resources' && <ResourceManager projects={projects} windowMode={panelMode === 'window'} debug={debugMode} onOpenResEdit={(res) => win.openResEdit(res)} />}

          {['departments', 'organizations'].includes(view) && (
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">{titles[view]}</span></div>
              <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Раздел в разработке</div>
                <div>Здесь будет таблица с CRUD: создание, редактирование, удаление, импорт, экспорт</div>
              </div>
            </div>
          )}

          {/* ═══ NEW PROJECT ═══ */}
          {view === 'new-project' && (
            <NewProjectWizard onBack={() => navTo('projects')} onCreated={() => { load().then(() => navTo('projects')); }} />
          )}

          {/* ═══ SETTINGS ═══ */}
          {view === 'settings' && !selectedProject && (
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">Настройки Рабочего стола</span></div>
              <div style={{ display: 'grid', gap: 20, maxWidth: 640 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🔗 Контроль цепочки заказов</div>
                  <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                    При переносе заказа в пул или группу система может предупреждать о связанных заказах (родительских и дочерних — весь «куст»).
                  </div>
                  {([
                    { v: 'control', icon: '🔒', title: 'Контроль', desc: 'Перенос только всем кустом целиком. Вариант один: перенести весь куст или отменить.' },
                    { v: 'warning', icon: '⚠️', title: 'Предупреждение', desc: 'Показывать куст с выбором: перенести весь куст или только текущий заказ.' },
                    { v: 'off', icon: '🚫', title: 'Выключен', desc: 'Не предупреждать — переносить как раньше.' },
                  ] as const).map(opt => (
                    <label key={opt.v} style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px',
                      borderRadius: 9, border: `1px solid ${orderChainControl === opt.v ? 'rgba(59,130,246,.5)' : '#1E3252'}`,
                      background: orderChainControl === opt.v ? 'rgba(59,130,246,.08)' : '#0A1628',
                      cursor: 'pointer', marginBottom: 8,
                    }}>
                      <input type="radio" name="chain-control" checked={orderChainControl === opt.v} onChange={() => setChainControl(opt.v)} style={{ marginTop: 3, accentColor: '#3B82F6' }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.icon} {opt.title}</div>
                        <div style={{ fontSize: 12, color: '#8FA3BD', marginTop: 2, lineHeight: 1.45 }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                  <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 8, lineHeight: 1.5, background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.15)', borderRadius: 8, padding: '10px 12px' }}>
                    💡 Связанные заказы — это те, что связаны через поле «Код заказа» в BOM или «Код заказа родителя». При переносе куста связанные заказы отвязываются от своих прежних групп/пулов, и расчёты по ним (включая расчёты пулов) аннулируются.
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🏭 Полуфабрикаты в цепочке</div>
                  <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                    Правило: узел-полуфабрикат должен иметь маршрут (операции) и заказ-производитель. Здесь выбирается, может ли полуфабрикат изготавливаться в рамках своего же заказа или для каждого нужен отдельный подчинённый заказ.
                  </div>
                  {([
                    { v: 'strict', icon: '🔒', title: 'Строго — всегда отдельный заказ', desc: 'Каждый полуфабрикат производится отдельным подчинённым заказом. Полуфабрикат «внутри своего заказа» — аномалия, система предложит создать заказ.' },
                    { v: 'flexible', icon: '⚙️', title: 'Гибко — можно в рамках заказа', desc: 'Разрешён полуфабрикат, изготавливаемый внутри своего заказа. Аномалиями считаются только отсутствие маршрута и отсутствие привязки к заказу.' },
                  ] as const).map(opt => (
                    <label key={opt.v} style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px',
                      borderRadius: 9, border: `1px solid ${semiPolicy === opt.v ? 'rgba(59,130,246,.5)' : '#1E3252'}`, background: semiPolicy === opt.v ? 'rgba(59,130,246,.08)' : '#0A1628',
                      cursor: 'pointer', marginBottom: 8,
                    }}>
                      <input type="radio" name="semi-policy" checked={semiPolicy === opt.v} onChange={() => setSemiPolicyMode(opt.v)} style={{ marginTop: 3, accentColor: '#3B82F6' }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.icon} {opt.title}</div>
                        <div style={{ fontSize: 12, color: '#8FA3BD', marginTop: 2, lineHeight: 1.45 }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                  <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 8, lineHeight: 1.5, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)', borderRadius: 8, padding: '10px 12px' }}>
                    ⚠ Проверка выполняется при открытии BOM заказа: полуфабрикаты без маршрута и без подчинённого заказа подсвечиваются, создание заказа — одним кликом. Полуфабрикаты-«фантомы» (прозрачные узлы) исключены из проверки.
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🗂 Интерфейс работы со списками</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      Как открываются заказы, справочники и редакторы: встроенно, модально или в отдельных окнах.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {([['side', 'Встроенно'], ['modal', 'Модально'], ['window', 'Окна (MDI)']] as const).map((kv) => (
                        <button key={kv[0]} onClick={() => setPanelMode(kv[0])} style={{ flex: 1, border: '1px solid ' + (panelMode === kv[0] ? 'rgba(59,130,246,.6)' : '#1E3252'), background: panelMode === kv[0] ? 'rgba(59,130,246,.14)' : '#0A1628', color: panelMode === kv[0] ? '#fff' : '#8FA3BD', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{kv[1]}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6, lineHeight: 1.45 }}>
                      {panelMode === 'window' ? 'Окна (MDI): заказы, справочники и редакторы открываются отдельными окнами — перетаскивание, прилипание к краям (Snap), сетка раскладок «⛶», панель задач внизу.' : panelMode === 'modal' ? 'Модально — заказы и справочники открываются поверх списка, закрытие по ✕ или Esc.' : 'Встроенно — заказ открывается в панели справа от списка, справочники и редакторы — inline поверх списка.'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🧪 Режим отладки</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      Показывать технические идентификаторы в заголовках окон и форм — чтобы было удобно описывать их в сообщениях. Клик по идентификатору копирует его в буфер.
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={debugMode} onChange={e => setDebugModeFlag(e.target.checked)} style={{ accentColor: '#3B82F6' }} />
                      <span style={{ fontSize: 13 }}>Показывать технические идентификаторы</span>
                    </label>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6, lineHeight: 1.45 }}>
                      Идентификаторы вида [order:openWin #1]. Можно отключить в любой момент — интерфейс вернётся к обычному виду.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>☰ Меню</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      Как сворачивать левое меню.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {([['expanded', 'Развёрнуто'], ['manual', 'Вручную'], ['auto', 'Авто-скрытие']] as const).map((kv) => (
                        <button key={kv[0]} onClick={() => setMenuMode(kv[0])} style={{ flex: 1, border: '1px solid ' + (menuMode === kv[0] ? 'rgba(59,130,246,.6)' : '#1E3252'), background: menuMode === kv[0] ? 'rgba(59,130,246,.14)' : '#0A1628', color: menuMode === kv[0] ? '#fff' : '#8FA3BD', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{kv[1]}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6, lineHeight: 1.45 }}>
                      {menuMode === 'auto' ? 'Авто-скрытие: меню свёрнуто, при наведении мыши к левому краю — выплывает.' : menuMode === 'manual' ? 'Вручную: кнопка «⟨» в шапке сворачивает меню в значки и разворачивает обратно.' : 'Меню всегда развёрнуто, без кнопки скрытия.'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>📐 Прилипание к краям</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      При перетаскивании окна к краю рабочей области — подсвечивать зону прилипания (Snap) и раскладку.
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={win.snapEnabled} onChange={e => win.toggleSnap(e.target.checked)} style={{ accentColor: '#3B82F6' }} />
                      <span style={{ fontSize: 13 }}>Включить прилипание к краям</span>
                    </label>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6, lineHeight: 1.45 }}>
                      При выключении окна перетаскиваются свободно, без прилипания к краям и без раскладки Snap.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🌲 Дерево заказов</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      Что показывать под заказами в списке по умолчанию.
                    </div>
                    <select value={treeMode} onChange={e => setTreeMode(e.target.value as any)} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#B0C4DE', padding: '6px 10px', fontSize: 12.5, width: '100%' }}>
                      <option value="bom">Состав (BOM)</option>
                      <option value="both">Состав + Маршруты</option>
                      <option value="routes">Маршруты</option>
                    </select>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6 }}>Режим можно быстро переключать и в самом списке заказов.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'settings' && selectedProject && (
            <>
              <div className="panel">
                <div className="panel-hdr"><span className="panel-title">⚙️ Настройки проекта</span><span className="panel-sub">{selectedProject.name}</span></div>
                <div style={{ display: 'grid', gap: 16, maxWidth: 500 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: '#5A7090', marginBottom: 6 }}>Название</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input id="proj-name-input" defaultValue={selectedProject.name} style={{ flex: 1, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '8px 12px', fontSize: 14 }} onKeyDown={e => { if (e.key === 'Enter') renameProject(selectedProject, (e.target as HTMLInputElement).value); }} />
                      <button className="btn btn-primary btn-sm" onClick={() => renameProject(selectedProject, (document.getElementById('proj-name-input') as HTMLInputElement)?.value || '')}>Сохранить</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedProject.status === 'archived' ? '📦 В архиве' : '📁 Активный'}</div>
                        <div style={{ fontSize: 12, color: '#5A7090' }}>{selectedProject.status === 'archived' ? 'Проект скрыт из основных списков' : 'Проект отображается в списках'}</div>
                      </div>
                      <button className={selectedProject.status === 'archived' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} onClick={() => archiveProject(selectedProject)}>
                        {selectedProject.status === 'archived' ? 'Восстановить' : 'В архив'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>🧩 Этапы проекта</div>
                        <div style={{ fontSize: 12, color: '#5A7090' }}>Регистр этапов для группировки операций маршрутов</div>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={() => win.openDirWin('stages', '🧩 Этапы проекта', DIR_COLUMNS.stages.columns, undefined, undefined, undefined, {
                        endpoints: {
                          list: `https://profyplan.ru/api/v1/projects/${selectedProject.id}/stages/`,
                          create: `https://profyplan.ru/api/v1/projects/${selectedProject.id}/stages/`,
                          item: (id: string) => `https://profyplan.ru/api/v1/project-stages/${id}`,
                          method: 'PATCH' as const,
                        },
                      })}>Этапы</button>
                    </div>
                  </div>
                  <div style={{ paddingTop: 12, borderTop: '1px solid #1E3252' }}>
                    <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }} onClick={() => deleteProject(selectedProject)}>
                      🗑 Удалить проект
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => navTo('projects')}>← К проектам</button>
              </div>
            </>
          )}

          {/* ═══ DIRECTORY MODAL ═══ */}
          {directoryModal && (
            <>
              <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 9990, backdropFilter: 'blur(4px)' }} onClick={() => setDirectoryModal(null)} />
              <div style={{
                position: 'fixed', top: '5vh', left: '5vw', width: '90vw', height: '90vh', zIndex: 9991,
                background: 'linear-gradient(135deg, #0F1E36, #162844)', border: '1px solid #1E3252',
                borderRadius: 14, display: 'flex', flexDirection: 'column',
                boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
              }}>
                {/* Modal header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #1E3252' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{directoryModal === 'nomenclature' ? '📦' : directoryModal === 'units' ? '📏' : directoryModal === 'counterparties' ? '👥' : directoryModal === 'resources' ? '🔧' : directoryModal === 'departments' ? '🏢' : directoryModal === 'organizations' ? '🏭' : '📅'}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#E8EEF5' }}>
                      {directoryModal === 'nomenclature' ? 'Номенклатура' : directoryModal === 'units' ? 'Единицы измерения' : directoryModal === 'counterparties' ? 'Контрагенты' : directoryModal === 'resources' ? 'Ресурсы' : directoryModal === 'departments' ? 'Подразделения' : directoryModal === 'organizations' ? 'Организации' : 'Календари'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['nomenclature', 'units', 'counterparties', 'resources', 'departments', 'organizations'].map(tab => (
                      <button key={tab} onClick={() => setDirectoryModal(tab)} style={{
                        background: directoryModal === tab ? '#1E3252' : '#162844',
                        color: directoryModal === tab ? '#B0C4DE' : '#5A7090',
                        border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12,
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.12s',
                      }}>
                        {tab === 'nomenclature' ? 'Номенклатура' : tab === 'units' ? 'Ед. измерения' : tab === 'counterparties' ? 'Контрагенты' : tab === 'resources' ? 'Ресурсы' : tab === 'departments' ? 'Подразделения' : tab === 'organizations' ? 'Организации' : 'Календари'}
                      </button>
                    ))}
                    <button onClick={() => setDirectoryModal(null)} style={{
                      background: 'transparent', border: 'none', color: '#5A7090', fontSize: 20,
                      cursor: 'pointer', padding: '0 8px', lineHeight: 1,
                    }}>✕</button>
                  </div>
                </div>
                {/* Modal body */}
                <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
                  {directoryModal === 'nomenclature' && (
                    <DirectoryTable
                      entity="nomenclature"
                      apiBase="https://profyplan.ru/api"
                      synonyms={NOMENCLATURE_SYNONYMS}
                      columns={[
                        { key: 'name', label: 'Название', width: 240 },
                        { key: 'code', label: 'Код', width: 120 },
                        { key: 'article', label: 'Артикул', width: 150 },
                        { key: 'ntype', label: 'Тип', width: 130 },
                        { key: 'unit', label: 'Ед.', width: 70 },
                        { key: 'description', label: 'Описание' },
                      ]}
                    />
                  )}
                  {directoryModal === 'units' && (
                    <DirectoryTable
                      entity="units"
                      apiBase="https://profyplan.ru/api"
                      synonyms={UNIT_SYNONYMS}
                      columns={[
                        { key: 'code', label: 'ОКЕИ', width: 80 },
                        { key: 'symbol_int', label: 'Межд.', width: 80 },
                        { key: 'symbol_ru', label: 'Символ', width: 80 },
                        { key: 'name_ru', label: 'Название', width: 160 },
                        { key: 'name_en', label: 'English', width: 160 },
                      ]}
                    />
                  )}
                  {directoryModal === 'counterparties' && (
                    <DirectoryTable
                      entity="counterparties"
                      apiBase="https://profyplan.ru/api"
                      columns={DIR_COLUMNS.counterparties.columns}
                    />
                  )}
                  {directoryModal !== 'nomenclature' && directoryModal !== 'units' && directoryModal !== 'counterparties' && (
                    <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Раздел в разработке</div>
                      <div>Здесь будет таблица с CRUD и импортом</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ═══ REPORTS / CCM ═══ */}
          {view === 'reports' && (
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">Отчёты</span></div>
              <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>📋 Раздел в разработке</div>
            </div>
          )}
        </div>
      </div>

    {/* Окна заказов + окна-списки (поверх рабочего стола) */}
    {win.wins.length > 0 && (
      <WindowsLayer
        wins={win.wins}
        lay={win.lay}
        snapZone={win.snapZone}
        setWins={win.setWins}
        setLay={win.setLay}
        orders={orders}
        resourcesList={resourcesList}
        orderBomNodes={orderBomNodes}
        routings={routings}
        routingFor={routingFor}
        routingsFor={routingsFor}
        resName={resName}
        groups={projGroups}
        pools={projPools}
        isDyn={isDyn}
        renderOrdersTable={() => renderOrdersView('table')}
        renderBomWindow={renderBomWindow}
        onOpenOrder={openOrderPanel}
        onOpenGroup={openGroupEditor}
        onOpenPool={openPoolEditor}
        onClose={win.closeWin}
        onFocus={win.focusWin}
        onToggleMin={win.toggleMinWin}
        onMinimizeAll={win.toggleMinimizeAll}
        onReset={win.resetWin}
        onToggleMax={win.toggleMaxWin}
        onDrag={win.startDrag}
        onResize={win.startResize}
        onApplyCell={win.applySnapCell}
        onSaveEdit={saveWinEdit}
        onNodeOrderChange={handleNodeOrderChange}
        onBomNodeQuantity={handleBomNodeQuantity}
        onBomNodeRemove={handleBomNodeRemove}
        onBomNodeAdd={handleBomNodeAdd}
        onRoutingOpUpdate={handleRoutingOpUpdate}
        onRoutingOpAdd={handleRoutingOpAdd}
        onRoutingOpRemove={handleRoutingOpRemove}
        onNodeUnlink={handleBomNodeUnlink}
        openOrderWinById={openOrderWinById}
        anomalies={bomAnomalies}
        anomaliesLoading={bomAnomaliesLoading}
        onCreateMissingOrders={createMissingOrders}
        onCreateOrderFromNode={createOrderFromNode}
        onAttachOrder={handleAttachFreeOrder}
        onNodeNomenclatureChange={handleBomNodeNomenclature}
        onPickResource={openResourcePick}
                  onOpenDirPick={openDirForPick}
                  onRoutingOpCreate={handleRoutingOpCreate}
                  orderRes={orderRes}
                  onOrderResLoad={loadOrderResources}
                  onOrderResChange={handleOrderResChange}
                  onOrderResRemove={handleOrderResRemove}
                  onDirCalendar={(rid, rname) => win.openCalWin(rid, rname || 'Ресурс')}
                  calData={calData}
                  onCalLoad={loadCalData}
                  onCalAddAssignment={handleCalAddAssignment}
                  onCalDelAssignment={handleCalDelAssignment}
                  onCalAddException={handleCalAddException}
                  onCalDelException={handleCalDelException}
                  opNameSuggestions={Array.from(new Set(routings.flatMap((r: any) => ((r.operations || []) as any[]).map((o: any) => o.name).filter(Boolean))))}
        dirRefreshKey={dirRefreshKey}
        onOrderFocus={focusOrderByBom}
        onOpenDirectory={openDirectory}
        onDirManageEdit={(entity, row) => { if (entity === 'resources') win.openResEdit(row); }}
        onDirManageDelete={(entity, row) => { if (entity === 'resources') runDeleteCheck('resource', row.id, row.name || row.code || row.id); }}
        schedules={workSchedules}
        onSaveResourceEdit={saveResourceEdit}
        debug={debugMode}
      />
    )}

    {/* Универсальный модуль справочника (модальное окно) */}
    {dirManager && (
      <DirectoryManager
        title={dirManager.title}
        entity={dirManager.entity}
        columns={dirManager.columns}
        apiBase="https://profyplan.ru/api"
        debug={debugMode}
        onClose={() => setDirManager(null)}
      />
    )}


    {/* Sidebar context menu */}
    {sidebarCtx && (
      <>
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9998 }} onClick={() => setSidebarCtx(null)} onContextMenu={(e) => { e.preventDefault(); setSidebarCtx(null); }} />
        <div style={{
          position: 'fixed', left: sidebarCtx.x, top: sidebarCtx.y, zIndex: 9999,
          background: 'linear-gradient(135deg, #0F1E36, #162844)', border: '1px solid #1E3252',
          borderRadius: 10, padding: '4px 0', minWidth: 180,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          {debugMode && <DebugBadge debug={debugMode} corner text="[ctx:menu]" />}
          <button onClick={() => { setDirectoryModal(sidebarCtx.view); setSidebarCtx(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#B0C4DE', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            📋 Открыть список
          </button>
          <button onClick={() => { navTo(sidebarCtx.view as View); setSidebarCtx(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#B0C4DE', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            🔍 Перейти к разделу
          </button>
        </div>
      </>
    )}

    {/* Context menu */}
    {ctxMenu && (
      <>
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9998 }} onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
        <div style={{
          position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
          background: 'linear-gradient(135deg, #0F1E36, #162844)', border: '1px solid #1E3252',
          borderRadius: 10, padding: '4px 0', minWidth: 200,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          {ctxMenu.project && !ctxMenu.pool && !ctxMenu.group && (<>
            <div style={{ padding: '8px 14px', fontSize: 13, color: '#B0C4DE', borderBottom: '1px solid #1E3252', marginBottom: 4 }}>
              📁 {ctxMenu.project.name}
            </div>
            <button onClick={(e) => { e.stopPropagation(); const btn = e.target as HTMLElement; btn.style.display = 'none'; const inp = btn.nextElementSibling as HTMLInputElement; if (inp) { inp.style.display = 'block'; inp.value = ctxMenu.project.name; inp.focus(); inp.select(); } }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#B0C4DE', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              ✏️ Переименовать
            </button>
            <input style={{ display: 'none', width: 'calc(100% - 28px)', margin: '0 14px 8px', background: '#0A1628', border: '1px solid #3B82F6', borderRadius: 6, color: '#E8EEF5', padding: '6px 10px', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none' }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setCtxMenu(null); } if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== ctxMenu.project.name) { renameProject(ctxMenu.project, v); } setCtxMenu(null); } }}
              onBlur={() => setCtxMenu(null)}
            />
            <button onClick={() => { archiveProject(ctxMenu.project); setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#B0C4DE', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              {ctxMenu.project.status === 'archived' ? '📂 Восстановить' : '📦 В архив'}
            </button>
            <button onClick={() => { deleteProject(ctxMenu.project); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#EF4444', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              🗑 Удалить
            </button>
          </>)}
          {ctxMenu.pool && (<>
            <div style={{ padding: '8px 14px', fontSize: 13, color: '#B0C4DE', borderBottom: '1px solid #1E3252', marginBottom: 4 }}>
              📦 {ctxMenu.pool.name}
            </div>
            <button onClick={() => { const pl = ctxMenu.pool; setCtxMenu(null); runDeleteCheck('order_pool', pl.id, pl.name); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#EF4444', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              🗑 Удалить
            </button>
          </>)}
          {ctxMenu.group && (<>
            <div style={{ padding: '8px 14px', fontSize: 13, color: '#B0C4DE', borderBottom: '1px solid #1E3252', marginBottom: 4 }}>
              📋 {ctxMenu.group.name}
            </div>
            <button onClick={() => { const gr = ctxMenu.group; setCtxMenu(null); runDeleteCheck('order_group', gr.id, gr.name); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#EF4444', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              🗑 Удалить
            </button>
          </>)}
        </div>
      </>
    )}

    {/* Excel Import Wizard */}
    {importProjectId && (
      <ExcelImportWizard
        projectId={importProjectId}
        debug={debugMode}
        onClose={() => setImportProjectId(null)}
        onComplete={() => { setImportProjectId(null); refresh(); }}
      />
    )}

    {/* Delete Check Dialog */}
    {deleteCheckEntity && (
      <DeleteCheckDialog
        entityType={deleteCheckEntity.type}
        debug={debugMode}
        entityId={deleteCheckEntity.id}
        entityName={deleteCheckEntity.name}
        result={deleteCheckResult}
        loading={deleteCheckLoading}
        error={deleteCheckError}
        onClose={() => { setDeleteCheckEntity(null); setDeleteCheckResult(null); setDeleteCheckError(null); }}
        onDeleted={() => {
          if (deleteCheckEntity.type === 'project') {
            setSelectedProject(null); setOrders([]); load().then(() => navTo('projects'));
          } else if (deleteCheckEntity.type === 'order') {
            refresh();
          } else if (deleteCheckEntity.type === 'order_group') {
            setSelectedGroup(null);
            loadProjectGroups(selectedProject);
          } else if (deleteCheckEntity.type === 'order_pool') {
            setSelectedPool(null);
            loadProjectPools(selectedProject);
          } else if (deleteCheckEntity.type === 'resource') {
            setDirRefreshKey(k => k + 1);
            load();
          } else {
            load();
          }
        }}
      />
    )}

    {/* Мастер удаления узла BOM: проверка поддерева вниз по дереву */}
    {bomDelete && (() => {
      const total = bomDelete.items.length;
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setBomDelete(null)}>
          <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, width: 480, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid #334155' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#F1F5F9' }}>⚠️ Удаление узла BOM</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>{bomDelete.name}</div>
            </div>
            <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: 13, color: '#FBBF24', fontWeight: 500, marginBottom: 8 }}>
                {total > 0 ? 'Будут удалены связанные объекты (' + total + '):' : 'Узел не имеет вложенных элементов. Удаление затронет только сам узел.'}
              </div>
              {total > 0 && (
                <div style={{ display: 'grid', gap: 4 }}>
                  {bomDelete.items.slice(0, 12).map((it: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: '#94A3B8', padding: '2px 0 2px 12px', borderLeft: '2px solid #334155', margin: '2px 0' }}>
                      {it.name} <span style={{ color: '#64748B', fontSize: 11 }}>({it.type === 'assembly' ? 'сборка' : it.type === 'semi_finished' ? 'полуфабрикат' : 'материал'})</span>
                    </div>
                  ))}
                  {total > 12 && <div style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic' }}>...и ещё {total - 12}</div>}
                </div>
              )}
              <div style={{ marginTop: 12, fontSize: 12, color: '#94A3B8' }}>
                Удаляется весь узел вместе с поддеревом спецификации. Операции маршрута при этом сохраняются.
              </div>
            </div>
            <div style={{ padding: '12px 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #334155' }}>
              <button onClick={() => setBomDelete(null)} style={{ background: '#334155', border: 'none', color: '#CBD5E1', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
              <button onClick={doBomNodeDelete} style={{ background: '#DC2626', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{total > 0 ? 'Удалить узел и ' + total + ' потомков' : 'Удалить узел'}</button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* Стилизованные диалоги: ввод имени узла/операции, подтверждение удаления операции */}
    {appModal && (() => {
      if (appModal.kind === 'node-add') {
        const isSemi = appModal.nodeType === 'semi_finished';
        return (
          <AppModal title={isSemi ? 'Добавить полуфабрикат' : 'Добавить материал'} code="node-add" debug={debugMode} onClose={() => { setAppModal(null); setModalName(''); }} accent={isSemi ? '#A78BFA' : '#34D399'}>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 8 }}>Название {isSemi ? 'полуфабриката' : 'материала'}:</div>
            <input autoFocus value={modalName} onChange={e => setModalName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmBomNodeAdd(); }} placeholder={isSemi ? 'Например: Опора моста' : 'Например: Бетон М400'} style={{ width: '100%', background: '#0A1628', border: '1px solid #2A4060', borderRadius: 8, color: '#E8EEF5', padding: '8px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
              <button onClick={() => { setAppModal(null); setModalName(''); }} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
              <button onClick={confirmBomNodeAdd} disabled={!modalName.trim()} style={{ background: isSemi ? '#8B5CF6' : '#10B981', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: modalName.trim() ? 'pointer' : 'default', opacity: modalName.trim() ? 1 : .5, fontFamily: 'inherit' }}>Добавить</button>
            </div>
          </AppModal>
        );
      }
      if (appModal.kind === 'op-add') {
        return (
          <AppModal title="Добавить операцию в маршрут" code="op-add" debug={debugMode} onClose={() => { setAppModal(null); setModalName(''); setModalResId(null); setModalOpId(null); setModalOpName(null); setModalOpDur(null); }} accent="#22D3EE">
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 8 }}>Операция * <span style={{ color: '#5A7090' }}>(из каталога операций; длительность подставится по умолчанию):</span></div>
            <ReferenceField entity="operations" pathOverride="https://profyplan.ru/api/v1/catalog-operations/" value={modalOpId} onChange={v => setModalOpId(v)} onOpenBrowser={openDirForPick} onPickItem={row => { setModalOpId(String(row.id)); setModalOpName(row.name); setModalOpDur(Number(row.default_duration_hours) || 1); }} placeholder="Выбрать операцию…" />
            <div style={{ fontSize: 11.5, color: '#8FA3BD', margin: '10px 0 6px' }}>Ресурс * <span style={{ color: '#5A7090' }}>(обязательно — операция без ресурса не участвует в расчёте мощности):</span></div>
            <ReferenceField entity="resources" value={modalResId} onChange={v => setModalResId(v)} onOpenBrowser={openDirForPick} placeholder="Выбрать ресурс…" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
              <button onClick={() => { setAppModal(null); setModalName(''); setModalResId(null); setModalOpId(null); setModalOpName(null); setModalOpDur(null); }} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
              <button onClick={confirmRoutingOpAdd} disabled={!modalOpId || !modalResId} style={{ background: (modalOpId && modalResId) ? '#0891B2' : '#123047', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: (modalOpId && modalResId) ? 'pointer' : 'default', opacity: (modalOpId && modalResId) ? 1 : .5, fontFamily: 'inherit' }}>Добавить</button>
            </div>
          </AppModal>
        );
      }
      if (appModal.kind === 'node-nom') {
        const wantType = appModal.nodeType === 'assembly' ? 'product' : appModal.nodeType;
        const typeLabel = appModal.nodeType === 'assembly' ? 'продукция' : appModal.nodeType === 'semi_finished' ? 'полуфабрикат' : 'материал';
        const q = nomQuery.trim().toLowerCase();
        const items = nomenclatureList.filter((n: any) =>
          n.ntype === wantType && (!q || (n.name || '').toLowerCase().includes(q) || (n.code || '').toLowerCase().includes(q) || (n.article || '').toLowerCase().includes(q))
        ).slice(0, 60);
        return (
          <AppModal title={'Выбор номенклатуры — ' + typeLabel} code="node-nom" debug={debugMode} onClose={() => { setAppModal(null); setNomQuery(''); }} accent="#A78BFA" width={560}>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 8 }}>
              Замените номенклатуру в строке состава. Фильтр по типу: <b style={{ color: '#C4B5FD' }}>{typeLabel}</b>. Операции не затрагиваются — они меняются во вкладке «Маршрут».
            </div>
            <input autoFocus value={nomQuery} onChange={e => setNomQuery(e.target.value)} placeholder="Поиск по имени, коду или артикулу…" style={{ width: '100%', background: '#0A1628', border: '1px solid #2A4060', borderRadius: 8, color: '#E8EEF5', padding: '7px 10px', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 8 }} />
            <div style={{ display: 'grid', gap: 4, maxHeight: 300, overflow: 'auto' }}>
              {items.length === 0 && <div style={{ color: '#5A7090', padding: '12px 4px' }}>Номенклатура не найдена{nomenclatureList.length === 0 ? ' — откройте справочник «Номенклатура» и добавьте записи' : ''}.</div>}
              {items.map((n: any) => {
                const sel = appModal.nomId === n.id;
                return (
                  <div key={n.id} onClick={() => setAppModal({ ...appModal, nomId: n.id })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: sel ? 'rgba(139,92,246,.2)' : '#0A1628', border: '1px solid ' + (sel ? 'rgba(139,92,246,.6)' : '#1E3252') }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#E8EEF5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#5A7090', flex: '0 0 auto' }}>{n.code || n.article || ''}</span>
                    <span style={{ fontSize: 10.5, color: '#8FA3BD', background: 'rgba(138,151,173,.13)', borderRadius: 4, padding: '1px 6px', flex: '0 0 auto' }}>{n.unit || ''}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
              <button onClick={() => { setAppModal(null); setNomQuery(''); }} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
              <button onClick={confirmBomNodeNomenclature} disabled={!appModal.nomId} style={{ background: '#8B5CF6', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: appModal.nomId ? 'pointer' : 'default', opacity: appModal.nomId ? 1 : .5, fontFamily: 'inherit' }}>Заменить</button>
            </div>
          </AppModal>
        );
      }
      return (
        <AppModal title="Удалить операцию" code="op-del" debug={debugMode} onClose={() => setAppModal(null)} accent="#F87171">
          <div style={{ fontSize: 12.5, color: '#B0C4DE' }}>
            Удалить операцию <b style={{ color: '#E8EEF5' }}>«{appModal.opName}»</b> из маршрута?
            <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6 }}>Операция будет удалена безвозвратно.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
            <button onClick={() => setAppModal(null)} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
            <button onClick={() => { handleRoutingOpRemove(appModal.opId); setAppModal(null); }} style={{ background: '#EF4444', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Удалить</button>
          </div>
        </AppModal>
      );
    })()}

    {/* Модалка привязки свободного заказа (панель заказа, вкладка «Состав») */}
    {panelAttach && (() => {
      const cur = orders.find((x: any) => x.id === panelAttach);
      const free = orders.filter((x: any) => !x.parent_order_id && x.id !== panelAttach);
      return (
        <AppModal title="Привязать свободный заказ" code="attach" debug={debugMode} onClose={() => setPanelAttach(null)} accent="#A78BFA" width={520}>
          <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 10 }}>
            Свободные заказы (без родителя): <b style={{ color: '#C4B5FD' }}>{free.length}</b> — для заказа <b style={{ color: '#C4B5FD' }}>{cur ? (cur.ext_id || cur.specification_name || cur.id.slice(0, 8)) : ''}</b>. Выбранный заказ станет производителем первого свободного полуфабриката в составе.
          </div>
          {free.length === 0 && (
            <div style={{ color: '#5A7090', padding: '12px 4px', fontSize: 12 }}>
              Свободных заказов нет (в проекте всего {orders.length}). Свободными считаются заказы без родителя — чтобы освободить заказ, разорвите связь у его узла в составе (кнопка ⛓).
            </div>
          )}
          <div style={{ display: 'grid', gap: 5, maxHeight: 300, overflow: 'auto' }}>
            {free.map((x: any) => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FBBF24', flexShrink: 0 }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#B0C4DE', flex: '0 0 74px' }}>{x.ext_id || '—'}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#E8EEF5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.specification_name || x.ext_id || '—'}</span>
                <button onClick={() => { handleAttachFreeOrder(panelAttach, x.id); setPanelAttach(null); }}
                  style={{ background: 'rgba(167,139,250,.14)', border: '1px solid rgba(167,139,250,.45)', color: '#C4B5FD', borderRadius: 6, padding: '4px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Привязать</button>
              </div>
            ))}
          </div>
        </AppModal>
      );
    })()}

    {/* BOM heavy modal */}
    {bomModalOrder && (() => {
      const nodes = orderBomNodesWithSuborders(bomModalOrder);
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,20,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `24px 20px 24px ${sidebarWidth + 20}px` }} onClick={() => setBomModalOrder(null)}>
          <div style={{ background: '#0F1E36', border: '1px solid #1E3252', borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px 0', flexShrink: 0 }}>
              <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5A7090', fontWeight: 600 }}>BOM · Развёртка</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#E8EEF5' }}>{bomModalOrder.specification_name || bomModalOrder.ext_id || '—'}</span>
              {debugMode && <DebugBadge debug={debugMode} text="[bom:modal]" copy={`[bom:modal] «${bomModalOrder.specification_name || bomModalOrder.ext_id || '—'}»`} />}
              <div style={{ flex: 1 }} />
              <button onClick={() => setBomModalOrder(null)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ padding: '16px 22px 22px', overflow: 'auto' }}>
              <BomExpand
                order={bomModalOrder}
                nodes={nodes}
                orders={(projectOrders[selectedProject?.id || ''] || []).map((x: any) => ({ id: x.id, ext_id: x.ext_id, specification_name: x.specification_name }))}
                anomalies={bomAnomalies}
                anomaliesLoading={bomAnomaliesLoading}
                semiPolicy={semiPolicy}
                timeline={bomTimeline?.length ? bomTimeline : buildDraftTimeline(nodes)}
                timelineDraft={!bomTimeline?.length}
                timelineLoading={bomTimelineLoading}
                onLoadTimeline={loadBomTimeline}
                onNodeOrderChange={handleNodeOrderChange}
                onNodeQuantityChange={handleBomNodeQuantity}
                onNodeRemove={confirmBomNodeDelete}
                onNodeAdd={handleBomNodeAdd}
                onOrderFocus={focusOrderByBom}
                onRoutingAdd={handleRoutingOpAdd}
                onCreateMissingOrders={createMissingOrders}
                onCreateOrderFromNode={createOrderFromNode}
                routings={routings}
                resName={resName}
              />
            </div>
          </div>
        </div>
      );
    })()}

    {/* Chain control dialog (куст заказов при перемещении) */}
    {chainDialog && (() => {
      const { order, selectedIds, targetGroupId, targetPoolId, cluster } = chainDialog;
      const ordersInCluster = cluster.orders || [];
      const selectedSet = new Set(selectedIds);
      const related = ordersInCluster.filter((x: any) => !selectedSet.has(x.id));
      const single = selectedIds.length === 1;
      const parents = single ? related.filter((x: any) => x.relation === 'parent') : [];
      const children = single ? related.filter((x: any) => x.relation === 'child') : [];
      const unclassified = single ? related.filter((x: any) => x.relation !== 'parent' && x.relation !== 'child') : related;
      const selfOrder = ordersInCluster.find((x: any) => x.id === selectedIds[0]) || order;
      const targetLabel = targetPoolId
        ? `пул «${(pools[selectedProject?.id || ''] || []).find((p: any) => p.id === targetPoolId)?.name || targetPoolId.slice(0, 8)}»`
        : targetGroupId
          ? `группу «${(groups[selectedProject?.id || ''] || []).find((g: any) => g.id === targetGroupId)?.name || targetGroupId.slice(0, 8)}»`
          : 'корень проекта (без группы/пула)';
      const nameOf = (o: any) => o.ext_id || o.specification_name || o.id.slice(0, 8);
      const statusOf = (o: any) => {
        const parts: string[] = [];
        if (o.group_id) parts.push('в группе');
        if (o.pool_id) parts.push('в пуле');
        if (o.has_cpm) parts.push('рассчитан (CPM)');
        return parts.length ? parts.join(' · ') : 'не сгруппирован';
      };
      const total = ordersInCluster.length;
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,20,.72)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => resolveChainMove('cancel')}>
          <div style={{ background: '#0F1E36', border: '1px solid #2A4060', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '88vh', overflow: 'auto', padding: 22 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#E8EEF5' }}>Контроль цепочки заказов</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => resolveChainMove('cancel')} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            <div style={{ fontSize: 13, color: '#B0C4DE', marginBottom: 14, lineHeight: 1.55 }}>
              {single
                ? <>Заказ <b style={{ color: '#E8EEF5' }}>{nameOf(selfOrder)}</b> переносится в <b style={{ color: '#A78BFA' }}>{targetLabel}</b> и связан с другими заказами:</>
                : <>Выбранные заказы ({selectedIds.length}) переносятся в <b style={{ color: '#A78BFA' }}>{targetLabel}</b> и связаны с другими заказами:</>}
            </div>

            {parents.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>Родительские</div>
                {parents.map((o: any) => (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: '#0A1628', borderRadius: 6, marginBottom: 4, fontSize: 12.5 }}>
                    <span style={{ color: '#E8EEF5', fontWeight: 500 }}>{nameOf(o)}</span>
                    <span style={{ color: '#8FA3BD', fontSize: 11 }}>{statusOf(o)}</span>
                  </div>
                ))}
              </div>
            )}
            {children.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>Дочерние</div>
                {children.map((o: any) => (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: '#0A1628', borderRadius: 6, marginBottom: 4, fontSize: 12.5 }}>
                    <span style={{ color: '#E8EEF5', fontWeight: 500 }}>{nameOf(o)}</span>
                    <span style={{ color: '#8FA3BD', fontSize: 11 }}>{statusOf(o)}</span>
                  </div>
                ))}
              </div>
            )}
            {unclassified.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>Связанные</div>
                {unclassified.map((o: any) => (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: '#0A1628', borderRadius: 6, marginBottom: 4, fontSize: 12.5 }}>
                    <span style={{ color: '#E8EEF5', fontWeight: 500 }}>{nameOf(o)}</span>
                    <span style={{ color: '#8FA3BD', fontSize: 11 }}>{statusOf(o)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 12, color: '#F59E0B', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
              При переносе всего куста связанные заказы будут отвязаны от своих прежних групп и пулов, а расчёты по ним (включая расчёты пулов) будут аннулированы.
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {orderChainControl !== 'control' && (
                <button onClick={() => resolveChainMove('current')} style={{ background: '#0A1628', border: '1px solid #2A4060', color: '#B0C4DE', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                  Только текущий
                </button>
              )}
              <button onClick={() => resolveChainMove('all')} style={{ background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}>
                Перенести весь куст ({total})
              </button>
              <button onClick={() => resolveChainMove('cancel')} style={{ background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* Duplicate order dialog */}
    {dupCheck && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,20,.72)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setDupCheck(null)}>
        <div style={{ background: '#0F1E36', border: '1px solid #2A4060', borderRadius: 14, width: '100%', maxWidth: 460, maxHeight: '80vh', overflow: 'auto', padding: 22 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>🔁</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#E8EEF5' }}>Возможный дубликат</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setDupCheck(null)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 20 }}>✕</button>
          </div>
          <div style={{ fontSize: 13, color: '#B0C4DE', marginBottom: 12, lineHeight: 1.5 }}>
            Заказ с названием <b style={{ color: '#E8EEF5' }}>«{dupCheck.spec}»</b> уже есть в проекте:
          </div>
          {dupCheck.existing.map((o: any) => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 10px', background: '#0A1628', borderRadius: 6, marginBottom: 4, fontSize: 12.5 }}>
              <span style={{ color: '#E8EEF5' }}>{o.ext_id ? `${o.ext_id} · ` : ''}{o.specification_name}</span>
              <span style={{ color: '#8FA3BD', fontSize: 11 }}>{o.status || '—'}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={doCreateOrder} style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}>
              Всё равно создать
            </button>
            <button onClick={() => setDupCheck(null)} style={{ background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

// ═══ NEW PROJECT WIZARD ═══
function NewProjectWizard({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('cpm');
  const [usesPhases, setUsesPhases] = useState(false);
  const [country, setCountry] = useState('RU');
  const [manualRows, setManualRows] = useState<Record<string, string>[]>([]);
  const [nomenMatches, setNomenMatches] = useState<Record<string, { id: string; name: string } | null>>({});
  const [showManual, setShowManual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);

  // Nomenclature search function for ClipboardPaste
  const searchNomenclature = async (q: string) => {
    try {
      const items = await apiF<any[]>(`/nomenclature/search/?q=${encodeURIComponent(q)}`);
      return items.map((i: any) => ({ id: i.id, name: i.name, code: i.code, article: i.article }));
    } catch { return []; }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Steps indicator */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
        {[1, 2, 3].map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: step >= s ? 'linear-gradient(135deg, #3B82F6, #2563EB)' : '#1E3252',
              color: step >= s ? '#fff' : '#5A7090',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700,
              boxShadow: step >= s ? '0 2px 8px rgba(59,130,246,0.3)' : 'none',
            }}>{step > s ? '✓' : s}</div>
            {s < 3 && <div style={{ flex: 1, height: 2, background: step > s ? '#3B82F6' : '#1E3252', margin: '0 8px' }} />}
          </div>
        ))}
      </div>

      {/* Step 1: Basics */}
      {step === 1 && (
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 20 }}>Шаг 1: Основные параметры</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#B0C4DE' }}>Название проекта</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Редуктор Р-200" style={{
                width: '100%', padding: '10px 14px', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8,
                color: '#E8EEF5', fontSize: 14, fontFamily: 'Inter, sans-serif', outline: 'none',
              }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#B0C4DE' }}>Режим планирования</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { id: 'quick', label: 'Быстрый', desc: 'Без CPM' },
                  { id: 'cpm', label: 'CPM', desc: 'Критический путь' },
                  { id: 'pert', label: 'PERT', desc: 'Вероятностный' },
                ].map(m => (
                  <button key={m.id} onClick={() => setMode(m.id)} style={{
                    flex: 1, padding: '12px', background: mode === m.id ? 'rgba(59,130,246,0.12)' : '#0F1E36',
                    border: `1px solid ${mode === m.id ? '#3B82F6' : '#1E3252'}`, borderRadius: 10,
                    color: mode === m.id ? '#60A5FA' : '#B0C4DE', cursor: 'pointer', textAlign: 'center',
                    fontFamily: 'Inter, sans-serif', transition: 'all 0.12s',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: '#5A7090', marginTop: 4 }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#B0C4DE' }}>Страна</label>
                <select value={country} onChange={e => setCountry(e.target.value)} style={{
                  width: '100%', padding: '10px 14px', background: '#0A1628', border: '1px solid #1E3252',
                  borderRadius: 8, color: '#E8EEF5', fontSize: 14, fontFamily: 'Inter, sans-serif',
                }}>
                  <option value="RU">🇷🇺 Россия</option>
                  <option value="KZ">🇰🇿 Казахстан</option>
                  <option value="BY">🇧🇾 Беларусь</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#B0C4DE', fontSize: 13 }}>
                  <input type="checkbox" checked={usesPhases} onChange={e => setUsesPhases(e.target.checked)} />
                  Использовать этапы
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Data */}
      {step === 2 && !showManual && (
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 20 }}>Шаг 2: Загрузка данных</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="dir-card" style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: 16, cursor: 'pointer' }}>
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) setExcelFile(f); e.target.value = ''; }} />
              <div style={{ fontSize: 28 }}>📥</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Импорт из Excel</div>
                <div style={{ fontSize: 12, color: '#5A7090' }}>{excelFile ? `✓ ${excelFile.name}` : 'Загрузите .xlsx файл'}</div>
              </div>
            </label>
            {[
              { icon: '📋', title: 'Google Таблицы', desc: 'Синхронизация с Sheets' },
              { icon: '🔌', title: 'API / 1С', desc: 'Интеграция с ERP' },
              { icon: '✍️', title: 'Вручную', desc: 'Заполнить в интерфейсе', action: () => setShowManual(true) },
            ].map((opt, i) => (
              <div key={i} className="dir-card" onClick={opt.action}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: 16, cursor: opt.action ? 'pointer' : 'default' }}>
                <div style={{ fontSize: 28 }}>{opt.icon}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.title}</div>
                  <div style={{ fontSize: 12, color: '#5A7090' }}>{opt.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: 12, background: 'rgba(59,130,246,0.06)', borderRadius: 8, fontSize: 12, color: '#5A7090' }}>
            💡 Можно пропустить этот шаг — проект создастся пустым. Данные можно добавить позже через кнопку «Импорт» в карточке проекта.
          </div>
        </div>
      )}

      {/* Step 2: Manual Input */}
      {step === 2 && showManual && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div className="panel-title">Шаг 2: Ручной ввод</div>
            <button className="btn btn-sm" style={{ background: 'transparent', border: '1px solid #2A4060', color: '#B0C4DE', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
              onClick={() => setShowManual(false)}>← Назад к выбору</button>
          </div>
          <ClipboardPaste
            nomenclatureSearchFn={searchNomenclature}
            onApply={(rows, matches) => { setManualRows(rows); setNomenMatches(matches); setShowManual(false); }}
          />
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 20 }}>Шаг 3: Подтверждение</div>
          <div style={{ background: '#0A1628', borderRadius: 10, padding: 20, border: '1px solid #1E3252' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 14 }}>
              <div style={{ color: '#5A7090' }}>Название</div><div style={{ fontWeight: 600 }}>{name || '(не указано)'}</div>
              <div style={{ color: '#5A7090' }}>Режим</div><div>{mode.toUpperCase()}{usesPhases ? ' + Этапы' : ''}</div>
              <div style={{ color: '#5A7090' }}>Страна</div><div>{country}</div>
              <div style={{ color: '#5A7090' }}>Данные</div>
              <div>
                <div>{manualRows.length > 0 ? `${manualRows.length} строк вручную` : excelFile ? `Excel: ${excelFile.name}` : 'Будут добавлены позже'}</div>
                {Object.values(nomenMatches).filter(Boolean).length > 0 && (
                  <div style={{ fontSize: 11, color: '#10B981', marginTop: 4 }}>
                    ✓ Сопоставлено с номенклатурой: {Object.values(nomenMatches).filter(Boolean).length} продуктов
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button className="btn btn-secondary" onClick={() => step > 1 ? setStep(step - 1) : onBack()}>
          {step > 1 ? '← Назад' : '← К проектам'}
        </button>
        {step < 3 && !showManual ? (
          <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Далее →</button>
        ) : step < 3 ? (
          <div></div>
        ) : (
          <button className="btn btn-primary" disabled={creating} onClick={async () => { setCreating(true); try { const proj = await apiF<any>('/projects', { method: 'POST', body: JSON.stringify({ name: name || 'Без названия', mode: mode === 'quick' ? 'quick' : 'project', default_method: mode === 'pert' ? 'pert_cpm' : 'cpm', country_code: country }) }); if (manualRows.length > 0 && proj?.id) { for (const row of manualRows) { await apiF(`/production-orders/?project_id=${proj.id}`, { method: 'POST', body: JSON.stringify({ ext_id: row.ext_id || null, specification_name: row.specification_name || null, quantity: Number(row.quantity) || 1, unit: row.unit || 'pcs', start_date: row.start_date || null, due_date: row.due_date || null, priority: row.priority || 'normal', client: row.client || null, notes: row.notes || null, parent_order_id: row.parent_order_id || null }) }); } } if (excelFile && proj?.id) { const imp: any = await importProductionOrders(excelFile, proj.id); if (imp?.errors && imp.errors.length > 0) { alert(`Импорт с ошибками (${imp.errors.length}): ${imp.errors[0]?.message || ''}`); } } onCreated(); } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); } }}>
            {creating ? 'Создание...' : 'Создать проект'}
          </button>
        )}
      </div>
    </div>
  );
}
