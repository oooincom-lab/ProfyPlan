'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WinRec, LayState, OrderTab } from './useWindows';

type WindowsLayerProps = {
  wins: WinRec[];
  lay: LayState | null;
  snapZone: any;
  setWins: Dispatch<SetStateAction<WinRec[]>>;
  setLay: Dispatch<SetStateAction<LayState | null>>;
  orders: any[];
  resourcesList: any[];
  groups: any[];
  pools: any[];
  isDyn: (o: any) => boolean;
  orderBomNodes: (o: any) => any[];
  routingFor: (o: any) => any;
  resName: (rid: any) => string;
  onOpenOrder: (o: any) => void;
  onOpenGroup: (g: any) => void;
  onOpenPool: (p: any) => void;
  renderOrdersTable?: () => any;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onToggleMin: (id: string) => void;
  onMinimizeAll: () => void;
  onReset: (id: string) => void;
  onToggleMax: (id: string) => void;
  onDrag: (e: any, w: WinRec) => void;
  onResize: (e: any, w: WinRec) => void;
  onApplyCell: (colCount: number, colIndex: number, rowCount: number, rowIndex: number) => void;
  onSaveEdit: (w: WinRec) => void;
};

const TAB_LIST: { v: OrderTab; l: string }[] = [
  { v: 'order', l: 'Заказ' },
  { v: 'bom', l: 'Состав' },
  { v: 'route', l: 'Маршрут' },
  { v: 'res', l: 'Ресурсы' },
  { v: 'plan', l: 'План' },
];

/**
 * Слой оконного режима: floating-окна заказов И окон-списков (заказы/группы/пулы),
 * подсветка Snap-зоны, панель раскладок (⛶) и панель задач. Чистая презентация —
 * вся логика живёт в useWindows() на стороне page.tsx.
 */
