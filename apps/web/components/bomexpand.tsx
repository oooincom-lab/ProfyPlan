'use client';

import { useState } from 'react';
import BomTree from './bomtree';

export type BomExpandProps = {
  order: any;
  nodes: any[];
  orders: any[];
  anomalies: any;               // { no_routing: [], no_order: [], self_order: [] } | null
  anomaliesLoading: boolean;
  semiPolicy: 'strict' | 'flexible';
  timeline?: any;
  timelineLoading?: boolean;
  onLoadTimeline?: () => void;
  onNodeOrderChange: (nodeId: string, orderId: string | null) => void;
  onCreateMissingOrders: () => void;
  onCreateOrderFromNode: (nodeId: string) => void;
  routings?: any[];
  resName?: (rid: any) => string;
};

const CAT_LABEL: Record<string, string> = {
  no_routing: 'нет маршрута',
  no_order: 'нет заказа',
  self_order: 'свой заказ',
};

/**
 * Содержимое BOM-развёртки по цепочке (без оверлея и заголовка окна):
 * легенда + панель аномалий структуры + тяжёлое дерево BomTree.
 * Используется и в модалке, и в оконном режиме (WindowsLayer kind 'bom').
 */
export default function BomExpand(props: BomExpandProps) {
  const {
    order, nodes, orders, anomalies, anomaliesLoading, semiPolicy,
    timeline, timelineLoading, onLoadTimeline,
    onNodeOrderChange, onCreateMissingOrders, onCreateOrderFromNode,
    routings, resName,
  } = props;

  const [treeMode, setTreeMode] = useState<'bom' | 'both' | 'routes'>('both');

  const visible = !anomalies ? [] : (semiPolicy === 'strict'
    ? [...anomalies.no_routing, ...anomalies.no_order, ...anomalies.self_order]
    : [...anomalies.no_routing, ...anomalies.no_order]);
  const canCreate = visible.filter((a: any) => a.category !== 'no_routing');
  const anomalyIds = !anomalies ? undefined : new Set(visible.map((a: any) => a.node_id));

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10, fontSize: 11, color: '#8FA3BD', padding: '8px 12px', background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.18)', borderRadius: 8 }}>
        <span>🔗 Колонка «Заказ» — какой заказ производит этот узел (связывает куст заказов).</span>
        <span style={{ opacity: .85 }}>⛓ Цветные узлы с бейджем заказа — BOM подчинённых заказов цепочки.</span>
        <span style={{ opacity: .85 }}>Переключатель «Только свой BOM / Вся цепочка» — сверху.</span>
      </div>

      <div style={{ display: 'inline-flex', background: '#0B1B33', border: '1px solid #1E3A5F', borderRadius: 8, padding: 2, marginBottom: 10 }}>
        {([['bom', 'BOM'], ['both', 'BOM + Маршруты'], ['routes', 'Маршруты']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTreeMode(v)} style={{ border: 0, background: treeMode === v ? '#3B82F6' : 'transparent', color: treeMode === v ? '#fff' : '#8FA3BD', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</button>
        ))}
      </div>

      {(() => {
        if (anomaliesLoading) {
          return <div style={{ fontSize: 12, color: '#5A7090', padding: '8px 12px', marginBottom: 10 }}>Проверка структуры…</div>;
        }
        if (!anomalies || !visible.length) return null;
        return (
          <div style={{ marginBottom: 10, padding: '10px 12px', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#FCA5A5' }}>⚠ Аномалии структуры: {visible.length}</span>
              <span style={{ fontSize: 11, color: '#8FA3BD' }}>полуфабрикаты без маршрута или без подчинённого заказа</span>
              <div style={{ flex: 1 }} />
              {canCreate.length > 0 && (
                <button
                  onClick={onCreateMissingOrders}
                  style={{ background: '#3B82F6', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Создать заказы ({canCreate.length})
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gap: 4, maxHeight: 150, overflow: 'auto' }}>
              {visible.slice(0, 15).map((a: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(4,10,20,.4)', borderRadius: 5 }}>
                  <span style={{ color: '#FCA5A5', fontWeight: 600, flex: '0 0 86px' }}>{CAT_LABEL[a.category] || a.category}</span>
                  <span style={{ color: '#E8EEF5', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.path || a.name}>
                    {a.name}
                  </span>
                  {a.category !== 'no_routing' && (
                    <button
                      onClick={() => onCreateOrderFromNode(a.node_id)}
                      style={{ background: 'transparent', border: '1px solid rgba(59,130,246,.4)', color: '#60A5FA', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                    >
                      Создать заказ
                    </button>
                  )}
                </div>
              ))}
              {visible.length > 15 && <div style={{ fontSize: 11, color: '#5A7090', padding: '2px 8px' }}>…и ещё {visible.length - 15}</div>}
            </div>
          </div>
        );
      })()}

      <BomTree
        nodes={nodes}
        orderName={order.specification_name}
        timeline={timeline}
        timelineLoading={timelineLoading}
        onLoadTimeline={onLoadTimeline}
        editable
        orders={orders}
        onNodeOrderChange={onNodeOrderChange}
        chainControl
        currentOrderId={order.id}
        anomalyIds={anomalyIds}
        routings={routings}
        showOps={treeMode !== 'bom'}
        showMaterials={treeMode !== 'routes'}
        resName={resName}
      />
    </div>
  );
}
