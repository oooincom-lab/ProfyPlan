'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WinRec, LayState, OrderTab } from './useWindows';
import DirectoryTable from '@/components/DirectoryTable';
import ReferenceField from '@/components/ReferenceField';
import DirectoryPicker from '@/components/DirectoryPicker';
import BomTree from '@/components/bomtree';
import ResourceForm from '@/components/ResourceForm';
import DebugBadge from '@/components/DebugBadge';
import AppModal from '@/components/AppModal';

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
  onDirManageEdit?: (entity: string, row: any) => void;
  onDirManageDelete?: (entity: string, row: any) => void;
  /** Обновить списки справочников после удаления (счётчик) */
  dirRefreshKey?: number;
  /** Клик по бейджу «производит: …» — перейти к заказу */
  onOrderFocus?: (orderId: string) => void;
  /** Добавить операцию в маршрут (при пустом routingId — создать маршрут узла) */
  onRoutingOpAdd?: (routingId: string, nodeId?: string) => void;
  /** Удалить операцию маршрута */
  onRoutingOpRemove?: (opId: string) => void;
  /** Выбор/замена номенклатуры в строке состава (кнопка ⇄ при редактировании) */
  onNodeNomenclatureChange?: (nodeId: string, nodeType: string) => void;
  /** Разрыв связи узла с заказом-производителем */
  onNodeUnlink?: (nodeId: string, orderId: string | null) => void;
  /** Открыть окно заказа по id (клик по бейджу «производит: …») */
  openOrderWinById?: (orderId: string) => void;
  /** Аномалии структуры BOM проекта (для списка заказов и вкладки «Состав») */
  anomalies?: any;
  anomaliesLoading?: boolean;
  onCreateMissingOrders?: () => void;
  onCreateOrderFromNode?: (nodeId: string) => void;
  /** Привязать свободный заказ к текущему как производителя полуфабриката */
  onAttachOrder?: (currentOrderId: string, freeOrderId: string) => void;
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
  onOpenDirPick?: (entity: string, onPick: (row: any) => void) => void;
  onRoutingOpCreate?: (routingId: string, name: string, resourceId: string, catalogOperationId?: string | null, durationHours?: number | null) => Promise<boolean>;
  opNameSuggestions?: string[];
  /** Ресурсы заказа (Шаг 5): {orderId: items[]} — из операций маршрутов + переопределения */
  orderRes?: Record<string, any[]>;
  /** Добавить ресурс в заказ (ReferenceField) */
  onOrderResAdd?: (orderId: string, resourceId: string) => void;
  /** Загрузить ресурсы заказа (lazy при открытой вкладке «Ресурсы») */
  onOrderResLoad?: (orderId: string) => void;
  /** Изменить переопределение/связь ресурса заказа (upsert) */
  onOrderResChange?: (orderId: string, item: any, patch: Record<string, any>) => void;
  /** Убрать переопределение/связь */
  onOrderResRemove?: (orderId: string, item: any) => void;
  schedules?: any[];
  onSaveResourceEdit?: (w: WinRec) => void;
  debug?: boolean;
};