export default function WindowsLayer(props: WindowsLayerProps) {
  const {
    wins, lay, snapZone, setWins, setLay,
    orders, resourcesList, groups, pools, isDyn,
    orderBomNodes, routingFor, resName,
    onOpenOrder, onOpenGroup, onOpenPool, renderOrdersTable,
    onClose, onFocus, onToggleMin, onMinimizeAll, onReset, onToggleMax, onDrag, onResize, onApplyCell, onSaveEdit,
  } = props;

  const maxZ = wins.reduce((m: number, w: WinRec) => Math.max(m, w.z), 0);
  const allMin = wins.length > 0 && wins.every(w => w.min);
  const [snapSel, setSnapSel] = useState<{ c: number; r: number } | null>(null);
  const [snapCell, setSnapCell] = useState(-1);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const orderById = (id: string) => orders.find((x: any) => x.id === id) || null;
  const winLabel = (w: WinRec) => {
    if (w.kind === 'list') return w.title || 'Список';
    const o = w.data || orderById(w.orderId);
    return o ? (o.ext_id || o.id) : (w.orderId.slice(0, 8));
  };

  const reorderWins = (from: number, to: number) => {
    setWins(prev => {
      const arr = [...prev];
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      return arr;
    });
  };

  return (
    <>
      {snapZone && <div className="pp-snapzone" style={{ left: snapZone.x, top: snapZone.y, width: snapZone.w, height: snapZone.h }} />}

      {wins.map((w: WinRec) => {
        const isList = w.kind === 'list';
        const o = isList ? null : (w.data || orderById(w.orderId));
        if (!isList && !o) return null;

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
          <div key={w.id} id={'pp-win-' + w.id} className={'pp-win' + (w.min ? ' min' : '') + (w.z === maxZ ? ' focus' : '')}
            style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 200 + w.z }}
            onPointerDown={() => { if (w.z !== maxZ) onFocus(w.id); }}>
            <div className="pp-win-title" onPointerDown={(e) => onDrag(e, w)} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.pp-wbtn')) return; onReset(w.id); }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isList ? '#22D3EE' : '#3B82F6', flexShrink: 0 }} />
              <span className="ttl">{isList ? (w.title || 'Список') : ((o!.ext_id || o!.id) + ' · ' + (o!.specification_name || ''))}</span>
              <button className="pp-wbtn" title="Свернуть" onClick={(e) => { e.stopPropagation(); onToggleMin(w.id); }}>–</button>
              <button className="pp-wbtn" title={w.max ? 'Восстановить' : 'Развернуть'} onClick={(e) => { e.stopPropagation(); onToggleMax(w.id); }}>
                {w.max
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V6a2 2 0 0 1 2-2h3" /><path d="M20 9V6a2 2 0 0 0-2-2h-3" /><path d="M4 15v3a2 2 0 0 0 2 2h3" /><path d="M20 15v3a2 2 0 0 1-2 2h-3" /></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H6a3 3 0 0 0-3 3v3" /><path d="M15 3h3a3 3 0 0 1 3 3v3" /><path d="M9 21H6a3 3 0 0 1-3-3v-3" /><path d="M15 21h3a3 3 0 0 0 3-3v-3" /></svg>}
              </button>
              <button className="pp-wbtn" title="Раскладка окон (Snap)" onClick={(e) => { e.stopPropagation(); onFocus(w.id); setSnapSel(null); setSnapCell(-1); setLay(prev => (prev && prev.winId === w.id && !prev.cols) ? null : { winId: w.id, cols: 0, rows: 0, placed: [] }); }}>⛶</button>
              <button className="pp-wbtn close" title="Закрыть" onClick={(e) => { e.stopPropagation(); onClose(w.id); }}>✕</button>
            </div>

            {!isList && (
              <div style={{ display: 'flex', borderBottom: '1px solid #1E3252', flexShrink: 0 }}>
                {TAB_LIST.map(tb => (
                  <button key={tb.v} onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, tab: tb.v, editing: false } : x))}
                    style={{ flex: 1, border: 0, background: 'transparent', color: w.tab === tb.v ? '#fff' : '#8FA3BD', borderBottom: '2px solid ' + (w.tab === tb.v ? '#3B82F6' : 'transparent'), padding: '7px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{tb.l}</button>
                ))}
              </div>
            )}

            <div style={{ padding: '12px 14px', overflowY: 'auto', flex: 1, fontSize: 12.5, color: '#E2E8F0', minHeight: 0 }}>
              {isList && w.listKind === 'orders' && (renderOrdersTable ? renderOrdersTable() : (
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
                    {orders.map((ord: any) => (
                      <tr key={ord.id} onClick={() => onOpenOrder(ord)} style={{ cursor: 'pointer' }}>
                        <td className="t-graph"><span className={isDyn(ord) ? 'g-dyn' : 'g-pln'}>{isDyn(ord) ? '⚡' : '○'}</span></td>
                        <td className="t-mono">{ord.ext_id || '—'}</td>
                        <td className="t-name">{ord.specification_name || ord.ext_id || '—'}</td>
                        <td>{ord.client || '—'}</td>
                        <td className="t-mono">{ord.quantity} {ord.unit}</td>
                        <td><span className={`badge ${ord.priority}`}>{ord.priority === 'high' ? 'Выс.' : ord.priority === 'critical' ? 'Крит.' : ord.priority === 'low' ? 'Низк.' : 'Обыч.'}</span></td>
                        <td><span className={`badge ${ord.status}`}>{ord.status === 'draft' ? 'Черновик' : ord.status === 'planned' ? 'План' : ord.status === 'in_progress' ? 'В работе' : ord.status === 'completed' ? 'Завершён' : ord.status}</span></td>
                      </tr>
                    ))}
                    {orders.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#5A7090' }}>Заказов нет</td></tr>}
                  </tbody>
                </table>
              ))}
              {isList && w.listKind === 'groups' && (
                groups.length ? groups.map((g: any) => (
                  <div key={g.id} onClick={() => onOpenGroup(g)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: '1px dashed rgba(30,58,95,.5)', cursor: 'pointer', borderRadius: 6 }}>
                    <span style={{ flex: 1 }}>📁 {g.name}</span>
                  </div>
                )) : <div style={{ color: '#5A7090', padding: 24, textAlign: 'center' }}>Групп нет</div>
              )}
              {isList && w.listKind === 'pools' && (
                pools.length ? pools.map((p: any) => (
                  <div key={p.id} onClick={() => onOpenPool(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: '1px dashed rgba(30,58,95,.5)', cursor: 'pointer', borderRadius: 6 }}>
                    <span style={{ flex: 1 }}>📦 {p.name}</span>
                  </div>
                )) : <div style={{ color: '#5A7090', padding: 24, textAlign: 'center' }}>Пулов нет</div>
              )}

              {!isList && w.tab === 'order' && !w.editing && (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, editing: true, form: { client: o!.client || '', quantity: String(o!.quantity ?? ''), priority: o!.priority || 'normal', start_date: o!.start_date || '', due_date: o!.due_date || '', status: o!.status || 'draft' } } : x))}
                      style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✏️ Редактировать</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '6px 10px', fontSize: 13 }}>
                    {[['Клиент', o!.client || '—'], ['Кол-во', String(o!.quantity ?? '—')], ['Ед.', o!.unit || '—'], ['Приоритет', o!.priority || '—'], ['Статус', o!.status || '—'], ['Старт', o!.start_date || '—'], ['Финиш', o!.due_date || '—'], ['Заказ родителя', o!.parent_order_id || '—']].map((kv: any) => (
                      <div key={kv[0]} style={{ display: 'contents' }}>
                        <div style={{ color: '#5A7090' }}>{kv[0]}</div>
                        <div style={{ color: '#E2E8F0' }}>{kv[1]}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!isList && w.tab === 'order' && w.editing && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {([['client', 'Клиент'], ['quantity', 'Кол-во'], ['priority', 'Приоритет'], ['start_date', 'Старт'], ['due_date', 'Финиш'], ['status', 'Статус']] as const).map((kv) => {
                    const k = kv[0] as string, label = kv[1] as string;
                    return (
                      <label key={k} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#8FA3BD', fontSize: 12 }}>{label}</span>
                        {k === 'priority' ? (
                          <select value={w.form[k] || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, [k]: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                            <option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option>
                          </select>
                        ) : k === 'status' ? (
                          <select value={w.form[k] || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, [k]: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                            <option value="draft">Черновик</option><option value="active">В работе</option><option value="completed">Завершён</option>
                          </select>
                        ) : (
                          <input value={w.form[k] || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, [k]: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                        )}
                      </label>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button onClick={() => onSaveEdit(w)} style={{ background: '#3B82F6', border: 0, color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Сохранить</button>
                    <button onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, editing: false } : x))} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, cursor: 'pointer' }}>Отмена</button>
                  </div>
                </div>
              )}
              {!isList && w.tab === 'bom' && (
                bomNodes.length ? <div>{bomNodes.filter((n: any) => !n.parent_id).map((n: any) => renderBomNode(n, 0))}</div>
                : <div style={{ color: '#5A7090' }}>Состав не загружен — нажмите кнопку BOM (▸) у заказа в списке.</div>
              )}
              {!isList && w.tab === 'route' && (
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
              {!isList && w.tab === 'res' && (
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
              {!isList && w.tab === 'plan' && (
                <div style={{ color: '#8FA3BD', lineHeight: 1.6 }}>
                  План по заказу формируется при расчёте CPM / Ганта (Фаза 2): операции маршрута будут разворачиваться в план с привязкой к ресурсам и датам.
                </div>
              )}
            </div>
            <div className="pp-resize" onPointerDown={(e) => onResize(e, w)} />
          </div>
        );
      })}

      {lay && !lay.cols && (() => {
        const PRESETS: { n: string; c: number; r: number }[] = [
          { n: 'Весь', c: 1, r: 1 },
          { n: '2 кол', c: 2, r: 1 },
          { n: '3 кол', c: 3, r: 1 },
          { n: '4 кол', c: 4, r: 1 },
          { n: '2 стр', c: 1, r: 2 },
          { n: '3 стр', c: 1, r: 3 },
          { n: '2×2', c: 2, r: 2 },
          { n: '3×2', c: 3, r: 2 },
          { n: '2×3', c: 2, r: 3 },
          { n: '3×3', c: 3, r: 3 },
        ];
        return (
          <div className="pp-lay" style={{ right: 16, bottom: 56, width: 320 }}>
            <div className="lh">{snapSel ? 'РАСКЛАДКА — куда поставить окно' : 'РАСКЛАДКА — выберите схему'}</div>
            {!snapSel ? (
              <div>
                <div style={{ fontSize: 11, color: '#8FA3BD', marginTop: 10 }}>1) Схема деления:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                  {PRESETS.map(p => (
                    <button key={p.n} onClick={() => { setSnapSel({ c: p.c, r: p.r }); setSnapCell(-1); }} aria-label={p.n} title={p.n} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                      <div style={{ width: 46, height: 34, display: 'grid', gridTemplateColumns: 'repeat(' + p.c + ',1fr)', gridTemplateRows: 'repeat(' + p.r + ',1fr)', gap: 2, border: '1.5px solid #2A4060', borderRadius: 5, padding: 3, background: '#0A1628' }}>
                        {Array.from({ length: p.c * p.r }).map((_, i) => <div key={i} style={{ background: '#16304A', borderRadius: 2 }} />)}
                      </div>
                      <div style={{ fontSize: 10, color: '#8FA3BD', marginTop: 3, textAlign: 'center' }}>{p.n}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <button onClick={() => setSnapSel(null)} style={{ background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 5, cursor: 'pointer', fontSize: 12, padding: '3px 8px' }}>← схемы</button>
                  <span style={{ fontSize: 12, color: '#8FA3BD' }}>2) Клик по ячейке ({snapSel.c} × {snapSel.r}):</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + snapSel.c + ',1fr)', gridTemplateRows: 'repeat(' + snapSel.r + ',1fr)', gap: 4, width: '100%', height: 170, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, padding: 4, marginTop: 10 }}>
                  {Array.from({ length: snapSel.c * snapSel.r }).map((_, i) => (
                    <button key={i} onMouseEnter={() => setSnapCell(i)} onMouseLeave={() => setSnapCell(-1)} onClick={() => onApplyCell(snapSel.c, i % snapSel.c, snapSel.r, Math.floor(i / snapSel.c))} aria-label={'ячейка ' + (i + 1)} title={'ячейка ' + (i + 1)} style={{ background: snapCell === i ? '#2563EB' : '#16304A', border: '1px solid #2E4A6E', borderRadius: 3, cursor: 'pointer', padding: 0 }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {wins.length > 0 && (
        <div className="pp-taskbar">
          {wins.map((w: WinRec, idx: number) => {
            const active = w.z === maxZ && !w.min;
            return (
              <div key={w.id}
                className={'pp-tchip' + (active ? ' active' : '') + (w.min ? ' min' : '') + (overIdx === idx ? ' over' : '')}
                draggable
                onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overIdx !== idx) setOverIdx(idx); }}
                onDragLeave={() => { if (overIdx === idx) setOverIdx(null); }}
                onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== idx) reorderWins(dragIdx, idx); setDragIdx(null); setOverIdx(null); }}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                title={winLabel(w)}
                onClick={() => { if (w.min || !active) onFocus(w.id); else onToggleMin(w.id); }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: w.min ? '#F59E0B' : (w.kind === 'list' ? '#22D3EE' : '#3B82F6'), flexShrink: 0 }} />
                {winLabel(w)}
                {w.editing && <span className="pp-tchip-dirty" title="Есть несохранённые изменения" />}
                <span className="pp-tchip-x" title="Закрыть"
                  onClick={(e) => { e.stopPropagation(); onClose(w.id); }}>×</span>
              </div>
            );
          })}
          <button onClick={onMinimizeAll} title={allMin ? 'Развернуть все окна' : 'Свернуть все окна'}
            style={{ marginLeft: 'auto', flexShrink: 0, background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', lineHeight: 1, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{allMin ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" /></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" /></svg>}</button>
        </div>
      )}
    </>
  );
}
