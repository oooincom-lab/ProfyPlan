/**
 * Multi-Project Network Graph — интерактивный сводный сетевой график CCM.
 * Canvas-рендеринг: цветовое кодирование по проектам, ресурсные треки,
 * технологические и ресурсные связи.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { MergedCPMResult, ResourceLevelResult } from '@/lib/types';

interface NodePos {
  id: string;
  x: number;
  y: number;
  name: string;
  projectIndex: number;
  earlyStart: number;
  earlyFinish: number;
  isCritical: boolean;
  totalFloat: number;
  duration: number;
  resource?: string;
}

interface EdgeLine {
  from: string;
  to: string;
  type: 'tech' | 'inter_project' | 'resource';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const PROJECT_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
];
const NODE_R = 24;
const PX_PER_HOUR = 8;
const RESOURCE_ROW_H = 80;
const LEFT_MARGIN = 160;

interface Props {
  cpmResult: MergedCPMResult | null;
  levelResult: ResourceLevelResult | null;
}

export default function NetworkGraph({ cpmResult, levelResult }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(0.85);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<NodePos | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const nodes = useRef<NodePos[]>([]);
  const edges = useRef<EdgeLine[]>([]);
  const resources = useRef<string[]>([]);

  // Build graph data
  useEffect(() => {
    if (!cpmResult) return;

    const cpmNodes = cpmResult.nodes;
    const projectCount = new Set(
      cpmNodes.map((n) => n.id.slice(0, 2))
    ).size || 2;

    // Collect resources
    const resSet = new Set<string>();
    if (levelResult) {
      levelResult.operations.forEach((op) => {
        if (op.resource_name) resSet.add(op.resource_name);
      });
    }
    const resList = Array.from(resSet);
    resources.current = resList.length > 0 ? resList : ['Ресурсы'];

    // Position nodes: X by early_start, Y by resource
    const resIndex = new Map<string, number>();
    const nodeList: NodePos[] = [];
    const nodeResMap = new Map<string, string>();

    // Assign resources to nodes from leveling result
    if (levelResult) {
      levelResult.operations.forEach((op) => {
        if (op.resource_name) {
          nodeResMap.set(op.operation_id, op.resource_name);
        }
      });
    }

    // Default resource assignment
    const defaultRes = resList[0] || '';

    cpmNodes.forEach((n, i) => {
      const res = nodeResMap.get(n.id) || defaultRes;
      if (!resIndex.has(res)) resIndex.set(res, resIndex.size);

      nodeList.push({
        id: n.id,
        x: LEFT_MARGIN + n.early_start * PX_PER_HOUR,
        y: 60 + (resIndex.get(res) || i % resList.length) * RESOURCE_ROW_H,
        name: n.name,
        projectIndex: i % projectCount,
        earlyStart: n.early_start,
        earlyFinish: n.early_finish,
        isCritical: n.is_critical,
        totalFloat: n.total_float,
        duration: n.duration,
        resource: res,
      });
    });

    nodes.current = nodeList;

    // Build edges (simplified — transitions between nodes in time order)
    const edgeList: EdgeLine[] = [];
    const sorted = [...nodeList].sort((a, b) => a.earlyStart - b.earlyStart);
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i];
      edgeList.push({
        from: prev.id,
        to: curr.id,
        type: prev.projectIndex !== curr.projectIndex ? 'inter_project' : 'tech',
        fromX: prev.x + NODE_R,
        fromY: prev.y,
        toX: curr.x - NODE_R,
        toY: curr.y,
      });
      prev = curr;
    }

    edges.current = edgeList;
  }, [cpmResult, levelResult]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.current.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.parentElement?.clientWidth || 1200;
    const maxX = Math.max(
      ...nodes.current.map((n) => n.x + NODE_R * 2),
      ...edges.current.map((e) => Math.max(e.fromX, e.toX)),
    );
    const maxY = Math.max(
      ...nodes.current.map((n) => n.y + NODE_R * 2),
      (resources.current.length + 1) * RESOURCE_ROW_H + 100,
    );
    const fullW = Math.max(W, (maxX + 100) * scale);
    const fullH = (maxY + 80) * scale;

    canvas.width = fullW;
    canvas.height = fullH;
    canvas.style.width = `${fullW}px`;
    canvas.style.height = `${fullH}px`;

    ctx.clearRect(0, 0, fullW, fullH);

    // Background
    ctx.fillStyle = '#0A1628';
    ctx.fillRect(0, 0, fullW, fullH);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    // Resource tracks
    resources.current.forEach((res, ri) => {
      const y = 60 + ri * RESOURCE_ROW_H - 10;
      ctx.fillStyle = 'rgba(30, 50, 82, 0.3)';
      ctx.fillRect(0, y, maxX + 100, RESOURCE_ROW_H - 4);

      ctx.fillStyle = '#5A7090';
      ctx.font = '10px IBM Plex Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(res, LEFT_MARGIN - 10, y + 16);
    });

    // Time grid
    const maxTime = Math.max(...nodes.current.map((n) => n.earlyFinish));
    const gridStep = maxTime > 500 ? 100 : maxTime > 200 ? 50 : 24;
    ctx.strokeStyle = 'rgba(60, 90, 130, 0.15)';
    ctx.lineWidth = 0.5;
    for (let t = 0; t <= maxTime; t += gridStep) {
      const x = LEFT_MARGIN + t * PX_PER_HOUR;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, maxY);
      ctx.stroke();

      ctx.fillStyle = '#B0C4DE';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${t}ч`, x, 18);
    }

    // Edges
    edges.current.forEach((e) => {
      ctx.strokeStyle = e.type === 'inter_project'
        ? 'rgba(245, 158, 11, 0.3)'
        : e.type === 'resource'
          ? 'rgba(96, 165, 250, 0.15)'
          : 'rgba(96, 165, 250, 0.2)';
      ctx.lineWidth = e.type === 'resource' ? 0.5 : 1;
      ctx.setLineDash(e.type === 'inter_project' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(e.fromX, e.fromY);
      ctx.lineTo(e.toX, e.toY);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Nodes
    nodes.current.forEach((n) => {
      const color = PROJECT_COLORS[n.projectIndex % PROJECT_COLORS.length];

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(n.x + 2, n.y + 2, NODE_R, 0, Math.PI * 2);
      ctx.fill();

      // Circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = color;
      ctx.lineWidth = n.isCritical ? 2.5 : 1.5;
      ctx.stroke();

      // Critical path marker
      if (n.isCritical) {
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, NODE_R + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Number
      ctx.fillStyle = '#E8EEF5';
      ctx.font = 'bold 11px IBM Plex Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const idx = nodes.current.indexOf(n) + 1;
      ctx.fillText(`${idx}`, n.x, n.y);

      // Label
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#B0C4DE';
      ctx.fillText(
        n.name.length > 18 ? n.name.slice(0, 16) + '…' : n.name,
        n.x,
        n.y + NODE_R + 12,
      );
    });

    ctx.restore();

    // Hover tooltip
    if (hoveredNode) {
      const tipX = mousePos.x + 16;
      const tipY = mousePos.y - 20;

      ctx.fillStyle = '#162844';
      ctx.strokeStyle = '#1E3252';
      ctx.lineWidth = 1;
      const tipW = 220;
      const tipH = 110;
      ctx.beginPath();
      ctx.roundRect(tipX, tipY, tipW, tipH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#E8EEF5';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(hoveredNode.name, tipX + 12, tipY + 22);

      const lines = [
        `Старт: ${hoveredNode.earlyStart}ч`,
        `Финиш: ${hoveredNode.earlyFinish}ч`,
        `Длит.: ${hoveredNode.duration}ч`,
        `Резерв: ${hoveredNode.totalFloat}ч`,
        hoveredNode.isCritical ? '🔴 Критический путь' : '🟢 Некритический',
      ];

      ctx.fillStyle = '#8FA3BD';
      ctx.font = '10px IBM Plex Mono, monospace';
      lines.forEach((line, i) => {
        ctx.fillText(line, tipX + 12, tipY + 42 + i * 16);
      });
    }
  }, [cpmResult, levelResult, scale, offset, hoveredNode, mousePos]);

  // Mouse handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.3, Math.min(2.5, s * (e.deltaY < 0 ? 1.08 : 0.92))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
    setMousePos({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });

    // Hit-test nodes
    const mx = (e.nativeEvent.offsetX - offset.x) / scale;
    const my = (e.nativeEvent.offsetY - offset.y) / scale;
    const hit = nodes.current.find(
      (n) => Math.hypot(n.x - mx, n.y - my) < NODE_R + 4,
    );
    setHoveredNode(hit || null);
  };

  const handleMouseUp = () => setDragging(false);

  const resetView = () => {
    setScale(0.85);
    setOffset({ x: 0, y: 0 });
  };

  if (!cpmResult) {
    return (
      <div style={{
        padding: 48, textAlign: 'center', color: 'var(--fg-3)', fontSize: 14,
      }}>
        Выполните объединение проектов для построения сводного сетевого графика
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 5,
        display: 'flex', gap: 8,
      }}>
        <button onClick={resetView} style={{
          padding: '4px 12px', borderRadius: 6,
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--fg-2)', fontSize: 11, cursor: 'pointer',
        }}>
          Сброс
        </button>
        <span style={{
          padding: '4px 10px', borderRadius: 6,
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--fg-4)', fontSize: 10,
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {Math.round(scale * 100)}%
        </span>
      </div>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? 'grabbing' : 'grab', display: 'block' }}
      />
    </div>
  );
}