function fmtPreds(p: any): string {
  if (Array.isArray(p)) return p.join(', ');
  if (typeof p === 'string' && p.trim()) return p.split(/[;,\s]+/).filter(Boolean).join(', ');
  return '';
}

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
    onDirManageEdit, onDirManageDelete, dirRefreshKey = 0, onOrderFocus,
    onRoutingOpAdd, onRoutingOpRemove, onNodeUnlink, openOrderWinById, onNodeNomenclatureChange,
    anomalies, anomaliesLoading = false, onCreateMissingOrders, onCreateOrderFromNode, onAttachOrder,
    onClose, onFocus, onToggleMin, onMinimizeAll, onReset, onToggleMax, onDrag, onResize, onApplyCell, onSaveEdit,
    onNodeOrderChange, onBomNodeQuantity, onBomNodeRemove, onBomNodeAdd,
    onRoutingOpUpdate, onPickResource, onOpenDirPick, onRoutingOpCreate, opNameSuggestions,
    schedules = [], onSaveResourceEdit, orderRes, onOrderResAdd, onOrderResLoad, onOrderResChange, onOrderResRemove,
    debug = false,
  } = props;

  const maxZ = wins.reduce((m: number, w: WinRec) => Math.max(m, w.z), 0);
  const allMin = wins.length > 0 && wins.every(w => w.min);
  const [snapSel, setSnapSel] = useState<{ c: number; r: number } | null>(null);
  const [snapCell, setSnapCell] = useState(-1);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [delOp, setDelOp] = useState<{ id: string; name: string } | null>(null);
  const [attachOpen, setAttachOpen] = useState<{ orderId: string } | null>(null);
  const [opAddForm, setOpAddForm] = useState<Record<string, { opId: string | null; opName: string | null; opDur: number | null; resId: string | null }>>({});
  // Единица длительности для инлайн-редактирования операций маршрута (Шаг 4): д/ч/мин/с
  const [durUnit, setDurUnit] = useState<Record<string, string>>({});

  // Шаг 5: ленивая загрузка ресурсов заказа для открытых вкладок «Ресурсы»
  useEffect(() => {
    for (const w of wins) {
      if (!w.min && w.tab === 'res' && w.orderId && onOrderResLoad) onOrderResLoad(w.orderId);
    }
  }, [wins, onOrderResLoad]);
  // Селектор «Узел» на вкладке «Маршрут» (Шаг 4): фильтр маршрутов по узлу BOM
  const [routeSelNode, setRouteSelNode] = useState<Record<string, string | null>>({});
  const [showBomOps, setShowBomOps] = useState(false); // чекбокс «показывать операции» (вкладка Состав)
  const orderById = (id: string) => orders.find((x: any) => x.id === id) || null;
  const winLabel = (w: WinRec) => {
    if (w.kind === 'list') return w.title || 'Список';
    if (w.kind === 'dir') return w.title || 'Справочник';
    if (w.kind === 'resedit') return w.title || 'Ресурс';
    const o = w.data || orderById(w.orderId);
    const base = o ? (o.ext_id || o.id) : (w.orderId.slice(0, 8));
    return w.kind === 'bom' ? 'BOM · ' + base : base;
  };

  const winFullTitle = (w: WinRec) => {
    if (w.kind === 'list') return w.title || 'Список';
    if (w.kind === 'dir') return w.title || 'Справочник';
    if (w.kind === 'resedit') return w.title || 'Ресурс';
    if (w.kind === 'opadd') return w.title || 'Добавить операцию в маршрут';
    const o = w.data || orderById(w.orderId);
    const full = o ? ((o.ext_id || o.id) + ' · ' + (o.specification_name || '')) : (w.orderId.slice(0, 8));
    return w.kind === 'bom' ? 'BOM · ' + full : full;
  };

  // 🧪 Технический идентификатор окна (режим отладки)
  const debugIdOf = (w: WinRec, idx: number): { badge: string; copy: string } => {
    const n = wins.filter((x, i) => i <= idx && x.kind === w.kind && (
      w.kind === 'dir' ? (x.data?.entity === w.data?.entity)
        : w.kind === 'list' ? (x.listKind === w.listKind)
          : true
    )).length;
    const title = winFullTitle(w);
    if (w.kind === 'order') return { badge: `[order:openWin #${n}]`, copy: `[order:openWin #${n}] «${title}»` };
    if (w.kind === 'bom') return { badge: `[bom:openBomWin #${n}]`, copy: `[bom:openBomWin #${n}] «${title}»` };
    if (w.kind === 'list') return { badge: `[list:openListWin:${w.listKind || '?'} #${n}]`, copy: `[list:openListWin:${w.listKind || '?'} #${n}] «${title}»` };
    if (w.kind === 'dir') return { badge: `[dir:openDirWin:${w.data?.entity || '?'} #${n}]`, copy: `[dir:openDirWin:${w.data?.entity || '?'} #${n}] «${title}»` };
    if (w.kind === 'opadd') return { badge: `[opadd:openWin #${n}]`, copy: `[opadd:openWin #${n}] «${title}»` };
    return { badge: `[resedit:openResEdit #${n}]`, copy: `[resedit:openResEdit #${n}] «${title}»` };
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

      {wins.map((w: WinRec, wi: number) => {
        const isList = w.kind === 'list';
        const isBom = w.kind === 'bom';
        const isDir = w.kind === 'dir';
        const isResEdit = w.kind === 'resedit';
        const o = (isList || isDir || isResEdit) ? null : (w.data || orderById(w.orderId));
        if (!isList && !isDir && !isResEdit && !o) return null;

        const bomNodes = o ? orderBomNodes(o) : [];

        // ── Окно «Добавить операцию в маршрут» (MDI): простое окно рабочего стола с формой ──
        if (w.kind === 'opadd') {
          const f = opAddForm[w.id] || { opId: null, opName: null, opDur: null, resId: null };
          const canAdd = !!f.opId && !!f.resId;
          return (
            <div key={w.id} id={'pp-win-' + w.id} className={'pp-win' + (w.min ? ' min' : '') + (w.z === maxZ ? ' focus' : '')}
              style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 200 + w.z }}
              onPointerDown={() => { if (w.z !== maxZ) onFocus(w.id); }}>
              <div className="pp-win-title" onPointerDown={(e) => onDrag(e, w)} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.pp-wbtn')) return; onReset(w.id); }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22D3EE', flexShrink: 0 }} />
                <span className="ttl">{w.title || 'Добавить операцию в маршрут'}</span>
                {debug && <DebugBadge text={debugIdOf(w, wi).badge} copy={debugIdOf(w, wi).copy} debug={debug} />}
                <button className="pp-wbtn" title="Свернуть" onClick={(e) => { e.stopPropagation(); onToggleMin(w.id); }}>–</button>
                <button className="pp-wbtn" title="Закрыть" onClick={(e) => { e.stopPropagation(); onClose(w.id); }}>✕</button>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', height: 'calc(100% - 32px)' }}>
                <div style={{ fontSize: 11.5, color: '#8FA3BD' }}>Операция * <span style={{ color: '#5A7090' }}>(из каталога операций; длительность подставится по умолчанию):</span></div>
                <ReferenceField
                  entity="operations"
                  pathOverride="/api/v1/catalog-operations/"
                  value={f.opId || null}
                  onChange={(v) => setOpAddForm(prev => ({ ...prev, [w.id]: { ...f, opId: v, opName: null, opDur: null } }))}
                  onOpenBrowser={onOpenDirPick}
                  onPickItem={(row) => setOpAddForm(prev => ({ ...prev, [w.id]: { ...f, opId: String(row.id), opName: row.name, opDur: Number(row.default_duration_hours) || 1 } }))}
                  placeholder="Выбрать операцию…"
                />
                {f.opName && (
                  <div style={{ fontSize: 11.5, color: '#8FA3BD' }}>Название: <b style={{ color: '#E8EEF5' }}>{f.opName}</b> · длительность по умолчанию: <b style={{ color: '#E8EEF5' }}>{f.opDur} ч</b></div>
                )}
                <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 4 }}>Ресурс * <span style={{ color: '#5A7090' }}>(обязательно — операция без ресурса не участвует в расчёте мощности):</span></div>
                <ReferenceField
                  entity="resources"
                  value={f.resId}
                  onChange={(v) => setOpAddForm(prev => ({ ...prev, [w.id]: { ...f, resId: v } }))}
                  onOpenBrowser={onOpenDirPick}
                  placeholder="Выбрать ресурс…"
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #1E3252' }}>
                  <button onClick={() => onClose(w.id)} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
                  <button
                    onClick={async () => {
                      if (!canAdd || !onRoutingOpCreate) return;
                      const ok = await onRoutingOpCreate(w.data.routingId, (f.opName || '').trim(), f.resId as string, f.opId, f.opDur);
                      if (ok !== false) onClose(w.id);
                    }}
                    disabled={!canAdd}
                    style={{ background: canAdd ? '#0891B2' : '#123047', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: canAdd ? 'pointer' : 'default', opacity: canAdd ? 1 : .5, fontFamily: 'inherit' }}
                  >Добавить</button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={w.id} id={'pp-win-' + w.id} className={'pp-win' + (w.min ? ' min' : '') + (w.z === maxZ ? ' focus' : '')}
            style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 200 + w.z }}
            onPointerDown={() => { if (w.z !== maxZ) onFocus(w.id); }}>
            <div className="pp-win-title" onPointerDown={(e) => onDrag(e, w)} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.pp-wbtn')) return; onReset(w.id); }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isList ? '#22D3EE' : isBom ? '#A78BFA' : isDir ? '#10B981' : isResEdit ? '#F59E0B' : '#3B82F6', flexShrink: 0 }} />
              <span className="ttl">{isList ? (w.title || 'Список') : isDir ? (w.title || 'Справочник') : isResEdit ? (w.title || 'Ресурс') : ((o!.ext_id || o!.id) + ' · ' + (o!.specification_name || ''))}</span>
              {debug && <DebugBadge text={debugIdOf(w, wi).badge} copy={debugIdOf(w, wi).copy} debug={debug} />}
              <button className="pp-wbtn" title="Свернуть" onClick={(e) => { e.stopPropagation(); onToggleMin(w.id); }}>–</button>
              <button className="pp-wbtn" title={w.max ? 'Восстановить' : 'Развернуть'} onClick={(e) => { e.stopPropagation(); onToggleMax(w.id); }}>
                {w.max
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V6a2 2 0 0 1 2-2h3" /><path d="M20 9V6a2 2 0 0 0-2-2h-3" /><path d="M4 15v3a2 2 0 0 0 2 2h3" /><path d="M20 15v3a2 2 0 0 1-2 2h-3" /></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H6a3 3 0 0 0-3 3v3" /><path d="M15 3h3a3 3 0 0 1 3 3v3" /><path d="M9 21H6a3 3 0 0 1-3-3v-3" /><path d="M15 21h3a3 3 0 0 0 3-3v-3" /></svg>}
              </button>
              <button className="pp-wbtn" title="Раскладка окон (Snap)" onClick={(e) => { e.stopPropagation(); onFocus(w.id); setSnapSel(null); setSnapCell(-1); setLay(prev => (prev && prev.winId === w.id && !prev.cols) ? null : { winId: w.id, cols: 0, rows: 0, placed: [] }); }}>⛶</button>
              <button className="pp-wbtn close" title="Закрыть" onClick={(e) => { e.stopPropagation(); onClose(w.id); }}>✕</button>
            </div>

            {!isList && !isBom && !isDir && !isResEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid #1E3252', background: '#0D1F3A', flexShrink: 0 }}>
                <span style={{ flex: 1, minWidth: 0, color: '#8FA3BD', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o!.specification_name || o!.ext_id || ''}</span>
                {w.tab === 'bom' && (
                  <>
                    <label title="Показывать операции маршрута корневого узла в составе" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#8FA3BD', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={showBomOps} onChange={e => setShowBomOps(e.target.checked)} style={{ accentColor: '#3B82F6' }} />
                      показывать операции
                    </label>
                    {onAttachOrder && (
                      <button onClick={() => setAttachOpen({ orderId: o!.id })}
                        title="Привязать свободный заказ как производителя полуфабриката"
                        style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.4)', color: '#C4B5FD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>⛓ Привязать свободный заказ</button>
                    )}
                  </>
                )}
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

            {!isList && !isBom && !isDir && !isResEdit && (
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
                <DirectoryTable
                  entity={w.data?.entity || ''}
                  refreshKey={dirRefreshKey}
                  columns={w.data?.columns || []}
                  apiBase="https://profyplan.ru/api"
                  onSelect={w.data?.onSelect}
                  endpoints={w.data?.endpoints}
                  onManageEdit={w.data?.onManageEdit ? (row: any) => onDirManageEdit?.(w.data?.entity || '', row) : undefined}
                  onManageDelete={w.data?.onManageDelete ? (row: any) => onDirManageDelete?.(w.data?.entity || '', row) : undefined}
                />
              )}
              {isResEdit && (
                <ResourceForm
                  form={w.form}
                  onChange={patch => setWins(prev => prev.map(x => x.id === w.id ? { ...x, form: { ...x.form, ...patch } } : x))}
                  schedules={schedules}
                  saving={!!w.saving}
                  onSave={() => onSaveResourceEdit && onSaveResourceEdit(w)}
                  onCancel={() => onClose(w.id)}
                />
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

              {!isList && !isBom && !isDir && !isResEdit && w.tab === 'order' && !w.editing && (
                <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '6px 10px', fontSize: 13 }}>
                  {[['Клиент', o!.client || '—'], ['Кол-во', String(o!.quantity ?? '—')], ['Ед.', o!.unit || '—'], ['Приоритет', o!.priority || '—'], ['Статус', o!.status || '—'], ['Старт', o!.start_date || '—'], ['Финиш', o!.due_date || '—'], ['Заказ родителя', o!.parent_order_id || '—']].map((kv: any) => (
                    <div key={kv[0]} style={{ display: 'contents' }}>
                      <div style={{ color: '#5A7090' }}>{kv[0]}</div>
                      <div style={{ color: '#E2E8F0' }}>{kv[1]}</div>
                    </div>
                  ))}
                </div>
              )}
              {!isList && !isBom && !isDir && !isResEdit && w.tab === 'order' && w.editing && (
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
              {!isList && !isBom && !isDir && !isResEdit && w.tab === 'bom' && (
                <>
                  {(() => {
                    const all: any[] = anomalies ? [...(anomalies.no_routing || []), ...(anomalies.no_order || []), ...(anomalies.self_order || [])] : [];
                    if (anomaliesLoading) return <div style={{ fontSize: 11.5, color: '#5A7090', padding: '6px 4px', marginBottom: 8 }}>Проверка структуры…</div>;
                    if (!all.length) return null;
                    return (
                      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#FCA5A5' }}>⚠ Аномалии структуры: {all.length}</span>
                          <span style={{ fontSize: 10.5, color: '#8FA3BD' }}>полуфабрикаты без маршрута или без подчинённого заказа</span>
                          <div style={{ flex: 1 }} />
                          {onCreateMissingOrders && all.filter((a: any) => a.category !== 'no_routing').length > 0 && (
                            <button onClick={onCreateMissingOrders} style={{ background: '#3B82F6', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Создать заказы ({all.filter((a: any) => a.category !== 'no_routing').length})</button>
                          )}
                        </div>
                        <div style={{ display: 'grid', gap: 3, maxHeight: 110, overflow: 'auto', marginTop: 5 }}>
                          {all.slice(0, 12).map((a: any, i: number) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 8px', background: 'rgba(4,10,20,.4)', borderRadius: 5 }}>
                              <span style={{ color: '#FCA5A5', fontWeight: 600, flex: '0 0 84px' }}>{a.category === 'no_routing' ? 'нет маршрута' : a.category === 'no_order' ? 'нет заказа' : 'свой заказ'}</span>
                              <span style={{ color: '#E8EEF5', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.path || a.name}>{a.name}</span>
                              {a.category !== 'no_routing' && onCreateOrderFromNode && (
                                <button onClick={() => onCreateOrderFromNode(a.node_id)} style={{ background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 5, padding: '1px 8px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Создать заказ</button>
                              )}
                            </div>
                          ))}
                          {all.length > 12 && <div style={{ fontSize: 10.5, color: '#5A7090', padding: '2px 8px' }}>…и ещё {all.length - 12}</div>}
                        </div>
                      </div>
                    );
                  })()}
                  {bomNodes.length ? <BomTree nodes={bomNodes} compact orderName={o!.specification_name} routings={routings} showOps={showBomOps} showMaterials resName={resName} editable={w.editing} orders={orders} onNodeOrderChange={onNodeOrderChange} onNodeQuantityChange={onBomNodeQuantity} onNodeRemove={onBomNodeRemove} onNodeAdd={onBomNodeAdd} onOrderFocus={openOrderWinById || onOrderFocus} onRoutingAdd={onRoutingOpAdd} onNodeUnlink={onNodeUnlink} addRootOnly rootOpsOnly childExpandable={false} onNodeNomenclatureChange={onNodeNomenclatureChange} currentOrderId={o!.id} />
                  : <div style={{ color: '#5A7090' }}>Состав не загружен — нажмите кнопку BOM (▸) у заказа в списке.</div>}
                </>
              )}
              {!isList && !isBom && !isDir && !isResEdit && w.tab === 'route' && (() => {
                const rts = routingsFor(o);
                if (!rts.length) return <div style={{ color: '#5A7090' }}>Маршруты не заданы. Привяжите маршруты к узлам спецификации (BOM → узел → routing_id).</div>;
                const selNode = routeSelNode[w.id] || '';
                const shown = selNode ? rts.filter((r: any) => r.product_node_id === selNode) : rts;
                return (
                  <div>
                    {bomNodes.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 11.5, color: '#8FA3BD', flexShrink: 0 }}>Узел:</span>
                        <select
                          value={selNode}
                          onChange={(e) => setRouteSelNode(prev => ({ ...prev, [w.id]: e.target.value }))}
                          style={{ flex: 1, maxWidth: 380, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 10px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          <option value="">Все узлы ({rts.length})</option>
                          {bomNodes.map((n: any) => (
                            <option key={n.id} value={n.id}>{(n.path || '') + ' ' + (n.nomenclature_name || '')}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {shown.map((r: any) => {
                      const total = (r.operations || []).reduce((s: number, op: any) => s + (Number(op.duration_hours) || 0), 0);
                      return (
                        <div key={r.id} style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{ fontSize: 11.5, color: '#22D3EE' }}>⛓ {r.name || 'Маршрут'} · {(r.operations || []).length} оп. · {total} ч{r.variant ? ' · вариант ' + r.variant : ''}</span>
                            <div style={{ flex: 1 }} />
                            {w.editing && (
                              <button type="button" title="Добавить операцию в маршрут"
                                onClick={() => onRoutingOpAdd?.(r.id)}
                                style={{ background: 'rgba(34,211,238,.12)', border: '1px solid rgba(34,211,238,.35)', color: '#22D3EE', borderRadius: 5, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>＋ операция</button>
                            )}
                          </div>
                          {(r.operations || []).map((op: any) => (
                            <div key={op.id || op.sequence_number} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                {w.editing ? (
                                  <input
                                    type="number" min="1" step="1"
                                    defaultValue={op.sequence_number}
                                    key={'seq-' + op.id + '-' + op.sequence_number}
                                    title="Номер операции"
                                    onBlur={(e) => { const v = parseInt(String(e.target.value), 10); if (!Number.isNaN(v) && v >= 1 && v !== op.sequence_number) onRoutingOpUpdate?.(op.id, { sequence_number: v }); }}
                                    style={{ width: 44, background: '#0A1628', border: '1px solid rgba(59,130,246,.4)', borderRadius: 5, color: '#93C5FD', padding: '2px 5px', fontSize: 12, textAlign: 'center', fontFamily: 'inherit' }}
                                  />
                                ) : (
                                  <span style={{ color: '#3B82F6', fontWeight: 700, fontSize: 12 }}>{op.sequence_number}</span>
                                )}
                                {w.editing ? (
                                  <ReferenceField
                                    entity="operations"
                                    pathOverride="/api/v1/catalog-operations/"
                                    value={op.catalog_operation_id || null}
                                    displayValue={op.catalog_operation_id ? op.name : undefined}
                                    onChange={(v) => { if (!v) onRoutingOpUpdate?.(op.id, { catalog_operation_id: null }); }}
                                    onPickItem={(row) => onRoutingOpUpdate?.(op.id, { catalog_operation_id: row.id, name: row.name, duration_hours: Number(row.default_duration_hours) || Number(op.duration_hours) || 0 })}
                                    onOpenBrowser={onOpenDirPick}
                                    placeholder="Операция из каталога…"
                                    style={{ flex: 1, minWidth: 150 }}
                                  />
                                ) : (
                                  <span style={{ flex: 1, fontWeight: 600 }}>{op.name}</span>
                                )}
                                {w.editing && (
                                  <button type="button" title="Удалить операцию"
                                    onClick={() => setDelOp({ id: op.id, name: op.name })}
                                    style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)', color: '#F87171', borderRadius: 5, width: 22, height: 22, fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>✕</button>
                                )}
                                {w.editing ? (() => {
                                  const K: Record<string, number> = { 'д': 24, 'ч': 1, 'мин': 1 / 60, 'с': 1 / 3600 };
                                  const unit = durUnit[op.id] || 'ч';
                                  const k = K[unit] || 1;
                                  const display = ((Number(op.duration_hours) || 0) / k);
                                  return (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#FCD34D', fontSize: 12 }}>
                                    <input
                                      type="number" min="0" step="any"
                                      defaultValue={Number(display.toFixed(3))}
                                      key={'dur-' + op.id + '-' + unit + '-' + (Number(op.duration_hours) || 0)}
                                      title="Продолжительность операции"
                                      onBlur={(e) => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (!Number.isNaN(v) && v >= 0) { const hours = v * k; if (Number(hours.toFixed(3)) !== Number(op.duration_hours)) { onRoutingOpUpdate?.(op.id, { duration_hours: Number(hours.toFixed(3)) }); } } }}
                                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                      style={{ width: 74, background: '#0A1628', border: '1px solid rgba(245,158,11,.4)', borderRadius: 5, color: '#FCD34D', padding: '2px 5px', fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }}
                                    />
                                    <select
                                      value={unit}
                                      title="Единица длительности"
                                      onChange={(e) => setDurUnit(prev => ({ ...prev, [op.id]: e.target.value }))}
                                      style={{ background: '#0A1628', border: '1px solid rgba(245,158,11,.4)', borderRadius: 5, color: '#FCD34D', padding: '2px 3px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}
                                    >
                                      <option value="д">д</option>
                                      <option value="ч">ч</option>
                                      <option value="мин">мин</option>
                                      <option value="с">с</option>
                                    </select>
                                  </span>
                                  );
                                })() : (
                                  <span style={{ color: '#FCD34D', fontSize: 12 }}>{Number(op.duration_hours) || 0} ч</span>
                                )}
                              </div>
                              <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 3 }}>
                                {w.editing ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ flexShrink: 0, width: 108 }}>Этап:</span>
                                      <ReferenceField
                                        entity="stages"
                                        pathOverride={'/api/v1/projects/' + (o.project_id || '') + '/stages/'}
                                        value={op.stage_name || null}
                                        displayValue={op.stage_name || undefined}
                                        onChange={() => {}}
                                        onPickItem={(row) => onRoutingOpUpdate?.(op.id, { stage_name: row.name })}
                                        onOpenBrowser={onOpenDirPick}
                                        placeholder="Выбрать этап…"
                                        style={{ flex: 1, minWidth: 140 }}
                                      />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ flexShrink: 0, width: 108 }}>Ресурс:</span>
                                      <ReferenceField
                                        entity="resources"
                                        value={op.resource_type_id || null}
                                        onChange={(v) => onRoutingOpUpdate?.(op.id, { resource_type_id: v })}
                                        onOpenBrowser={onOpenDirPick}
                                        placeholder="Выбрать ресурс…"
                                        style={{ flex: 1, minWidth: 140 }}
                                      />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ flexShrink: 0, width: 108 }}>Подразделение:</span>
                                      <ReferenceField
                                        entity="departments"
                                        value={null}
                                        displayValue={op.department || undefined}
                                        onChange={() => {}}
                                        onPickItem={(row) => onRoutingOpUpdate?.(op.id, { department: row.name })}
                                        onOpenBrowser={onOpenDirPick}
                                        placeholder="Выбрать подразделение…"
                                        style={{ flex: 1, minWidth: 140 }}
                                      />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ flexShrink: 0, width: 108 }}>Предш. оп.:</span>
                                      <input
                                        type="text"
                                        defaultValue={fmtPreds(op.predecessors)}
                                        key={'pred-' + op.id + '-' + (op.predecessors || '')}
                                        title="Номера предшественников через запятую"
                                        onBlur={(e) => { const v = e.target.value.replace(/[^0-9,\s]/g, '').trim(); if (v !== (op.predecessors || '')) onRoutingOpUpdate?.(op.id, { predecessors: v || null }); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                        placeholder="—"
                                        style={{ flex: 1, minWidth: 80, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 10px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div>Этап: {op.stage_name || '—'} · Ресурс: {resName(op.resource_type_id)}</div>
                                )}{op.setup_hours ? ' · Наладка: ' + op.setup_hours + ' ч' : ''}{op.teardown_hours ? ' · Снятие: ' + op.teardown_hours + ' ч' : ''}{fmtPreds(op.predecessors) ? ' · Предш.: ' + fmtPreds(op.predecessors) : ''}{Number(op.output_quantity) ? ' · Вых. годн.: ' + op.output_quantity : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {!isList && !isBom && !isDir && !isResEdit && w.tab === 'res' && o && (() => {
                const list = (orderRes || {})[o.id] || [];
                return (
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 11.5, color: '#5A7090', flex: 1 }}>Ресурсы заказа: {list.length} <span style={{ fontSize: 10.5 }}>(из операций маршрутов; здесь задаётся подразделение и доступная мощность)</span></span>
                      <ReferenceField
                        entity="resources"
                        value={null}
                        onChange={() => {}}
                        onPickItem={(row) => onOrderResAdd?.(o.id, String(row.id))}
                        onOpenBrowser={onOpenDirPick}
                        placeholder="+ Ресурс"
                        style={{ flex: '0 1 260px', minWidth: 180 }}
                      />
                    </div>
                    {list.length === 0 && (
                      <div style={{ color: '#5A7090', fontSize: 12 }}>Ресурсы появятся автоматически, когда назначите их операциям маршрута (вкладка «Маршрут»), либо добавьте вручную полем «+ Ресурс».</div>
                    )}
                    {list.map((it: any) => (
                      <div key={it.resource_id} style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ flex: 1, fontWeight: 600, fontSize: 12.5 }}>{it.resource_name}</span>
                          <span style={{ color: '#5A7090', fontSize: 11 }}>Ед.: {it.resource_unit || '—'}</span>
                          <span style={{ color: '#5A7090', fontSize: 11 }}>Тип: {it.resource_type || '—'}</span>
                          {it.id && (
                            <button type="button" title="Убрать из заказа" onClick={() => onOrderResRemove?.(o.id, it)}
                              style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)', color: '#F87171', borderRadius: 5, width: 22, height: 22, fontSize: 12, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                          <span style={{ fontSize: 11.5, color: '#8FA3BD', width: 112 }}>Подразделение:</span>
                          <ReferenceField
                            entity="departments"
                            value={it.department_id || null}
                            displayValue={it.department_name || undefined}
                            onChange={() => {}}
                            onPickItem={(row) => onOrderResChange?.(o.id, it, { department_id: row.id })}
                            onOpenBrowser={onOpenDirPick}
                            placeholder="Выбрать подразделение…"
                            style={{ flex: 1, minWidth: 170 }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 11.5, color: '#8FA3BD', width: 112 }}>Доступно:</span>
                          <input
                            type="number" min="0" step="any"
                            defaultValue={it.capacity ?? ''}
                            key={'cap-' + (it.id || it.resource_id) + '-' + (it.capacity ?? '')}
                            onBlur={(e) => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (!Number.isNaN(v) && v >= 0) onOrderResChange?.(o.id, it, { capacity: v }); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            style={{ width: 90, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '5px 8px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', textAlign: 'right' }}
                          />
                          <span style={{ color: '#5A7090', fontSize: 11 }}>{it.resource_unit || ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {!isList && !isBom && !isDir && !isResEdit && w.tab === 'plan' && (
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
          {debug && <DebugBadge debug={debug} text="[area:taskbar]" />}
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
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: w.min ? '#F59E0B' : (w.kind === 'list' ? '#22D3EE' : w.kind === 'bom' ? '#A78BFA' : w.kind === 'dir' ? '#10B981' : w.kind === 'resedit' ? '#F59E0B' : '#3B82F6'), flexShrink: 0 }} />
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

      {delOp && (
        <AppModal title="Удалить операцию" onClose={() => setDelOp(null)} accent="#F87171">
          <div style={{ fontSize: 12.5, color: '#B0C4DE' }}>
            Удалить операцию <b style={{ color: '#E8EEF5' }}>«{delOp.name}»</b> из маршрута?
            <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 6 }}>Операция будет удалена безвозвратно.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
            <button onClick={() => setDelOp(null)} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
            <button onClick={() => { onRoutingOpRemove?.(delOp.id); setDelOp(null); }} style={{ background: '#EF4444', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Удалить</button>
          </div>
        </AppModal>
      )}

      {attachOpen && (() => {
        const cur = orderById(attachOpen.orderId);
        const free = orders.filter((x: any) => !x.parent_order_id && x.id !== attachOpen.orderId);
        return (
          <AppModal title="Привязать свободный заказ" onClose={() => setAttachOpen(null)} accent="#A78BFA" width={520}>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 10 }}>
              Свободные заказы (без родителя): <b style={{ color: '#C4B5FD' }}>{free.length}</b> — для заказа <b style={{ color: '#C4B5FD' }}>{cur ? (cur.ext_id || cur.specification_name || cur.id.slice(0, 8)) : ''}</b>. Выбранный заказ станет производителем первого свободного полуфабриката в составе.
            </div>
            {free.length === 0 && (
              <div style={{ color: '#5A7090', padding: '12px 4px', fontSize: 12 }}>
                Свободных заказов нет (в проекте всего {orders.length}). Свободными считаются заказы без родителя — чтобы освободить заказ, разорвите связь у его узла в составе (кнопка ⛓).
              </div>
            )}
            <div style={{ display: 'grid', gap: 5, maxHeight: 300, overflow: 'auto' }}>
              {free.map((x: any) => (
                <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FBBF24', flexShrink: 0 }} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#B0C4DE', flex: '0 0 74px' }}>{x.ext_id || '—'}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#E8EEF5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.specification_name || x.ext_id || '—'}</span>
                  <button
                    onClick={() => { onAttachOrder?.(attachOpen.orderId, x.id); setAttachOpen(null); }}
                    style={{ background: 'rgba(167,139,250,.14)', border: '1px solid rgba(167,139,250,.45)', color: '#C4B5FD', borderRadius: 6, padding: '4px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Привязать</button>
                </div>
              ))}
            </div>
          </AppModal>
        );
      })()}
    </>
  );
}
