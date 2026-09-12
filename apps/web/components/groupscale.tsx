'use client';
/**
 * Шкала куста по ресурсам (шаг 2.3).
 * Строки — ресурсы, полосы — операции; общие ресурсы подсвечены, закрепления показаны маркерами,
 * события мощности — полосами на строке ресурса, «призрак» прежнего положения — полупрозрачными полосами.
 * Сверху — хлебные крошки контекста и переключатели (шаг 8.3).
 */
import { useEffect, useMemo, useState } from 'react';

type Props = {
  project: any;
  groupName?: string | null;
  nodes: any[];
  resMap: Record<string, string>;
  resIds?: Record<string, string>;
  pins: any[];
  events: any[];
  ghost?: any[];
  options: { showPins: boolean; showEvents: boolean; showFlow: boolean };
  onToggle: (key: 'showPins' | 'showEvents' | 'showFlow') => void;
  onOpenGantt?: () => void;
  onBack?: () => void;
  pinsByOp?: Record<string, any>;
  onPin?: (operationId: string, pinType: string, pinAt: string, isHard: boolean, note?: string) => void;
  onUnpin?: (pinId: string) => void;
  busy?: boolean;
};

const MS_DAY = 86400000;
const parse = (v: any): number => {
  if (!v) return NaN;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isFinite(t) ? t : NaN;
};
const fmt = (t: number) => (Number.isFinite(t) ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—');

export default function GroupScale({ project, groupName, nodes, resMap, resIds, pins, events, ghost, options, onToggle, onOpenGantt, onBack, pinsByOp, onPin, onUnpin, busy }: Props) {
  const [sel, setSel] = useState<any>(null);
  const [hard, setHard] = useState(true);
  const [when, setWhen] = useState<string>('');
  const [drag, setDrag] = useState<any>(null);

  const MAGNET_RADIUS_MS = 86400000; // радиус магнита — 1 день (единица настройки magnet.radius_value)

  // Якоря магнита: для каждого ресурса — даты начал и окончаний соседних операций
  const anchors = useMemo(() => {
    const m: Record<string, { t: number; label: string }[]> = {};
    (nodes || []).forEach((n: any) => {
      const res = resMap[n.id] || 'Без ресурса';
      const a = parse(n.start_datetime), b = parse(n.finish_datetime || n.start_datetime);
      if (Number.isFinite(b)) (m[res] = m[res] || []).push({ t: b, label: 'конец: ' + String(n.name).slice(0, 30) });
      if (Number.isFinite(a)) (m[res] = m[res] || []).push({ t: a, label: 'начало: ' + String(n.name).slice(0, 30) });
    });
    return m;
  }, [nodes, resMap]);

  const startDrag = (e: any, n: any, res: string) => {
    const lane = e.currentTarget.parentElement.getBoundingClientRect();
    setDrag({ id: n.id, res, laneW: lane.width, x0: e.clientX, dt: 0, label: '', anchor: false, moved: false });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (ev: MouseEvent) => {
      const op = (nodes || []).find((x: any) => x.id === drag.id);
      if (!op) return;
      const deltaMs = ((ev.clientX - drag.x0) / Math.max(drag.laneW, 1)) * rows.span;
      const target = parse(op.start_datetime) + deltaMs;
      let best: any = null;
      (anchors[drag.res] || []).forEach((c: any) => {
        const d = Math.abs(c.t - target);
        if (d <= MAGNET_RADIUS_MS && (!best || d < best.d)) best = { t: c.t, label: c.label, d };
      });
      const anchorHit = !!best;
      if (!best) {
        const day = 86400000;
        const t = Math.round(target / day) * day;
        best = { t, label: 'сетка дней', d: Math.abs(t - target) };
      }
      setDrag((s: any) => ({ ...s, dt: best.t, label: best.label, anchor: anchorHit, moved: Math.abs(ev.clientX - drag.x0) > 4 }));
    };
    const up = () => {
      const d = drag.dt;
      const moved = !!drag.moved;
      setDrag(null);
      // закрепление ставим только при реальном перетаскивании, обычный клик лишь открывает панель
      if (moved && d && onPin) {
        const iso = new Date(d).toISOString().slice(0, 16);
        onPin(drag.id, 'start_not_earlier', iso, true, 'перетаскивание на шкале куста: ' + (drag.label || 'день'));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [drag, anchors, nodes, rows.span, onPin]);

  const openSel = (n: any) => {
    setSel(n);
    setWhen((n.start_datetime || '').slice(0, 16).replace(' ', 'T'));
    setHard(true);
  };

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
                {options.showEvents && (events || []).filter((e: any) => (resIds?.[r.res] ? e.resource_id === resIds[r.res] : (e.resource_name || '') === r.res)).map((e: any, i: number) => {
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
                {drag && drag.res === r.res && drag.dt > 0 && (
                  <span style={{ position: 'absolute', left: pos(drag.dt) + '%', top: 0, bottom: 0, width: 2, background: '#FBBF24' }}>
                    <span style={{ position: 'absolute', top: -16, left: 4, whiteSpace: 'nowrap', fontSize: 10.5, color: '#FBBF24' }}>
                      {fmt(drag.dt)}{drag.anchor ? ' · ' + drag.label : ''}
                    </span>
                  </span>
                )}
                {r.ops.map((n: any) => {
                  const a = parse(n.start_datetime), b = parse(n.finish_datetime || n.start_datetime);
                  return (
                    <span key={n.id} title={`${n.name}\n${fmt(a)} → ${fmt(b)}${n.is_pinned ? '\nзакреплено' : ''}`} style={{
                      position: 'absolute', left: pos(a) + '%', width: width(a, b) + '%', top: 6, height: 12, borderRadius: 4,
                      background: n.is_critical ? '#EF4444' : '#3B82F6',
                      outline: n.is_pinned && options.showPins ? '1.5px solid #22D3EE' : 'none',
                      cursor: drag ? 'grabbing' : 'grab',
                    }} onClick={() => openSel(n)} onMouseDown={(e) => startDrag(e, n, r.res)} />
                  );
                })}
                {options.showPins && (pins || []).filter((p: any) => (resMap[p.operation_id] === r.res) || (resIds?.[r.res] ? p.resource_id === resIds[r.res] : false)).map((p: any, i: number) => {
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

      {sel && (
        <div style={{
          position: 'fixed', right: 18, bottom: 18, width: 360, zIndex: 40,
          background: '#101F38', border: '1px solid #2B5B92', borderRadius: 12, padding: 12, boxShadow: '0 12px 30px rgba(0,0,0,.45)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{sel.name}</div>
          <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 8 }}>
            ресурс: {resMap[sel.id] || '—'} | план: {fmt(parse(sel.start_datetime))} → {fmt(parse(sel.finish_datetime || sel.start_datetime))}
            {pinsByOp?.[sel.id] ? ' | закреплено' : ''}
          </div>
          <label style={{ display: 'block', fontSize: 11.5, color: '#8FA3BD', marginBottom: 4 }}>Дата и время закрепления</label>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            style={{ width: '100%', background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 8, color: '#E8EEF5', padding: '5px 8px', fontSize: 12.5, marginBottom: 8 }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#C9D7EA', marginBottom: 8 }}>
            <input type="checkbox" checked={hard} onChange={() => setHard(!hard)} /> жёсткое (план не сдвигает операцию из этой даты)
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['start_not_earlier', '⏳ Начать не раньше'], ['finish_not_later', '⏱ Закончить не позже'], ['capacity_window', '🪟 Окно мощности']] as const).map(([t, label]) => (
              <button key={t} disabled={!!busy} onClick={() => onPin && sel && onPin(sel.id, t, when, hard, 'закрепление из шкалы куста')}
                style={{ background: '#12304F', border: '1px solid #2B5B92', color: '#DBEAFE', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
            {pinsByOp?.[sel.id] && (
              <button disabled={!!busy} onClick={() => onUnpin && onUnpin(pinsByOp[sel.id].id)}
                style={{ background: '#331717', border: '1px solid #6D2A2A', color: '#FCA5A5', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
                ✕ Снять закрепление
              </button>
            )}
            <button onClick={() => setSel(null)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #1E3252', color: '#8FA3BD', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
              Закрыть
            </button>
          </div>
          {busy && <div style={{ fontSize: 11.5, color: '#FBBF24', marginTop: 8 }}>Пересчитываю план…</div>}
          {ghost && ghost.length > 0 && (
            <div style={{ fontSize: 11, color: '#8FA3BD', marginTop: 8 }}>Серые полосы — положение до последнего изменения (для сравнения «до/после»).</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: '#8FA3BD' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#EF4444', borderRadius: 3, marginRight: 6 }} />критические</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#3B82F6', borderRadius: 3, marginRight: 6 }} />есть резерв</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#C4B5FD', borderRadius: 3, marginRight: 6 }} />общий ресурс куста</span>
        <span><span style={{ display: 'inline-block', width: 2, height: 10, background: '#22D3EE', marginRight: 6 }} />маркер закрепления</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(248,113,113,.25)', border: '1px solid #F87171', borderRadius: 3, marginRight: 6 }} />ограничение / простой</span>
        <span style={{ color: '#FBBF24' }}>↔ тяните полосу: магнит ловит конец соседней операции, начало следующей или сетку дней (радиус 1 день), на отпускании ставится закрепление</span>
      </div>
    </div>
  );
}
