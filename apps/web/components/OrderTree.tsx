'use client';

import React, { Fragment, useMemo, useState } from 'react';

/**
 * OrderTree — переиспользуемое дерево заказов по parent_order_id.
 * Отображает заказы иерархически: подчинённые — под родителями, с отступом,
 * сворачиванием и защитой от циклов (страховка, импорт уже валидирует).
 */
export interface OrderTreeItem {
  id: string;
  parent_order_id?: string | null;
}

export interface OrderRowCtx {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  toggle: () => void;
}

interface OrderTreeProps<T extends OrderTreeItem> {
  orders: T[];
  renderRow: (o: T, ctx: OrderRowCtx) => React.ReactNode;
}

export default function OrderTree<T extends OrderTreeItem>({ orders, renderRow }: OrderTreeProps<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { roots, childrenMap } = useMemo(() => {
    const childrenMap = new Map<string, T[]>();
    const roots: T[] = [];
    const ids = new Set(orders.map((o) => o.id));
    for (const o of orders) {
      const pid = o.parent_order_id;
      if (pid && ids.has(pid)) {
        const arr = childrenMap.get(pid) || [];
        arr.push(o);
        childrenMap.set(pid, arr);
      } else {
        roots.push(o);
      }
    }
    return { roots, childrenMap };
  }, [orders]);

  const renderNode = (o: T, depth: number, visited: Set<string>): React.ReactNode => {
    if (visited.has(o.id)) return null; // защита от циклов
    const nextVisited = new Set(visited);
    nextVisited.add(o.id);
    const kids = childrenMap.get(o.id) || [];
    const hasChildren = kids.length > 0;
    const expanded = hasChildren && !collapsed.has(o.id);
    const toggle = () =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(o.id)) next.delete(o.id);
        else next.add(o.id);
        return next;
      });
    return (
      <Fragment key={o.id}>
        {renderRow(o, { depth, hasChildren, expanded, toggle })}
        {expanded && kids.map((k) => renderNode(k, depth + 1, nextVisited))}
      </Fragment>
    );
  };

  return <>{roots.map((o) => renderNode(o, 0, new Set()))}</>;
}

/** Стрелка-шеврон для строки дерева */
export function TreeChevron({ expanded, onClick, size = 10 }: { expanded: boolean; onClick: (e: React.MouseEvent) => void; size?: number }) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        width: size + 6, height: size + 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#5A7090', cursor: 'pointer', flex: '0 0 auto', userSelect: 'none',
      }}
      title={expanded ? 'Свернуть' : 'Развернуть'}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
        style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s' }}>
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
