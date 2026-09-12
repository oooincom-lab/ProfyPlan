'use client';
/**
 * Шкала куста по ресурсам (шаг 2.3).
 * Строки — ресурсы, полосы — операции; общие ресурсы подсвечены, закрепления показаны маркерами,
 * события мощности — полосами на строке ресурса, «призрак» прежнего положения — полупрозрачными полосами.
 * Сверху — хлебные крошки контекста и переключатели (шаг 8.3).
 */
import { useMemo } from 'react';

type Props = {
  project: any;
  groupName?: string | null;
  nodes: any[];
  resMap: Record<string, string>;
  pins: any[];
  events: any[];
  ghost?: any[];
  options: { showPins: boolean; showEvents: boolean; showFlow: boolean };
  onToggle: (key: 'showPins' | 'showEvents' | 'showFlow') => void;
  onOpenGantt?: () => void;
  onBack?: () => void;
};

const MS_DAY = 86400000;
const parse = (v: any): number => {
  if (!v) return NaN;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isFinite(t) ? t : NaN;
};
const fmt = (t: number) => (Number.isFinite(t) ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—');

export default function GroupScale({ project, groupName, nodes, resMap, pins, events, ghost, options, onToggle, onOpenGantt, onBack }: Props) {
  const rows = useMemo(() => {
    const list = (nodes || []).filter((n: any) => Number.isFinite(parse(n.start_datetime)));
    if (!list.length) return { rows: [], min: 0, span: MS_DAY, count: 0 };
    const min = Math.min(...list.map((n: any) => parse(n.start_datetime)));
    const max = Math.max(...list.map((n: any) => parse(n.finish_datetime || n.start_datetime)));
    const span = Math.max(max - min, MS_DAY);
    const byRes: Record<string, any[]> = {};
    list.forEach((n: any) => {
      const rid = resMap[n.id] || 'Без ресурса';
      (byRes[rid] = byRes[rid] || []).push(n);
    });
    const out = Object.entries(byRes).map(([res, ops]) => {
      const orders = new Set(ops.map((o: any) => o.order_id || o.order_name || o.name.split(' · ')[0]));
      return {
        res,
        ops: ops.sort((a: any, b: any) => parse(a.start_datetime) - parse(b.start_datetime)),
        shared: orders.size > 1,
        ordersCount: orders.size,
      };
    });
    out.sort((a, b) => (b.ops.length - a.ops.length) || a.res.localeCompare(b.res));
    return { rows: out, min, span, count: list.length };
  }, [nodes, resMap]);

  const pos = (t: number) => (Number.isFinite(t) ? ((t - rows.min) / rows.span) * 100 : 0);
  const width = (a: number, b: number) => Math.max(0.6, ((b - a) / rows.span) * 100);
  const ghostByOp = useMemo(() => {
    const m: Record<string, any> = {};
    (ghost || []).forEach((g: any) => { m[g.id] = g; });
    return m;
  }, [ghost]);
  const weeks: number[] = [];
  if (rows.count > 0 && Number.isFinite(rows.min) && Number.isFinite(rows.span) && rows.span > 0) {
    const step = rows.span > 120 * MS_DAY ? 30 * MS_DAY : 7 * MS_DAY;
    let guard = 0;
    for (let t = rows.min; t <= rows.min + rows.span && guard < 60; t += step, guard++) weeks.push(t);
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
        <span style={{ color: '#5A7090' }}>Портфель</span><span style={{ color: '#33456B' }}>›</span>
        <span style={{ color: '#93C5FD', cursor: 'pointer' }} onClick={onBack}>{project?.name || 'Проект'}</span>
        <span style={{ color: '#33456B' }}>›</span>
        <b style={{ color: '#E8EEF5' }}>Куст: {groupName || 'все заказы проекта'}</b>
        <span style={{ flex: 1 }} />
        {([['showPins', 'маркеры'], ['showEvents', 'события мощности'], ['showFlow', 'поток']] as const).map(([key, label]) => (
          <label key={key} style={{
            display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer',
            border: '1px solid ' + (options[key] ? '#2B5B92' : '#1E3252'),
            background: options[key] ? '#12304F' : 'transparent',
            color: options[key] ? '#DBEAFE' : '#8FA3BD', borderRadius: 999, padding: '3px 10px',
          }}>
            <input type="checkbox" checked={options[key]} onChange={() => onToggle(key)} style={{ display: 'none' }} />
            {options[key] ? '✓ ' : ''}{label}
          </label>
        ))}
        {onOpenGantt && <button onClick={onOpenGantt} className="btn btn-secondary btn-sm">📊 Диаграмма Ганта</button>}
      </div>

      {rows.count === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#5A7090' }}>Нет операций для отображения. Выполните расчёт проекта.</div>}

      {rows.count > 0 && (
        <div style={{ border: '1px solid #1E3252', borderRadius: 10, overflow: 'hidden', background: '#0A1628' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #1E3252', background: '#0F1E36', fontSize: 11, color: '#8FA3BD' }}>
            <div style={{ width: 190, flex: '0 0 190px', padding: '5px 8px', borderRight: '1px solid #1E3252' }}>Ресурс</div>
            <div style={{ flex: 1, position: 'relative', height: 22 }}>
              {weeks.map((t, i) => (
                <span key={i} style={{ position: 'absolute', left: pos(t) + '%', top: 4, fontSize: 10.5, color: '#5A7090' }}>{fmt(t)}</span>
              ))}
            </div>
          </div>
          {rows.rows.map((r) => (
            <div key={r.res} style={{ display: 'flex', borderBottom: '1px solid #14263F' }}>
              <div style={{
                width: 190, flex: '0 0 190px', padding: '6px 8px', borderRight: '1px solid #1E3252', fontSize: 12,
                color: r.shared ? '#C4B5FD' : '#C9D7EA', background: r.shared ? '#1B1733' : 'transparent',
              }}>
                {r.res}
                <span style={{ color: '#5A7090', marginLeft: 6, fontSize: 10.5 }}>
                  {r.ops.length} оп.{r.shared ? ' · общий' : ''}
                </span>
              </div>
              <div style={{ flex: 1, position: 'relative', height: 30, background: r.shared ? '#121A2E' : 'transparent' }}>
                {weeks.map((t, i) => (
                  <span key={i} style={{ position: 'absolute', left: pos(t) + '%', top: 0, bottom: 0, width: 1, background: '#14263F' }} />
                ))}
                {options.showEvents && (events || []).filter((e: any) => (e.resource_name || '') === r.res).map((e: any, i: number) => {
                  const a = parse(e.date_from), b = parse(e.date_to);
                  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
                  const bad = e.event_type === 'breakdown' || e.event_type === 'reduced';
                  return (
                    <span key={'ev' + i} title={e.reason || e.event_type} style={{
                      position: 'absolute', left: pos(a) + '%', width: width(a, b) + '%', top: 0, bottom: 0,
                      background: bad ? 'rgba(248,113,113,.16)' : 'rgba(52,211,153,.14)',
                      borderLeft: '1px solid ' + (bad ? '#F87171' : '#34D399'),
                    }} />
                  );
                })}
                {ghost && r.ops.map((n: any) => {
                  const g = ghostByOp[n.id];
                  if (!g) return null;
                  const a = parse(g.start_datetime), b = parse(g.finish_datetime || g.start_datetime);
                  if (!Number.isFinite(a)) return null;
                  return <span key={'g' + n.id} title="прежнее положение" style={{
                    position: 'absolute', left: pos(a) + '%', width: width(a, b) + '%', top: 18, height: 6,
                    background: 'rgba(148,163,184,.35)', borderRadius: 3,
                  }} />;
                })}
                {r.ops.map((n: any) => {
                  const a = parse(n.start_datetime), b = parse(n.finish_datetime || n.start_datetime);
                  return (
                    <span key={n.id} title={`${n.name}\n${fmt(a)} → ${fmt(b)}${n.is_pinned ? '\nзакреплено' : ''}`} style={{
                      position: 'absolute', left: pos(a) + '%', width: width(a, b) + '%', top: 6, height: 12, borderRadius: 4,
                      background: n.is_critical ? '#EF4444' : '#3B82F6',
                      outline: n.is_pinned && options.showPins ? '1.5px solid #22D3EE' : 'none',
                      cursor: 'pointer',
                    }} />
                  );
                })}
                {options.showPins && (pins || []).filter((p: any) => (p.resource_name || '') === r.res).map((p: any, i: number) => {
                  const t = parse(p.pin_at);
                  if (!Number.isFinite(t)) return null;
                  return <span key={'p' + i} title={`закрепление: ${p.pin_type}${p.is_hard ? ' (жёсткое)' : ''}`} style={{
                    position: 'absolute', left: pos(t) + '%', top: 0, bottom: 0, width: 2, background: '#22D3EE',
                  }} />;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: '#8FA3BD' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#EF4444', borderRadius: 3, marginRight: 6 }} />критические</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#3B82F6', borderRadius: 3, marginRight: 6 }} />есть резерв</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#C4B5FD', borderRadius: 3, marginRight: 6 }} />общий ресурс куста</span>
        <span><span style={{ display: 'inline-block', width: 2, height: 10, background: '#22D3EE', marginRight: 6 }} />маркер закрепления</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(248,113,113,.25)', border: '1px solid #F87171', borderRadius: 3, marginRight: 6 }} />ограничение / простой</span>
      </div>
    </div>
  );
}
