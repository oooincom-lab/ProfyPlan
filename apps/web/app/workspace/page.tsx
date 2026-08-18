'use client';

import { useState, useCallback, Fragment, useRef, useEffect } from 'react';
import ClipboardPaste from '@/components/ClipboardPaste';
import DirectoryTable from '@/components/DirectoryTable';
import { NOMENCLATURE_SYNONYMS, UNIT_SYNONYMS } from '@/components/DataImport';
import DirectoryPicker from '@/components/DirectoryPicker';
import Sidebar from '@/components/sidebar';
import PoolEditor from '@/components/pooleditor';
import GroupEditor from '@/components/groupeditor';
import DeleteCheckDialog from '@/components/DeleteCheckDialog';
import ExcelImportWizard from '@/components/ExcelImportWizard';
import BomTree from '@/components/bomtree';
import { importProductionOrders } from '@/lib/api';
import { useWindows, type WinRec } from '@/components/windows/useWindows';
import WindowsLayer from '@/components/windows/WindowsLayer';

const API = 'https://profyplan.ru/api/v1';
const C = (s: string) => s;

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

type View = 'dashboard' | 'projects' | 'project-dashboard' | 'project-orders' | 'project-gantt' | 'project-pools' | 'project-groups' | 'archive' | 'directories' | 'nomenclature' | 'units' | 'resources' | 'departments' | 'organizations' | 'calendars' | 'ccm' | 'reports' | 'settings' | 'new-project';

