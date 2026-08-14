'use client';

import { useState } from 'react';
import OrderTree, { TreeChevron } from './OrderTree';

interface Order {
  id: string;
  specification_name?: string;
  ext_id?: string;
  client?: string;
  quantity?: number;
  unit?: string;
  status?: string;
  pool_id?: string | null;
  group_id?: string | null;
  parent_order_id?: string | null;
}

interface Pool {
  id: string;
  name: string;
  group_id?: string | null;
}

interface Group {
  id: string;
  name: string;
}

interface GroupEditorProps {
  group: Group;
  orders: Order[];
  pools: Pool[];
  onClose: () => void;
  onRefresh: () => void;
  onMoveOrders?: (orderIds: string[], groupId: string | null) => Promise<void>;
}

const btnStyle = (w: number): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
  width: w, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(59,130,246,.25)',
  background: 'rgba(59,130,246,.04)', color: '#B0C4DE', cursor: 'pointer',
  fontSize: 10, fontWeight: 500, transition: 'all .15s', lineHeight: 1.2
});

const arrowSVG = (dir: string, color: string) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d={
      dir === 'left' ? 'M11 4L6 9l5 5' :
      dir === 'right' ? 'M7 4l5 5-5 5' :
      dir === 'left2' ? 'M14 4L8 9l6 5M10 4L4 9l6 5' :
      'M4 4l6 5-6 5M8 4l6 5-6 5'
    } stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

function statusLabel(status?: string) {
  if (status === 'draft') return 'Черн.';
  if (status === 'planned') return 'План';
  if (status === 'in_progress') return 'Раб.';
  return status || '—';
}

