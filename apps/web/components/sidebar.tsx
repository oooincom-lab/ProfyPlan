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

  const collapseAllProjects = () => {
    setExpandedProj(new Set());
  };

  return (
    <div className="sidebar">
      {/* Inline CSS — self-contained */}
      <style>{`
        .sidebar{background:#0F1E36;border-right:1px solid #1E3252;padding:14px 0;display:flex;flex-direction:column;height:100vh;position:sticky;top:0;overflow-y:auto;overflow-x:hidden}
        .s-brand{display:flex;align-items:center;gap:10px;padding:4px 16px 14px}
        .s-logo{width:34px;height:34px;background:linear-gradient(135deg,#3B82F6,#2563EB);border-radius:9px;box-shadow:0 4px 14px rgba(59,130,246,.35);flex-shrink:0}
        .s-name{font-size:17px;font-weight:700;letter-spacing:-.02em}
        .s-sec{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#60A5FA;text-transform:uppercase;letter-spacing:.1em;padding:14px 20px 4px;display:flex;align-items:center;justify-content:space-between}
        .s-collapse-all{font-size:11px;cursor:pointer;color:#60A5FA;padding:2px 6px;border-radius:4px;background:none;border:none;font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.05em;opacity:0.5;transition:opacity .15s}
        .s-collapse-all:hover{opacity:1;background:rgba(59,130,246,.15)}
        .s-item{display:flex;align-items:center;gap:10px;padding:7px 16px;color:#8FA3BD;font-size:13px;cursor:pointer;transition:all .12s;text-decoration:none;border:none;background:none;width:100%;text-align:left;font-family:Inter,sans-serif;border-left:3px solid transparent}
        .s-item:hover{background:#162844;color:#B0C4DE}
        .s-item.active{background:rgba(59,130,246,.12);color:#60A5FA;font-weight:600;border-left-color:#3B82F6;box-shadow:inset 0 0 0 1px rgba(59,130,246,.1)}
        .s-sub{display:flex;align-items:center;gap:6px;padding:5px 16px 5px 80px;color:#5A7090;font-size:12px;cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:Inter,sans-serif}
        .s-sub:hover{color:#8FA3BD;background:#162844}
        .s-count{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#374151;background:rgba(100,116,139,.2);padding:1px 6px;border-radius:4px}
        .s-expand{font-size:11px;opacity:0.4;transition:opacity .15s;width:12px;text-align:center;flex-shrink:0}
        .s-proj-name{flex:1}
        .s-arrow{cursor:pointer;width:14px;text-align:center;flex-shrink:0;font-size:11px;opacity:0.4;transition:opacity .12s}
        .s-arrow:hover{opacity:1}
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
          📁 Все проекты
        </span>
      </div>

      {expandedProjects && projects.filter((p: any) => p.status !== 'archived').map((p: any) => {
        const isExp = expandedProj.has(p.id);
        return (
          <div key={p.id}>
            <div
              className={`s-item ${(view === 'project-dashboard' || view === 'project-orders') && selectedProject?.id === p.id ? 'active' : ''}`}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, project: p }); }}
              style={{ paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 10 }}
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
                📁 {p.name}
              </span>
            </div>

            {isExp && (
              <>
                <div
                  className="s-sub"
                  onClick={() => { loadProjectOrdersView(p); if (expandedOrders !== p.id) { setExpandedOrders(p.id); loadProjectOrders(p.id); } }}
                  style={view === 'project-orders' && selectedProject?.id === p.id ? { color: '#60A5FA', fontWeight: 600 } : {}}
                >
                  📋 Заказы{' '}
                  <span className="s-count">
                    {projectOrders[p.id]?.length ?? (expandedOrders === p.id ? '...' : (p.order_count || '—'))}
                  </span>
                </div>

                {expandedOrders === p.id && projectOrders[p.id] && (
                  <>
                    {projectOrders[p.id].length === 0 && (
                      <div className="s-sub" style={{ color: '#5A7090' }}>нет заказов</div>
                    )}
                    {projectOrders[p.id].map((o: any) => (
                      <div
                        key={o.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('orderId', o.id); e.dataTransfer.effectAllowed = 'move'; }}
                        className="s-sub"
                        style={{ paddingLeft: 96, fontSize: 11, cursor: 'grab' }}
                        title={o.specification_name}
                      >
                        {o.specification_name || o.ext_id || '—'}{' '}
                        <span style={{ color: '#374151', marginLeft: 4 }}>×{o.quantity}</span>
                      </div>
                    ))}
                  </>
                )}

                <div
                  className="s-sub"
                  onClick={() => loadProjectGroups(p)}
                  style={view === 'project-groups' && selectedProject?.id === p.id ? { color: '#60A5FA', fontWeight: 600 } : {}}
                >
                  📁 Группы <span className="s-count">{groups.length || '—'}</span>
                </div>

                {groups.map((g: any) => (
                  <div
                    key={'sg-' + g.id}
                    className="s-sub"
                    style={{ paddingLeft: 96, fontSize: 11 }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'rgba(59,130,246,.15)'; }}
                    onDragLeave={(e) => { e.currentTarget.style.background = ''; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.background = ''; const oid = e.dataTransfer.getData('orderId'); if (oid) moveOrder(oid, g.id, null); }}
                  >
                    📁 {g.name}
                  </div>
                ))}

                {pools.map((p: any) => (
                  <div
                    key={'sp-' + p.id}
                    className="s-sub"
                    style={{ paddingLeft: 96, fontSize: 11 }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'rgba(59,130,246,.15)'; }}
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
                  style={view === 'project-gantt' && selectedProject?.id === p.id ? { color: '#60A5FA', fontWeight: 600 } : {}}
                >
                  📊 Диаграмма Ганта
                </div>
                <div
                  className="s-sub"
                  onClick={() => loadProjectPools(p)}
                  style={view === 'project-pools' && selectedProject?.id === p.id ? { color: '#60A5FA', fontWeight: 600 } : {}}
                >
                  📦 Пулы
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
            <div className="s-sub" style={{ color: '#5A7090', paddingLeft: 80 }}>пусто</div>
          )}
          {projects.filter((p: any) => p.status === 'archived').map((p: any) => (
            <button
              key={p.id}
              className={`s-item ${view === 'project-dashboard' && selectedProject?.id === p.id ? 'active' : ''}`}
              onClick={() => loadProjectDashboard(p)}
              style={{ paddingLeft: 32, opacity: 0.7 }}
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
            style={view === 'nomenclature' ? { color: '#60A5FA', fontWeight: 600 } : {}}
            onClick={() => navTo('nomenclature')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'nomenclature' }); }}
            onDoubleClick={() => setDirectoryModal('nomenclature')}
          >
            📦 Номенклатура
          </div>
          <div
            className={`s-sub ${view === 'units' ? 'active' : ''}`}
            style={view === 'units' ? { color: '#60A5FA', fontWeight: 600 } : {}}
            onClick={() => navTo('units')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'units' }); }}
            onDoubleClick={() => setDirectoryModal('units')}
          >
            📏 Единицы измерения
          </div>
          <div
            className={`s-sub ${view === 'resources' ? 'active' : ''}`}
            style={view === 'resources' ? { color: '#60A5FA', fontWeight: 600 } : {}}
            onClick={() => navTo('resources')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'resources' }); }}
            onDoubleClick={() => setDirectoryModal('resources')}
          >
            🔧 Ресурсы
          </div>
          <div
            className={`s-sub ${view === 'departments' ? 'active' : ''}`}
            style={view === 'departments' ? { color: '#60A5FA', fontWeight: 600 } : {}}
            onClick={() => navTo('departments')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'departments' }); }}
            onDoubleClick={() => setDirectoryModal('departments')}
          >
            🏢 Подразделения
          </div>
          <div
            className={`s-sub ${view === 'organizations' ? 'active' : ''}`}
            style={view === 'organizations' ? { color: '#60A5FA', fontWeight: 600 } : {}}
            onClick={() => navTo('organizations')}
            onContextMenu={(e) => { e.preventDefault(); setSidebarCtx({ x: e.clientX, y: e.clientY, view: 'organizations' }); }}
            onDoubleClick={() => setDirectoryModal('organizations')}
          >
            🏭 Организации
          </div>
          <div
            className={`s-sub ${view === 'calendars' ? 'active' : ''}`}
            style={view === 'calendars' ? { color: '#60A5FA', fontWeight: 600 } : {}}
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
      <div style={{ marginTop: 'auto', borderTop: '1px solid #1E3252', paddingTop: 8 }}>
        <button className={`s-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navTo('settings')}>
          ⚙️ Настройки
        </button>
      </div>
    </div>
  );
}
