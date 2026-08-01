/**
 * Resource Load Chart — загрузка ресурсов с bottleneck-индикаторами.
 */
'use client';

import { useEffect, useRef } from 'react';

interface ResourceLoadData {
  resourceName: string;
  loadPercent: number;
  utilizedHours: number;
  availableHours: number;
  queueOps: number;
  isBottleneck: boolean;
}

interface Props {
  data: ResourceLoadData[];
  width?: number;
  height?: number;
}

export default function ResourceLoadChart({ data, width = 600, height = 300 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0F1E36';
    ctx.fillRect(0, 0, width, height);

    const barH = 24;
    const gap = 8;
    const totalH = data.length * (barH + gap) + 40;
    const startY = 20;
    const barMaxW = width - 180;

    // Title
    ctx.fillStyle = '#E8EEF5';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Загрузка ресурсов', 14, startY - 4);

    data.forEach((res, i) => {
      const y = startY + i * (barH + gap);
      const barW = (res.loadPercent / 100) * barMaxW;

      // Resource name
      ctx.fillStyle = '#B0C4DE';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(res.resourceName, 100, y + barH - 6);

      // Background bar
      ctx.fillStyle = 'rgba(30, 50, 82, 0.5)';
      ctx.fillRect(110, y, barMaxW, barH);

      // Load bar
      const color = res.isBottleneck
        ? '#EF4444'
        : res.loadPercent > 80
          ? '#F59E0B'
          : '#10B981';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(110, y, barW, barH);
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = res.isBottleneck ? 'rgba(239, 68, 68, 0.4)' : 'rgba(30, 50, 82, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(110, y, barMaxW, barH);

      // Label
      ctx.fillStyle = '#E8EEF5';
      ctx.font = 'bold 10px IBM Plex Mono, monospace';
      ctx.textAlign = 'left';
      const labelX = barW > 40 ? 116 : 116 + (barW > 20 ? barW : 20);
      ctx.fillStyle = barW > 40 ? '#E8EEF5' : '#8FA3BD';
      ctx.fillText(`${res.loadPercent}%`, 116, y + barH - 6);

      // Queue badge
      if (res.queueOps > 0) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
        ctx.font = '9px Inter, sans-serif';
        ctx.fillText(`${res.queueOps} в очереди`, 114 + barMaxW, y + barH - 6);
      }
    });
  }, [data, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', borderRadius: 8 }}
    />
  );
}