export default function AppShell() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [authError, setAuthError] = useState(false);
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
    return v === 'modal' ? 'modal' : v === 'window' ? 'window' : 'side';
  });
  const [menuMode, setMenuModeState] = useState<'expanded' | 'manual' | 'auto'>(() => {
    if (typeof window === 'undefined') return 'expanded';
    const v = localStorage.getItem('profyplan_menu_mode');
    return v === 'manual' ? 'manual' : v === 'auto' ? 'auto' : 'expanded';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [selOrderId, setSelOrderId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'order' | 'bom' | 'route' | 'res' | 'plan'>('order');
  const [panelEditing, setPanelEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [routings, setRoutings] = useState<any[]>([]);
  const [resourcesList, setResourcesList] = useState<any[]>([]);
  // ── Режим «Окна» (как в ОС: перетаскивание, Snap-раскладки, панель задач) ──
  // Логика и состояние вынесены в useWindows() / WindowsLayer (components/windows).
  const sidebarWidth = menuMode === 'auto' ? 0 : (sidebarCollapsed ? 64 : 260);
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

  // ── «Окна для списков»: список заказов открывается окном поверх дашборда ──
  const [listWinMode, setListWinModeState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('profyplan_list_windows') === '1';
  });

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

  // ── Панель заказа: режимы, данные, действия ──
  const setTreeMode = (m: 'both' | 'bom' | 'routes') => { setTreeModeState(m); try { localStorage.setItem('profyplan_tree_mode', m); } catch {} };
  const setPanelMode = (m: 'side' | 'modal' | 'window') => {
    setPanelModeState(m);
    try { localStorage.setItem('profyplan_panel_mode', m); } catch {}
    if (m === 'modal') { setSelOrderId(null); setPanelEditing(false); }
  };
  const setMenuMode = (m: 'expanded' | 'manual' | 'auto') => {
    setMenuModeState(m);
    try { localStorage.setItem('profyplan_menu_mode', m); } catch {}
    if (m === 'expanded') { setSidebarCollapsed(false); }
  };

  const loadPanelData = async (p: any) => {
    try {
      const [r, rs] = await Promise.all([
        apiF<any>('/bom/routings').catch(() => null),
        apiF<any[]>('/resources').catch(() => []),
      ]);
      if (r && Array.isArray(r.items)) setRoutings(r.items);
      if (Array.isArray(rs)) setResourcesList(rs);
    } catch {}
  };

  const selOrder = selOrderId ? (orders.find((o: any) => o.id === selOrderId) || null) : null;

  const openOrderPanel = (o: any) => {
    if (panelMode === 'window' || listWinMode) { win.openWin(o); return; }
    setSelOrderId(o.id);
    setPanelTab('order');
    setPanelEditing(false);
  };

  const setListWinMode = (v: boolean) => { setListWinModeState(v); try { localStorage.setItem('profyplan_list_windows', v ? '1' : '0'); } catch {} };

  const routingFor = (o: any): any | null => {
    if (!routings.length) return null;
    const root = orderBomNodes(o).find((n: any) => !n.parent_id);
    const key = root?.routing_id || null;
    if (!key) return null;
    return routings.find((r: any) => r.id === key) || null;
  };

  const resName = (rid: any) => {
    if (!rid) return '—';
    const r = resourcesList.find((x: any) => x.id === rid);
    return r ? r.name : String(rid).slice(0, 8) + '…';
  };

  const startEditOrder = () => {
    if (!selOrder) return;
    setEditForm({
      client: selOrder.client || '',
      quantity: String(selOrder.quantity ?? ''),
      priority: selOrder.priority || 'normal',
      start_date: selOrder.start_date || '',
      due_date: selOrder.due_date || '',
      status: selOrder.status || 'draft',
    });
    setPanelEditing(true);
  };

  const saveOrderEdit = async () => {
    if (!selOrder) return;
    try {
      const body: any = { client: editForm.client, quantity: Number(editForm.quantity) || 1, priority: editForm.priority, status: editForm.status };
      if (editForm.start_date) body.start_date = editForm.start_date;
      if (editForm.due_date) body.due_date = editForm.due_date;
      await apiF(`/production-orders/${selOrder.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg('Заказ обновлён');
      setPanelEditing(false);
      if (selectedProject) await loadProjectOrdersView(selectedProject);
    } catch (e: any) { setMsg('Ошибка сохранения: ' + (e.message || String(e))); }
  };

  const saveWinEdit = async (w: WinRec) => {
    const o = orders.find((x: any) => x.id === w.orderId);
    if (!o) return;
    try {
      const body: any = { client: w.form.client, quantity: Number(w.form.quantity) || 1, priority: w.form.priority, status: w.form.status };
      if (w.form.start_date) body.start_date = w.form.start_date;
      if (w.form.due_date) body.due_date = w.form.due_date;
      await apiF(`/production-orders/${o.id}`, { method: 'PATCH', body: JSON.stringify(body) });
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
    const specName = (o.specification_name || '').toLowerCase().trim();
    const specId = (o.specification_id || '').toLowerCase().trim();
    const roots = all.filter(n => !n.parent_id);
    const childrenMap: Record<string, any[]> = {};
    for (const n of all) if (n.parent_id) (childrenMap[n.parent_id] ||= []).push(n);
    const kept = new Set<string>();
    const walk = (start: any) => { kept.add(start.id); for (const c of childrenMap[start.id] || []) walk(c); };
    const specOf = (n: any) => (n.path && n.path.includes('/')) ? n.path.split('/')[0].toLowerCase().trim() : '';

    // 1) корни по имени номенклатуры (спецификация заказа = имя корневого изделия)
    const byName = roots.filter(r => specName && (r.nomenclature_name || '').toLowerCase().trim() === specName);
    if (byName.length) { byName.forEach(walk); return all.filter(n => kept.has(n.id)); }

    // 2) узел (не только корень) по коду = specification_id — заказ, созданный из полуфабриката
    if (specId) {
      const node = all.find(n => (n.nomenclature_id || '').toLowerCase().trim() === specId
        || (n.ext_id || '').toLowerCase().trim() === specId);
      if (node) { walk(node); return all.filter(n => kept.has(n.id)); }
    }

    // 3) корни, чья спецификация из path == specification_id (импортированные данные: path = Спец/Узел)
    const byPath = roots.filter(r => specId && specOf(r) === specId);
    if (byPath.length) { byPath.forEach(walk); return all.filter(n => kept.has(n.id)); }

    // 4) спецификация задана, но не найдена — пустой BOM, а не «весь проект»
    if (specName || specId) return [];

    // 5) без спецификации — все корни (ручные заказы без привязки к BOM)
    roots.forEach(walk);
    return all.filter(n => kept.has(n.id));
  };

  const openBomModal = (o: any) => {
    setBomModalOrder(o);
    setBomTimeline(null);
    setBomTimelineLoading(false);
    if (selectedProject) loadProjectOrders(selectedProject.id);
    if (selectedProject) loadBomAnomalies(selectedProject.id);
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
    } catch (e: any) { setMsg('Ошибка привязки заказа: ' + (e.message || String(e))); }
  };

  // BOM-узлы заказа + BOM подчинённых заказов (тусклые, через order_id на узлах)
  const orderBomNodesWithSuborders = (o: any) => {
    const projId = selectedProject?.id || '';
    const all = bomTrees[projId] || [];
    if (!all.length) return [];
    const own = orderBomNodes(o).map((n: any) => ({
      ...n,
      _ownerId: o.id,
      _ownerExtId: o.ext_id || o.specification_name || '',
    }));
    const ordersList = projectOrders[projId] || [];

    const result: any[] = [...own];

    // Получить корни BOM подчинённого заказа по его id
    const subOrderRoots = (orderId: string, skipId?: string): any[] => {
      const sub = ordersList.find((x: any) => x.id === orderId);
      if (!sub) return [];
      const roots = orderBomNodes(sub).filter((n: any) => !n.parent_id);
      const mapped = roots.map((n: any) => ({
        ...n,
        _ownerId: sub.id,
        _ownerExtId: sub.ext_id || sub.specification_name || '',
      }));
      // Заказ создан из самого узла (корень его BOM = этот узел): встраиваем детей, а не копию узла
      if (skipId && mapped.length === 1 && mapped[0].id === skipId) {
        return all
          .filter((c: any) => c.parent_id === skipId)
          .map((c: any) => ({ ...c, _ownerId: sub.id, _ownerExtId: sub.ext_id || sub.specification_name || '' }));
      }
      return mapped;
    };

    // Рекурсивно встраиваем узлы подчинённого заказа как дочерние (цветные, сгруппированы по заказам)
    const inject = (nodes: any[], parentId: string, dimLevel: number, visited: Set<string>) => {
      for (const n of nodes) {
        const synthId = `sub_${parentId}_${n.id}_${dimLevel}`;
        const clone: any = { ...n, id: synthId, parent_id: parentId, dimmed: dimLevel };
        result.push(clone);
        const realChildren = all.filter((c: any) => c.parent_id === n.id);
        if (realChildren.length) inject(realChildren.map((c: any) => ({ ...c, _ownerId: clone._ownerId, _ownerExtId: clone._ownerExtId })), synthId, dimLevel, visited);
        if (n.order_id && n.order_id !== o.id && !visited.has(n.order_id)) {
          const nextVisited = new Set(visited);
          nextVisited.add(n.order_id);
          const deeper = subOrderRoots(n.order_id, n.id);
          if (deeper.length) inject(deeper, synthId, Math.min(dimLevel + 1, 2), nextVisited);
        }
      }
    };

    for (const n of own) {
      if (n.order_id && n.order_id !== o.id) {
        const visited = new Set<string>([o.id]);
        const subRoots = subOrderRoots(n.order_id, n.id);
        if (subRoots.length) inject(subRoots, n.id, 1, visited);
      }
    }

    return result;
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
    loadPanelData(p);
    if (listWinMode) {
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

  const navTo = (v: View) => { setView(v); setSelectedProject(null); setOrders([]); setGroups({}); setPools({}); if (['directories','nomenclature','units','resources','departments','organizations','calendars'].includes(v)) win.minimizeAll(); };

  // ── Gantt ──
  const loadProjectGantt = async (p: any) => {
    setSelectedProject(p); setView('project-gantt');
    setGanttLoading(true); setGanttData(null);
    try {
      const r = await apiF<any>(`/projects/${p.id}/calculate/cpm`, { method: 'POST' });
      setGanttData(r);
    } catch (e: any) { setMsg('Ошибка загрузки Ганта: ' + (e.message || String(e))); }
    setGanttLoading(false);
  };

  // ── Groups ──
  const loadProjectGroups = async (p: any) => {
    setSelectedProject(p);
    if (listWinMode) {
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
    await apiF(`/projects/${selectedProject.id}/groups`, { method: 'POST', body: JSON.stringify({ name: newGroupName.trim() }) });
    setNewGroupInput(false);
    await loadProjectGroups(selectedProject);
  };

  const delGroup = (gid: string, gname: string) => {
    runDeleteCheck('order_group', gid, gname);
  };

  // ── Pools ──
  const loadProjectPools = async (p: any) => {
    setSelectedProject(p);
    if (listWinMode) {
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
      <div className="kpi-card"><div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
      <div className="kpi-card"><div className="kpi-label">Динамические</div><div className="kpi-val g">{dynCount}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
      <div className="kpi-card"><div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress}</div><div className="kpi-sub">{inProgress > 0 ? 'Активных' : 'Нет'}</div></div>
      <div className="kpi-card"><div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical}</div><div className="kpi-sub">High + Critical</div></div>
      <div className="kpi-card"><div className="kpi-label">Групп / Пулов</div><div className="kpi-val">{projGroups.length + projPools.length}</div><div className="kpi-sub">{projGroups.length} гр. · {projPools.length} пул.</div></div>
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
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', width: '100%' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                <div className="panel">
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

                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl">
                      <thead><tr>
                        <th style={{ width: 56 }}></th>
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
                          return (
                            <Fragment key={o.id}>
                            <tr draggable onClick={() => openOrderPanel(o)} onDragStart={(e) => { e.dataTransfer.setData('orderId', o.id); e.dataTransfer.effectAllowed = 'move'; }} style={{ cursor: 'grab', background: o.pool_id ? 'rgba(139,92,246,.06)' : undefined }}>
                              <td style={{ textAlign: 'left', paddingLeft: 4 + depth * 16, width: 56, minWidth: 56, maxWidth: 56, overflow: 'visible', boxShadow: depth > 0 ? 'inset 2px 0 0 ' + (depth === 1 ? '#8B5CF6' : '#06B6D4') : undefined }}>
                                {hasChildren ? (
                                  <button onClick={(e) => { e.stopPropagation(); toggleOrderCollapse(o.id); }} title={collapsed ? 'Развернуть поддерево' : 'Свернуть поддерево'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60A5FA', fontSize: 12, padding: '2px 3px 2px 0', marginRight: 2, verticalAlign: 'middle', lineHeight: 1 }}>{collapsed ? '▸' : '▾'}</button>
                                ) : null}
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleBomOrder(o); }}
                                  title={bomOpen ? 'Свернуть BOM' : 'Показать BOM'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: bomOpen ? '#60A5FA' : '#5A7090', fontSize: 14, padding: '2px 6px', transition: 'color .15s' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#60A5FA')}
                                  onMouseLeave={e => (e.currentTarget.style.color = bomOpen ? '#60A5FA' : '#5A7090')}
                                >{bomOpen ? '▾' : '▸'}</button>
                              </td>
                              <td className="t-mono" style={{ fontSize: 14 }}>{ti.icon}</td>
                              {orderShowAll && <td className="t-name" style={{ fontSize: 12 }}>{ti.name}</td>}
                              <td className="t-graph"><span className={isDyn(o) ? 'g-dyn' : 'g-pln'} title={isDyn(o) ? `${o.operations_created || '?'} операций` : 'Нет графа'}>{isDyn(o) ? '⚡' : '○'}</span></td>
                              <td className="t-mono">{o.ext_id || '—'}</td>
                              <td className="t-name" style={{ color: o.pool_id ? '#A78BFA' : undefined }}>{depth > 0 && <span title="Подчинённый заказ (цепочка)" style={{ display: 'inline-block', background: 'rgba(139,92,246,.15)', color: '#C4B5FD', border: '1px solid rgba(139,92,246,.45)', borderRadius: 5, fontSize: 10.5, padding: '0 5px', marginRight: 6, fontWeight: 600, lineHeight: '14px' }}>⛓</span>}{o.specification_name || o.ext_id || '—'}</td>
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
                                      <span style={{ fontSize: 12, fontWeight: 600, color: '#B0C4DE', letterSpacing: '.02em' }}>BOM · {o.specification_name || o.ext_id || '—'}</span>
                                      {bomLoading[selectedProject?.id || ''] && <span style={{ fontSize: 11, color: '#F59E0B' }}>загрузка…</span>}
                                      <span style={{ fontSize: 11, color: '#5A7090' }}>структура изделия</span>
                                      <button onClick={() => openBomModal(o)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Развернуть полностью ↗</button>
                                    </div>
<BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} timeline={bomTimeline || undefined} timelineLoading={bomTimelineLoading} onLoadTimeline={loadBomTimeline} />
                                  </div>
                                </td>
                              </tr>
                            )}
                            {treeMode !== 'bom' && (() => {
                              const rt = routingFor(o);
                              if (!rt || !rt.operations || !rt.operations.length) return null;
                              const total = rt.operations.reduce((s: number, op: any) => s + (Number(op.duration_hours) || 0), 0);
                              return (
                                <tr>
                                  <td colSpan={orderShowAll ? 14 : 13} style={{ padding: '4px 14px 8px', background: 'rgba(6,182,212,.04)' }}>
                                    <div style={{ fontSize: 11, color: '#22D3EE', marginBottom: 4 }}>⛓ Маршрут · {rt.name || '—'} · {rt.operations.length} оп. · {total} ч</div>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                      {rt.operations.map((op: any) => (
                                        <span key={op.id || op.sequence_number} style={{ background: '#0B1B33', border: '1px solid #1E3252', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#B0C4DE' }}>
                                          {op.sequence_number} {op.name} · {resName(op.resource_type_id)} · {Number(op.duration_hours) || 0} ч
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })()}
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
                    ? { ...base, position: 'fixed', top: 68, left: 275, right: 18, bottom: 58, maxHeight: 'none', zIndex: 120, borderColor: 'rgba(59,130,246,.6)', boxShadow: '0 24px 70px rgba(0,0,0,.55)' }
                    : { ...base, width: panelWidth ?? '40%', minWidth: 300, maxWidth: '62%', position: 'sticky', top: 16 };
                  const tabs: { v: 'order' | 'bom' | 'route' | 'res' | 'plan'; l: string }[] = [
                    { v: 'order', l: 'Заказ' }, { v: 'bom', l: 'Состав' }, { v: 'route', l: 'Маршрут' }, { v: 'res', l: 'Ресурсы' }, { v: 'plan', l: 'План' },
                  ];
                  const bomNodes = o ? orderBomNodes(o) : [];
                  const renderBomNode = (n: any, d: number): any => {
                    const kids = bomNodes.filter((c: any) => c.parent_id === n.id);
                    return (
                      <div key={n.id}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', borderBottom: '1px dashed rgba(30,58,95,.5)', fontSize: 12.5 }}>
                          <span style={{ color: n.node_type === 'material' ? '#8FA3BD' : '#E2E8F0' }}>{n.nomenclature_name || n.name || n.ext_id}</span>
                          <span style={{ color: '#5A7090' }}>×{n.quantity_per_parent ?? '1'}</span>
                          <span style={{ color: '#5A7090', fontSize: 11 }}>{n.unit}</span>
                          {n.node_type === 'semi_finished' && <span style={{ background: 'rgba(139,92,246,.15)', color: '#C4B5FD', borderRadius: 4, padding: '0 5px', fontSize: 10 }}>ПФ</span>}
                          {n.is_phantom && <span style={{ background: 'rgba(6,182,212,.12)', color: '#67E8F9', borderRadius: 4, padding: '0 5px', fontSize: 10 }}>фантом</span>}
                          {n.routing_id && <span style={{ color: '#22D3EE', fontSize: 10 }}>⛓</span>}
                        </div>
                        {kids.map((k: any) => renderBomNode(k, d + 1))}
                      </div>
                    );
                  };
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
                            <div style={{ fontSize: 12, color: '#8FA3BD', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o ? (o.specification_name || '—') : 'Выберите заказ в списке'}</div>
                          </div>
                          {o && panelTab === 'order' && !panelEditing && (
                            <button onClick={startEditOrder} style={{ background: 'transparent', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✏️ Редактировать</button>
                          )}
                          {isModal && (
                            <button onClick={() => setSelOrderId(null)} style={{ background: 'transparent', border: 0, color: '#8FA3BD', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>✕</button>
                          )}
                        </div>
                        <div style={{ display: 'flex', borderBottom: '1px solid #1E3252' }}>
                          {tabs.map(tb => (
                            <button key={tb.v} onClick={() => { setPanelTab(tb.v); setPanelEditing(false); }} style={{ flex: 1, border: 0, background: 'transparent', color: panelTab === tb.v ? '#fff' : '#8FA3BD', borderBottom: '2px solid ' + (panelTab === tb.v ? '#3B82F6' : 'transparent'), padding: '8px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{tb.l}</button>
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
                            <div style={{ display: 'grid', gap: 8 }}>
                              {([['client', 'Клиент'], ['quantity', 'Кол-во'], ['priority', 'Приоритет'], ['start_date', 'Старт'], ['due_date', 'Финиш'], ['status', 'Статус']] as const).map(([k, label]) => (
                                <label key={k} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }}>
                                  <span style={{ color: '#8FA3BD', fontSize: 12 }}>{label}</span>
                                  {k === 'priority' ? (
                                    <select value={editForm[k] || ''} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                                      <option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option>
                                    </select>
                                  ) : k === 'status' ? (
                                    <select value={editForm[k] || ''} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                                      <option value="draft">Черновик</option><option value="active">В работе</option><option value="completed">Завершён</option>
                                    </select>
                                  ) : (
                                    <input value={editForm[k] || ''} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                                  )}
                                </label>
                              ))}
                              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                                <button onClick={saveOrderEdit} style={{ background: '#3B82F6', border: 0, color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Сохранить</button>
                                <button onClick={() => setPanelEditing(false)} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, cursor: 'pointer' }}>Отмена</button>
                              </div>
                            </div>
                          )}
                          {o && panelTab === 'bom' && (
                            bomNodes.length ? <div>{bomNodes.filter((n: any) => !n.parent_id).map((n: any) => renderBomNode(n, 0))}</div>
                            : <div style={{ color: '#5A7090' }}>Состав не загружен — нажмите кнопку BOM (▸) у заказа в списке.</div>
                          )}
                          {o && panelTab === 'route' && (
                            rt && rt.operations && rt.operations.length ? (
                              <div>
                                <div style={{ fontSize: 11.5, color: '#22D3EE', marginBottom: 8 }}>⛓ {rt.name || 'Маршрут'} · {rt.operations.length} оп. · {rtTotal} ч{rt.variant ? ' · вариант ' + rt.variant : ''}</div>
                                {rt.operations.map((op: any) => (
                                  <div key={op.id || op.sequence_number} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <span style={{ color: '#3B82F6', fontWeight: 700, fontSize: 12 }}>{op.sequence_number}</span>
                                      <span style={{ flex: 1, fontWeight: 600 }}>{op.name}</span>
                                      <span style={{ color: '#FCD34D', fontSize: 12 }}>{Number(op.duration_hours) || 0} ч</span>
                                    </div>
                                    <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 3 }}>
                                      Ресурс: {resName(op.resource_type_id)}{op.setup_hours ? ' · Наладка: ' + op.setup_hours + ' ч' : ''}{op.teardown_hours ? ' · Снятие: ' + op.teardown_hours + ' ч' : ''}{op.predecessors && op.predecessors.length ? ' · Предш.: ' + op.predecessors.join(', ') : ''}{Number(op.output_quantity) ? ' · Вых. годн.: ' + op.output_quantity : ''}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : <div style={{ color: '#5A7090' }}>Маршрут не задан. Привяжите маршрут к корневому узлу спецификации (BOM → узел → routing_id).</div>
                          )}
                          {o && panelTab === 'res' && (
                            resourcesList.length ? (
                              <div>
                                <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>Справочник ресурсов: {resourcesList.length}</div>
                                {resourcesList.map((r: any) => (
                                  <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed rgba(30,58,95,.5)' }}>
                                    <span style={{ flex: 1 }}>{r.name}</span>
                                    <span style={{ color: '#5A7090', fontSize: 11 }}>{r.resource_type || '—'}</span>
                                    <span style={{ color: '#FCD34D', fontSize: 11 }}>×{r.capacity_per_unit ?? r.capacity_per_day ?? '—'}</span>
                                    <span style={{ color: '#5A7090', fontSize: 11 }}>{r.capacity_unit || r.unit || ''}</span>
                                  </div>
                                ))}
                              </div>
                            ) : <div style={{ color: '#5A7090' }}>Справочник ресурсов пуст.</div>
                          )}
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
    .kpi-card{background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3252;border-radius:12px;padding:18px 20px;transition:all .15s}
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
    .proj-card{background:linear-gradient(135deg,#0F1E36,#162844);border:1px solid #1E3252;border-radius:12px;padding:20px;transition:all .15s;cursor:pointer}
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
          {authError ? (
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
    'resources': 'Ресурсы',
    'departments': 'Подразделения',
    'organizations': 'Организации',
    'calendars': 'Календари',
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
      onMouseMove={(e) => { if (menuMode === 'auto' && sidebarCollapsed && e.clientX < 8) setSidebarCollapsed(false); }}
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
        setDirectoryModal={setDirectoryModal}
        setSelectedProject={setSelectedProject}
        setView={setView}
        collapsed={sidebarCollapsed}
        menuMode={menuMode}
        onAutoHide={() => setSidebarCollapsed(true)}
      />

      {/* ═══ MAIN ═══ */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', minWidth: 0, gridColumn: 2 }}>
        {/* Topbar */}
        <div className="topbar">
          {menuMode !== 'expanded' && (
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню в значки'}
              style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #2A4060', background: '#0B1B33', color: '#8FA3BD', cursor: 'pointer', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 4 }}
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
            {view === 'project-groups' && listWinMode && !selectedGroup && (
              <>
                <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
              {newGroupInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewGroupInput(false);else if(e.key==='Enter')addGroup()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addGroup} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewGroupInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
              </>
            )}
            {view === 'project-pools' && listWinMode && !selectedPool && (
              <>
                <button onClick={addPool} className="btn btn-primary btn-sm">+ Пул</button>
              {newPoolInput && (<span style={{display:'inline-flex',gap:4,alignItems:'center',marginLeft:4}}><input value={newPoolName} onChange={e=>setNewPoolName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewPoolInput(false);else if(e.key==='Enter')addPool()}} placeholder="Название" autoFocus style={{background:'#0A1628',border:'1px solid #3B82F6',borderRadius:6,color:'#E8EEF5',padding:'4px 8px',fontSize:12,width:130,outline:'none'}} /><button onClick={addPool} className="btn btn-primary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✓</button><button onClick={()=>setNewPoolInput(false)} className="btn btn-secondary btn-sm" style={{padding:'4px 8px',fontSize:12}}>✕</button></span>)}
              </>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => navTo('new-project')}>+ Новый проект</button>
            <button onClick={onRefresh} className="btn btn-secondary btn-sm" title="Обновить данные" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg></button>
          </div>
        </div>

        <div style={{ padding: '20px 28px 48px', flex: 1, overflow: 'auto' }}>
          {/* ═══ DASHBOARD ═══ */}
          {view === 'dashboard' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="kpi-card"><div className="kpi-label">Всего проектов</div><div className="kpi-val">{projects.length}</div><div className="kpi-sub">активных: {projects.filter((p: any) => p.status === 'active').length}</div></div>
                <div className="kpi-card"><div className="kpi-label">Заказов</div><div className="kpi-val g">{orders.length || '—'}</div><div className="kpi-sub">выберите проект</div></div>
                <div className="kpi-card"><div className="kpi-label">Динамических</div><div className="kpi-val g">{dynCount || '—'}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
                <div className="kpi-card"><div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress || '—'}</div><div className="kpi-sub">активных заказов</div></div>
                <div className="kpi-card"><div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical || '—'}</div><div className="kpi-sub">High + Critical</div></div>
              </div>
              <div className="panel">
                <div className="panel-hdr"><span className="panel-title">Последние проекты</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {projects.slice(0, 4).map((p: any) => (
                    <div key={p.id} className="proj-card" onClick={() => loadProjectDashboard(p)}>
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
              {projects.filter((p: any) => p.status !== 'archived').map((p: any) => (
                <div key={p.id} className="proj-card">
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
              {projects.filter((p: any) => p.status === 'archived').map((p: any) => (
                <div key={p.id} className="proj-card" style={{ opacity: 0.7 }}>
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
                <div className="kpi-card"><div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
                <div className="kpi-card"><div className="kpi-label">Динамические</div><div className="kpi-val g">{dynCount}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
                <div className="kpi-card"><div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress}</div><div className="kpi-sub">{inProgress > 0 ? 'Активных' : 'Нет'}</div></div>
                <div className="kpi-card"><div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical}</div><div className="kpi-sub">High + Critical</div></div>
                <div className="kpi-card"><div className="kpi-label">Групп / Пулов</div><div className="kpi-val">{projGroups.length + projPools.length}</div><div className="kpi-sub">{projGroups.length} гр. · {projPools.length} пул.</div></div>
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
          {view === 'project-orders' && (listWinMode ? <div ref={dashHeadRef}>{renderSectionDashboard()}</div> : renderOrdersView())}

          {/* ═══ PROJECT GANTT ═══ */}
          {view === 'project-gantt' && (
            <div className="panel">
              <div className="panel-hdr">
                <div><span className="panel-title">📊 Диаграмма Ганта</span><span className="panel-sub">{selectedProject?.name}</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
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
                      <th style={{ width: 300 }}>Операция</th>
                      <th style={{ width: 80 }}>Длит. (ч)</th>
                      <th style={{ width: 90 }}>ES</th>
                      <th style={{ width: 90 }}>EF</th>
                      <th style={{ width: 90 }}>LS</th>
                      <th style={{ width: 90 }}>LF</th>
                      <th style={{ width: 80 }}>Резерв</th>
                      <th style={{ minWidth: 300 }}>График</th>
                    </tr></thead>
                    <tbody>
                      {(ganttData.nodes || []).map((n: any) => {
                        const totalDur = ganttData.nodes?.reduce((m: number, x: any) => Math.max(m, x.late_finish || x.early_finish || 0), 1) || 1;
                        const es = n.early_start || 0;
                        const ef = n.early_finish || 0;
                        const dur = n.duration || ef - es || 1;
                        const leftPct = (es / totalDur) * 100;
                        const widthPct = Math.max((dur / totalDur) * 100, 1);
                        const isCritical = n.total_float === 0;
                        const tf = n.total_float || 0;
                        return (
                          <tr key={n.id}>
                            <td style={{ color: isCritical ? '#f87171' : '#E8EEF5', fontWeight: isCritical ? 600 : 400 }}>
                              {isCritical ? '🔴 ' : ''}{n.name}
                            </td>
                            <td className="t-mono">{dur}ч</td>
                            <td className="t-mono">{es}ч</td>
                            <td className="t-mono">{ef}ч</td>
                            <td className="t-mono">{n.late_start ?? '—'}</td>
                            <td className="t-mono">{n.late_finish ?? '—'}</td>
                            <td className="t-mono" style={{ color: tf === 0 ? '#10B981' : '#F59E0B' }}>{tf === 0 ? '0 (КП)' : tf}</td>
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
          {view === 'project-groups' && !selectedGroup && (listWinMode ? (<div ref={dashHeadRef}>{renderSectionDashboard()}</div>) : (
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
          {view === 'project-pools' && !selectedPool && (listWinMode ? (<div ref={dashHeadRef}>{renderSectionDashboard()}</div>) : (
            <>
              {/* ── Dashboard KPI row ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="kpi-card"><div className="kpi-label">Пулов</div><div className="kpi-val v">{projPools.length}</div><div className="kpi-sub">CCM-объединений</div></div>
                <div className="kpi-card"><div className="kpi-label">В пулах</div><div className="kpi-val g">{orders.filter((o: any) => !!o.pool_id).length}</div><div className="kpi-sub">заказов</div></div>
                <div className="kpi-card"><div className="kpi-label">Свободных</div><div className="kpi-val">{orders.filter((o: any) => !o.pool_id).length}</div><div className="kpi-sub">доступно</div></div>
                <div className="kpi-card"><div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
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
                                <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} />
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
                                        <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} />
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
                                    <BomTree nodes={orderBomNodes(o)} compact orderName={o.specification_name} />
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
                { id: 'resources', icon: '🔧', title: 'Ресурсы', desc: 'Станки, люди, бригады' },
                { id: 'departments', icon: '🏢', title: 'Подразделения', desc: 'Цеха, участки, отделы' },
                { id: 'organizations', icon: '🏭', title: 'Организации', desc: 'Клиенты, поставщики, юрлица' },
                { id: 'calendars', icon: '📅', title: 'Календари', desc: 'Праздники, смены, графики' },
              ].map(d => (
                <div key={d.id} className="dir-card" onClick={() => setDirectoryModal(d.id)}>
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

          {view === 'resources' && (
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">{titles[view]}</span></div>
              <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔧</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Раздел в разработке</div>
                <div>Здесь будет таблица ресурсов: станки, бригады, транспорт</div>
              </div>
            </div>
          )}

          {['departments', 'organizations', 'calendars'].includes(view) && (
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
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🗂 Панель заказа</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      Как открывать окно заказа при клике на заказ в списке.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {([['side', 'Сбоку'], ['modal', 'Модальное'], ['window', 'Окна']] as const).map((kv) => (
                        <button key={kv[0]} onClick={() => setPanelMode(kv[0])} style={{ flex: 1, border: '1px solid ' + (panelMode === kv[0] ? 'rgba(59,130,246,.6)' : '#1E3252'), background: panelMode === kv[0] ? 'rgba(59,130,246,.14)' : '#0A1628', color: panelMode === kv[0] ? '#fff' : '#8FA3BD', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{kv[1]}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6, lineHeight: 1.45 }}>
                      {panelMode === 'window' ? 'Окна: несколько заказов одновременно, перетаскивание, прилипание к краям (Snap), сетка раскладок «⛶», панель задач внизу.' : panelMode === 'modal' ? 'Модальное — поверх списка, закрытие по ✕ или Esc.' : 'Сбоку — панель закреплена справа от списка, ширину меняют перетаскиванием разделителя.'}
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
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🪟 Окна для списков</div>
                    <div style={{ fontSize: 12, color: '#5A7090', marginBottom: 12, lineHeight: 1.5 }}>
                      Открывать списки (заказы, группы, пулы) отдельным окном поверх дашборда вместо полного экрана.
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={listWinMode} onChange={e => setListWinMode(e.target.checked)} style={{ accentColor: '#3B82F6' }} />
                      <span style={{ fontSize: 13 }}>Включить окна для списков</span>
                    </label>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6, lineHeight: 1.45 }}>
                      При включении клик по «📋 Заказы», «📁 Группы» или «📦 Пулы» открывает список в окне поверх дашборда; клик по строке — окно заказа или редактор группы/пула.
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
                    <span style={{ fontSize: 20 }}>{directoryModal === 'nomenclature' ? '📦' : directoryModal === 'units' ? '📏' : directoryModal === 'resources' ? '🔧' : directoryModal === 'departments' ? '🏢' : directoryModal === 'organizations' ? '🏭' : '📅'}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#E8EEF5' }}>
                      {directoryModal === 'nomenclature' ? 'Номенклатура' : directoryModal === 'units' ? 'Единицы измерения' : directoryModal === 'resources' ? 'Ресурсы' : directoryModal === 'departments' ? 'Подразделения' : directoryModal === 'organizations' ? 'Организации' : 'Календари'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['nomenclature', 'units', 'resources', 'departments', 'organizations', 'calendars'].map(tab => (
                      <button key={tab} onClick={() => setDirectoryModal(tab)} style={{
                        background: directoryModal === tab ? '#1E3252' : '#162844',
                        color: directoryModal === tab ? '#B0C4DE' : '#5A7090',
                        border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12,
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.12s',
                      }}>
                        {tab === 'nomenclature' ? 'Номенклатура' : tab === 'units' ? 'Ед. измерения' : tab === 'resources' ? 'Ресурсы' : tab === 'departments' ? 'Подразделения' : tab === 'organizations' ? 'Организации' : 'Календари'}
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
                  {directoryModal !== 'nomenclature' && directoryModal !== 'units' && (
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
        routingFor={routingFor}
        resName={resName}
        groups={projGroups}
        pools={projPools}
        isDyn={isDyn}
        renderOrdersTable={() => renderOrdersView('table')}
        onOpenOrder={openOrderPanel}
        onOpenGroup={(g: any) => { if (!selectedProject) return; win.setWins(prev => prev.filter(w => !(w.kind === 'list' && w.listKind === 'groups'))); setSelectedGroup(g); setSelectedProject(selectedProject); setView('project-groups'); setEditingGroup(false); (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`); const gs = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/groups`); const pr = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`); setOrders(o); setGroups(prev => ({ ...prev, [selectedProject.id]: gs.items })); setPools(prev => ({ ...prev, [selectedProject.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })(); }}
        onOpenPool={(p: any) => { if (!selectedProject) return; win.setWins(prev => prev.filter(w => !(w.kind === 'list' && w.listKind === 'pools'))); setSelectedPool(p); setSelectedProject(selectedProject); setView('project-pools'); setSelPoolOrders(new Set()); setSelFreeOrders(new Set()); setEditingPool(false); (async () => { try { const o = await apiF<any[]>(`/production-orders/?project_id=${selectedProject.id}`); const pr = await apiF<{ items: any[] }>(`/projects/${selectedProject.id}/pools`); setOrders(o); setPools(prev => ({ ...prev, [selectedProject.id]: pr.items })); } catch (e: any) { setMsg(String(e)); } })(); }}
        onClose={win.closeWin}
        onFocus={win.focusWin}
        onToggleMin={win.toggleMinWin}
        onMinimizeAll={win.minimizeAll}
        onReset={win.resetWin}
        onToggleMax={win.toggleMaxWin}
        onDrag={win.startDrag}
        onResize={win.startResize}
        onApplyCell={win.applySnapCell}
        onSaveEdit={saveWinEdit}
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
        onClose={() => setImportProjectId(null)}
        onComplete={() => { setImportProjectId(null); refresh(); }}
      />
    )}

    {/* Delete Check Dialog */}
    {deleteCheckEntity && (
      <DeleteCheckDialog
        entityType={deleteCheckEntity.type}
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
          } else {
            load();
          }
        }}
      />
    )}

    {/* BOM heavy modal */}
    {bomModalOrder && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,10,20,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setBomModalOrder(null)}>
        <div style={{ background: '#0F1E36', border: '1px solid #1E3252', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '88vh', overflow: 'auto', padding: 22 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5A7090', fontWeight: 600 }}>BOM · Развёртка</span>
            <span style={{ fontSize: 17, fontWeight: 600, color: '#E8EEF5' }}>{bomModalOrder.specification_name || bomModalOrder.ext_id || '—'}</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setBomModalOrder(null)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 20 }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10, fontSize: 11, color: '#8FA3BD', padding: '8px 12px', background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.18)', borderRadius: 8 }}>
            <span>🔗 Колонка «Заказ» — какой заказ производит этот узел (связывает куст заказов).</span>
            <span style={{ opacity: .85 }}>⛓ Цветные узлы с бейджем заказа — BOM подчинённых заказов цепочки.</span>
            <span style={{ opacity: .85 }}>Переключатель «Только свой BOM / Вся цепочка» — сверху.</span>
          </div>

          {(() => {
            if (bomAnomaliesLoading) {
              return <div style={{ fontSize: 12, color: '#5A7090', padding: '8px 12px', marginBottom: 10 }}>Проверка структуры…</div>;
            }
            if (!bomAnomalies) return null;
            const visible = semiPolicy === 'strict'
              ? [...bomAnomalies.no_routing, ...bomAnomalies.no_order, ...bomAnomalies.self_order]
              : [...bomAnomalies.no_routing, ...bomAnomalies.no_order];
            if (!visible.length) return null;
            const catLabel: Record<string, string> = {
              no_routing: 'нет маршрута',
              no_order: 'нет заказа',
              self_order: 'свой заказ',
            };
            const canCreate = visible.filter((a: any) => a.category !== 'no_routing');
            return (
              <div style={{ marginBottom: 10, padding: '10px 12px', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#FCA5A5' }}>⚠ Аномалии структуры: {visible.length}</span>
                  <span style={{ fontSize: 11, color: '#8FA3BD' }}>полуфабрикаты без маршрута или без подчинённого заказа</span>
                  <div style={{ flex: 1 }} />
                  {canCreate.length > 0 && (
                    <button
                      onClick={createMissingOrders}
                      style={{ background: '#3B82F6', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Создать заказы ({canCreate.length})
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 4, maxHeight: 150, overflow: 'auto' }}>
                  {visible.slice(0, 15).map((a: any, idx: number) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(4,10,20,.4)', borderRadius: 5 }}>
                      <span style={{ color: '#FCA5A5', fontWeight: 600, flex: '0 0 86px' }}>{catLabel[a.category] || a.category}</span>
                      <span style={{ color: '#E8EEF5', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.path || a.name}>
                        {a.name}
                      </span>
                      {a.category !== 'no_routing' && (
                        <button
                          onClick={() => createOrderFromNode(a.node_id)}
                          style={{ background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >
                          Создать заказ
                        </button>
                      )}
                    </div>
                  ))}
                  {visible.length > 15 && <div style={{ fontSize: 11, color: '#5A7090', padding: '2px 8px' }}>…и ещё {visible.length - 15}</div>}
                </div>
              </div>
            );
          })()}

          <BomTree
            nodes={orderBomNodesWithSuborders(bomModalOrder)}
            orderName={bomModalOrder.specification_name}
            timeline={bomTimeline || undefined}
            timelineLoading={bomTimelineLoading}
            onLoadTimeline={loadBomTimeline}
            editable
            orders={(projectOrders[selectedProject?.id || ''] || []).map((x: any) => ({ id: x.id, ext_id: x.ext_id, specification_name: x.specification_name }))}
            onNodeOrderChange={handleNodeOrderChange}
            chainControl
            currentOrderId={bomModalOrder.id}
            anomalyIds={(() => {
              if (!bomAnomalies) return undefined;
              const visible = semiPolicy === 'strict'
                ? [...bomAnomalies.no_routing, ...bomAnomalies.no_order, ...bomAnomalies.self_order]
                : [...bomAnomalies.no_routing, ...bomAnomalies.no_order];
              return new Set(visible.map((a: any) => a.node_id));
            })()}
          />
        </div>
      </div>
    )}

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
