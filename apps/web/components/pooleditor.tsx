'use client';

import { useState } from 'react';
import OrderTree, { TreeChevron } from './OrderTree';
import DebugBadge from './DebugBadge';

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
}

interface PoolEditorProps {
  pool: Pool;
  orders: Order[];
  onClose: () => void;
  onRefresh: () => void;
  onMoveOrders?: (orderIds: string[], poolId: string | null) => Promise<void>;
  debug?: boolean;
}

const btnStyle = (w: number): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
  width: w, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(139,92,246,.25)',
  background: 'rgba(139,92,246,.04)', color: '#B0C4DE', cursor: 'pointer',
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

async function moveOrders(orderIds: string[], poolId: string | null) {
  const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : '';
  for (const oid of orderIds) {
    const r = await fetch('https://profyplan.ru/api/v1/production-orders/' + oid + '/move', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify({ pool_id: poolId }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Network error' }));
      throw new Error(err.detail || 'Ошибка сервера');
    }
  }
}

export default function PoolEditor({ pool, orders, onClose, onRefresh, onMoveOrders, debug = false }: PoolEditorProps) {
  const poolOrders = orders.filter(o => o.pool_id === pool.id);
  const freeOrders = orders.filter(o => !o.pool_id);
  const poolIds = poolOrders.map(o => o.id);
  const freeIds = freeOrders.map(o => o.id);

  const [selPool, setSelPool] = useState<Set<string>>(new Set());
  const [selFree, setSelFree] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const togglePool = (id: string, e: React.MouseEvent) => {
    const s = new Set(selPool);
    if (e.shiftKey) {
      const arr = Array.from(s);
      const last = arr.pop();
      const a = last ? poolIds.indexOf(last) : 0;
      const b = poolIds.indexOf(id);
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      for (let i = lo; i <= hi; i++) s.add(poolIds[i]);
    } else {
      s.has(id) ? s.delete(id) : s.add(id);
    }
    setSelPool(s);
  };

  const toggleFree = (id: string, e: React.MouseEvent) => {
    const s = new Set(selFree);
    if (e.shiftKey) {
      const arr = Array.from(s);
      const last = arr.pop();
      const a = last ? freeIds.indexOf(last) : 0;
      const b = freeIds.indexOf(id);
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      for (let i = lo; i <= hi; i++) s.add(freeIds[i]);
    } else {
      s.has(id) ? s.delete(id) : s.add(id);
    }
    setSelFree(s);
  };

  const addToPool = async (orderIds: string[]) => {
    setSaving(true);
    try {
      if (onMoveOrders) await onMoveOrders(orderIds, pool.id);
      else await moveOrders(orderIds, pool.id);
    }
    catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); setSaving(false); return; }
    setSaving(false);
    setSelFree(new Set());
    onRefresh();
  };

  const removeFromPool = async (orderIds: string[]) => {
    setSaving(true);
    try {
      if (onMoveOrders) await onMoveOrders(orderIds, null);
      else await moveOrders(orderIds, null);
    }
    catch (e: any) { alert('Ошибка: ' + (e.message || String(e))); setSaving(false); return; }
    setSaving(false);
    setSelPool(new Set());
    onRefresh();
  };

  const fillPool = () => {
    if (freeOrders.length === 0) return;
    addToPool(freeOrders.map(o => o.id));
  };

  const clearPool = () => {
    if (poolOrders.length === 0) return;
    removeFromPool(poolOrders.map(o => o.id));
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>← Назад</button>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>📦 Редактор: {pool.name}</span>
          <span className="t-mono" style={{ marginLeft: 10, fontSize: 12, color: '#8FA3BD' }}>
            {poolOrders.length} заказов
          </span>
        </div>
        <DebugBadge debug={debug} text="[pool:editor]" copy={`[pool:editor] «${pool.name}»`} />
        {saving && <span style={{ fontSize: 12, color: '#60A5FA' }}>Сохранение...</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, height: 'calc(100vh - 200px)' }}>
        {/* LEFT: Pool orders */}
        <div className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation();
            try {
              const ids: string[] = JSON.parse(e.dataTransfer.getData('orderIds') || '[]');
              const toAdd = ids.filter(id => !poolIds.includes(id));
              if (toAdd.length > 0) addToPool(toAdd);
            } catch {}
          }}>
          <div className="panel-hdr">
            <div>
              <span className="panel-title">📦 Заказы в пуле</span>
              <span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{poolOrders.length}</span>
            </div>
            <span className="t-mono" style={{ fontSize: 11, color: selPool.size > 0 ? '#A78BFA' : '#5A7090' }}>
              {selPool.size > 0 ? `Выбрано: ${selPool.size}` : ''}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
            {poolOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#5A7090', fontSize: 12, border: '2px dashed rgba(139,92,246,.15)', borderRadius: 8, margin: 8 }}>
                Перетащите заказы сюда
              </div>
            ) : (
              <OrderTree
                orders={poolOrders}
                renderRow={(o, ctx) => (
                  <div key={o.id} draggable
                    onDragStart={e => {
                      const ids = selPool.has(o.id) ? Array.from(selPool) : [o.id];
                      e.dataTransfer.setData('orderIds', JSON.stringify(ids));
                      e.dataTransfer.effectAllowed = 'move';
                      document.body.style.cursor = 'grabbing';
                    }}
                    onDragEnd={() => { document.body.style.cursor = ''; }}
                    onClick={e => togglePool(o.id, e)}
                    style={{
                      cursor: 'pointer', padding: '8px 10px', paddingLeft: 10 + ctx.depth * 16, margin: '2px 0', borderRadius: 6,
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: selPool.has(o.id) ? 'rgba(139,92,246,.14)' : 'transparent',
                      border: selPool.has(o.id) ? '1px solid rgba(139,92,246,.35)' : '1px solid transparent',
                      transition: 'background .1s', userSelect: 'none'
                    }}>
                    {ctx.hasChildren && <TreeChevron expanded={ctx.expanded} onClick={() => ctx.toggle()} />}
                    <input type="checkbox" checked={selPool.has(o.id)} onChange={() => {}} style={{ accentColor: '#8B5CF6', width: 14, height: 14, pointerEvents: 'none' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.specification_name || o.ext_id || '—'}</div>
                      <div style={{ fontSize: 10, color: '#8FA3BD' }}>{o.client || '—'}</div>
                    </div>
                    <span className="t-mono" style={{ fontSize: 10, color: '#5A7090', whiteSpace: 'nowrap' }}>{o.quantity} {o.unit}</span>
                    <span className={`badge ${o.status}`} style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{statusLabel(o.status)}</span>
                  </div>
                )}
              />
            )}
          </div>
        </div>

        {/* CENTER: Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '0 2px' }}>
          <button onClick={() => selFree.size > 0 && addToPool(Array.from(selFree))}
            disabled={selFree.size === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (selFree.size > 0) { e.currentTarget.style.background = 'rgba(139,92,246,.12)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; }}>
            {arrowSVG('left', selFree.size > 0 ? '#A78BFA' : '#5A7090')}
            <span>Добавить</span>
          </button>
          <button onClick={() => selPool.size > 0 && removeFromPool(Array.from(selPool))}
            disabled={selPool.size === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (selPool.size > 0) { e.currentTarget.style.background = 'rgba(139,92,246,.12)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; }}>
            {arrowSVG('right', selPool.size > 0 ? '#A78BFA' : '#5A7090')}
            <span>Убрать</span>
          </button>
          <div style={{ borderTop: '1px solid rgba(139,92,246,.12)', margin: '6px 4px' }} />
          <button onClick={fillPool}
            disabled={freeOrders.length === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (freeOrders.length > 0) { e.currentTarget.style.background = 'rgba(139,92,246,.12)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; }}>
            {arrowSVG('left2', freeOrders.length > 0 ? '#A78BFA' : '#5A7090')}
            <span>Все в пул</span>
          </button>
          <button onClick={clearPool}
            disabled={poolOrders.length === 0} style={btnStyle(72)}
            onMouseEnter={e => { if (poolOrders.length > 0) { e.currentTarget.style.background = 'rgba(139,92,246,.12)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.5)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,.25)'; }}>
            {arrowSVG('right2', poolOrders.length > 0 ? '#A78BFA' : '#5A7090')}
            <span>Очистить</span>
          </button>
        </div>

        {/* RIGHT: Free orders */}
        <div className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation();
            try {
              const ids: string[] = JSON.parse(e.dataTransfer.getData('orderIds') || '[]');
              const toRemove = ids.filter(id => poolIds.includes(id));
              if (toRemove.length > 0) removeFromPool(toRemove);
            } catch {}
          }}>
          <div className="panel-hdr">
            <div>
              <span className="panel-title">📋 Свободные заказы</span>
              <span className="t-mono" style={{ marginLeft: 6, fontSize: 11, color: '#8FA3BD' }}>{freeOrders.length}</span>
            </div>
            <span className="t-mono" style={{ fontSize: 11, color: selFree.size > 0 ? '#60A5FA' : '#5A7090' }}>
              {selFree.size > 0 ? `Выбрано: ${selFree.size}` : ''}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
            {freeOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#5A7090', fontSize: 12, border: '2px dashed rgba(59,130,246,.1)', borderRadius: 8, margin: 8 }}>
                Все заказы распределены
              </div>
            ) : (
              <OrderTree
                orders={freeOrders}
                renderRow={(o, ctx) => (
                  <div key={o.id} draggable
                    onDragStart={e => {
                      const ids = selFree.has(o.id) ? Array.from(selFree) : [o.id];
                      e.dataTransfer.setData('orderIds', JSON.stringify(ids));
                      e.dataTransfer.effectAllowed = 'move';
                      document.body.style.cursor = 'grabbing';
                    }}
                    onDragEnd={() => { document.body.style.cursor = ''; }}
                    onClick={e => toggleFree(o.id, e)}
                    style={{
                      cursor: 'pointer', padding: '8px 10px', paddingLeft: 10 + ctx.depth * 16, margin: '2px 0', borderRadius: 6,
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: selFree.has(o.id) ? 'rgba(59,130,246,.1)' : 'transparent',
                      border: selFree.has(o.id) ? '1px solid rgba(59,130,246,.25)' : '1px solid transparent',
                      transition: 'background .1s', userSelect: 'none'
                    }}>
                    {ctx.hasChildren && <TreeChevron expanded={ctx.expanded} onClick={() => ctx.toggle()} />}
                    <input type="checkbox" checked={selFree.has(o.id)} onChange={() => {}} style={{ accentColor: '#3B82F6', width: 14, height: 14, pointerEvents: 'none' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.specification_name || o.ext_id || '—'}</div>
                      <div style={{ fontSize: 10, color: '#8FA3BD' }}>{o.client || '—'}</div>
                    </div>
                    <span className="t-mono" style={{ fontSize: 10, color: '#5A7090', whiteSpace: 'nowrap' }}>{o.quantity} {o.unit}</span>
                    <span className={`badge ${o.status}`} style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{statusLabel(o.status)}</span>
                  </div>
                )}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
