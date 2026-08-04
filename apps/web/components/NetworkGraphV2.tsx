/**
 * NetworkGraphV2 — сетевой график с фактическим выполнением.
 * 4 состояния узлов, янтарный двойной путь, автозакрытие, Baseline-наложение.
 */
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MergedCPMResult, ResourceLevelResult, ActualFact } from '@/lib/types';
import OperationPanel from './OperationPanel';
import AutoCloseModal from './AutoCloseModal';
import { getActual, autoClosePredecessors, uncloseChain } from '@/lib/api';

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
  status: 'not_started' | 'in_progress' | 'completed' | 'delayed' | 'cancelled';
  source?: string;
  factStart?: string;
  factEnd?: string;
}

interface EdgeLine {
  from: string;
  to: string;
  type: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const PROJECT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
const NODE_R = 24;
const PX_PER_HOUR = 8;
const RESOURCE_ROW_H = 80;
const LEFT_MARGIN = 160;

const STATUS_STYLES: Record<string, { color: string; stroke: string; lw: number; dash?: number[]; inner: boolean; double: boolean }> = {
  not_started: { color: 'rgba(140,160,190,0.3)', stroke: '#5A7090', lw: 1.5, inner: false, double: false },
  in_progress:  { color: 'rgba(59,130,246,0.3)', stroke: '#3B82F6', lw: 2, dash: [3, 2], inner: false, double: false },
  completed:    { color: 'rgba(16,185,129,0.35)', stroke: '#F59E0B', lw: 2, inner: true, double: true },
  delayed:      { color: 'rgba(239,68,68,0.25)', stroke: '#EF4444', lw: 2, inner: false, double: false },
  cancelled:    { color: 'rgba(239,68,68,0.15)', stroke: '#EF4444', lw: 1.5, dash: [4, 3], inner: false, double: false },
};

interface Props {
  cpmResult: MergedCPMResult | null;
  levelResult: ResourceLevelResult | null;
  baselineNodes?: NodePos[] | null;
  showBaseline?: boolean;
}

export default function NetworkGraphV2({ cpmResult, levelResult, baselineNodes, showBaseline }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(0.85);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<NodePos | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<NodePos | null>(null);
  const [actualsMap, setActualsMap] = useState<Record<string, ActualFact>>({});
  const [autoClosePredecessorsList, setAutoClosePredecessorsList] = useState<NodePos[]>([]);

  const nodes = useRef<NodePos[]>([]);
  const edges = useRef<EdgeLine[]>([]);
  const resources = useRef<string[]>([]);

  // Load actuals
  useEffect(() => {
    if (!cpmResult) return;
    const ids = cpmResult.nodes.map(n => n.id);
    Promise.all(ids.map(id => getActual(id).catch(() => null)))
      .then(results => {
        const map: Record<string, ActualFact> = {};
        results.forEach((r, i) => { if (r) map[ids[i]] = r; });
        setActualsMap(map);
      });
  }, [cpmResult]);

  // Build graph
  useEffect(() => {
    if (!cpmResult) return;
    const cpmNodes = cpmResult.nodes;
    const projectCount = new Set(cpmNodes.map(n => n.id.slice(0, 2))).size || 2;
    const resSet = new Set<string>();
    if (levelResult) {
      levelResult.operations.forEach(op => { if (op.resource_name) resSet.add(op.resource_name); });
    }
    const resList = Array.from(resSet);
    resources.current = resList.length > 0 ? resList : ['Ресурсы'];

    const resIndex = new Map<string, number>();
    const nodeList: NodePos[] = [];
    const nodeResMap = new Map<string, string>();
    if (levelResult) {
      levelResult.operations.forEach(op => { if (op.resource_name) nodeResMap.set(op.operation_id, op.resource_name); });
    }
    const defaultRes = resList[0] || '';

    cpmNodes.forEach((n, i) => {
      const res = nodeResMap.get(n.id) || defaultRes;
      if (!resIndex.has(res)) resIndex.set(res, resIndex.size);
      const ae = actualsMap[n.id];
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
        status: (ae?.status as NodePos['status']) || 'not_started',
        source: ae?.source,
        factStart: ae?.fact_start,
        factEnd: ae?.fact_end,
      });
    });
    nodes.current = nodeList;

    const edgeList: EdgeLine[] = [];
    const sorted = [...nodeList].sort((a, b) => a.earlyStart - b.earlyStart);
    for (let i = 1; i < sorted.length; i++) {
      edgeList.push({
        from: sorted[i - 1].id, to: sorted[i].id,
        type: sorted[i - 1].projectIndex !== sorted[i].projectIndex ? 'inter_project' : 'tech',
        fromX: sorted[i - 1].x + NODE_R, fromY: sorted[i - 1].y,
        toX: sorted[i].x - NODE_R, toY: sorted[i].y,
      });
    }
    edges.current = edgeList;
  }, [cpmResult, levelResult, actualsMap]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.current.length === 0) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;

    const maxX = Math.max(...nodes.current.map(n => n.x + NODE_R * 2), 600);
    const maxY = Math.max(...nodes.current.map(n => n.y + NODE_R * 2), 400);
    const fullW = Math.max(1000, (maxX + 100) * scale);
    const fullH = Math.max(600, (maxY + 80) * scale);

    canvas.width = fullW; canvas.height = fullH;
    canvas.style.width = `${fullW}px`; canvas.style.height = `${fullH}px`;

    ctx.clearRect(0, 0, fullW, fullH);
    ctx.fillStyle = '#0A1628'; ctx.fillRect(0, 0, fullW, fullH);
    ctx.save();
    ctx.translate(offset.x, offset.y); ctx.scale(scale, scale);

    // Resource tracks
    resources.current.forEach((res, ri) => {
      const y = 60 + ri * RESOURCE_ROW_H - 10;
      ctx.fillStyle = 'rgba(30,50,82,0.3)';
      ctx.fillRect(0, y, maxX + 100, RESOURCE_ROW_H - 4);
      ctx.fillStyle = '#5A7090'; ctx.font = '10px IBM Plex Mono';
      ctx.textAlign = 'right'; ctx.fillText(res, LEFT_MARGIN - 10, y + 16);
    });

    // Time grid
    const maxTime = Math.max(...nodes.current.map(n => n.earlyFinish), 1);
    const gridStep = maxTime > 500 ? 100 : maxTime > 200 ? 50 : 24;
    for (let t = 0; t <= maxTime; t += gridStep) {
      const x = LEFT_MARGIN + t * PX_PER_HOUR;
      ctx.strokeStyle = 'rgba(60,90,130,0.12)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, maxY); ctx.stroke();
      ctx.fillStyle = '#5A7090'; ctx.font = '9px IBM Plex Mono'; ctx.textAlign = 'center';
      ctx.fillText(`${t}ч`, x, 18);
    }

    // Baseline overlay
    if (showBaseline && baselineNodes) {
      baselineNodes.forEach(bn => {
        const cn = nodes.current.find(n => n.id === bn.id);
        if (!cn || cn.status === 'completed') return;
        const bx = LEFT_MARGIN + bn.earlyStart * PX_PER_HOUR;
        const by = cn.y;
        ctx.strokeStyle = '#5A7090'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(bx, by, NODE_R + 2, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Edges
    edges.current.forEach(e => {
      const fn = nodes.current.find(n => n.id === e.from);
      const tn = nodes.current.find(n => n.id === e.to);
      if (!fn || !tn) return;
      const bothDone = fn.status === 'completed' && tn.status === 'completed';

      if (bothDone) {
        const dx = tn.x - fn.x, dy = tn.y - fn.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = len > 0 ? -dy / len : 0, ny = len > 0 ? dx / len : 0;
        ctx.strokeStyle = 'rgba(245,158,11,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fn.x + NODE_R + nx * 3, fn.y - ny * 3);
        ctx.lineTo(tn.x - NODE_R + nx * 3, tn.y - ny * 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(fn.x + NODE_R - nx * 3, fn.y + ny * 3);
        ctx.lineTo(tn.x - NODE_R - nx * 3, tn.y + ny * 3);
        ctx.stroke();
      } else {
        ctx.strokeStyle = fn.status === 'completed' ? 'rgba(245,158,11,0.35)' : 'rgba(60,90,130,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(fn.x + NODE_R, fn.y); ctx.lineTo(tn.x - NODE_R, tn.y);
        ctx.stroke();
      }
    });

    // Nodes
    nodes.current.forEach((n, idx) => {
      const st = STATUS_STYLES[n.status] || STATUS_STYLES.not_started;
      const color = PROJECT_COLORS[n.projectIndex % PROJECT_COLORS.length];

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(n.x + 2, n.y + 2, NODE_R, 0, Math.PI * 2); ctx.fill();

      // Circle
      ctx.beginPath(); ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = st.color; ctx.globalAlpha = st.inner ? 1 : 0.3; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = st.stroke; ctx.lineWidth = st.lw;
      if (st.dash) ctx.setLineDash(st.dash); else ctx.setLineDash([]);
      ctx.stroke(); ctx.setLineDash([]);

      // Double outline
      if (st.double) {
        ctx.strokeStyle = '#B45309'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, NODE_R + 4, 0, Math.PI * 2); ctx.stroke();
      }

      // Inner dot
      if (st.inner) {
        ctx.fillStyle = '#10B981';
        ctx.beginPath(); ctx.arc(n.x, n.y, 8, 0, Math.PI * 2); ctx.fill();
      }

      // Critical marker
      if (n.isCritical && n.status !== 'completed') {
        ctx.strokeStyle = '#EF4444'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(n.x, n.y, NODE_R + 3, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Number
      ctx.fillStyle = '#E8EEF5'; ctx.font = 'bold 11px IBM Plex Mono'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${idx + 1}`, n.x, n.y);

      // Label
      ctx.font = '9px Inter, sans-serif'; ctx.fillStyle = '#8FA3BD'; ctx.textAlign = 'center';
      ctx.fillText(n.name.length > 16 ? n.name.slice(0, 14) + '…' : n.name, n.x, n.y + NODE_R + 12);

      // Duration bar
      const barW = Math.max(n.duration * PX_PER_HOUR, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(n.x - barW / 2, n.y + NODE_R + 15, barW, 3);
    });

    ctx.restore();

    // Hover tooltip
    if (hoveredNode) {
      const tx = 16, ty = canvas.height - 130;
      ctx.fillStyle = '#162844'; ctx.strokeStyle = '#1E3252'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx, ty, 250, 110, 8); ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#E8EEF5'; ctx.textAlign = 'left'; ctx.font = 'bold 12px Inter';
      ctx.fillText(hoveredNode.name, tx + 12, ty + 22);

      const statusLabels: Record<string, string> = { not_started: 'Не начато', in_progress: 'В процессе', completed: 'Завершено', delayed: 'Задержано', cancelled: 'Отменено' };
      const lines = [
        `Статус: ${statusLabels[hoveredNode.status]}`,
        `План: ${hoveredNode.earlyStart}ч – ${hoveredNode.earlyFinish}ч (${hoveredNode.duration}ч)`,
        hoveredNode.isCritical ? 'Критический путь' : 'Некритический',
        hoveredNode.source === 'auto_closed' ? 'Закрыто автоматически' : '',
      ];
      ctx.fillStyle = '#8FA3BD'; ctx.font = '10px IBM Plex Mono';
      lines.forEach((l, i) => { if (l) ctx.fillText(l, tx + 12, ty + 42 + i * 16); });
      ctx.fillStyle = '#60A5FA'; ctx.font = '9px Inter';
      ctx.fillText('Двойной клик — редактировать | Правый клик — действия', tx + 12, ty + 90);
    }
  }, [cpmResult, levelResult, scale, offset, hoveredNode, mousePos, actualsMap, showBaseline, baselineNodes]);

  // Handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(s => Math.max(0.3, Math.min(2.5, s * (e.deltaY < 0 ? 1.08 : 0.92))));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
    setMousePos({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    const mx = (e.nativeEvent.offsetX - offset.x) / scale;
    const my = (e.nativeEvent.offsetY - offset.y) / scale;
    setHoveredNode(nodes.current.find(n => Math.hypot(n.x - mx, n.y - my) < NODE_R + 4) || null);
  }, [dragging, dragStart, offset, scale]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleDoubleClick = useCallback(async (e: React.MouseEvent) => {
    const mx = (e.nativeEvent.offsetX - offset.x) / scale;
    const my = (e.nativeEvent.offsetY - offset.y) / scale;
    const hit = nodes.current.find(n => Math.hypot(n.x - mx, n.y - my) < NODE_R + 4);
    if (!hit) return;

    // If completing and has unclosed predecessors
    if (hit.status !== 'completed') {
      const idx = nodes.current.findIndex(n => n.id === hit.id);
      const preds = nodes.current.slice(0, idx).filter(n => n.status !== 'completed');
      if (preds.length > 0) {
        setAutoClosePredecessorsList(preds.map((n, i) => ({ ...n, index: nodes.current.findIndex(x => x.id === n.id) + 1 })));
        setSelectedNode(hit);
        return;
      }
    }
    setSelectedNode(hit);
  }, [offset, scale]);

  const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    const mx = (e.nativeEvent.offsetX - offset.x) / scale;
    const my = (e.nativeEvent.offsetY - offset.y) / scale;
    const hit = nodes.current.find(n => Math.hypot(n.x - mx, n.y - my) < NODE_R + 4);
    if (!hit || hit.status !== 'completed' || hit.source !== 'auto_closed') return;

    if (window.confirm(`Отменить закрытие операций до «${hit.name}» (включительно)? Будут сняты только автоматически закрытые операции.`)) {
      await uncloseChain(hit.id);
      // Reload actuals
      const ids = cpmResult?.nodes.map(n => n.id) || [];
      const results = await Promise.all(ids.map(id => getActual(id).catch(() => null)));
      const map: Record<string, ActualFact> = {};
      results.forEach((r, i) => { if (r) map[ids[i]] = r; });
      setActualsMap(map);
    }
  }, [offset, scale, cpmResult]);

  const resetView = useCallback(() => {
    setScale(0.85); setOffset({ x: 0, y: 0 });
  }, []);

  const handleSaveNode = useCallback(async (updated: NodePos) => {
    setSelectedNode(null);
    const ids = cpmResult?.nodes.map(n => n.id) || [];
    const results = await Promise.all(ids.map(id => getActual(id).catch(() => null)));
    const map: Record<string, ActualFact> = {};
    results.forEach((r, i) => { if (r) map[ids[i]] = r; });
    setActualsMap(map);
  }, [cpmResult]);

  const handleAutoClose = useCallback(async () => {
    if (!selectedNode) return;
    await autoClosePredecessors(selectedNode.id);
    setAutoClosePredecessorsList([]);
    const ids = cpmResult?.nodes.map(n => n.id) || [];
    const results = await Promise.all(ids.map(id => getActual(id).catch(() => null)));
    const map: Record<string, ActualFact> = {};
    results.forEach((r, i) => { if (r) map[ids[i]] = r; });
    setActualsMap(map);
  }, [selectedNode, cpmResult]);

  const handleManualOnly = useCallback(() => {
    setAutoClosePredecessorsList([]);
  }, []);

  if (!cpmResult) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)', fontSize: 14 }}>
        Выполните объединение проектов для построения сводного сетевого графика
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, display: 'flex', gap: 8 }}>
          <button onClick={resetView} style={{
            padding: '4px 12px', borderRadius: 6, background: 'var(--bg-3)',
            border: '1px solid var(--border)', color: 'var(--fg-2)', fontSize: 11, cursor: 'pointer',
          }}>Сброс</button>
          <span style={{
            padding: '4px 10px', borderRadius: 6, background: 'var(--bg-3)',
            border: '1px solid var(--border)', color: 'var(--fg-4)', fontSize: 10,
            fontFamily: 'IBM Plex Mono',
          }}>{Math.round(scale * 100)}%</span>
        </div>
        <canvas ref={canvasRef}
          onWheel={handleWheel} onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick} onContextMenu={handleContextMenu}
          style={{ cursor: dragging ? 'grabbing' : 'grab', display: 'block' }}
        />
      </div>

      {selectedNode && !autoClosePredecessorsList.length && (
        <OperationPanel
          node={selectedNode}
          onSave={handleSaveNode}
          onClose={() => setSelectedNode(null)}
          onStatusChange={async (nodeId, newStatus) => {
            if (newStatus === 'completed' && selectedNode) {
              const idx = nodes.current.findIndex(n => n.id === selectedNode.id);
              const preds = nodes.current.slice(0, idx).filter(n => n.status !== 'completed');
              if (preds.length > 0) {
                setAutoClosePredecessorsList(preds.map((n, i) => ({ ...n, index: nodes.current.findIndex(x => x.id === n.id) + 1 })));
                return;
              }
            }
          }}
        />
      )}

      {autoClosePredecessorsList.length > 0 && selectedNode && (
        <AutoCloseModal
          targetOp={selectedNode}
          predecessors={autoClosePredecessorsList}
          onAutoClose={handleAutoClose}
          onManualOnly={handleManualOnly}
          onCancel={() => setAutoClosePredecessorsList([])}
        />
      )}
    </div>
  );
}
