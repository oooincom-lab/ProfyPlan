'use client';

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
  orderBomNodes: (o: any) => any[];
  routingFor: (o: any) => any;
  resName: (rid: any) => string;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onToggleMin: (id: string) => void;
  onReset: (id: string) => void;
  onDrag: (e: any, w: WinRec) => void;
  onResize: (e: any, w: WinRec) => void;
  onPickLay: (cols: number, rows: number) => void;
  onPlaceNext: () => void;
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
 * Слой оконного режима: floating-окна заказов, подсветка Snap-зоны,
 * панель раскладок (⛶) и панель задач. Чистая презентация — вся логика
 * живёт в useWindows() на стороне page.tsx.
 */
export default function WindowsLayer(props: WindowsLayerProps) {
  const {
    wins, lay, snapZone, setWins, setLay,
    orders, resourcesList, orderBomNodes, routingFor, resName,
    onClose, onFocus, onToggleMin, onReset, onDrag, onResize, onPickLay, onPlaceNext, onSaveEdit,
  } = props;

  const maxZ = wins.reduce((m: number, w: WinRec) => Math.max(m, w.z), 0);
  const orderById = (id: string) => orders.find((x: any) => x.id === id) || null;

  return (
    <>
      {snapZone && <div className="pp-snapzone" style={{ left: snapZone.x, top: snapZone.y, width: snapZone.w, height: snapZone.h }} />}

      {wins.map((w: WinRec) => {
        const o = orderById(w.orderId);
        if (!o) return null;
        const bomNodes = orderBomNodes(o);
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
        const rt = routingFor(o);
        const rtTotal = rt?.operations ? rt.operations.reduce((s: number, op: any) => s + (Number(op.duration_hours) || 0), 0) : 0;
        return (
          <div key={w.id} id={'pp-win-' + w.id} className={'pp-win' + (w.min ? ' min' : '') + (w.z === maxZ ? ' focus' : '')}
            style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 200 + w.z }}
            onPointerDown={() => { if (w.z !== maxZ) onFocus(w.id); }}>
            <div className="pp-win-title" onPointerDown={(e) => onDrag(e, w)} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.pp-wbtn')) return; onReset(w.id); }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', flexShrink: 0 }} />
              <span className="ttl">{o.ext_id || o.id} · {o.specification_name || ''}</span>
              <button className="pp-wbtn" title="Свернуть" onClick={(e) => { e.stopPropagation(); onToggleMin(w.id); }}>–</button>
              <button className="pp-wbtn" title="Раскладка окон (Snap)" onClick={(e) => { e.stopPropagation(); onFocus(w.id); setLay(prev => (prev && prev.winId === w.id && !prev.cols) ? null : { winId: w.id, cols: 0, rows: 0, placed: [] }); }}>⛶</button>
              <button className="pp-wbtn close" title="Закрыть" onClick={(e) => { e.stopPropagation(); onClose(w.id); }}>✕</button>
            </div>
            <div style={{ display: 'flex', borderBottom: '1px solid #1E3252', flexShrink: 0 }}>
              {TAB_LIST.map(tb => (
                <button key={tb.v} onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, tab: tb.v, editing: false } : x))}
                  style={{ flex: 1, border: 0, background: 'transparent', color: w.tab === tb.v ? '#fff' : '#8FA3BD', borderBottom: '2px solid ' + (w.tab === tb.v ? '#3B82F6' : 'transparent'), padding: '7px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{tb.l}</button>
              ))}
            </div>
            <div style={{ padding: '12px 14px', overflowY: 'auto', flex: 1, fontSize: 12.5, color: '#E2E8F0', minHeight: 0 }}>
              {w.tab === 'order' && !w.editing && (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button onClick={() => setWins(prev => prev.map(x => x.id === w.id ? { ...x, editing: true, form: { client: o.client || '', quantity: String(o.quantity ?? ''), priority: o.priority || 'normal', start_date: o.start_date || '', due_date: o.due_date || '', status: o.status || 'draft' } } : x))}
                      style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(245,158,11,.4)', color: '#FCD34D', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>✏️ Редактировать</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '6px 10px', fontSize: 13 }}>
                    {[['Клиент', o.client || '—'], ['Кол-во', String(o.quantity ?? '—')], ['Ед.', o.unit || '—'], ['Приоритет', o.priority || '—'], ['Статус', o.status || '—'], ['Старт', o.start_date || '—'], ['Финиш', o.due_date || '—'], ['Заказ родителя', o.parent_order_id || '—']].map((kv: any) => (
                      <div key={kv[0]} style={{ display: 'contents' }}>
                        <div style={{ color: '#5A7090' }}>{kv[0]}</div>
                        <div style={{ color: '#E2E8F0' }}>{kv[1]}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {w.tab === 'order' && w.editing && (
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
              {w.tab === 'bom' && (
                bomNodes.length ? <div>{bomNodes.filter((n: any) => !n.parent_id).map((n: any) => renderBomNode(n, 0))}</div>
                : <div style={{ color: '#5A7090' }}>Состав не загружен — нажмите кнопку BOM (▸) у заказа в списке.</div>
              )}
              {w.tab === 'route' && (
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
              {w.tab === 'res' && (
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
              {w.tab === 'plan' && (
                <div style={{ color: '#8FA3BD', lineHeight: 1.6 }}>
                  План по заказу формируется при расчёте CPM / Ганта (Фаза 2): операции маршрута будут разворачиваться в план с привязкой к ресурсам и датам.
                </div>
              )}
            </div>
            <div className="pp-resize" onPointerDown={(e) => onResize(e, w)} />
          </div>
        );
      })}

      {lay && lay.cols > 0 && (() => {
        const d = { x: 260, y: 53, w: typeof window !== 'undefined' ? window.innerWidth - 260 : 1140, h: typeof window !== 'undefined' ? Math.max(400, window.innerHeight - 53 - 44) : 800 };
        const cw = d.w / lay.cols, ch = d.h / lay.rows;
        const cells: any[] = [];
        for (let r = 0; r < lay.rows; r++) for (let c = 0; c < lay.cols; c++) cells.push({ x: d.x + c * cw, y: d.y + r * ch, w: cw, h: ch });
        return (
          <div className="pp-lay" style={{ right: 16, bottom: 56 }}>
            <div className="lh">РАСКЛАДКА · {lay.cols * lay.rows} ячейки — клик по свободной ячейке ставит следующее открытое окно</div>
            <div className="pp-laycells" style={{ gridTemplateColumns: 'repeat(' + lay.cols + ', 1fr)' }}>
              {cells.map((z: any, i: number) => {
                const placedW = i === 0 ? wins.find((x: WinRec) => x.id === lay.winId) : (i - 1 < lay.placed.length ? wins.find((x: WinRec) => x.id === lay.placed[i - 1]) : null);
                const placedO = placedW ? orderById(placedW.orderId) : null;
                const isFree = i > 0 && i - 1 >= lay.placed.length;
                const cand = isFree ? wins.find((x: WinRec) => x.id !== lay.winId && !lay.placed.includes(x.id)) : null;
                const candO = cand ? orderById(cand.orderId) : null;
                return (
                  <div key={i} className={'bc' + (placedW ? ' done' : '')} onClick={() => { if (isFree) onPlaceNext(); }}
                    style={isFree ? { borderStyle: 'dashed' } : undefined}>
                    {placedW ? <>{placedO ? (placedO.ext_id || placedO.id) : (placedW.orderId.slice(0, 8))}</> : (isFree ? <>{candO ? '→ ' + (candO.ext_id || candO.id) : '—'} <small>клик — поставить сюда</small></> : '')}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {lay && !lay.cols && (() => {
        const L: { n: string; cols: number; rows: number }[] = [
          { n: '2 окна', cols: 2, rows: 1 },
          { n: '3 окна', cols: 3, rows: 1 },
          { n: '4 окна', cols: 2, rows: 2 },
        ];
        return (
          <div className="pp-lay" style={{ right: 16, bottom: 56 }}>
            <div className="lh">РАСКЛАДКА ОКОН — выберите вариант</div>
            <div className="pp-layrow">
              {L.map((o2) => (
                <div key={o2.n} className="pp-layopt" onClick={() => onPickLay(o2.cols, o2.rows)}>
                  <div className="mini">
                    {Array.from({ length: o2.rows * o2.cols }).map((_, i) => (
                      <div key={i} className={'cell' + (o2.cols === 3 && i >= 2 ? ' h' : '')} />
                    ))}
                  </div>
                  <div className="lab">{o2.n}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {wins.length > 0 && (
        <div className="pp-taskbar">
          {wins.map((w: WinRec) => {
            const o = orderById(w.orderId);
            const active = w.z === maxZ && !w.min;
            return (
              <div key={w.id} className={'pp-tchip' + (active ? ' active' : '') + (w.min ? ' min' : '')}
                onClick={() => { if (w.min || !active) onFocus(w.id); else onToggleMin(w.id); }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: w.min ? '#F59E0B' : '#3B82F6', flexShrink: 0 }} />
                {o ? (o.ext_id || o.id) : '—'}
              </div>
            );
          })}
          <span style={{ fontSize: 11, color: '#5A7090', marginLeft: 4, whiteSpace: 'nowrap' }}>Перетаскивайте окна за заголовок — у краёв появится зона прилипания; «⛶» — сетка раскладок.</span>
        </div>
      )}
    </>
  );
}
