'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';

export interface ListWinRec {
  id: string;
  kind: 'orders' | 'groups' | 'pools';
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Окна-списки поверх рабочего стола (режим «Окна для списков»).
 * Перетаскивание за заголовок, закрытие. Клик по строке передаёт выбор наверх.
 */
export default function ListWindowsLayer(props: {
  listWins: ListWinRec[];
  onClose: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  orders: any[];
  groups: any[];
  pools: any[];
  isDyn: (o: any) => boolean;
  onOpenOrder: (o: any) => void;
  onOpenGroup: (g: any) => void;
  onOpenPool: (p: any) => void;
}) {
  const { listWins, onClose, onMove, orders, groups, pools, isDyn, onOpenOrder, onOpenGroup, onOpenPool } = props;
  if (!listWins.length) return null;

  const startDrag = (e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    const win = listWins.find(w => w.id === id);
    if (!win) return;
    const sx = e.clientX, sy = e.clientY, ox = win.x, oy = win.y;
    const move = (ev: MouseEvent) => onMove(id, ox + ev.clientX - sx, oy + ev.clientY - sy);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <>
      {listWins.map((w, n) => (
        <div
          key={w.id}
          style={{
            position: 'fixed', left: w.x, top: w.y, width: w.w, height: w.h,
            zIndex: 500 + n, background: '#0B1B33', border: '1px solid #1E3A5F',
            borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.5)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div
            onMouseDown={e => startDrag(e, w.id)}
            style={{ padding: '10px 14px', borderBottom: '1px solid #1E3A5F', background: '#0D1F3A', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, cursor: 'move', userSelect: 'none' }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.title}</span>
            <button onClick={() => onClose(w.id)} title="Закрыть" style={{ background: 'none', border: 'none', color: '#8FA3BD', cursor: 'pointer', fontSize: 15, padding: '2px 6px', lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 10, fontSize: 12.5, color: '#E2E8F0' }}>
            {w.kind === 'orders' && (
              <table className="tbl">
                <thead><tr>
                  <th className="t-graph">Граф</th>
                  <th>ID</th>
                  <th>Продукт</th>
                  <th>Клиент</th>
                  <th>Кол-во</th>
                  <th>Приоритет</th>
                  <th>Статус</th>
                </tr></thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} onClick={() => onOpenOrder(o)} style={{ cursor: 'pointer' }}>
                      <td className="t-graph"><span className={isDyn(o) ? 'g-dyn' : 'g-pln'}>{isDyn(o) ? '⚡' : '○'}</span></td>
                      <td className="t-mono">{o.ext_id || '—'}</td>
                      <td className="t-name">{o.specification_name || o.ext_id || '—'}</td>
                      <td>{o.client || '—'}</td>
                      <td className="t-mono">{o.quantity} {o.unit}</td>
                      <td><span className={`badge ${o.priority}`}>{o.priority === 'high' ? 'Выс.' : o.priority === 'critical' ? 'Крит.' : o.priority === 'low' ? 'Низк.' : 'Обыч.'}</span></td>
                      <td><span className={`badge ${o.status}`}>{o.status === 'draft' ? 'Черновик' : o.status === 'planned' ? 'План' : o.status === 'in_progress' ? 'В работе' : o.status === 'completed' ? 'Завершён' : o.status}</span></td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Заказов нет</td></tr>}
                </tbody>
              </table>
            )}
            {w.kind === 'groups' && (
              groups.length ? groups.map((g: any) => (
                <div key={g.id} onClick={() => onOpenGroup(g)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: '1px dashed rgba(30,58,95,.5)', cursor: 'pointer', borderRadius: 6 }}>
                  <span style={{ flex: 1 }}>📁 {g.name}</span>
                </div>
              )) : <div style={{ color: '#5A7090', padding: 24, textAlign: 'center' }}>Групп нет</div>
            )}
            {w.kind === 'pools' && (
              pools.length ? pools.map((p: any) => (
                <div key={p.id} onClick={() => onOpenPool(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: '1px dashed rgba(30,58,95,.5)', cursor: 'pointer', borderRadius: 6 }}>
                  <span style={{ flex: 1 }}>📦 {p.name}</span>
                </div>
              )) : <div style={{ color: '#5A7090', padding: 24, textAlign: 'center' }}>Пулов нет</div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
