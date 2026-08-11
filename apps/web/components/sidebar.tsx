'use client';

import { useState, useEffect } from 'react';

type View =
  | 'dashboard' | 'projects' | 'project-dashboard' | 'project-orders'
  | 'project-gantt' | 'project-pools' | 'project-groups' | 'archive'
  | 'directories' | 'nomenclature' | 'units' | 'resources'
  | 'departments' | 'organizations' | 'calendars' | 'ccm'
  | 'reports' | 'settings' | 'new-project';

interface SidebarProps {
  view: View;
  navTo: (v: View) => void;
  projects: any[];
  selectedProject: any;
  groups: any[];
  pools: any[];
  projectOrders: Record<string, any[]>;
  expandedOrders: string | null;
  setExpandedOrders: (v: string | null) => void;
  loadProjectDashboard: (p: any) => void;
  loadProjectOrdersView: (p: any) => void;
  loadProjectGantt: (p: any) => void;
  loadProjectPools: (p: any) => void;
  loadProjectGroups: (p: any) => void;
  loadProjectOrders: (id: string) => void;
  setCtxMenu: (m: any) => void;
  setSidebarCtx: (m: any) => void;
  moveOrder: (orderId: string, groupId: string | null, poolId: string | null) => void;
  setDirectoryModal: (m: string | null) => void;
  setSelectedProject: (p: any) => void;
  setView: (v: View) => void;
}

