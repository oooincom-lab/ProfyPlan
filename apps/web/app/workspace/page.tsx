'use client';

import { useState, useCallback } from 'react';
import ClipboardPaste from '@/components/ClipboardPaste';

const API = 'https://profyplan.ru/api/v1';
const C = (s: string) => s;

async function apiF<T>(path: string, opts?: RequestInit): Promise<T> {
  const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as any || {}) };
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers: h });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  if (r.status === 204) return undefined as any;
  return r.json();
}

type View = 'dashboard' | 'projects' | 'project-detail' | 'directories' | 'nomenclature' | 'resources' | 'departments' | 'organizations' | 'calendars' | 'ccm' | 'reports' | 'settings' | 'new-project';

export default function AppShell() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState<View>('dashboard');
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [pools, setPools] = useState<any[]>([]);
  const [expandedProj, setExpandedProj] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<string | null>(null);
  const [projectOrders, setProjectOrders] = useState<Record<string, any[]>>({});
  const [sidebarSec, setSidebarSec] = useState<string | null>(null);

  const [newOrder, setNewOrder] = useState({ specification_name: '', quantity: '1', unit: 'pcs', priority: 'normal', client: '' });
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [editingOrder, setEditingOrder] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  // ── Context menu ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: any } | null>(null);

  // ── Order CRUD ──
  const loadProjectOrders = async (projId: string) => {
    if (projectOrders[projId]) return;
    try {
      const ords = await apiF<any[]>(`/production-orders/?project_id=${projId}`);
      setProjectOrders(prev => ({ ...prev, [projId]: ords }));
    } catch {}
  };

  const createOrder = async () => {
    if (!newOrder.specification_name.trim() || !selectedProject) return;
    try {
      await apiF(`/production-orders/?project_id=${selectedProject.id}`, {
        method: 'POST', body: JSON.stringify({
          specification_name: newOrder.specification_name, quantity: Number(newOrder.quantity) || 1,
          unit: newOrder.unit, priority: newOrder.priority, client: newOrder.client || null,
        })
      });
      setNewOrder({ specification_name: '', quantity: '1', unit: 'pcs', priority: 'normal', client: '' });
      setShowNewOrder(false);
      await loadProject(selectedProject);
    } catch (e: any) { alert('Ошибка создания: ' + (e.message || String(e))); }
  };

  const deleteOrder = async (orderId: string) => {
    if (!confirm('Удалить заказ?')) return;
    try {
      await apiF(`/production-orders/${orderId}`, { method: 'DELETE' });
      await loadProject(selectedProject);
    } catch (e: any) { alert('Ошибка удаления: ' + (e.message || String(e))); }
  };

  const updateOrder = async (orderId: string) => {
    if (!editValues.specification_name?.trim()) { setEditingOrder(null); return; }
    try {
      await apiF(`/production-orders/${orderId}/update`, {
        method: 'PUT', body: JSON.stringify({
          specification_name: editValues.specification_name,
          quantity: Number(editValues.quantity) || undefined,
          client: editValues.client,
        })
      });
      setEditingOrder(null);
      await loadProject(selectedProject);
    } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); }
  };

  // ── Project actions ──
  const archiveProject = async (p: any) => {
    try {
      await apiF(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: p.status === 'archived' ? 'draft' : 'archived' }) });
      await load().then(() => navTo('projects'));
    } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); }
  };

  const deleteProject = async (p: any) => {
    if (!confirm(`Удалить проект "${p.name}"? Это действие необратимо.`)) return;
    try {
      await apiF(`/projects/${p.id}`, { method: 'DELETE' });
      setSelectedProject(null); setOrders([]);
      await load().then(() => navTo('projects'));
    } catch (e: any) { alert('Ошибка удаления: ' + (e.message || String(e))); }
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
    try {
      await apiF('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }) });
      const proj = await apiF<{ items: any[] }>('/projects');
      setProjects(proj.items);
      setLoaded(true);
    } catch (e: any) { setMsg(e.message || String(e)); }
    setLoading(false);
  }, []);

  const loadProject = async (p: any) => {
    setSelectedProject(p);
    setView('project-detail');
    setExpandedProj(p.id);
    setOrders([]); setGroups([]); setPools([]);
    try {
      const [o, g, pl] = await Promise.all([
        apiF<any[]>(`/production-orders/?project_id=${p.id}`),
        apiF<{ items: any[] }>(`/projects/${p.id}/groups`),
        apiF<{ items: any[] }>(`/projects/${p.id}/pools`),
      ]);
      setOrders(o); setGroups(g.items); setPools(pl.items);
      setMsg(`${o.length} заказов · ${g.items.length} групп · ${pl.items.length} пулов`);
    } catch (e: any) { setMsg(String(e)); }
  };

  const refresh = () => selectedProject && loadProject(selectedProject);

  const addGroup = async () => {
    if (!selectedProject) return;
    const n = prompt('Название группы:');
    if (!n) return;
    await apiF(`/projects/${selectedProject.id}/groups`, { method: 'POST', body: JSON.stringify({ name: n, sort_order: groups.length }) });
    await refresh();
  };

  const delGroup = async (gid: string) => {
    if (!confirm('Удалить группу?')) return;
    await apiF(`/projects/${selectedProject.id}/groups/${gid}`, { method: 'DELETE' });
    await refresh();
  };

  const navTo = (v: View) => { setView(v); setSelectedProject(null); setOrders([]); setGroups([]); setPools([]); };

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
    .panel-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
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
    .sidebar{background:#0F1E36;border-right:1px solid #1E3252;padding:14px 0;display:flex;flex-direction:column;height:100vh;position:sticky;top:0;overflow-y:auto;overflow-x:hidden}
    .s-brand{display:flex;align-items:center;gap:10px;padding:4px 16px 14px}
    .s-logo{width:34px;height:34px;background:linear-gradient(135deg,#3B82F6,#2563EB);border-radius:9px;box-shadow:0 4px 14px rgba(59,130,246,.35);flex-shrink:0}
    .s-name{font-size:17px;font-weight:700;letter-spacing:-.02em}
    .s-sec{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#60A5FA;text-transform:uppercase;letter-spacing:.1em;padding:14px 20px 4px}
    .s-item{display:flex;align-items:center;gap:10px;padding:7px 16px;color:#8FA3BD;font-size:13px;cursor:pointer;transition:all .12s;text-decoration:none;border:none;background:none;width:100%;text-align:left;font-family:Inter,sans-serif;border-left:3px solid transparent}
    .s-item:hover{background:#162844;color:#B0C4DE}
    .s-item.active{background:rgba(59,130,246,.12);color:#60A5FA;font-weight:600;border-left-color:#3B82F6;box-shadow:inset 0 0 0 1px rgba(59,130,246,.1)}
    .s-sub{display:flex;align-items:center;gap:6px;padding:5px 16px 5px 44px;color:#5A7090;font-size:12px;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:Inter,sans-serif}
    .s-sub:hover{color:#8FA3BD;background:#162844}
    .s-count{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#374151;background:rgba(100,116,139,.2);padding:1px 6px;border-radius:4px}
    .s-expand{font-size:11px;opacity:0.4;transition:opacity .15s;width:12px;text-align:center;flex-shrink:0}
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
          <button onClick={load} disabled={loading} className="btn btn-primary" style={{ padding: '12px 36px', fontSize: 15 }}>
            {loading ? 'Загрузка...' : 'Загрузить рабочий стол'}
          </button>
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
    'project-detail': selectedProject?.name || 'Проект',
    'directories': 'Справочники',
    'nomenclature': 'Номенклатура',
    'resources': 'Ресурсы',
    'departments': 'Подразделения',
    'organizations': 'Организации',
    'calendars': 'Календари',
    'ccm': 'CCM',
    'reports': 'Отчёты',
    'settings': 'Настройки',
    'new-project': 'Новый проект',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* ═══ SIDEBAR ═══ */}
      <div className="sidebar">
        <div className="s-brand">
          <div className="s-logo" />
          <span className="s-name">ProfyPlan</span>
        </div>

        <div className="s-sec" style={{ paddingTop: 4 }}>Навигация</div>
        <button className={`s-item ${view === 'dashboard' ? 'active' : ''}`} onClick={() => navTo('dashboard')}>
          📊 Рабочий стол
        </button>

        <div className="s-sec">Проекты</div>
        <button className={`s-item ${view === 'projects' ? 'active' : ''}`} onClick={() => navTo('projects')}>
          📁 Все проекты
        </button>
        {projects.map((p: any) => {
          const isExp = expandedProj === p.id;
          return (
            <div key={p.id}>
              <button
                className={`s-item ${view === 'project-detail' && selectedProject?.id === p.id ? 'active' : ''}`}
                onClick={() => loadProject(p)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, project: p }); }}
                style={{ paddingLeft: 16 }}
              >
                <span className="s-expand" style={{ opacity: isExp ? 1 : 0.4 }}>{isExp ? '▼' : '▶'}</span>
                📁 {p.name}
              </button>
              {isExp && (
                <>
                  <div className="s-sub" onClick={() => { if (expandedOrders === p.id) { setExpandedOrders(null); } else { setExpandedOrders(p.id); loadProjectOrders(p.id); } }}>
                    📋 Заказы <span className="s-count">{projectOrders[p.id]?.length ?? (expandedOrders === p.id ? '...' : (p.order_count || '—'))}</span>
                  </div>
                  {expandedOrders === p.id && projectOrders[p.id] && (
                    <>
                      {projectOrders[p.id].length === 0 && <div className="s-sub" style={{ color: '#5A7090' }}>нет заказов</div>}
                      {projectOrders[p.id].map((o: any) => (
                        <div key={o.id} className="s-sub" style={{ paddingLeft: 60, fontSize: 11 }} title={o.specification_name}>
                          {o.specification_name || o.ext_id || '—'} <span style={{ color: '#374151', marginLeft: 4 }}>×{o.quantity}</span>
                        </div>
                      ))}
                    </>
                  )}
                  <div className="s-sub" onClick={() => {}}>
                    📁 Группы <span className="s-count">{groups.length || '—'}</span>
                  </div>
                  <div className="s-sub" onClick={() => {}}>
                    📦 Пулы <span className="s-count">{pools.length || '—'}</span>
                  </div>
                  <div className="s-sub" onClick={() => { setSelectedProject(p); setView('settings'); }}>
                    ⚙️ Настройки
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="s-sec">Данные</div>
        <button className={`s-item ${view === 'directories' ? 'active' : ''}`} onClick={() => navTo('directories')}>
          📚 Справочники
        </button>
        {['directories', 'nomenclature', 'resources', 'departments', 'organizations', 'calendars'].includes(view) && (
          <>
            <div className={`s-sub ${view === 'nomenclature' ? 'active' : ''}`} style={view === 'nomenclature' ? { color: '#60A5FA', fontWeight: 600 } : {}} onClick={() => navTo('nomenclature')}>
              📦 Номенклатура
            </div>
            <div className={`s-sub ${view === 'resources' ? 'active' : ''}`} style={view === 'resources' ? { color: '#60A5FA', fontWeight: 600 } : {}} onClick={() => navTo('resources')}>
              🔧 Ресурсы
            </div>
            <div className={`s-sub ${view === 'departments' ? 'active' : ''}`} style={view === 'departments' ? { color: '#60A5FA', fontWeight: 600 } : {}} onClick={() => navTo('departments')}>
              🏢 Подразделения
            </div>
            <div className={`s-sub ${view === 'organizations' ? 'active' : ''}`} style={view === 'organizations' ? { color: '#60A5FA', fontWeight: 600 } : {}} onClick={() => navTo('organizations')}>
              🏭 Организации
            </div>
            <div className={`s-sub ${view === 'calendars' ? 'active' : ''}`} style={view === 'calendars' ? { color: '#60A5FA', fontWeight: 600 } : {}} onClick={() => navTo('calendars')}>
              📅 Календари
            </div>
          </>
        )}

        <div className="s-sec">Аналитика</div>
        <a href="/ccm-v2" className="s-item" style={{ textDecoration: 'none' }}>📈 CCM</a>
        <button className={`s-item ${view === 'reports' ? 'active' : ''}`} onClick={() => navTo('reports')}>📋 Отчёты</button>

        <div style={{ marginTop: 'auto', borderTop: '1px solid #1E3252', paddingTop: 8 }}>
          <button className={`s-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navTo('settings')}>
            ⚙️ Настройки
          </button>
        </div>
      </div>

      {/* ═══ MAIN ═══ */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Topbar */}
        <div className="topbar">
          <div>
            <h1>{titles[view]}</h1>
            {view === 'project-detail' && <div className="tb-sub">{msg}</div>}
            {view === 'projects' && <div className="tb-sub">{projects.length} проектов</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {view === 'project-detail' && (
              <>
                <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
                <button onClick={refresh} className="btn btn-secondary btn-sm">🔄</button>
              </>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => navTo('new-project')}>+ Новый проект</button>
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
                    <div key={p.id} className="proj-card" onClick={() => loadProject(p)}>
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
              {projects.map((p: any) => (
                <div key={p.id} className="proj-card">
                  <div className="pc-name">📁 {p.name}</div>
                  <div className="pc-meta">{p.status} · {p.mode || 'cpm'} · {new Date(p.created_at).toLocaleDateString('ru')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => loadProject(p)}>Открыть</button>
                    <button className="btn btn-secondary btn-sm">📥 Импорт</button>
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

          {/* ═══ PROJECT DETAIL ═══ */}
          {view === 'project-detail' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="kpi-card"><div className="kpi-label">Всего заказов</div><div className="kpi-val">{orders.length}</div><div className="kpi-sub">{totalQty.toFixed(0)} ед.</div></div>
                <div className="kpi-card"><div className="kpi-label">Динамические</div><div className="kpi-val g">{dynCount}</div><div className="kpi-sub">⚡ CPM развёрнут</div></div>
                <div className="kpi-card"><div className="kpi-label">В работе</div><div className="kpi-val g">{inProgress}</div><div className="kpi-sub">{inProgress > 0 ? 'Активных' : 'Нет'}</div></div>
                <div className="kpi-card"><div className="kpi-label">Приоритетных</div><div className="kpi-val r">{critical}</div><div className="kpi-sub">High + Critical</div></div>
                <div className="kpi-card"><div className="kpi-label">Групп / Пулов</div><div className="kpi-val">{groups.length + pools.length}</div><div className="kpi-sub">{groups.length} гр. · {pools.length} пул.</div></div>
              </div>

              <div className="panel">
                <div className="panel-hdr">
                  <div><span className="panel-title">Заказы</span><span className="panel-sub">КОРЕНЬ · {rootOrders.length} шт.</span></div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowNewOrder(true)}>+ Заказ</button>
                    <span style={{ fontSize: 11, color: '#5A7090' }}>⚡ = CPM</span><span style={{ fontSize: 11, color: '#5A7090' }}>○ = План</span>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead><tr><th className="t-graph">Граф</th><th>ID</th><th>Продукт</th><th>Клиент</th><th>Кол-во</th><th>Приоритет</th><th>Статус</th><th>Старт</th><th>Финиш</th><th style={{ width: 40 }}></th></tr></thead>
                    <tbody>
                      {rootOrders.map((o: any) => (
                        <tr key={o.id}>
                          <td className="t-graph"><span className={isDyn(o) ? 'g-dyn' : 'g-pln'} title={isDyn(o) ? `${o.operations_created || '?'} операций` : 'Нет графа'}>{isDyn(o) ? '⚡' : '○'}</span></td>
                          <td className="t-mono">{o.ext_id || '—'}</td>
                          <td className="t-name">{o.specification_name || o.ext_id || '—'}</td>
                          <td>{o.client || '—'}</td>
                          <td className="t-mono">{o.quantity} {o.unit}</td>
                          <td><span className={`badge ${o.priority}`}>{o.priority === 'high' ? 'Высокий' : o.priority === 'critical' ? 'Критич.' : o.priority === 'low' ? 'Низкий' : 'Обычный'}</span></td>
                          <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черновик' : o.status === 'planned' ? 'План' : o.status === 'in_progress' ? 'В работе' : 'Завершён'}</span></td>
                          <td className="t-mono">{o.start_date || '—'}</td>
                          <td className="t-mono">{o.due_date || '—'}</td>
                          <td><button onClick={() => deleteOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.5, padding: '2px 4px' }} title="Удалить заказ">🗑</button></td>
                        </tr>
                      ))}
                      {showNewOrder && (
                        <tr>
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
                      {rootOrders.length === 0 && !showNewOrder && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Заказов нет</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {groups.map((g: any) => {
                const gOrds = grpOrders(g.id);
                return (
                  <div key={g.id} className="group-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: gOrds.length > 0 ? 12 : 0 }}>
                      <div><span style={{ fontWeight: 600, fontSize: 15 }}>📁 {g.name}</span><span className="t-mono" style={{ marginLeft: 10, fontSize: 12 }}>{gOrds.length} заказов</span></div>
                      <button onClick={() => delGroup(g.id)} className="btn btn-danger btn-sm">🗑</button>
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
                            <td><button onClick={() => deleteOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.5, padding: '2px 4px' }}>🗑</button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* ═══ DIRECTORIES ═══ */}
          {view === 'directories' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
              {[
                { id: 'nomenclature', icon: '📦', title: 'Номенклатура', desc: 'Продукты, материалы, узлы' },
                { id: 'resources', icon: '🔧', title: 'Ресурсы', desc: 'Станки, люди, бригады' },
                { id: 'departments', icon: '🏢', title: 'Подразделения', desc: 'Цеха, участки, отделы' },
                { id: 'organizations', icon: '🏭', title: 'Организации', desc: 'Клиенты, поставщики, юрлица' },
                { id: 'calendars', icon: '📅', title: 'Календари', desc: 'Праздники, смены, графики' },
              ].map(d => (
                <div key={d.id} className="dir-card" onClick={() => navTo(d.id as View)}>
                  <div className="dc-icon">{d.icon}</div>
                  <div className="dc-title">{d.title}</div>
                  <div className="dc-count">{d.desc}</div>
                </div>
              ))}
            </div>
          )}

          {/* ═══ DIRECTORY DETAILS (placeholder) ═══ */}
          {['nomenclature', 'resources', 'departments', 'organizations', 'calendars'].includes(view) && (
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
              <div className="panel-hdr"><span className="panel-title">Настройки интерфейса</span></div>
              <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
                <div>Тема, состав KPI, уведомления — в разработке</div>
                <div style={{ marginTop: 16, fontSize: 13, color: '#8FA3BD' }}>Для управления проектом выберите его и нажмите ⚙️ в карточке</div>
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

          {/* ═══ REPORTS / CCM ═══ */}
          {view === 'reports' && (
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">Отчёты</span></div>
              <div style={{ textAlign: 'center', padding: 48, color: '#5A7090' }}>📋 Раздел в разработке</div>
            </div>
          )}
        </div>
      </div>
    </div>

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
          <div style={{ padding: '8px 14px', fontSize: 13, color: '#B0C4DE', borderBottom: '1px solid #1E3252', marginBottom: 4 }}>
            📁 {ctxMenu.project.name}
          </div>
          <button onClick={() => { const newName = prompt('Новое название:', ctxMenu.project.name); if (newName && newName !== ctxMenu.project.name) { renameProject(ctxMenu.project, newName); } setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#B0C4DE', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            ✏️ Переименовать
          </button>
          <button onClick={() => { archiveProject(ctxMenu.project); setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#B0C4DE', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            {ctxMenu.project.status === 'archived' ? '📂 Восстановить' : '📦 В архив'}
          </button>
          <button onClick={() => { if (confirm('Удалить проект и все данные?')) { deleteProject(ctxMenu.project); } setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#EF4444', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            🗑 Удалить
          </button>
        </div>
      </>
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
  const [showManual, setShowManual] = useState(false);
  const [creating, setCreating] = useState(false);

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
            {[
              { icon: '📥', title: 'Импорт из Excel', desc: 'Загрузите .xlsx файл' },
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
          <ClipboardPaste onApply={(rows) => { setManualRows(rows); setShowManual(false); }} />
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
              <div style={{ color: '#5A7090' }}>Данные</div><div>{manualRows.length > 0 ? `${manualRows.length} строк вручную` : 'Будут добавлены позже'}</div>
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
          <button className="btn btn-primary" disabled={creating} onClick={async () => { setCreating(true); try { const proj = await apiF('/projects', { method: 'POST', body: JSON.stringify({ name: name || 'Без названия', mode: mode === 'quick' ? 'quick' : 'project', default_method: mode === 'pert' ? 'pert_cpm' : 'cpm', country_code: country }) }); if (manualRows.length > 0 && proj.id) { await Promise.all(manualRows.map((row: any) => apiF(`/production-orders/?project_id=${proj.id}`, { method: 'POST', body: JSON.stringify({ ext_id: row.ext_id || null, specification_name: row.specification_name || null, quantity: Number(row.quantity) || 1, unit: row.unit || 'pcs', start_date: row.start_date || null, due_date: row.due_date || null, priority: row.priority || 'normal', client: row.client || null, notes: row.notes || null }) }))); } onCreated(); } catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); } }}>
            {creating ? 'Создание...' : 'Создать проект'}
          </button>
        )}
      </div>
    </div>
  );
}
