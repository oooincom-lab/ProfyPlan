/**
 * Multi-Project Gantt Chart — интерактивная диаграмма Ганта
 * с группировкой по проектам и ресурсными треками.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { mergeProjects } from '@/lib/api';

interface GanttOperation {
  id: string;
  name: string;
  projectName: string;
  projectId: string;
  resource?: string;
  earlyStart: number;
  earlyFinish: number;
  duration: number;
  isCritical: boolean;
  totalFloat: number;
  color?: string;
}

interface ProjectGroup {
  id: string;
  name: string;
  color: string;
  operations: GanttOperation[];
}

const PROJECT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
];

const PX_PER_HOUR = 10;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 52;
const GROUP_HEADER_HEIGHT = 30;
const LEFT_PANEL_WIDTH = 260;

export default function GanttChart({ projectIds, projectNames }: { projectIds: string[]; projectNames?: Record<string, string>; }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalDuration, setTotalDuration] = useState(0);

  const loadData = async () => {
    if (projectIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const merged = await mergeProjects(projectIds);
      const nodes: any[] = merged.nodes || [];
      const colorByPid: Record<string, string> = {};
      const nameOf = (pid: string) => {
        const nm = projectNames && projectNames[pid];
        if (nm) return nm;
        const idx = projectIds.indexOf(pid);
        return idx >= 0 ? `Проект ${idx + 1}` : pid.slice(0, 8);
      };
      projectIds.forEach((pid, i) => { colorByPid[pid] = PROJECT_COLORS[i % PROJECT_COLORS.length]; });

      // Реальная привязка операций к проектам (project_id из /ccm/merge); запасной вариант — по индексу.
      const ops: GanttOperation[] = nodes.map((n: any, i: number) => {
        const pid = String(n.project_id || projectIds[i % projectIds.length]);
        return {
          id: n.id,
          name: n.name,
          projectName: nameOf(pid),
          projectId: pid,
          earlyStart: n.early_start || 0,
          earlyFinish: n.early_finish || 0,
          duration: n.duration || (n.early_finish || 0) - (n.early_start || 0),
          isCritical: n.is_critical || false,
          totalFloat: n.total_float || 0,
          color: colorByPid[pid] || '#8B5CF6',
        };
      });

      // Группировка по проектам
      const grouped = new Map<string, ProjectGroup>();
      for (const pid of projectIds) {
        grouped.set(pid, {
          id: pid,
          name: nameOf(pid),
          color: colorByPid[pid] || '#666',
          operations: ops.filter((o) => o.projectId === pid),
        });
      }

      const groupsArr = Array.from(grouped.values());
      setGroups(groupsArr);

      const maxEF = ops.reduce((max, o) => Math.max(max, o.earlyFinish), 0);
      setTotalDuration(maxEF);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [projectIds]);

  // Compute total height
  let totalRows = 0;
  for (const g of groups) {
    totalRows += 1 + g.operations.length; // group header + operations
  }

  const canvasW = Math.max(1200, totalDuration * PX_PER_HOUR + LEFT_PANEL_WIDTH + 60);
  const canvasH = HEADER_HEIGHT + totalRows * ROW_HEIGHT + 40;

  // Draw Gantt on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || groups.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvasW;
    canvas.height = canvasH;

    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0A1628';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Grid
    const gridStep = totalDuration > 200 ? 24 : totalDuration > 100 ? 12 : 4;
    ctx.strokeStyle = 'rgba(30, 50, 82, 0.5)';
    ctx.lineWidth = 0.5;
    for (let t = 0; t <= totalDuration; t += gridStep) {
      const x = LEFT_PANEL_WIDTH + t * PX_PER_HOUR;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, canvasH);
      ctx.stroke();
    }

    // Time labels
    ctx.fillStyle = '#B0C4DE';
    ctx.font = '10px IBM Plex Mono, monospace';
    ctx.textAlign = 'center';
    for (let t = 0; t <= totalDuration; t += gridStep) {
      const x = LEFT_PANEL_WIDTH + t * PX_PER_HOUR;
      ctx.fillText(`${t}ч`, x, HEADER_HEIGHT - 12);
    }

    // (псевдо-«линия сегодня» из старого прототипа убрана: ось топологическая — часы от старта, календарь здесь не отображается)

    // Draw bars
    let y = HEADER_HEIGHT;
    const BAR_H = 22;
    const BAR_Y_OFF = ROW_HEIGHT / 2 - BAR_H / 2;

    for (const group of groups) {
      // Group header
      ctx.fillStyle = group.color;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(0, y, canvasW, GROUP_HEADER_HEIGHT);
      ctx.globalAlpha = 1;

      ctx.fillStyle = group.color;
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(group.name, 14, y + GROUP_HEADER_HEIGHT - 10);

      y += GROUP_HEADER_HEIGHT;

      // Operations
      for (const op of group.operations) {
        const barX = LEFT_PANEL_WIDTH + op.earlyStart * PX_PER_HOUR;
        const barW = Math.max(op.duration * PX_PER_HOUR, 4);

        // Background row
        ctx.fillStyle = '#0F1E36';
        ctx.fillRect(0, y, LEFT_PANEL_WIDTH, ROW_HEIGHT);

        // Bar
        ctx.fillStyle = op.color || group.color;
        ctx.globalAlpha = 0.65;
        const radius = 4;
        ctx.beginPath();
        ctx.moveTo(barX + radius, y + BAR_Y_OFF);
        ctx.lineTo(barX + barW - radius, y + BAR_Y_OFF);
        ctx.arcTo(barX + barW, y + BAR_Y_OFF, barX + barW, y + BAR_Y_OFF + radius, radius);
        ctx.lineTo(barX + barW, y + BAR_Y_OFF + BAR_H - radius);
        ctx.arcTo(barX + barW, y + BAR_Y_OFF + BAR_H, barX + barW - radius, y + BAR_Y_OFF + BAR_H, radius);
        ctx.lineTo(barX + radius, y + BAR_Y_OFF + BAR_H);
        ctx.arcTo(barX, y + BAR_Y_OFF + BAR_H, barX, y + BAR_Y_OFF + BAR_H - radius, radius);
        ctx.lineTo(barX, y + BAR_Y_OFF + radius);
        ctx.arcTo(barX, y + BAR_Y_OFF, barX + radius, y + BAR_Y_OFF, radius);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Critical path border
        if (op.isCritical) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(barX + radius, y + BAR_Y_OFF);
          ctx.lineTo(barX + barW - radius, y + BAR_Y_OFF);
          ctx.arcTo(barX + barW, y + BAR_Y_OFF, barX + barW, y + BAR_Y_OFF + radius, radius);
          ctx.lineTo(barX + barW, y + BAR_Y_OFF + BAR_H - radius);
          ctx.arcTo(barX + barW, y + BAR_Y_OFF + BAR_H, barX + barW - radius, y + BAR_Y_OFF + BAR_H, radius);
          ctx.lineTo(barX + radius, y + BAR_Y_OFF + BAR_H);
          ctx.arcTo(barX, y + BAR_Y_OFF + BAR_H, barX, y + BAR_Y_OFF + BAR_H - radius, radius);
          ctx.lineTo(barX, y + BAR_Y_OFF + radius);
          ctx.arcTo(barX, y + BAR_Y_OFF, barX + radius, y + BAR_Y_OFF, radius);
          ctx.stroke();
        }

        // Bar label
        ctx.fillStyle = '#E8EEF5';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'left';
        const label = op.name.length > 25 ? op.name.slice(0, 23) + '…' : op.name;
        ctx.fillText(label, barX + 6, y + BAR_Y_OFF + BAR_H - 6);

        // Left panel: operation name
        ctx.fillStyle = '#8FA3BD';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(op.name.length > 30 ? op.name.slice(0, 28) + '…' : op.name, 10, y + ROW_HEIGHT / 2 + 4);

        // Float indicator
        if (op.totalFloat > 0) {
          const floatX = barX + barW;
          const floatW = op.totalFloat * PX_PER_HOUR;
          ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
          ctx.fillRect(floatX, y + BAR_Y_OFF, Math.min(floatW, 40), BAR_H);
        }

        y += ROW_HEIGHT;
      }
    }
  }, [groups, totalDuration, canvasW, canvasH]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10, 22, 40, 0.85)', zIndex: 10,
        }}>
          <span style={{ color: '#60A5FA', fontSize: 14 }}>Загрузка данных и расчёт CPM...</span>
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8, padding: '8px 16px', color: '#EF4444', fontSize: 13, zIndex: 10,
        }}>
          {error}
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={{ display: 'block' }}
      />
    </div>
  );
}
