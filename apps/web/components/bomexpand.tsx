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
  timelineDraft?: boolean;
  timelineLoading?: boolean;
  onLoadTimeline?: () => void;
  onNodeOrderChange: (nodeId: string, orderId: string | null) => void;
  onNodeQuantityChange?: (nodeId: string, value: number) => void;
  onNodeRemove?: (nodeId: string) => void;
  onNodeAdd?: (parentId: string, nodeType: 'material' | 'semi_finished') => void;
  onOrderFocus?: (orderId: string) => void;
  onRoutingAdd?: (routingId: string) => void;
  onCreateMissingOrders: () => void;
  onCreateOrderFromNode: (nodeId: string) => void;
  routings?: any[];
  resName?: (rid: any) => string;
  scope?: 'own' | 'chain';
  onScopeChange?: (s: 'own' | 'chain') => void;
  layerMode?: boolean;
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
    timeline, timelineDraft, timelineLoading, onLoadTimeline,
    onNodeOrderChange, onNodeQuantityChange, onNodeRemove, onNodeAdd, onOrderFocus, onRoutingAdd,
    onCreateMissingOrders, onCreateOrderFromNode,
    routings, resName, scope = 'own', onScopeChange, layerMode = false,
  } = props;

  const [treeMode, setTreeMode] = useState<'bom' | 'both' | 'routes'>('both');
  const [editing, setEditing] = useState(false);

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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'inline-flex', background: '#0B1B33', border: '1px solid #1E3A5F', borderRadius: 8, padding: 2 }}>
          {([['bom', 'Состав'], ['both', 'Состав + Маршруты'], ['routes', 'Маршруты']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTreeMode(v)} style={{ border: 0, background: treeMode === v ? '#3B82F6' : 'transparent', color: treeMode === v ? '#fff' : '#8FA3BD', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</button>
          ))}
        </div>
        <button
          onClick={() => setEditing(!editing)}
          title="Включить/выключить редактирование структуры (добавление, удаление, смена заказа)"
          style={{
            border: '1px solid ' + (editing ? 'rgba(245,158,11,.5)' : '#1E3A5F'),
            background: editing ? 'rgba(245,158,11,.12)' : '#0B1B33',
            color: editing ? '#FCD34D' : '#8FA3BD',
            borderRadius: 8, padding: '4px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
          }}
        >
          {editing ? '✓ Редактирование включено' : '✏️ Редактирование'}
        </button>
        <span style={{ fontSize: 11, color: '#5A7090' }}>{editing ? 'Кнопки ＋ ⇥ ✕ и смена заказа доступны' : 'Структура только для просмотра'}</span>
        {onScopeChange && (
          <div style={{ display: 'inline-flex', background: '#0B1B33', border: '1px solid #1E3A5F', borderRadius: 8, padding: 2, marginLeft: 'auto' }}>
            {([['own', 'Только свой BOM'], ['chain', 'Вся цепочка']] as const).map(([v, label]) => (
              <button key={v} onClick={() => onScopeChange(v)} style={{ border: 0, background: scope === v ? '#7C3AED' : 'transparent', color: scope === v ? '#fff' : '#8FA3BD', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</button>
            ))}
          </div>
        )}
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
        editable={editing}
        timeline={timeline}
        timelineDraft={timelineDraft}
        timelineLoading={timelineLoading}
        onLoadTimeline={onLoadTimeline}
        orders={orders}
        onNodeOrderChange={onNodeOrderChange}
        onNodeQuantityChange={onNodeQuantityChange}
        onNodeRemove={onNodeRemove}
        onNodeAdd={onNodeAdd}
        onOrderFocus={onOrderFocus}
        onRoutingAdd={onRoutingAdd}
        chainControl
        layerMode={layerMode}
        childExpandable={!layerMode}
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