async function moveOrders(orderIds: string[], groupId: string | null) {
  const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : '';
  for (const oid of orderIds) {
    const r = await fetch('https://profyplan.ru/api/v1/production-orders/' + oid + '/move', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify({ group_id: groupId }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Network error' }));
      throw new Error(err.detail || 'Ошибка сервера');
    }
  }
}

async function movePools(poolIds: string[], groupId: string | null) {
  const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : '';
  for (const pid of poolIds) {
    const r = await fetch('https://profyplan.ru/api/v1/order-pools/' + pid + '/move', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify({ group_id: groupId }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Network error' }));
      throw new Error(err.detail || 'Ошибка сервера');
    }
  }
}

function OrderCard({ o, selected, onToggle, colorSet, depth = 0, hasChildren = false, expanded = false, onExpand }: {
  o: Order; selected: boolean; onToggle: (e: React.MouseEvent) => void; colorSet: 'blue' | 'amber';
  depth?: number; hasChildren?: boolean; expanded?: boolean; onExpand?: () => void;
}) {
  const ac = colorSet === 'blue' ? '#3B82F6' : '#F59E0B';
  const bg = colorSet === 'blue' ? 'rgba(59,130,246,.1)' : 'rgba(245,158,11,.1)';
  const border = colorSet === 'blue' ? 'rgba(59,130,246,.25)' : 'rgba(245,158,11,.25)';
  return (
    <div draggable
      onDragStart={e => {
        e.dataTransfer.setData('orderIds', JSON.stringify([o.id]));
        e.dataTransfer.effectAllowed = 'move';
        document.body.style.cursor = 'grabbing';
      }}
      onDragEnd={() => { document.body.style.cursor = ''; }}
      onClick={onToggle}
      style={{
        cursor: 'pointer', padding: '8px 10px', paddingLeft: 10 + depth * 16, margin: '2px 0', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8,
        background: selected ? bg : 'transparent',
        border: selected ? `1px solid ${border}` : '1px solid transparent',
        transition: 'background .1s', userSelect: 'none'
      }}>
      {hasChildren && <TreeChevron expanded={expanded} onClick={() => onExpand && onExpand()} />}
      <input type="checkbox" checked={selected} onChange={() => {}} style={{ accentColor: ac, width: 14, height: 14, pointerEvents: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.specification_name || o.ext_id || '—'}</div>
        <div style={{ fontSize: 10, color: '#8FA3BD' }}>{o.client || '—'}</div>
      </div>
      <span className="t-mono" style={{ fontSize: 10, color: '#5A7090', whiteSpace: 'nowrap' }}>{o.quantity} {o.unit}</span>
      <span className={`badge ${o.status}`} style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{statusLabel(o.status)}</span>
    </div>
  );
}

export default function GroupEditor({ group, orders, pools, onClose, onRefresh, onMoveOrders }: GroupEditorProps) {
  const groupOrders = orders.filter(o => o.group_id === group.id);
  const groupPools = pools.filter(p => p.group_id === group.id);
  const freeOrders = orders.filter(o => !o.group_id && !o.pool_id);
  const freePools = pools.filter(p => !p.group_id);

  const [selGroup, setSelGroup] = useState<{ orders: Set<string>; pools: Set<string> }>({ orders: new Set(), pools: new Set() });
  const [selFree, setSelFree] = useState<{ orders: Set<string>; pools: Set<string> }>({ orders: new Set(), pools: new Set() });
  const [saving, setSaving] = useState(false);

  const toggleGroupOrder = (id: string) => {
    const s = new Set(selGroup.orders);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelGroup({ ...selGroup, orders: s });
  };
  const toggleGroupPool = (id: string) => {
    const s = new Set(selGroup.pools);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelGroup({ ...selGroup, pools: s });
  };
  const toggleFreeOrder = (id: string) => {
    const s = new Set(selFree.orders);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelFree({ ...selFree, orders: s });
  };
  const toggleFreePool = (id: string) => {
    const s = new Set(selFree.pools);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelFree({ ...selFree, pools: s });
  };

  const addOrders = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSaving(true);
    try {
      if (onMoveOrders) await onMoveOrders(ids, group.id);
      else await moveOrders(ids, group.id);
    }
    catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); setSaving(false); return; }
    setSaving(false);
    setSelFree({ orders: new Set(), pools: selFree.pools });
    onRefresh();
  };

  const removeOrders = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSaving(true);
    try {
      if (onMoveOrders) await onMoveOrders(ids, null);
      else await moveOrders(ids, null);
    }
    catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); setSaving(false); return; }
    setSaving(false);
    setSelGroup({ orders: new Set(), pools: selGroup.pools });
    onRefresh();
  };

  const addPools = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSaving(true);
    try { await movePools(ids, group.id); }
    catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); setSaving(false); return; }
    setSaving(false);
    setSelFree({ orders: selFree.orders, pools: new Set() });
    onRefresh();
  };

  const removePools = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSaving(true);
    try { await movePools(ids, null); }
    catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); setSaving(false); return; }
    setSaving(false);
    setSelGroup({ orders: selGroup.orders, pools: new Set() });
    onRefresh();
  };

  const totalInGroup = groupOrders.length + groupPools.length;
  const totalFree = freeOrders.length + freePools.length;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>← Назад</button>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>📁 Редактор: {group.name}</span>
          <span className="t-mono" style={{ marginLeft: 10, fontSize: 12, color: '#8FA3BD' }}>
            {totalInGroup} элементов
          </span>
        </div>
        {saving && <span style={{ fontSize: 12, color: '#60A5FA' }}>Сохранение...</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, height: 'calc(100vh - 200px)' }}>
        {/* LEFT: Group contents — orders + pools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* GROUP ORDERS */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              try {
                const ids: string[] = JSON.parse(e.dataTransfer.getData('orderIds') || '[]');
                const toAdd = ids.filter(id => !groupOrders.find(o => o.id === id));
                if (toAdd.length > 0) addOrders(toAdd);
              } catch {}
            }}>
            <div className="panel-hdr">
              <div>
                <span className="panel-title">📋 Заказы в группе</span>
                <span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{groupOrders.length}</span>
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: selGroup.orders.size > 0 ? '#F59E0B' : '#5A7090' }}>
                {selGroup.orders.size > 0 ? `Выбрано: ${selGroup.orders.size}` : ''}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {groupOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: '#5A7090', fontSize: 11, border: '2px dashed rgba(245,158,11,.1)', borderRadius: 8, margin: 4 }}>
                  Перетащите заказы сюда
                </div>
              ) : (
                <OrderTree
                  orders={groupOrders}
                  renderRow={(o, ctx) => (
                    <OrderCard key={'go-' + o.id} o={o} selected={selGroup.orders.has(o.id)} onToggle={() => toggleGroupOrder(o.id)} colorSet="amber"
                      depth={ctx.depth} hasChildren={ctx.hasChildren} expanded={ctx.expanded} onExpand={ctx.toggle} />
                  )}
                />
              )}
            </div>
          </div>

          {/* GROUP POOLS */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              try {
                const ids: string[] = JSON.parse(e.dataTransfer.getData('poolIds') || '[]');
                const toAdd = ids.filter(id => !groupPools.find(p => p.id === id));
                if (toAdd.length > 0) addPools(toAdd);
              } catch {}
            }}>
            <div className="panel-hdr">
              <div>
                <span className="panel-title">📦 Пулы в группе</span>
                <span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{groupPools.length}</span>
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: selGroup.pools.size > 0 ? '#A78BFA' : '#5A7090' }}>
                {selGroup.pools.size > 0 ? `Выбрано: ${selGroup.pools.size}` : ''}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {groupPools.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: '#5A7090', fontSize: 11, border: '2px dashed rgba(139,92,246,.1)', borderRadius: 8, margin: 4 }}>
                  Перетащите пулы сюда
                </div>
              ) : (
                groupPools.map(p => (
                  <div key={'gp-' + p.id} draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('poolIds', JSON.stringify([p.id]));
                      e.dataTransfer.effectAllowed = 'move';
                      document.body.style.cursor = 'grabbing';
                    }}
                    onDragEnd={() => { document.body.style.cursor = ''; }}
                    onClick={() => toggleGroupPool(p.id)}
                    style={{
                      cursor: 'pointer', padding: '8px 10px', margin: '2px 0', borderRadius: 6,
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: selGroup.pools.has(p.id) ? 'rgba(139,92,246,.14)' : 'transparent',
                      border: selGroup.pools.has(p.id) ? '1px solid rgba(139,92,246,.35)' : '1px solid transparent',
                      transition: 'background .1s', userSelect: 'none', fontSize: 12
                    }}>
                    <input type="checkbox" checked={selGroup.pools.has(p.id)} onChange={() => {}} style={{ accentColor: '#8B5CF6', width: 14, height: 14, pointerEvents: 'none' }} />
                    <span>📦 {p.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* CENTER: Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '0 2px' }}>
          <button onClick={() => addOrders(Array.from(selFree.orders))}
            disabled={selFree.orders.size === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (selFree.orders.size > 0) { e.currentTarget.style.background = 'rgba(59,130,246,.12)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,.04)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,.25)'; }}>
            {arrowSVG('left', selFree.orders.size > 0 ? '#60A5FA' : '#5A7090')}
            <span>+ Заказы</span>
          </button>
          <button onClick={() => removeOrders(Array.from(selGroup.orders))}
            disabled={selGroup.orders.size === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (selGroup.orders.size > 0) { e.currentTarget.style.background = 'rgba(59,130,246,.12)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,.04)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,.25)'; }}>
            {arrowSVG('right', selGroup.orders.size > 0 ? '#60A5FA' : '#5A7090')}
            <span>− Заказы</span>
          </button>
          <div style={{ borderTop: '1px solid rgba(59,130,246,.12)', margin: '6px 4px' }} />
          <button onClick={() => addPools(Array.from(selFree.pools))}
            disabled={selFree.pools.size === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (selFree.pools.size > 0) { e.currentTarget.style.background = 'rgba(139,92,246,.12)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; }}>
            {arrowSVG('left', selFree.pools.size > 0 ? '#A78BFA' : '#5A7090')}
            <span>+ Пулы</span>
          </button>
          <button onClick={() => removePools(Array.from(selGroup.pools))}
            disabled={selGroup.pools.size === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (selGroup.pools.size > 0) { e.currentTarget.style.background = 'rgba(139,92,246,.12)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; }}>
            {arrowSVG('right', selGroup.pools.size > 0 ? '#A78BFA' : '#5A7090')}
            <span>− Пулы</span>
          </button>
        </div>

        {/* RIGHT: Free items — orders + pools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* FREE ORDERS */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              try {
                const ids: string[] = JSON.parse(e.dataTransfer.getData('orderIds') || '[]');
                const toRemove = ids.filter(id => groupOrders.find(o => o.id === id));
                if (toRemove.length > 0) removeOrders(toRemove);
              } catch {}
            }}>
            <div className="panel-hdr">
              <div>
                <span className="panel-title">📋 Свободные заказы</span>
                <span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{freeOrders.length}</span>
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: selFree.orders.size > 0 ? '#60A5FA' : '#5A7090' }}>
                {selFree.orders.size > 0 ? `Выбрано: ${selFree.orders.size}` : ''}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {freeOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: '#5A7090', fontSize: 11, border: '2px dashed rgba(59,130,246,.1)', borderRadius: 8, margin: 4 }}>
                  Все заказы распределены
                </div>
              ) : (
                <OrderTree
                  orders={freeOrders}
                  renderRow={(o, ctx) => (
                    <OrderCard key={'fo-' + o.id} o={o} selected={selFree.orders.has(o.id)} onToggle={() => toggleFreeOrder(o.id)} colorSet="blue"
                      depth={ctx.depth} hasChildren={ctx.hasChildren} expanded={ctx.expanded} onExpand={ctx.toggle} />
                  )}
                />
              )}
            </div>
          </div>

          {/* FREE POOLS */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              try {
                const ids: string[] = JSON.parse(e.dataTransfer.getData('poolIds') || '[]');
                const toRemove = ids.filter(id => groupPools.find(p => p.id === id));
                if (toRemove.length > 0) removePools(toRemove);
              } catch {}
            }}>
            <div className="panel-hdr">
              <div>
                <span className="panel-title">📦 Свободные пулы</span>
                <span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{freePools.length}</span>
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: selFree.pools.size > 0 ? '#A78BFA' : '#5A7090' }}>
                {selFree.pools.size > 0 ? `Выбрано: ${selFree.pools.size}` : ''}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {freePools.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: '#5A7090', fontSize: 11, border: '2px dashed rgba(139,92,246,.1)', borderRadius: 8, margin: 4 }}>
                  Все пулы распределены
                </div>
              ) : (
                freePools.map(p => (
                  <div key={'fp-' + p.id} draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('poolIds', JSON.stringify([p.id]));
                      e.dataTransfer.effectAllowed = 'move';
                      document.body.style.cursor = 'grabbing';
                    }}
                    onDragEnd={() => { document.body.style.cursor = ''; }}
                    onClick={() => toggleFreePool(p.id)}
                    style={{
                      cursor: 'pointer', padding: '8px 10px', margin: '2px 0', borderRadius: 6,
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: selFree.pools.has(p.id) ? 'rgba(139,92,246,.14)' : 'transparent',
                      border: selFree.pools.has(p.id) ? '1px solid rgba(139,92,246,.35)' : '1px solid transparent',
                      transition: 'background .1s', userSelect: 'none', fontSize: 12
                    }}>
                    <input type="checkbox" checked={selFree.pools.has(p.id)} onChange={() => {}} style={{ accentColor: '#8B5CF6', width: 14, height: 14, pointerEvents: 'none' }} />
                    <span>📦 {p.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
