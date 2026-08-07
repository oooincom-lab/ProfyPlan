'use client';

import { useState, useCallback } from 'react';

const API = 'https://profyplan.ru/api/v1';

async function apiF<T>(path: string, opts?: RequestInit): Promise<T> {
  const tok = localStorage.getItem('profyplan_token');
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as any || {}) };
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers: h });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

export default function WorkspacePage() {
  const [loaded, setLoaded] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [pools, setPools] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [projectName, setProjectName] = useState('');
  const [pid, setPid] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await apiF('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }) });
      const proj: any = await apiF('/projects');
      const id = proj.items[0].id;
      setPid(id);
      setProjectName(proj.items[0].name);
      const [o, g, p] = await Promise.all([
        apiF<any[]>(`/production-orders/?project_id=${id}`),
        apiF<{ items: any[] }>(`/projects/${id}/groups`),
        apiF<{ items: any[] }>(`/projects/${id}/pools`),
      ]);
      setOrders(o); setGroups(g.items); setPools(p.items);
      setLoaded(true);
      setMsg(`${o.length} заказов · ${g.items.length} групп · ${p.items.length} пулов`);
    } catch (e: any) { setMsg(e.message || String(e)); }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!pid) return;
    const [o, g, p] = await Promise.all([
      apiF<any[]>(`/production-orders/?project_id=${pid}`),
      apiF<{ items: any[] }>(`/projects/${pid}/groups`),
      apiF<{ items: any[] }>(`/projects/${pid}/pools`),
    ]);
    setOrders(o); setGroups(g.items); setPools(p.items);
  }, [pid]);

  const addGroup = async () => {
    const n = prompt('Название группы:');
    if (!n || !pid) return;
    await apiF(`/projects/${pid}/groups`, { method: 'POST', body: JSON.stringify({ name: n, sort_order: groups.length }) });
    await refresh();
  };

  const delGroup = async (gid: string) => {
    if (!confirm('Удалить группу?')) return;
    await apiF(`/projects/${pid}/groups/${gid}`, { method: 'DELETE' });
    await refresh();
  };

  const rootOrders = orders.filter((o: any) => !o.group_id && !o.pool_id);
  const grpOrders = (gid: string) => orders.filter((o: any) => o.group_id === gid);

  // ── Loading screen ──
  if (!loaded) {
    return (
      <div style={{ background: '#0A1628', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 20px', background: 'linear-gradient(135deg, #3B82F6, #2563EB)', borderRadius: 12, boxShadow: '0 4px 20px rgba(59,130,246,0.35)' }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#E8EEF5', marginBottom: 8 }}>ProfyPlan</h1>
          <p style={{ color: '#5A7090', marginBottom: 24 }}>{msg || 'Рабочий стол'}</p>
          <button onClick={load} disabled={loading} style={{
            padding: '12px 36px', fontSize: 15, fontWeight: 600,
            background: loading ? '#1e3a5f' : 'linear-gradient(135deg, #3B82F6, #2563EB)',
            color: 'white', border: 'none', borderRadius: 10, cursor: loading ? 'default' : 'pointer',
            boxShadow: '0 4px 16px rgba(59,130,246,0.3)',
          }}>
            {loading ? 'Загрузка...' : 'Загрузить рабочий стол'}
          </button>
        </div>
      </div>
    );
  }

  // ── Stats ──
  const totalQty = orders.reduce((s: number, o: any) => s + parseFloat(o.quantity || '0'), 0);
  const inProgress = orders.filter((o: any) => o.status === 'in_progress').length;
  const critical = orders.filter((o: any) => o.priority === 'high' || o.priority === 'critical').length;

  // ── Layout ──
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#0A1628', color: '#E8EEF5' }}>
      <style>{`
        /* KPI */
        .kpi-card { background: linear-gradient(135deg, #0F1E36, #162844); border: 1px solid #1E3252; border-radius: 12px; padding: 18px 20px; transition: all 0.15s; }
        .kpi-card:hover { border-color: #2A4060; transform: translateY(-1px); }
        .kpi-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #60A5FA; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
        .kpi-val { font-family: 'IBM Plex Mono', monospace; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 2px; }
        .kpi-val.green { color: #10B981; }
        .kpi-val.red { color: #EF4444; }
        .kpi-sub { font-size: 12px; color: #5A7090; }
        /* Panel */
        .panel { background: linear-gradient(135deg, #0F1E36, #162844); border: 1px solid #1E3252; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
        .panel-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .panel-title { font-size: 15px; font-weight: 600; }
        .panel-sub { font-size: 12px; color: #5A7090; font-family: 'IBM Plex Mono', monospace; margin-left: 8px; }
        /* Table */
        .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tbl th { text-align: left; padding: 8px 12px; color: #60A5FA; font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #1E3252; }
        .tbl td { padding: 10px 12px; border-bottom: 1px solid #162844; color: #B0C4DE; }
        .tbl tr:hover td { background: rgba(59,130,246,0.05); }
        .tbl .name { color: #E8EEF5; font-weight: 600; }
        .tbl .mono { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #5A7090; }
        .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 6px; display: inline-block; }
        .badge.draft { background: rgba(100,116,139,0.15); color: #94a3b8; }
        .badge.planned { background: rgba(59,130,246,0.15); color: #60A5FA; }
        .badge.in_progress { background: rgba(16,185,129,0.15); color: #34d399; }
        .badge.completed { background: rgba(16,185,129,0.2); color: #10B981; }
        .badge.high { background: rgba(239,68,68,0.12); color: #f87171; }
        .badge.critical { background: rgba(239,68,68,0.18); color: #ef4444; }
        .badge.normal { background: rgba(100,116,139,0.15); color: #94a3b8; }
        .badge.low { background: rgba(100,116,139,0.1); color: #64748b; }
        /* Buttons */
        .btn { font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: all 0.12s; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .btn-primary { background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; box-shadow: 0 4px 12px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.2); }
        .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.2); }
        .btn-secondary { background: transparent; color: #B0C4DE; border-color: #2A4060; }
        .btn-secondary:hover { border-color: #3B82F6; color: #60A5FA; }
        .btn-danger { color: #EF4444; border-color: transparent; background: rgba(239,68,68,0.08); }
        .btn-danger:hover { background: rgba(239,68,68,0.15); }
        .btn-sm { font-size: 11px; padding: 4px 10px; }
        /* Group card */
        .group-card { background: rgba(59,130,246,0.04); border: 1px solid #1E3252; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; }
        .group-card:hover { border-color: #2A4060; }
      `}</style>

      {/* Sidebar */}
      <div style={{ background: '#0F1E36', borderRight: '1px solid #1E3252', padding: '20px 16px', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 20px' }}>
          <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #3B82F6, #2563EB)', borderRadius: 10, boxShadow: '0 4px 14px rgba(59,130,246,0.35)' }} />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>ProfyPlan</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '16px 8px 6px' }}>Навигация</div>
          <a href="/workspace" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.12)', color: '#60A5FA', fontWeight: 600, textDecoration: 'none', fontSize: 14, borderLeft: '3px solid #3B82F6' }}>📊 Рабочий стол</a>
          <a href="/ccm-v2" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, color: '#8FA3BD', textDecoration: 'none', fontSize: 14 }}>📈 CCM</a>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, color: '#8FA3BD', textDecoration: 'none', fontSize: 14 }}>📁 Проекты</a>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, color: '#8FA3BD', textDecoration: 'none', fontSize: 14 }}>📋 Отчёты</a>
        </div>
      </div>

      {/* Main */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Topbar */}
        <div style={{ padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1E3252', background: '#0F1E36', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.015em' }}>Рабочий стол</h1>
            <div style={{ fontSize: 12, color: '#5A7090', marginTop: 2 }}>
              Проект: <span style={{ color: '#60A5FA' }}>{projectName}</span> · {msg}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addGroup} className="btn btn-primary btn-sm">+ Группа</button>
            <button onClick={refresh} className="btn btn-secondary btn-sm">🔄 Обновить</button>
          </div>
        </div>

        <div style={{ padding: '20px 28px 48px', flex: 1 }}>
          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-label">Всего заказов</div>
              <div className="kpi-val">{orders.length}</div>
              <div className="kpi-sub">{totalQty.toFixed(0)} единиц продукции</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">В работе</div>
              <div className="kpi-val green">{inProgress}</div>
              <div className="kpi-sub">{inProgress > 0 ? 'Активных заказов' : 'Нет активных'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Приоритетных</div>
              <div className="kpi-val red">{critical}</div>
              <div className="kpi-sub">High + Critical</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Групп / Пулов</div>
              <div className="kpi-val">{groups.length + pools.length}</div>
              <div className="kpi-sub">{groups.length} групп · {pools.length} пулов</div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="panel">
            <div className="panel-hdr">
              <div>
                <span className="panel-title">Заказы</span>
                <span className="panel-sub">КОРЕНЬ ПРОЕКТА · {rootOrders.length} шт.</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ID</th><th>Продукт</th><th>Клиент</th><th>Кол-во</th>
                    <th>Приоритет</th><th>Статус</th><th>Старт</th><th>Финиш</th>
                  </tr>
                </thead>
                <tbody>
                  {rootOrders.map((o: any) => (
                    <tr key={o.id}>
                      <td className="mono">{o.ext_id || '—'}</td>
                      <td className="name">{o.specification_name || o.ext_id || 'Без названия'}</td>
                      <td>{o.client || '—'}</td>
                      <td className="mono">{o.quantity} {o.unit}</td>
                      <td><span className={`badge ${o.priority}`}>{o.priority === 'high' ? 'Высокий' : o.priority === 'critical' ? 'Критич.' : o.priority === 'low' ? 'Низкий' : 'Обычный'}</span></td>
                      <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черновик' : o.status === 'planned' ? 'План' : o.status === 'in_progress' ? 'В работе' : o.status === 'completed' ? 'Завершён' : o.status}</span></td>
                      <td className="mono">{o.start_date || '—'}</td>
                      <td className="mono">{o.due_date || '—'}</td>
                    </tr>
                  ))}
                  {rootOrders.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Заказов нет</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Groups */}
          {groups.map((g: any) => {
            const gOrders = grpOrders(g.id);
            return (
              <div key={g.id} className="group-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: gOrders.length > 0 ? 12 : 0 }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>📁 {g.name}</span>
                    <span style={{ fontSize: 12, color: '#5A7090', fontFamily: "'IBM Plex Mono', monospace", marginLeft: 10 }}>{gOrders.length} заказов</span>
                  </div>
                  <button onClick={() => delGroup(g.id)} className="btn btn-danger btn-sm">🗑 Удалить</button>
                </div>
                {gOrders.length > 0 && (
                  <table className="tbl" style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <th>ID</th><th>Продукт</th><th>Клиент</th><th>Кол-во</th><th>Приоритет</th><th>Статус</th><th>Старт</th><th>Финиш</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gOrders.map((o: any) => (
                        <tr key={o.id}>
                          <td className="mono">{o.ext_id || '—'}</td>
                          <td className="name">{o.specification_name || o.ext_id || '—'}</td>
                          <td>{o.client || '—'}</td>
                          <td className="mono">{o.quantity} {o.unit}</td>
                          <td><span className={`badge ${o.priority}`}>{o.priority === 'high' ? 'Высокий' : o.priority === 'critical' ? 'Критич.' : 'Обычный'}</span></td>
                          <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черновик' : o.status === 'in_progress' ? 'В работе' : 'Завершён'}</span></td>
                          <td className="mono">{o.start_date || '—'}</td>
                          <td className="mono">{o.due_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {gOrders.length === 0 && <div style={{ color: '#5A7090', fontSize: 13, padding: '8px 0' }}>Перетащите заказы в эту группу</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
