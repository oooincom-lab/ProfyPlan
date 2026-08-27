'use client';

import { useMemo, useState } from 'react';

export interface BomTreeNode {
  id: string;
  parent_id: string | null;
  level: number;
  node_type: string; // assembly | semi_finished | material
  nomenclature_id: string | null;
  nomenclature_name: string;
  quantity_per_parent: number | string;
  unit: string;
  is_make_or_buy: string; // make | buy
  procurement_lead_time_days: number | string | null;
  is_phantom: boolean;
  routing_id: string | null;
  order_id: string | null;
  ext_id: string | null;
  dimmed?: number; // 0/undefined = обычный; 1 = подчинённый 1-го уровня; 2 = 2-го уровня
  // Вариант А: владелец узла (какой заказ «производит» этот узел в цепочке)
  _ownerId?: string;
  _ownerExtId?: string;
  // Узел-граница: полуфабрикат, производимый другим (подчинённым) заказом — без своих операций здесь
  _boundary?: boolean;
  // Граница ПЕРВОГО уровня (дочерний заказ): показывается даже в режиме «Только свой BOM» (со своими операциями)
  _layerBoundary?: boolean;
}

export interface OrderOption {
  id: string;
  ext_id?: string | null;
  specification_name?: string | null;
}

interface BomTreeProps {
  nodes: BomTreeNode[];
  compact?: boolean;
  orderName?: string;
  poolName?: string;
  onOpenFull?: () => void;
  timeline?: TimelineOp[];
  timelineDraft?: boolean;
  timelineLoading?: boolean;
  onLoadTimeline?: () => void;
  editable?: boolean;
  orders?: OrderOption[];
  onNodeOrderChange?: (nodeId: string, orderId: string | null) => void;
  onNodeQuantityChange?: (nodeId: string, value: number) => void;
  onNodeRemove?: (nodeId: string) => void;
  onNodeAdd?: (parentId: string, nodeType: 'material' | 'semi_finished') => void;
  /** Вариант А: показывать управление «только свой BOM / вся цепочка» (тяжёлый модал) */
  chainControl?: boolean;
  /** id текущего заказа (для цветовой группировки и фильтра) */
  currentOrderId?: string;
  /** id узлов с аномалиями структуры (нет маршрута / нет подчинённого заказа) */
  anomalyIds?: Set<string>;
  /** Маршруты (с operations) — для встраивания операций в дерево */
  routings?: any[];
  /** Показывать операции маршрутов под узлами (режимы «Маршруты» / «Состав + Маршруты») */
  showOps?: boolean;
  /** Показывать материал-узлы (false — режим «Маршруты», только узлы с маршрутами) */
  showMaterials?: boolean;
  /** Имя ресурса по resource_type_id для операций */
  resName?: (rid: any) => string;
  /** Клик по бейджу «производит: …» — перейти к заказу-производителю узла */
  onOrderFocus?: (orderId: string) => void;
  /** Добавить операцию в маршрут узла (кнопка ⛭ при редактировании); при пустом routingId узел создаёт маршрут */
  onRoutingAdd?: (routingId: string, nodeId?: string) => void;
  /** Кнопки ＋/⇥/⛭ показывать только у корневых узлов (форма состава окна заказа) */
  addRootOnly?: boolean;
  /** Операции маршрутов раскрывать только у корневых узлов */
  rootOpsOnly?: boolean;
  /** Дочерние узлы не раскрываются (форма состава окна заказа: дочерний полуфабрикат без вложенного списка) */
  childExpandable?: boolean;
  /** Выбор/замена номенклатуры в строке (кнопка ⇄ при редактировании) */
  onNodeNomenclatureChange?: (nodeId: string, nodeType: string) => void;
  /** Разрыв связи узла с заказом-производителем (узел + заказ становятся свободными) */
  onNodeUnlink?: (nodeId: string, orderId: string | null) => void;
}

export interface TimelineOp {
  id?: string;
  name: string;
  duration: number;
  early_start: number;
  early_finish: number;
  total_float?: number;
}

const TYPE_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  assembly: { label: 'Сборка', color: '#60A5FA', bg: 'rgba(59,130,246,.15)', border: 'rgba(59,130,246,.35)' },
  semi_finished: { label: 'Полуфабрикат', color: '#34D399', bg: 'rgba(16,185,129,.14)', border: 'rgba(16,185,129,.3)' },
  material: { label: 'Материал', color: '#A8B6C8', bg: 'rgba(138,151,173,.13)', border: 'rgba(138,151,173,.3)' },
};