export default function Sidebar(props: SidebarProps) {
  const {
    view, navTo, projects, selectedProject, groups, pools,
    projectOrders, expandedOrders, setExpandedOrders,
    loadProjectDashboard, loadProjectOrdersView, loadProjectGantt,
    loadProjectPools, loadProjectGroups, loadProjectOrders,
    setCtxMenu, setSidebarCtx, moveOrder,
    setDirectoryModal, setSelectedProject, setView,
  } = props;

  // Internal expand state — independent multiselect
  const [expandedProjects, setExpandedProjects] = useState(true);
  const [expandedArchive, setExpandedArchive] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState(false);
  const [expandedProj, setExpandedProj] = useState<Set<string>>(new Set());
  const [expandedProjGroups, setExpandedProjGroups] = useState<Set<string>>(new Set());
  const [expandedProjPools, setExpandedProjPools] = useState<Set<string>>(new Set());

  // Auto-expand directories section when navigating to a directory view
  const dirViews = ['directories', 'nomenclature', 'units', 'resources', 'departments', 'organizations', 'calendars'];
  useEffect(() => {
    if (dirViews.includes(view)) {
      setExpandedDirectories(true);
    }
  }, [view]);

  const toggleProj = (pid: string) => {
    setExpandedProj(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const toggleProjGroups = (pid: string) => {
    setExpandedProjGroups(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const toggleProjPools = (pid: string) => {
    setExpandedProjPools(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const collapseAllProjects = () => {
    setExpandedProj(new Set());
    setExpandedProjGroups(new Set());
    setExpandedProjPools(new Set());
  };

  return (
    <div className="sidebar">
      {/* Inline CSS — self-contained */}
      <style>{`
        .sidebar{
          --s-bg:#0F1E36;--s-border:#1E3252;--s-hover-bg:#162844;
          --s-active-bg:rgba(59,130,246,.12);--s-active-border:#3B82F6;--s-active-shadow:rgba(59,130,246,.1);
          --s-fg:#CBD5E1;--s-fg-hover:#F1F5F9;--s-fg-sub:#94A3B8;--s-fg-active:#60A5FA;
          --s-fg-section:#60A5FA;--s-badge-bg:rgba(100,116,139,.2);--s-badge-fg:#64748B;
          --s-accent:#3B82F6;--s-accent-2:#2563EB;--s-folder-all:#60A5FA;--s-folder-proj:#60A5FA;
          --s-fg-proj:#B0C4DE;
          --s-dragover-bg:rgba(59,130,246,.15);--s-collapse-hover:rgba(59,130,246,.15);
          --s-logo-glow:0 4px 14px rgba(59,130,246,.35);
          background:var(--s-bg);border-right:1px solid var(--s-border);padding:14px 0;
          display:flex;flex-direction:column;height:100vh;position:sticky;top:0;overflow-y:auto;overflow-x:hidden
        }
        [data-theme="light"] .sidebar{
          --s-bg:#F1F5F9;--s-border:#E2E8F0;--s-hover-bg:#F8FAFC;
          --s-active-bg:rgba(59,130,246,.08);--s-active-border:#2563EB;--s-active-shadow:rgba(59,130,246,.05);
          --s-fg:#334155;--s-fg-hover:#0F172A;--s-fg-sub:#64748B;--s-fg-active:#2563EB;
          --s-fg-section:#3B82F6;--s-badge-bg:rgba(100,116,139,.1);--s-badge-fg:#94A3B8;
          --s-accent:#3B82F6;--s-accent-2:#2563EB;--s-folder-all:#3B82F6;--s-folder-proj:#3B82F6;
          --s-fg-proj:#475569;
          --s-dragover-bg:rgba(59,130,246,.08);--s-collapse-hover:rgba(59,130,246,.08);
          --s-logo-glow:0 4px 14px rgba(59,130,246,.15);
        }
        .s-brand{display:flex;align-items:center;gap:10px;padding:4px 16px 14px}
        .s-logo{width:34px;height:34px;background:linear-gradient(135deg,var(--s-accent),var(--s-accent-2));border-radius:9px;box-shadow:var(--s-logo-glow);flex-shrink:0}
        .s-name{font-size:17px;font-weight:700;letter-spacing:-.02em}
        .s-sec{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--s-fg-section);text-transform:uppercase;letter-spacing:.1em;padding:14px 20px 4px;display:flex;align-items:center;justify-content:space-between}
        .s-collapse-all{font-size:11px;cursor:pointer;color:var(--s-fg-section);padding:2px 6px;border-radius:4px;background:none;border:none;font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.05em;opacity:0.5;transition:opacity .15s}
        .s-collapse-all:hover{opacity:1;background:var(--s-collapse-hover)}
        .s-item{display:flex;align-items:center;gap:10px;padding:7px 16px;color:var(--s-fg);font-size:13px;font-weight:500;cursor:pointer;transition:all .12s;text-decoration:none;border:none;background:none;width:100%;text-align:left;font-family:Inter,sans-serif;border-left:3px solid transparent}
        .s-item:hover{background:var(--s-hover-bg);color:var(--s-fg-hover)}
        .s-item.active{background:var(--s-active-bg);color:var(--s-fg-active);font-weight:600;border-left-color:var(--s-active-border);box-shadow:inset 0 0 0 1px var(--s-active-shadow)}
        .s-sub{display:flex;align-items:center;gap:6px;padding:5px 16px 5px 56px;color:var(--s-fg-sub);font-size:12px;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:Inter,sans-serif}
        .s-sub:hover{color:var(--s-fg);background:var(--s-hover-bg)}
        .s-count{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--s-badge-fg);background:var(--s-badge-bg);padding:1px 6px;border-radius:4px}
        .s-expand{font-size:11px;opacity:0.4;transition:opacity .15s;width:12px;text-align:center;flex-shrink:0}
        .s-proj-name{flex:1}
        .s-arrow{cursor:pointer;width:14px;text-align:center;flex-shrink:0;font-size:11px;opacity:0.4;transition:opacity .12s}
        .s-arrow:hover{opacity:1}
        .s-folder{display:inline-block;width:14px;height:11px;background:currentColor;border-radius:2px 3px 3px 2px;position:relative;top:1px;flex-shrink:0}
        .s-folder::before{content:'';position:absolute;top:-3px;left:0;width:7px;height:3px;background:currentColor;border-radius:2px 2px 0 0}
        .s-folder-open{display:inline-block;width:14px;height:11px;border:1.5px solid currentColor;border-radius:2px 3px 3px 2px;position:relative;top:1px;flex-shrink:0;background:transparent}
        .s-folder-open::before{content:'';position:absolute;top:-3px;left:-1.5px;width:7px;height:3px;border:1.5px solid currentColor;border-bottom:none;border-radius:2px 2px 0 0;background:transparent}
        .sidebar::-webkit-scrollbar{width:6px}
        .sidebar::-webkit-scrollbar-track{background:var(--s-bg)}
        .sidebar::-webkit-scrollbar-thumb{background:var(--s-fg-sub);border-radius:3px}
        .sidebar::-webkit-scrollbar-thumb:hover{background:var(--s-fg)}
      `}</style>

      {/* Brand */}
      <div className="s-brand">
        <div className="s-logo" />
        <span className="s-name">ProfyPlan</span>
      </div>

      {/* Навигация */}
      <div className="s-sec" style={{ paddingTop: 4, justifyContent: 'flex-start' }}>
        Навигация
      </div>
      <button
        className={`s-item ${view === 'dashboard' ? 'active' : ''}`}
        onClick={() => navTo('dashboard')}
      >
        📊 Рабочий стол
      </button>

      {/* Проекты */}
      <div className="s-sec">
        <span>Проекты</span>
        {expandedProj.size > 0 && (
          <button className="s-collapse-all" onClick={collapseAllProjects} title="Свернуть все проекты">
            ↕ свернуть
          </button>
        )}
      </div>

      {/* Все проекты — section expand */}
      <div
        className={`s-item ${view === 'projects' ? 'active' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <span
          className="s-arrow"
          onClick={(e) => { e.stopPropagation(); setExpandedProjects(!expandedProjects); }}
        >
          {expandedProjects ? '▼' : '▶'}
        </span>
        <span
          className="s-proj-name"
          onClick={() => navTo('projects')}
          style={{ cursor: 'pointer' }}
        >
          <span className="s-folder" style={{ color: 'var(--s-folder-all)' }} /> Все проекты
        </span>
      </div>

      {expandedProjects && projects.filter((p: any) => p.status !== 'archived').map((p: any) => {
        const isExp = expandedProj.has(p.id);
        return (
          <div key={p.id}>
            <div
              className={`s-item ${view === 'project-dashboard' && selectedProject?.id === p.id ? 'active' : ''}`}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, project: p }); }}
              style={view === 'project-dashboard' && selectedProject?.id === p.id
                ? { paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 10 }
                : { paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--s-fg-proj)' }}
            >
              {/* Arrow — toggles expand only */}
              <span
                className="s-arrow"
                onClick={(e) => { e.stopPropagation(); toggleProj(p.id); }}
              >
                {isExp ? '▼' : '▶'}
              </span>
              {/* Name — navigates only */}
              <span
                className="s-proj-name"
                onClick={() => loadProjectDashboard(p)}
                style={{ cursor: 'pointer' }}
              >
                <span className="s-folder" style={{ color: 'var(--s-folder-proj)' }} /> {p.name}
              </span>
            </div>

            {isExp && (
              <>
                {/* Заказы — arrow + name */}
                <div
                  className="s-sub"
                  style={view === 'project-orders' && selectedProject?.id === p.id ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
                >
                  <span
                    className="s-arrow"
                    onClick={(e) => { e.stopPropagation(); if (expandedOrders !== p.id) { setExpandedOrders(p.id); loadProjectOrders(p.id); } else { setExpandedOrders(null); } }}
                  >
                    {expandedOrders === p.id ? '▼' : '▶'}
                  </span>
                  <span
                    className="s-proj-name"
                    onClick={() => loadProjectOrdersView(p)}
                    style={{ cursor: 'pointer' }}
                  >
                    📋 Заказы
                  </span>
                  <span className="s-count">
                    {projectOrders[p.id]?.length ?? (expandedOrders === p.id ? '...' : (p.order_count || '—'))}
                  </span>
                </div>

                {expandedOrders === p.id && projectOrders[p.id] && (
                  <>
                    {projectOrders[p.id].length === 0 && (
                      <div className="s-sub" style={{ color: 'var(--s-fg-sub)' }}>нет заказов</div>
                    )}
                    {projectOrders[p.id].map((o: any) => (
                      <div
                        key={o.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('orderId', o.id); e.dataTransfer.effectAllowed = 'move'; }}
                        className="s-sub"
                        style={{ paddingLeft: 72, fontSize: 11, cursor: 'grab' }}
                        title={o.specification_name}
                      >
                        {o.specification_name || o.ext_id || '—'}{' '}
                        <span style={{ color: 'var(--s-badge-fg)', marginLeft: 4 }}>×{o.quantity}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Группы — arrow + name */}
                <div
                  className="s-sub"
                  style={view === 'project-groups' && selectedProject?.id === p.id ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
                >
                  <span
                    className="s-arrow"
                    onClick={(e) => { e.stopPropagation(); toggleProjGroups(p.id); }}
                  >
                    {expandedProjGroups.has(p.id) ? '▼' : '▶'}
                  </span>
                  <span
                    className="s-proj-name"
                    onClick={() => loadProjectGroups(p)}
                    style={{ cursor: 'pointer' }}
                  >
                    📁 Группы
                  </span>
                  <span className="s-count">{groups.length || '—'}</span>
                </div>

                {expandedProjGroups.has(p.id) && groups.map((g: any) => (
                  <div
                    key={'sg-' + g.id}
                    className="s-sub"
                    style={{ paddingLeft: 72, fontSize: 11 }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'var(--s-dragover-bg)'; }}
                    onDragLeave={(e) => { e.currentTarget.style.background = ''; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.background = ''; const oid = e.dataTransfer.getData('orderId'); if (oid) moveOrder(oid, g.id, null); }}
                  >
                    📁 {g.name}
                  </div>
                ))}

                {/* Пулы — arrow + name */}
                <div
                  className="s-sub"
                  style={view === 'project-pools' && selectedProject?.id === p.id ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
                >
                  <span
                    className="s-arrow"
                    onClick={(e) => { e.stopPropagation(); toggleProjPools(p.id); }}
                  >
                    {expandedProjPools.has(p.id) ? '▼' : '▶'}
                  </span>
                  <span
                    className="s-proj-name"
                    onClick={() => loadProjectPools(p)}
                    style={{ cursor: 'pointer' }}
                  >
                    📦 Пулы
                  </span>
                </div>

                {expandedProjPools.has(p.id) && pools.map((p: any) => (
                  <div
                    key={'sp-' + p.id}
                    className="s-sub"
                    style={{ paddingLeft: 72, fontSize: 11 }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'var(--s-dragover-bg)'; }}
                    onDragLeave={(e) => { e.currentTarget.style.background = ''; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.background = ''; const oid = e.dataTransfer.getData('orderId'); if (oid) moveOrder(oid, null, p.id); }}
                  >
                    ▸ {p.name}
                  </div>
                ))}

                <div className="s-sub" onClick={() => { setSelectedProject(p); setView('settings'); }}>
                  ⚙️ Настройки
                </div>
                <div
                  className="s-sub"
                  onClick={() => loadProjectGantt(p)}
                  style={view === 'project-gantt' && selectedProject?.id === p.id ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
                >
                  📊 Диаграмма Ганта
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Архив */}
      <div
        className={`s-item ${view === 'archive' ? 'active' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <span
          className="s-arrow"
          onClick={(e) => { e.stopPropagation(); setExpandedArchive(!expandedArchive); }}
        >
          {expandedArchive ? '▼' : '▶'}
        </span>
        <span
          className="s-proj-name"
          onClick={() => navTo('archive')}
          style={{ cursor: 'pointer' }}
        >
          📦 Архив
        </span>
      </div>

      {expandedArchive && (
        <>
          {projects.filter((p: any) => p.status === 'archived').length === 0 && (
            <div className="s-sub" style={{ color: 'var(--s-fg-sub)', paddingLeft: 56 }}>пусто</div>
          )}
          {projects.filter((p: any) => p.status === 'archived').map((p: any) => (
            <button
              key={p.id}
              className={`s-item ${view === 'project-dashboard' && selectedProject?.id === p.id ? 'active' : ''}`}
              onClick={() => loadProjectDashboard(p)}
              style={view === 'project-dashboard' && selectedProject?.id === p.id
                ? { paddingLeft: 32, opacity: 0.7 }
                : { paddingLeft: 32, color: 'var(--s-fg-proj)', opacity: 0.7 }}
            >
              📦 {p.name}
            </button>
          ))}
        </>
      )}

      {/* Данные */}
      <div className="s-sec" style={{ justifyContent: 'flex-start' }}>Данные</div>
      <div
        className={`s-item ${view === 'directories' ? 'active' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <span
          className="s-arrow"
          onClick={(e) => { e.stopPropagation(); setExpandedDirectories(!expandedDirectories); }}
        >
          {expandedDirectories ? '▼' : '▶'}
        </span>
        <span
          className="s-proj-name"
          onClick={() => navTo('directories')}
          style={{ cursor: 'pointer' }}
        >
          📚 Справочники
        </span>
      </div>

      {expandedDirectories && (
        <>
          <div
            className={`s-sub ${view === 'nomenclature' ? 'active' : ''}`}
            style={view === 'nomenclature' ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
            onClick={() => navTo('nomenclature')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'nomenclature' }); }}
            onDoubleClick={() => setDirectoryModal('nomenclature')}
          >
            📦 Номенклатура
          </div>
          <div
            className={`s-sub ${view === 'units' ? 'active' : ''}`}
            style={view === 'units' ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
            onClick={() => navTo('units')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'units' }); }}
            onDoubleClick={() => setDirectoryModal('units')}
          >
            📏 Единицы измерения
          </div>
          <div
            className={`s-sub ${view === 'resources' ? 'active' : ''}`}
            style={view === 'resources' ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
            onClick={() => navTo('resources')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'resources' }); }}
            onDoubleClick={() => setDirectoryModal('resources')}
          >
            🔧 Ресурсы
          </div>
          <div
            className={`s-sub ${view === 'departments' ? 'active' : ''}`}
            style={view === 'departments' ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
            onClick={() => navTo('departments')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'departments' }); }}
            onDoubleClick={() => setDirectoryModal('departments')}
          >
            🏢 Подразделения
          </div>
          <div
            className={`s-sub ${view === 'organizations' ? 'active' : ''}`}
            style={view === 'organizations' ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
            onClick={() => navTo('organizations')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'organizations' }); }}
            onDoubleClick={() => setDirectoryModal('organizations')}
          >
            🏭 Организации
          </div>
          <div
            className={`s-sub ${view === 'calendars' ? 'active' : ''}`}
            style={view === 'calendars' ? { color: 'var(--s-fg-active)', fontWeight: 600 } : {}}
            onClick={() => navTo('calendars')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'calendars' }); }}
            onDoubleClick={() => setDirectoryModal('calendars')}
          >
            📅 Календари
          </div>
        </>
      )}

      {/* Аналитика */}
      <div className="s-sec" style={{ justifyContent: 'flex-start' }}>Аналитика</div>
      <a href="/ccm-v2" className="s-item" style={{ textDecoration: 'none' }}>📈 CCM</a>
      <button className={`s-item ${view === 'reports' ? 'active' : ''}`} onClick={() => navTo('reports')}>
        📋 Отчёты
      </button>

      {/* Настройки (bottom) */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--s-border)', paddingTop: 8 }}>
        <button className={`s-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navTo('settings')}>
          ⚙️ Настройки
        </button>
      </div>
    </div>
  );
}
