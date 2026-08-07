'use client';

import { useState, useCallback } from 'react';
import type { ProductionOrder, OrderGroup, OrderPool } from '@/lib/types';

const API = 'https://profyplan.ru/api/v1';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('profyplan_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options?.headers as any || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export default function WorkspacePage() {
  const [loaded, setLoaded] = useState(false);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [groups, setGroups] = useState<OrderGroup[]>([]);
  const [pools, setPools] = useState<OrderPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('Нажмите «Загрузить» для входа в рабочий стол');
  const [pid, setPid] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setMsg('Загрузка...');
    try {
      await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }) });
      const proj: any = await apiFetch('/projects');
      const projectId = proj.items[0].id;
      setPid(projectId);
      setMsg(`Проект: ${proj.items[0].name} — загрузка заказов...`);

      const [o, g, p] = await Promise.all([
        apiFetch<ProductionOrder[]>(`/production-orders/?project_id=${projectId}`),
        apiFetch<{ items: OrderGroup[] }>(`/projects/${projectId}/groups`),
        apiFetch<{ items: OrderPool[] }>(`/projects/${projectId}/pools`),
      ]);
      setOrders(o);
      setGroups(g.items);
      setPools(p.items);
      setLoaded(true);
      setMsg(`Готово: ${o.length} заказов, ${g.items.length} групп, ${p.items.length} пулов`);
    } catch (e: any) {
      setMsg(`Ошибка: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!pid) return;
    const [o, g, p] = await Promise.all([
      apiFetch<ProductionOrder[]>(`/production-orders/?project_id=${pid}`),
      apiFetch<{ items: OrderGroup[] }>(`/projects/${pid}/groups`),
      apiFetch<{ items: OrderPool[] }>(`/projects/${pid}/pools`),
    ]);
    setOrders(o); setGroups(g.items); setPools(p.items);
  }, [pid]);

  const addGroup = async () => {
    const name = prompt('Название группы:');
    if (!name || !pid) return;
    await apiFetch(`/projects/${pid}/groups`, { method: 'POST', body: JSON.stringify({ name, sort_order: groups.length }) });
    await refresh();
  };

  const deleteGrp = async (gid: string) => {
    if (!confirm('Удалить группу?')) return;
    await apiFetch(`/projects/${pid}/groups/${gid}`, { method: 'DELETE' });
    await refresh();
  };

  const rootOrders = orders.filter((o: any) => !o.group_id && !o.pool_id);
  const groupOrders = (gid: string) => orders.filter((o: any) => o.group_id === gid);

  if (!loaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>ProfyPlan</h1>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>{msg}</p>
        <button onClick={loadData} disabled={loading} style={{
          padding: '14px 40px', fontSize: 16, fontWeight: 600,
          background: loading ? '#93c5fd' : '#2563eb', color: 'white',
          border: 'none', borderRadius: 10, cursor: loading ? 'default' : 'pointer',
        }}>
          {loading ? 'Загрузка...' : 'Загрузить рабочий стол'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Рабочий стол</h1>
        <div style={{ fontSize: 13, color: '#6b7280' }}>{msg}</div>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Заказы — {rootOrders.length} шт.</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addGroup} style={btn}>+ Группа</button>
          </div>
        </div>
        {rootOrders.map((o: any) => (
          <div key={o.id} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 16px', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <strong>{o.specification_name || o.ext_id || '—'}</strong>
              <span style={{ marginLeft: 12, fontSize: 13, color: '#6b7280' }}>{o.quantity} {o.unit} · {o.client || '—'}</span>
            </div>
            <span style={{ fontSize: 13, color: '#9ca3af', fontFamily: 'monospace' }}>{o.start_date || '?'} → {o.due_date || '?'}</span>
          </div>
        ))}
        {rootOrders.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>Нет заказов</div>}
      </div>

      {groups.map((g: any) => (
        <div key={g.id} style={{ border: '1px solid #bfdbfe', borderRadius: 12, padding: 20, marginBottom: 12, background: '#f8faff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>📁 {g.name}</h3>
            <button onClick={() => deleteGrp(g.id)} style={{ ...btn, color: '#ef4444' }}>🗑</button>
          </div>
          {groupOrders(g.id).map((o: any) => (
            <div key={o.id} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span><strong>{o.specification_name || o.ext_id}</strong> · {o.quantity} {o.unit}</span>
              <span style={{ fontSize: 13, color: '#9ca3af', fontFamily: 'monospace' }}>{o.start_date} → {o.due_date}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '5px 14px', border: '1px solid #d1d5db', borderRadius: 7,
  background: 'white', fontSize: 13, cursor: 'pointer', color: '#374151', fontWeight: 500,
};