function fmtNum(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return (Math.round(n * 1000) / 1000).toString();
}

function orderLabel(orders: OrderOption[] | undefined, orderId: string | null | undefined): string {
  if (!orderId || !orders) return '';
  const o = orders.find(x => x.id === orderId);
  if (!o) return '';
  return o.ext_id || o.specification_name || '—';
}

function TypeIcon({ node_type }: { node_type: string }) {
  const c = 'currentColor';
  if (node_type === 'assembly') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round">
        <path d="M21 8l-9-5-9 5 9 5 9-5z" />
        <path d="M3 8v8l9 5 9-5V8" />
      </svg>
    );
  }
  if (node_type === 'semi_finished') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round">
        <path d="M12 2l9 5-9 5-9-5 9-5z" />
        <path d="M3 12l9 5 9-5" />
      </svg>
    );
  }
  // material
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round">
      <path d="M12 3c3.2 0 5 2.2 5 4 0 5.4-5 14-5 14s-5-8.6-5-14c0-1.8 1.8-4 5-4z" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s' }}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BomTree({ nodes, compact = false, orderName, poolName, onOpenFull, timeline, timelineDraft, timelineLoading, onLoadTimeline, editable, orders, onNodeOrderChange, onNodeQuantityChange, onNodeRemove, onNodeAdd, chainControl = false, currentOrderId, anomalyIds, routings, showOps = false, showMaterials = true, resName, onOrderFocus, onRoutingAdd, addRootOnly = false, rootOpsOnly = false, childExpandable = true, onNodeNomenclatureChange, onNodeUnlink }: BomTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'structure' | 'cpm' | 'ccm' | 'pert'>('structure');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showTimeline, setShowTimeline] = useState(true);
  const [chainAll, setChainAll] = useState(false);

  // Вариант А: при «только свой BOM» отфильтровываем узлы подчинённых заказов
  const effectiveNodes = useMemo(() => {
    if (!chainControl || chainAll || !currentOrderId) return nodes;
    return nodes.filter((n) => !n._ownerId || n._ownerId === currentOrderId || n._layerBoundary);
  }, [nodes, chainControl, chainAll, currentOrderId]);

  // Палитра по заказам-владельцам (устойчивая по порядку первого вхождения)
  const ownerColors = useMemo(() => {
    const palette = ['#10B981', '#A78BFA', '#F59E0B', '#EC4899', '#14B8A6', '#F97316', '#22D3EE'];
    const map = new Map<string, string>();
    let i = 0;
    for (const n of nodes) {
      const oid = n._ownerId;
      if (oid && oid !== currentOrderId && !map.has(oid)) {
        map.set(oid, palette[i % palette.length]);
        i++;
      }
    }
    return map;
  }, [nodes, currentOrderId]);

  const ownerLabel = (n: BomTreeNode): string => n._ownerExtId || '';

  const hasCpm = !!timeline && timeline.length > 0 && !timelineDraft;
  const cpmTotalDur = hasCpm ? Math.max(...timeline!.map(o => o.early_finish || 0), 1) : 1;
  const cpmCritCount = hasCpm ? timeline!.filter(o => (o.total_float ?? 0) === 0).length : 0;

  // Build tree from flat list
  const tree = useMemo(() => {
    const childrenMap: Record<string, BomTreeNode[]> = {};
    const roots: BomTreeNode[] = [];
    const idSet = new Set(effectiveNodes.map(n => n.id));
    for (const n of effectiveNodes) {
      // Нода с parent_id, которого нет в наборе (обрезанное поддерево заказа), — корень.
      if (n.parent_id && idSet.has(n.parent_id)) {
        (childrenMap[n.parent_id] ||= []).push(n);
      } else {
        roots.push(n);
      }
    }
    // sort children by sort_order then name
    for (const k of Object.keys(childrenMap)) {
      childrenMap[k].sort((a, b) => a.nomenclature_name.localeCompare(b.nomenclature_name));
    }
    return { childrenMap, roots };
  }, [effectiveNodes]);

  const toggleNode = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const all = new Set<string>();
    for (const n of nodes) if (tree.childrenMap[n.id]?.length) all.add(n.id);
    setCollapsed(all);
  };

  const matchesFilter = (n: BomTreeNode): boolean => {
    if (typeFilter !== 'all' && n.node_type !== typeFilter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${n.nomenclature_name} ${n.nomenclature_id || ''} ${n.ext_id || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  // Recursive render — but filter-aware: a node shows if it matches OR any descendant matches.
  const renderNode = (n: BomTreeNode, depth: number): React.ReactNode => {
    const meta = TYPE_META[n.node_type] || TYPE_META.material;
    if (!showMaterials && n.node_type === 'material') return null;
    const isRoot = depth === 0;
    const rawChildren = tree.childrenMap[n.id] || [];
    const children = showMaterials ? rawChildren : rawChildren.filter((c: BomTreeNode) => c.node_type !== 'material');
    const hasChildren = children.length > 0;
    const rt = showOps && n.routing_id && routings ? routings.find((r: any) => r.id === n.routing_id) : undefined;
    const ops = rt ? (rt.operations || []) : [];
    // В форме состава окна заказа операции раскрываются только у корневого узла
    const opsVisible = rootOpsOnly ? isRoot : true;
    const hasOps = showOps && ops.length > 0 && opsVisible;
    // Узел с операциями всегда раскрываем (иначе чекбокс «показывать операции»
    // в окне заказа не показывает операции дочерних узлов при childExpandable=false)
    const expandable = hasOps || (hasChildren && (isRoot || childExpandable));
    const isCollapsed = collapsed.has(n.id);
    const isBuy = n.is_make_or_buy === 'buy';
    const lead = fmtNum(n.procurement_lead_time_days);
    const dimLevel = n.dimmed || 0;
    const dimOpacity = dimLevel >= 2 ? 0.4 : dimLevel === 1 ? 0.6 : 1;
    const linkedOrderLabel = orderLabel(orders, n.order_id);
    // Вариант А: узел из BOM подчинённого заказа — своя подсветка по заказу-владельцу
    const isSub = !!currentOrderId && !!n._ownerId && n._ownerId !== currentOrderId;
    const ownerCol = isSub ? ownerColors.get(n._ownerId!) || '#10B981' : '';
    const ownerName = isSub ? ownerLabel(n) : '';

    return (
      <div key={n.id}>
        <div
          className="bom-node"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px',
            paddingLeft: isSub ? 10 : 8,
            borderRadius: 7, cursor: expandable ? 'pointer' : 'default',
            transition: 'background .12s',
            opacity: dimOpacity,
            background: isSub ? `${ownerCol}12` : 'transparent',
            borderLeft: isSub ? `3px solid ${ownerCol}` : '3px solid transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = isSub ? `${ownerCol}22` : '#162844')}
          onMouseLeave={e => (e.currentTarget.style.background = isSub ? `${ownerCol}12` : 'transparent')}
          onClick={() => expandable && toggleNode(n.id)}
        >
          <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#5A7090', flex: '0 0 16px' }}>
            {expandable ? <Chevron open={!isCollapsed} /> : null}
          </span>
          <span style={{
            width: 20, height: 20, borderRadius: 5, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', flex: '0 0 20px', background: meta.bg, color: meta.color,
          }}>
            <TypeIcon node_type={n.node_type} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#E8EEF5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {n.nomenclature_name}
              {anomalyIds && anomalyIds.has(n.id) && (
                <span title="Аномалия структуры: нет маршрута или нет подчинённого заказа" style={{
                  color: '#FCA5A5', fontSize: 10.5, marginLeft: 6, fontWeight: 700,
                  background: 'rgba(239,68,68,.14)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 4,
                  padding: '1px 5px', whiteSpace: 'nowrap',
                }}>
                  ⚠ аномалия
                </span>
              )}
              {n.is_phantom ? <span style={{ color: '#5A7090', fontSize: 11, marginLeft: 6 }}>фантом</span> : null}
              {isSub && ownerName && (
                <span title={`BOM заказа ${ownerName}`} style={{
                  color: ownerCol, fontSize: 10, marginLeft: 6, fontWeight: 600,
                  background: `${ownerCol}1c`, border: `1px solid ${ownerCol}45`, borderRadius: 4,
                  padding: '1px 5px', whiteSpace: 'nowrap',
                }}>
                  ⛓ {ownerName}
                </span>
              )}
              {linkedOrderLabel && (!currentOrderId || n.order_id !== currentOrderId) && (
                <span
                  title={onOrderFocus && n.order_id ? `Открыть заказ ${linkedOrderLabel}` : `Этот узел производит заказ ${linkedOrderLabel}`}
                  onClick={(e) => { e.stopPropagation(); if (onOrderFocus && n.order_id) onOrderFocus(n.order_id); }}
                  onMouseEnter={(e) => { if (onOrderFocus && n.order_id) { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,.32)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(139,92,246,.75)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; } }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(139,92,246,.14)'; el.style.borderColor = 'rgba(139,92,246,.35)'; el.style.transform = 'none'; }}
                  style={{
                    color: '#C4B5FD', fontSize: 10, marginLeft: 6, fontWeight: 600,
                    background: 'rgba(139,92,246,.14)', border: '1px solid rgba(139,92,246,.35)', borderRadius: 4,
                    padding: '1px 5px', whiteSpace: 'nowrap', cursor: onOrderFocus && n.order_id ? 'pointer' : 'default',
                    display: 'inline-flex', alignItems: 'center', gap: 3, transition: 'background .12s, border-color .12s, transform .12s',
                    boxShadow: onOrderFocus && n.order_id ? '0 0 0 1px rgba(139,92,246,.12)' : 'none',
                  }}>
                  производит: {linkedOrderLabel}{onOrderFocus && n.order_id ? <span style={{ fontSize: 9, opacity: .75 }}>↗</span> : null}
                </span>
              )}
            </span>
            <span style={{ display: 'block', fontSize: 11, color: '#5A7090', fontFamily: "'IBM Plex Mono', monospace" }}>
              {n.nomenclature_id || n.ext_id || '—'}
            </span>
          </span>
          {editable ? (
            <span style={{ flex: '0 0 66px', width: 66, display: 'inline-flex', alignItems: 'center', gap: 3 }}
              onClick={e => e.stopPropagation()}>
              <input type="number" min="0" step="any" defaultValue={fmtNum(n.quantity_per_parent)}
                key={n.id + ':' + fmtNum(n.quantity_per_parent)}
                onBlur={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) onNodeQuantityChange?.(n.id, v); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={{ width: '100%', background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 5, color: '#E2E8F0', padding: '2px 4px', fontSize: 12, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", outline: 'none' }} />
              <span style={{ color: '#5A7090', fontSize: 10, flex: '0 0 auto' }}>{n.unit}</span>
            </span>
          ) : (
            <span style={{ width: 56, textAlign: 'right', fontSize: 12, color: '#B0C4DE', fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'nowrap', flex: '0 0 56px' }}>
              {fmtNum(n.quantity_per_parent)} <span style={{ color: '#5A7090', fontSize: 11 }}>{n.unit}</span>
            </span>
          )}
          <span style={{
            width: compact ? 74 : 90, flex: `0 0 ${compact ? 74 : 90}px`, textAlign: 'center',
            fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 5,
            background: meta.bg, color: meta.color, whiteSpace: 'nowrap',
          }}>
            {meta.label}
          </span>
          <span style={{
            width: 44, flex: '0 0 44px', textAlign: 'center', fontSize: 10.5, fontWeight: 600,
            padding: '2px 5px', borderRadius: 5, whiteSpace: 'nowrap',
            background: isBuy ? 'rgba(96,165,250,.14)' : 'rgba(245,158,11,.14)',
            color: isBuy ? '#8FC1F7' : '#FBBF24',
          }}>
            {isBuy ? 'закупка' : 'произв.'}
          </span>
          {editable && (
            <span style={{ flex: '0 0 auto', display: 'inline-flex', gap: 3 }} onClick={e => e.stopPropagation()}>
              {/* Кнопки добавления — только у корневого узла (форма состава окна заказа) */}
              {(!addRootOnly || isRoot) && (n.routing_id || isRoot) && (
                <button type="button" title={n.routing_id ? 'Добавить операцию в маршрут' : 'Создать маршрут и добавить операцию'} onClick={() => onRoutingAdd?.(n.routing_id || '', n.id)}
                  style={{ background: 'rgba(34,211,238,.12)', border: '1px solid rgba(34,211,238,.35)', color: '#22D3EE', borderRadius: 5, width: 20, height: 20, fontSize: 11, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>⛭</button>
              )}
              {(!addRootOnly || isRoot) && (
                <button type="button" title="Добавить материал" onClick={() => onNodeAdd?.(n.id, 'material')}
                  style={{ background: 'rgba(52,211,153,.12)', border: '1px solid rgba(52,211,153,.35)', color: '#34D399', borderRadius: 5, width: 20, height: 20, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>＋</button>
              )}
              {(!addRootOnly || isRoot) && (
                <button type="button" title="Добавить полуфабрикат" onClick={() => onNodeAdd?.(n.id, 'semi_finished')}
                  style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.35)', color: '#A78BFA', borderRadius: 5, width: 20, height: 20, fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>⇥</button>
              )}
              {/* Разрыв связи с заказом-производителем — у вложенных узлов */}
              {addRootOnly && !isRoot && n.order_id && (!currentOrderId || n.order_id !== currentOrderId) && onNodeUnlink && (
                <button type="button" title="Разорвать связь с заказом-производителем (заказ станет свободным)" onClick={() => onNodeUnlink(n.id, n.order_id)}
                  style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.4)', color: '#FBBF24', borderRadius: 5, width: 20, height: 20, fontSize: 10.5, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>⛓</button>
              )}
              {onNodeNomenclatureChange && (
                <button type="button" title="Заменить номенклатуру (выбор из справочника)" onClick={() => onNodeNomenclatureChange(n.id, n.node_type)}
                  style={{ background: 'rgba(148,163,184,.12)', border: '1px solid rgba(148,163,184,.35)', color: '#A8B6C8', borderRadius: 5, width: 20, height: 20, fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>⇄</button>
              )}
              <button type="button" title="Удалить узел" onClick={() => onNodeRemove?.(n.id)}
                style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)', color: '#F87171', borderRadius: 5, width: 20, height: 20, fontSize: 11, lineHeight: 1, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>✕</button>
            </span>
          )}
          {!compact && editable && orders && (
            <span style={{ flex: '0 0 120px', width: 120, minWidth: 0 }}
              onClick={e => e.stopPropagation()}>
              <select
                value={n.order_id || ''}
                onChange={e => onNodeOrderChange?.(n.id, e.target.value || null)}
                title={linkedOrderLabel ? `Код заказа: ${linkedOrderLabel}` : 'Выбрать код заказа'}
                style={{
                  width: '100%', background: n.order_id ? 'rgba(139,92,246,.15)' : '#0A1628',
                  border: `1px solid ${n.order_id ? 'rgba(139,92,246,.4)' : '#1E3252'}`,
                  borderRadius: 6, color: n.order_id ? '#A78BFA' : '#8FA3BD',
                  padding: '3px 6px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                }}>
                <option value="">— нет заказа —</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.ext_id || o.specification_name || o.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </span>
          )}
          {!compact && (
            <span style={{
              width: 56, flex: '0 0 56px', textAlign: 'right', fontSize: 12,
              color: '#8FA3BD', fontFamily: "'IBM Plex Mono', monospace",
            }}>
              {n.procurement_lead_time_days !== null && n.procurement_lead_time_days !== undefined ? `${lead} дн` : '—'}
            </span>
          )}
        </div>
        {expandable && !isCollapsed && (
          <div style={{ marginLeft: 14, paddingLeft: 12, borderLeft: isSub && ownerCol ? `1px solid ${ownerCol}55` : '1px solid #2A4060' }}>
            {hasOps && ops.map((op: any) => {
              const det = [
                op.department ? 'Подразделение: ' + op.department : '',
                op.predecessors ? 'Предш.: ' + op.predecessors : '',
                op.setup_hours ? 'Наладка ' + op.setup_hours + ' ч' : '',
                op.teardown_hours ? 'Снятие ' + op.teardown_hours + ' ч' : '',
                Number(op.output_quantity) ? 'Вых. годн. ' + op.output_quantity : '',
              ].filter(Boolean).join(' · ');
              return (
                <div key={op.id || op.sequence_number} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', borderRadius: 6 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, flex: '0 0 18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(59,130,246,.14)', color: '#60A5FA', fontSize: 10.5, fontWeight: 700 }}>{op.sequence_number}</span>
                  {op.stage ? (
                    <span style={{ flex: '0 0 auto', fontSize: 10, color: '#C4B5FD', background: 'rgba(139,92,246,.14)', border: '1px solid rgba(139,92,246,.3)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>Этап {op.stage}{op.stage_name ? ' · ' + op.stage_name : ''}</span>
                  ) : null}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#5A7090', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ресурс: {resName ? resName(op.resource_type_id) : op.resource_type_id}{det ? ' · ' + det : ''}</span>
                  </span>
                  <span style={{ fontSize: 12, color: '#FCD34D', fontWeight: 600, whiteSpace: 'nowrap' }}>{Number(op.duration_hours) || 0} ч</span>
                </div>
              );
            })}
            {children.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Filter roots: keep a root if it matches OR any descendant matches
  const visibleRoots = useMemo(() => {
    if (!query.trim() && typeFilter === 'all') return tree.roots;
    const keep = (n: BomTreeNode): boolean => {
      if (matchesFilter(n)) return true;
      for (const c of tree.childrenMap[n.id] || []) if (keep(c)) return true;
      return false;
    };
    return tree.roots.filter(keep);
  }, [tree, query, typeFilter]);

  if (effectiveNodes.length === 0) {
    return (
      <div style={{ padding: '14px 10px', color: '#5A7090', fontSize: 12, textAlign: 'center' }}>
        {chainControl && !chainAll
          ? 'У этого заказа нет собственного BOM — в цепочке он использует BOM подчинённых заказов.'
          : 'BOM не загружен. Загрузите структуру изделия (BOM).'}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* Heavy header: mode toggle + toolbar */}
      {!compact && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ display: 'inline-flex', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 9, padding: 3, gap: 2 }}>
              {(['structure', 'cpm', 'ccm', 'pert'] as const).map(m => {
                const enabled = m === 'structure' || (m === 'cpm' && hasCpm);
                return (
                <button
                  key={m}
                  disabled={!enabled}
                  title={enabled ? undefined : 'Доступно после расчёта'}
                  onClick={() => setMode(m)}
                  style={{
                    border: 0, background: mode === m ? '#3B82F6' : 'transparent',
                    color: mode === m ? '#fff' : enabled ? '#8FA3BD' : '#5A7090',
                    fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
                    padding: '6px 12px', borderRadius: 6, cursor: enabled ? 'pointer' : 'not-allowed',
                    opacity: enabled ? 1 : 0.55,
                  }}>
                  {m === 'structure' ? 'Структура' : m === 'cpm' ? 'CPM' : m === 'ccm' ? 'CCM' : 'PERT'}
                </button>
                );
              })}
            </div>
            {chainControl && (
              <div style={{ display: 'inline-flex', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 9, padding: 3, gap: 2 }}>
                <button
                  onClick={() => setChainAll(false)}
                  title="Показать только узлы собственного BOM заказа"
                  style={{
                    border: 0, background: !chainAll ? '#8B5CF6' : 'transparent',
                    color: !chainAll ? '#fff' : '#8FA3BD',
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  }}>
                  Только свой BOM
                </button>
                <button
                  onClick={() => setChainAll(true)}
                  title="Показать единое дерево всей цепочки заказов"
                  style={{
                    border: 0, background: chainAll ? '#8B5CF6' : 'transparent',
                    color: chainAll ? '#fff' : '#8FA3BD',
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  }}>
                  Вся цепочка
                </button>
              </div>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={expandAll} style={toolbarBtn}>Развернуть</button>
            <button onClick={collapseAll} style={toolbarBtn}>Свернуть</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0A1628', border: '1px solid #1E3252', borderRadius: 7, padding: '5px 9px', flex: 1, maxWidth: 280, color: '#5A7090' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по имени или коду…"
                style={{ border: 0, background: 'transparent', color: '#E8EEF5', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', width: '100%' }} />
            </div>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 7, color: '#B0C4DE', padding: '5px 8px', fontSize: 12 }}>
              <option value="all">Все типы</option>
              <option value="assembly">Сборка</option>
              <option value="semi_finished">Полуфабрикат</option>
              <option value="material">Материал</option>
            </select>
            {onOpenFull && (
              <button onClick={onOpenFull} style={{ ...toolbarBtn, color: '#60A5FA', borderColor: 'rgba(59,130,246,.4)' }}>
                Развернуть полностью ↗
              </button>
            )}
          </div>
        </>
      )}

      {/* Column header (heavy only, structure mode) */}
      {!compact && mode === 'structure' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderBottom: '1px solid #1E3252', fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: '#5A7090', fontWeight: 600, marginBottom: 4 }}>
          <span style={{ width: 16, flex: '0 0 16px' }} />
          <span style={{ width: 20, flex: '0 0 20px' }} />
          <span style={{ flex: 1 }}>Состав</span>
          <span style={{ width: 56, flex: '0 0 56px', textAlign: 'right' }}>Кол-во</span>
          <span style={{ width: 90, flex: '0 0 90px', textAlign: 'center' }}>Тип</span>
          <span style={{ width: 44, flex: '0 0 44px', textAlign: 'center' }}>Способ</span>
          {editable && orders && <span style={{ width: 120, flex: '0 0 120px', textAlign: 'center' }}>Заказ</span>}
          <span style={{ width: 56, flex: '0 0 56px', textAlign: 'right' }}>Срок</span>
        </div>
      )}

      {/* Body: structure tree OR CPM summary */}
      {mode === 'cpm' && hasCpm ? (
        <div style={{ padding: '6px 2px 2px' }}>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#5A7090' }}>Общая длительность</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#E8EEF5', lineHeight: 1.2 }}>{Math.round(cpmTotalDur)} ч</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#5A7090' }}>Операций</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#E8EEF5', lineHeight: 1.2 }}>{(timeline || []).length}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#5A7090' }}>Критический путь</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#f87171', lineHeight: 1.2 }}>{cpmCritCount} оп.</div>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 4 }}>
            Гант по операциям проекта. КП — критический путь (резерв времени 0), некритические операции имеют запас.
          </div>
        </div>
      ) : (
        <div>{visibleRoots.map(r => renderNode(r, 0))}</div>
      )}

      {/* Legend (heavy only, structure mode) */}
      {!compact && mode === 'structure' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid #1E3252', fontSize: 11, color: '#8FA3BD' }}>
          {Object.entries(TYPE_META).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} /> {m.label}
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#8FC1F7' }} /> закупка
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#FBBF24' }} /> производство
          </span>
        </div>
      )}

      {/* Compact timeline (light) */}
      {compact && (
        <div style={{ marginTop: 10, borderTop: '1px solid #1E3252', paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#5A7090', fontWeight: 500 }}>Таймлайн</span>
            {!timeline || timeline.length === 0
              ? <span style={{ fontSize: 10.5, color: '#4A6080' }}>черновик — без расчёта</span>
              : timelineDraft
                ? <span style={{ fontSize: 10.5, color: '#8FA3BD' }}>черновик · {timeline.length} оп.</span>
                : <span style={{ fontSize: 10.5, color: '#5A7090' }}>{timeline.length} оп. · КП: {cpmCritCount}</span>}
          </div>
          {timeline && timeline.length > 0 ? (
            <div>
              {timeline.slice(0, 8).map((op, i) => {
                const totalDur = Math.max(...timeline.map(o => o.early_finish || 0), 1);
                const es = op.early_start || 0;
                const dur = op.duration || (op.early_finish - op.early_start) || 1;
                const left = (es / totalDur) * 100;
                const width = Math.max((dur / totalDur) * 100, 1);
                const crit = !timelineDraft && (op.total_float ?? 0) === 0;
                return (
                  <div key={op.id || i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ width: 130, flex: '0 0 130px', fontSize: 10.5, color: timelineDraft ? '#94A3B8' : crit ? '#f87171' : '#8FA3BD', fontWeight: crit ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={op.name}>
                      {op.name}
                    </span>
                    <div style={{ flex: 1, position: 'relative', height: 11, background: '#0A1628', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        position: 'absolute', left: `${left}%`, width: `${width}%`, height: '100%', borderRadius: 2,
                        background: timelineDraft ? 'linear-gradient(90deg, rgba(148,163,184,.22), rgba(148,163,184,.45))' : crit ? 'linear-gradient(90deg, rgba(239,68,68,.4), rgba(239,68,68,.7))' : 'linear-gradient(90deg, rgba(59,130,246,.3), rgba(59,130,246,.6))',
                        border: timelineDraft ? '1px solid rgba(148,163,184,.3)' : crit ? '1px solid rgba(239,68,68,.4)' : '1px solid rgba(59,130,246,.25)',
                      }} />
                    </div>
                    <span style={{ width: 34, flex: '0 0 34px', textAlign: 'right', fontSize: 9.5, fontFamily: "'IBM Plex Mono', monospace", color: timelineDraft ? '#8FA3BD' : crit ? '#f87171' : '#5A7090' }}>
                      {crit ? 'КП' : `${Math.round(dur)}ч`}
                    </span>
                  </div>
                );
              })}
              {timeline.length > 8 && <div style={{ fontSize: 10, color: '#5A7090', marginTop: 2 }}>+{timeline.length - 8} ещё…</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22, background: '#0A1628', borderRadius: 3, padding: '0 6px', border: '1px dashed #1E3252' }}>
              <div style={{ flex: 1, height: 8, background: 'repeating-linear-gradient(90deg, #1E3252 0 8px, transparent 8px 14px)', borderRadius: 2 }} />
              {onLoadTimeline && (
                <button onClick={onLoadTimeline} disabled={timelineLoading} style={{ background: '#1E3252', border: '1px solid #2A4060', color: timelineLoading ? '#5A7090' : '#B0C4DE', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: timelineLoading ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  {timelineLoading ? '…' : '▶ CPM'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Timeline (heavy only) */}
      {!compact && (
        <div style={{ marginTop: 12, borderTop: '1px solid #1E3252', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8FA3BD', cursor: 'pointer' }}>
              <input type="checkbox" checked={showTimeline} onChange={e => setShowTimeline(e.target.checked)} style={{ accentColor: '#3B82F6' }} />
              Таймлайн
            </label>
            {!timeline || timeline.length === 0
              ? <span style={{ fontSize: 11, color: '#5A7090' }}>Черновик — без расчёта</span>
              : timelineDraft
                ? <span style={{ fontSize: 11, color: '#8FA3BD' }}>черновик · {timeline.length} оп. по данным</span>
                : <span style={{ fontSize: 11, color: '#5A7090' }}>после расчёта CPM</span>}
          </div>
          {showTimeline && (timeline && timeline.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              {timeline.map((op, i) => {
                const totalDur = Math.max(...timeline.map(o => o.early_finish || 0), 1);
                const es = op.early_start || 0;
                const dur = op.duration || (op.early_finish - op.early_start) || 1;
                const left = (es / totalDur) * 100;
                const width = Math.max((dur / totalDur) * 100, 1);
                const crit = !timelineDraft && (op.total_float ?? 0) === 0;
                return (
                  <div key={op.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 190, flex: '0 0 190px', fontSize: 11.5, color: timelineDraft ? '#94A3B8' : crit ? '#f87171' : '#B0C4DE', fontWeight: crit ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={op.name}>
                      {op.name}
                    </span>
                    <div style={{ flex: 1, position: 'relative', height: 15, background: '#0A1628', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        position: 'absolute', left: `${left}%`, width: `${width}%`, height: '100%', borderRadius: 3,
                        background: timelineDraft ? 'linear-gradient(90deg, rgba(148,163,184,.22), rgba(148,163,184,.45))' : crit ? 'linear-gradient(90deg, rgba(239,68,68,.4), rgba(239,68,68,.7))' : 'linear-gradient(90deg, rgba(59,130,246,.3), rgba(59,130,246,.6))',
                        border: timelineDraft ? '1px solid rgba(148,163,184,.32)' : crit ? '1px solid rgba(239,68,68,.5)' : '1px solid rgba(59,130,246,.3)',
                      }} />
                    </div>
                    <span style={{ width: 44, flex: '0 0 44px', textAlign: 'right', fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: timelineDraft ? '#8FA3BD' : crit ? '#f87171' : '#5A7090' }}>
                      {crit ? 'КП' : `${Math.round(dur)}ч`}
                    </span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 10.5, color: '#5A7090' }}>
                {timelineDraft ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 4, borderRadius: 2, background: 'rgba(148,163,184,.5)' }} /> черновик (план по данным импорта)</span>
                ) : (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 4, borderRadius: 2, background: 'rgba(239,68,68,.6)' }} /> критический путь</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 4, borderRadius: 2, background: 'rgba(59,130,246,.5)' }} /> некритический</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8, padding: '14px 12px', border: '1px dashed #1E3252', borderRadius: 8, textAlign: 'center', color: '#5A7090', fontSize: 12 }}>
              Таймлайн появится после расчёта CPM/CCM.
              {onLoadTimeline && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={onLoadTimeline} disabled={timelineLoading} style={{ background: '#1E3252', border: '1px solid #2A4060', color: timelineLoading ? '#5A7090' : '#B0C4DE', borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: timelineLoading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                    {timelineLoading ? 'Расчёт…' : '▶ Запустить CPM-расчёт'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const toolbarBtn: React.CSSProperties = {
  background: '#0A1628', border: '1px solid #1E3252', color: '#8FA3BD',
  borderRadius: 7, padding: '5px 10px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
};
