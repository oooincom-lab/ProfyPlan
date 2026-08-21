'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WinRec, LayState, OrderTab } from './useWindows';
import DirectoryTable from '@/components/DirectoryTable';
import DirectoryPicker from '@/components/DirectoryPicker';
import BomTree from '@/components/bomtree';

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
  routings: any[];
  routingFor: (o: any) => any;
  routingsFor: (o: any) => any[];
  resName: (rid: any) => string;
  onOpenOrder: (o: any) => void;
  onOpenGroup: (g: any) => void;
  onOpenPool: (p: any) => void;
  renderOrdersTable?: () => any;
  renderBomWindow?: (w: WinRec) => any;
  onOpenDirectory: (entity: string) => void;
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
  onNodeOrderChange: (nodeId: string, orderId: string | null) => void;
  onBomNodeQuantity: (nodeId: string, value: number) => void;
  onBomNodeRemove: (nodeId: string) => void;
  onBomNodeAdd: (parentId: string, nodeType: 'material' | 'semi_finished') => void;
  onRoutingOpUpdate: (opId: string, patch: Record<string, any>) => void;
  onPickResource: (opId: string) => void;
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
    orderBomNodes, routingFor, routingsFor, resName, routings,
    onOpenOrder, onOpenGroup, onOpenPool, renderOrdersTable, renderBomWindow, onOpenDirectory,
    onClose, onFocus, onToggleMin, onMinimizeAll, onReset, onToggleMax, onDrag, onResize, onApplyCell, onSaveEdit,
    onNodeOrderChange, onBomNodeQuantity, onBomNodeRemove, onBomNodeAdd,
    onRoutingOpUpdate, onPickResource,
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
    if (w.kind === 'dir') return w.title || 'Справочник';
    const o = w.data || orderById(w.orderId);
    const base = o ? (o.ext_id || o.id) : (w.orderId.slice(0, 8));
    return w.kind === 'bom' ? 'BOM · ' + base : base;
  };

  const winFullTitle = (w: WinRec) => {
    if (w.kind === 'list') return w.title || 'Список';
    if (w.kind === 'dir') return w.title || 'Справочник';
    const o = w.data || orderById(w.orderId);
    const full = o ? ((o.ext_id || o.id) + ' · ' + (o.specification_name || '')) : (w.orderId.slice(0, 8));
    return w.kind === 'bom' ? 'BOM · ' + full : full;
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
        const isBom = w.kind === 'bom';
        const isDir = w.kind === 'dir';
        const o = (isList || isDir) ? null : (w.data || orderById(w.orderId));
        if (!isList && !isDir && !o) return null;

        const bomNodes = o ? orderBomNodes(o) : [];

        return (
          <div key={w.id} id={'pp-win-' + w.id} className={'pp-win' + (w.min ? ' min' : '') + (w.z === maxZ ? ' focus' : '')}
            style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 200 + w.z }}
            onPointerDown={() => { if (w.z !== maxZ) onFocus(w.id); }}>
            <div className="pp-win-title" onPointerDown={(e) => onDrag(e, w)} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.pp-wbtn')) return; onReset(w.id); }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isList ? '#22D3EE' : isBom ? '#A78BFA' : isDir ? '#10B981' : '#3B82F6', flexShrink: 0 }} />
              <span className="ttl">{isList ? (w.title || 'Список') : isDir ? (w.title || 'Справочник') : ((o!.ext_id || o!.id) + ' · ' + (o!.specification_name || ''))}</span>
              <button className="pp-wbtn" title="Свернуть" onClick={(e) => { e.stopPropagation(); onToggleMin(w.id); }}>–</button>
              <button className="pp-wbtn" title={w.max ? 'Восстановить' : 'Развернуть'} onClick={(e) => { e.stopPropagation(); onToggleMax(w.id); }}>
                {w.max
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V6a2 2 0 0 1 2-2h3" /><path d="M20 9V6a2 2 0 0 0-2-2h-3" /><path d="M4 15v3a2 2 0 0 0 2 2h3" /><path d="M20 15v3a2 2 0 0 1-2 2h-3" /></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H6a3 3 0 0 0-3 3v3" /><path d="M15 3h3a3 3 0 0 1 3 3v3" /><path d="M9 21H6a3 3 0 0 1-3-3v-3" /><path d="M15 21h3a3 3 0 0 0 3-3v-3" /></svg>}
              </button>
              <button className="pp-wbtn" title="Раскладка окон (Snap)" onClick={(e) => { e.stopPropagation(); onFocus(w.id); setSnapSel(null); setSnapCell(-1); setLay(prev => (prev && prev.winId === w.id && !prev.cols) ? null : { winId: w.id, cols: 0, rows: 0, placed: [] }); }}>⛶</button>
              <button className="pp-wbtn close" title="Закрыть" onClick={(e) => { e.stopPropagation(); onClose(w.id); }}>✕</button>
            </div>

            {!isList && !isBom && !isDir && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid #1E3252', background: '#0D1F3A', flexShrink: 0 }}>
                <span style={{ flex: 1, minWidth: 0, color: '#8FA3BD', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o!.specification_name || o!.ext_id || ''}</span>
                {!w.editing ? (
                  <button onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, editing: true, form: { client_id: o!.client_id || '', quantity: String(o!.quantity ?? ''), unit: o!.unit || '', priority: o!.priority || 'normal', start_date: o!.start_date || '', due_date: o!.due_date || '', status: o!.status || 'draft' } } : x))}
                    style={{ background: 'transparent', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✏️ Редактировать</button>
                ) : (
                  <>
                    <button onClick={() => onSaveEdit(w)} style={{ background: '#3B82F6', border: 0, color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>✓ Сохранить</button>
                    <button onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, editing: false } : x))} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✕ Отмена</button>
                  </>
                )}
              </div>
            )}

            {!isList && !isBom && !isDir && (
              <div style={{ display: 'flex', borderBottom: '1px solid #1E3252', flexShrink: 0 }}>
                {TAB_LIST.map(tb => (
                  <button key={tb.v} onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, tab: tb.v } : x))}
                    style={{ flex: 1, border: 0, background: 'transparent', color: w.tab === tb.v ? '#fff' : '#8FA3BD', borderBottom: '2px solid ' + (w.tab === tb.v ? '#3B82F6' : 'transparent'), padding: '7px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{tb.l}</button>
                ))}
              </div>
            )}

            <div style={{ padding: '12px 14px', overflow: 'auto', flex: 1, fontSize: 12.5, color: '#E2E8F0', minHeight: 0 }}>
              {isBom && (renderBomWindow ? renderBomWindow(w) : null)}
              {isDir && (
                <DirectoryTable entity={w.data?.entity || ''} columns={w.data?.columns || []} apiBase="https://profyplan.ru/api" onSelect={w.data?.onSelect} />
              )}
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

              {!isList && !isBom && !isDir && w.tab === 'order' && !w.editing && (
                <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '6px 10px', fontSize: 13 }}>
                  {[['Клиент', o!.client || '—'], ['Кол-во', String(o!.quantity ?? '—')], ['Ед.', o!.unit || '—'], ['Приоритет', o!.priority || '—'], ['Статус', o!.status || '—'], ['Старт', o!.start_date || '—'], ['Финиш', o!.due_date || '—'], ['Заказ родителя', o!.parent_order_id || '—']].map((kv: any) => (
                    <div key={kv[0]} style={{ display: 'contents' }}>
                      <div style={{ color: '#5A7090' }}>{kv[0]}</div>
                      <div style={{ color: '#E2E8F0' }}>{kv[1]}</div>
                    </div>
                  ))}
                </div>
              )}
              {!isList && !isBom && !isDir && w.tab === 'order' && w.editing && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Клиент</span>
                    <DirectoryPicker entity="counterparties" apiBase="https://profyplan.ru/api" value={w.form.client_id || null} onChange={(v) => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, client_id: v } } : x))} placeholder="Выбрать контрагента..." onManage={() => onOpenDirectory('counterparties')} />
                  </label>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Кол-во</span>
                    <input type="number" value={w.form.quantity || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, quantity: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                  </label>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Ед. изм.</span>
                    <DirectoryPicker entity="units" apiBase="https://profyplan.ru/api" value={w.form.unit || null} onChange={(v) => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, unit: v } } : x))} displayField="symbol_ru" valueField="symbol_int" subField="symbol_int" placeholder="Выбрать единицу..." onManage={() => onOpenDirectory('units')} />
                  </label>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Приоритет</span>
                    <select value={w.form.priority || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, priority: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                      <option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Старт</span>
                    <input type="date" value={w.form.start_date || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, start_date: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                  </label>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Финиш</span>
                    <input type="date" value={w.form.due_date || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, due_date: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }} />
                  </label>
                  <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#8FA3BD', fontSize: 12 }}>Статус</span>
                    <select value={w.form.status || ''} onChange={e => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, status: e.target.value } } : x))} style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5 }}>
                      <option value="draft">Черновик</option><option value="active">В работе</option><option value="completed">Завершён</option>
                    </select>
                  </label>
                </div>
              )}
              {!isList && !isBom && !isDir && w.tab === 'bom' && (
                bomNodes.length ? <BomTree nodes={bomNodes} compact orderName={o!.specification_name} routings={routings} showOps showMaterials resName={resName} editable={w.editing} orders={orders} onNodeOrderChange={onNodeOrderChange} onNodeQuantityChange={onBomNodeQuantity} onNodeRemove={onBomNodeRemove} onNodeAdd={onBomNodeAdd} />
                : <div style={{ color: '#5A7090' }}>Состав не загружен — нажмите кнопку BOM (▸) у заказа в списке.</div>
              )}
              {!isList && !isBom && !isDir && w.tab === 'route' && (() => {
                const rts = routingsFor(o);
                if (!rts.length) return <div style={{ color: '#5A7090' }}>Маршруты не заданы. Привяжите маршруты к узлам спецификации (BOM → узел → routing_id).</div>;
                return (
                  <div>
                    {rts.map((r: any) => {
                      const total = (r.operations || []).reduce((s: number, op: any) => s + (Number(op.duration_hours) || 0), 0);
                      return (
                        <div key={r.id} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11.5, color: '#22D3EE', marginBottom: 6 }}>⛓ {r.name || 'Маршрут'} · {(r.operations || []).length} оп. · {total} ч{r.variant ? ' · вариант ' + r.variant : ''}</div>
                          {(r.operations || []).map((op: any) => (
                            <div key={op.id || op.sequence_number} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ color: '#3B82F6', fontWeight: 700, fontSize: 12 }}>{op.sequence_number}</span>
                                <span style={{ flex: 1, fontWeight: 600 }}>{op.name}</span>
                                <span style={{ color: '#FCD34D', fontSize: 12 }}>{Number(op.duration_hours) || 0} ч</span>
                              </div>
                              <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 3 }}>
                                {w.editing ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                    <span style={{ flexShrink: 0 }}>Ресурс:</span>
                                    <button
                                      type="button"
                                      onClick={() => onPickResource(op.id)}
                                      style={{
                                        background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6,
                                        color: op.resource_type_id ? '#E8EEF5' : '#5A7090',
                                        padding: '6px 12px', fontSize: 13, cursor: 'pointer', flex: 1, textAlign: 'left',
                                      }}
                                    >
                                      {op.resource_type_id ? resName(op.resource_type_id) : 'Выбрать ресурс...'}
                                    </button>
                                  </div>
                                ) : (
                                  <>Ресурс: {resName(op.resource_type_id)}</>
                                )}{op.setup_hours ? ' · Наладка: ' + op.setup_hours + ' ч' : ''}{op.teardown_hours ? ' · Снятие: ' + op.teardown_hours + ' ч' : ''}{op.predecessors && op.predecessors.length ? ' · Предш.: ' + op.predecessors.join(', ') : ''}{Number(op.output_quantity) ? ' · Вых. годн.: ' + op.output_quantity : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {!isList && !isBom && !isDir && w.tab === 'res' && (() => {
                const used = new Set<string>();
                for (const r of routingsFor(o)) for (const op of (r.operations || [])) if (op.resource_type_id) used.add(String(op.resource_type_id));
                const ordRes = resourcesList.filter((r: any) => used.has(r.id) || used.has(r.name));
                return ordRes.length ? (
                  <div>
                    <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>Ресурсы заказа: {ordRes.length}</div>
                    {ordRes.map((r: any) => (
                      <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed rgba(30,58,95,.5)' }}>
                        <span style={{ flex: 1 }}>{r.name}</span>
                        <span style={{ color: '#5A7090', fontSize: 11 }}>{r.resource_type || '—'}</span>
                        <span style={{ color: '#FCD34D', fontSize: 11 }}>×{r.capacity_per_unit ?? r.capacity_per_day ?? '—'}</span>
                        <span style={{ color: '#5A7090', fontSize: 11 }}>{r.capacity_unit || r.unit || ''}</span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ color: '#5A7090' }}>У заказа нет задействованных ресурсов.</div>;
              })()}
              {!isList && !isBom && !isDir && w.tab === 'plan' && (
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
                title={winFullTitle(w)}
                onClick={() => { if (w.min || !active) onFocus(w.id); else onToggleMin(w.id); }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: w.min ? '#F59E0B' : (w.kind === 'list' ? '#22D3EE' : w.kind === 'bom' ? '#A78BFA' : w.kind === 'dir' ? '#10B981' : '#3B82F6'), flexShrink: 0 }} />
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
