/**
 * GanttChart — диаграмма Ганта (read-only).
 * Рендерит операции как горизонтальные полосы на временной шкале.
 * Цвета: серый (план), зелёный (факт/завершено), красный (задержка).
 * Зависимости — стрелками.
 */
'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';

// ── Типы ──
interface GanttOp {
  id: string;
  name: string;
  duration_hours: number;
  early_start: string | null;
  early_finish: string | null;
  is_critical: boolean;
  wbs_code?: string;
  operation_type?: string;
}

interface GanttDep {
  predecessor_id: string;
  successor_id: string;
  dependency_type: string;
  lag_hours: number;
}

interface GanttProps {
  operations: GanttOp[];
  dependencies?: GanttDep[];
  projectStart?: Date;
  title?: string;
}

// ── Константы отрисовки ──
const BAR_H = 28;
const BAR_GAP = 6;
const ROW_H = BAR_H + BAR_GAP;
const HEADER_H = 40;
const LABEL_W = 280;
const PADDING_X = 24;
const MIN_DAY_PX = 2;
const MAX_DAY_PX = 80;

function fmtDate(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function fmtTime(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}м`;
  if (h < 24) return `${h.toFixed(1)}ч`;
  return `${(h / 24).toFixed(1)}д`;
}

// ── Градиент для критического пути ──
const CRIT_GRAD = 'linear-gradient(135deg, #e74c3c, #c0392b)';
const NORM_GRAD = 'linear-gradient(135deg, #3498db, #2980b9)';
const DONE_GRAD = 'linear-gradient(135deg, #2ecc71, #27ae60)';
const MILESTONE_COLOR = '#f39c12';

export default function GanttChart({
  operations,
  dependencies = [],
  projectStart,
  title,
}: GanttProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(3);
  const [scrollX, setScrollX] = useState(0);

  const dayPx = Math.min(MAX_DAY_PX, Math.max(MIN_DAY_PX, zoom * 8));

  // Вычисляем временные границы
  const { ops, startDate, endDate, totalDays } = useMemo(() => {
    const now = projectStart || new Date();
    let minDate = now;
    let maxDate = now;

    const processed = operations.map((op, i) => {
      const start = op.early_start ? new Date(op.early_start) : new Date(now.getTime() + i * 3600000);
      const durH = op.duration_hours || 1;
      const end = op.early_finish
        ? new Date(op.early_finish)
        : new Date(start.getTime() + durH * 3600000);

      if (start < minDate) minDate = start;
      if (end > maxDate) maxDate = end;

      return { ...op, _start: start, _end: end, _durH: durH };
    });

    // Add buffer
    minDate = new Date(minDate.getTime() - 86400000);
    maxDate = new Date(maxDate.getTime() + 86400000 * 2);
    const days = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000) || 1;

    return { ops: processed, startDate: minDate, endDate: maxDate, totalDays: days };
  }, [operations, projectStart]);

  const chartW = totalDays * dayPx + PADDING_X * 2;
  const chartH = HEADER_H + ops.length * ROW_H + 40;

  // Позиция X для даты
  const dateToX = useCallback(
    (d: Date) =>
      PADDING_X + ((d.getTime() - startDate.getTime()) / 86400000) * dayPx,
    [startDate, dayPx]
  );

  // Генерация линий сетки (дни)
  const dayLines = useMemo(() => {
    const lines: { x: number; label: string; isWeekend: boolean }[] = [];
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(startDate.getTime() + i * 86400000);
      const isWE = d.getDay() === 0 || d.getDay() === 6;
      lines.push({
        x: PADDING_X + i * dayPx,
        label: fmtDate(d),
        isWeekend: isWE,
      });
    }
    return lines;
  }, [startDate, totalDays, dayPx]);

  // Индекс зависимостей
  const depMap = useMemo(() => {
    const m: Record<string, GanttDep> = {};
    for (const d of dependencies) {
      m[d.successor_id] = d;
    }
    return m;
  }, [dependencies]);

  // Отрисовка стрелок зависимостей
  const depArrows = useMemo(() => {
    const arrows: JSX.Element[] = [];
    const opById: Record<string, { _end: Date; _start: Date; idx: number }> = {};
    ops.forEach((op, i) => {
      opById[op.id] = { _end: op._end, _start: op._start, idx: i };
    });

    for (const dep of dependencies) {
      const pred = opById[dep.predecessor_id];
      const succ = opById[dep.successor_id];
      if (!pred || !succ) continue;

      const x1 = dateToX(pred._end);
      const y1 = HEADER_H + pred.idx * ROW_H + BAR_H / 2;
      const x2 = dateToX(succ._start);
      const y2 = HEADER_H + succ.idx * ROW_H + BAR_H / 2;

      const color = '#555';
      arrows.push(
        <g key={`dep-${dep.predecessor_id}-${dep.successor_id}`}>
          <path
            d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            opacity={0.6}
          />
          <polygon
            points={`${x2},${y2} ${x2 - 6},${y2 - 3} ${x2 - 6},${y2 + 3}`}
            fill={color}
            opacity={0.6}
          />
        </g>
      );
    }
    return arrows;
  }, [ops, dependencies, dateToX]);

  // Обработчики мыши для зума
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setZoom((z) => Math.max(0.5, Math.min(12, z - e.deltaY * 0.01)));
      } else {
        setScrollX((s) => Math.max(0, s + e.deltaX));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const viewBoxW = Math.max(800, chartW);
  const viewBoxH = chartH;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        overflow: 'hidden',
        background: '#0a0a0f',
        borderRadius: 8,
        border: '1px solid #1e1e2a',
      }}
    >
      {title && (
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14, color: '#e0e0e8', borderBottom: '1px solid #1e1e2a' }}>
          {title}
        </div>
      )}
      <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <svg
          ref={svgRef}
          viewBox={`${scrollX} 0 ${viewBoxW} ${viewBoxH}`}
          width="100%"
          height={viewBoxH + 20}
          style={{ minWidth: 600, display: 'block' }}
        >
          {/* Фон выходных */}
          {dayLines.filter((d) => d.isWeekend).map((d, i) => (
            <rect
              key={`we-${i}`}
              x={d.x - dayPx / 2}
              y={HEADER_H}
              width={dayPx}
              height={ops.length * ROW_H + 20}
              fill="rgba(255,255,255,0.02)"
            />
          ))}

          {/* Сетка дней */}
          {dayLines.filter((_, i) => i % Math.max(1, Math.floor(20 / dayPx)) === 0).map((d, i) => (
            <g key={`day-${i}`}>
              <line
                x1={d.x}
                y1={HEADER_H}
                x2={d.x}
                y2={HEADER_H + ops.length * ROW_H}
                stroke={d.isWeekend ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)'}
                strokeWidth={1}
              />
              <text
                x={d.x}
                y={HEADER_H - 12}
                textAnchor="middle"
                fill="#7a7a8a"
                fontSize={10}
                fontFamily="system-ui, sans-serif"
              >
                {d.label}
              </text>
            </g>
          ))}

          {/* Линия сегодня */}
          {(() => {
            const today = new Date();
            if (today >= startDate && today <= endDate) {
              const tx = dateToX(today);
              return (
                <line
                  x1={tx} y1={HEADER_H}
                  x2={tx} y2={HEADER_H + ops.length * ROW_H}
                  stroke="#e74c3c"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  opacity={0.7}
                />
              );
            }
            return null;
          })()}

          {/* Стрелки зависимостей */}
          {depArrows}

          {/* Полосы операций */}
          {ops.map((op, i) => {
            const x = dateToX(op._start);
            const w = Math.max(4, dateToX(op._end) - dateToX(op._start));
            const y = HEADER_H + i * ROW_H + BAR_GAP / 2;
            const isMilestone = w < 10;

            // Цвет
            const isLate = op.early_finish && new Date(op.early_finish) < new Date() && !op.is_critical;
            let fill = NORM_GRAD;
            if (op.is_critical) fill = CRIT_GRAD;
            if (isMilestone) fill = MILESTONE_COLOR;

            return (
              <g key={op.id}>
                {/* Метка слева */}
                <text
                  x={LABEL_W - 8}
                  y={y + BAR_H / 2 + 4}
                  textAnchor="end"
                  fill="#e0e0e8"
                  fontSize={12}
                  fontFamily="system-ui, sans-serif"
                  style={{ userSelect: 'none' }}
                >
                  {op.wbs_code ? `${op.wbs_code} · ` : ''}{op.name}
                </text>

                {/* Полоса */}
                {isMilestone ? (
                  <polygon
                    points={`${x},${y} ${x + 10},${y + BAR_H / 2} ${x},${y + BAR_H}`}
                    fill={fill}
                    opacity={0.9}
                  />
                ) : (
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={BAR_H}
                    rx={4}
                    fill={fill}
                    opacity={0.85}
                  />
                )}

                {/* Длительность на полосе */}
                {w > 50 && !isMilestone && (
                  <text
                    x={x + w / 2}
                    y={y + BAR_H / 2 + 4}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                    fontWeight={600}
                  >
                    {fmtTime(op._durH)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Разделитель меток */}
          <line
            x1={LABEL_W}
            y1={0}
            x2={LABEL_W}
            y2={viewBoxH}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        </svg>
      </div>

      {/* Легенда */}
      <div style={{
        display: 'flex', gap: 16, padding: '8px 16px',
        borderTop: '1px solid #1e1e2a', fontSize: 11, color: '#7a7a8a'
      }}>
        <span>🟦 План</span>
        <span>🟥 Критический путь</span>
        <span>🟨 Веха</span>
        <span style={{ opacity: 0.5 }}>Колёсико + Ctrl — зум</span>
      </div>
    </div>
  );
}
