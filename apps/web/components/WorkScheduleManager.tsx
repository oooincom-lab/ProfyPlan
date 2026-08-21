'use client';

import { useState, useEffect } from 'react';

const API = 'https://profyplan.ru/api/v1';

type Slot = {
  id?: string;
  day_of_week?: number | null;
  cycle_day?: number | null;
  start_hour: number;
  end_hour: number;
  kind: 'work' | 'break';
};

type Schedule = {
  id?: string;
  name: string;
  fill_mode: 'weekdays' | 'cycle';
  cycle_length?: number | null;
  timezone: string;
  slots: Slot[];
};

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ── time helpers (decimal hours ⇄ HH:MM) ──
const hhmm = (d: number) => {
  const h = Math.floor(d);
  const m = Math.round((d - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const dec = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
};

const MODE_LABEL: Record<string, string> = { weekdays: 'По дням недели', cycle: 'По циклу' };

export default function WorkScheduleManager() {
  const [list, setList] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as any || {}) };
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (r.status === 401) { localStorage.removeItem('profyplan_token'); throw new Error('AUTH_REQUIRED'); }
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setList(await af('/work-schedules/')); } catch (e: any) { setError(String(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const dayCount = (d: Schedule) => d.fill_mode === 'cycle' ? (d.cycle_length || 4) : 7;
  const dayKey = (d: Schedule, i: number) => d.fill_mode === 'cycle' ? i + 1 : i;
  const dayLabel = (d: Schedule, i: number) => d.fill_mode === 'cycle' ? `День ${i + 1}` : DAY_NAMES[i];
  const slotsForDay = (d: Schedule, i: number) => {
    const k = dayKey(d, i);
    return d.slots.filter(s => d.fill_mode === 'cycle' ? s.cycle_day === k : s.day_of_week === k);
  };
  const workHours = (d: Schedule) => {
    return d.slots.filter(s => s.kind === 'work').reduce((acc, s) => acc + (s.end_hour <= s.start_hour ? s.end_hour + 24 - s.start_hour : s.end_hour - s.start_hour), 0);
  };

  const newDraft = (): Schedule => ({
    name: '',
    fill_mode: 'weekdays',
    cycle_length: 4,
    timezone: 'Europe/Moscow',
    slots: [],
  });

  const startNew = () => { setEditing(newDraft()); setIsNew(true); };
  const startEdit = (s: Schedule) => { setEditing({ ...s, slots: s.slots.map(x => ({ ...x })) }); setIsNew(false); };
  const cancel = () => { setEditing(null); setIsNew(false); };

  const addSlot = (d: Schedule, dayIdx: number) => {
    const k = dayKey(d, dayIdx);
    const slot: Slot = { start_hour: 8, end_hour: 17, kind: 'work', ...(d.fill_mode === 'cycle' ? { cycle_day: k } : { day_of_week: k }) };
    setEditing({ ...d, slots: [...d.slots, slot] });
  };
  const updSlot = (d: Schedule, idx: number, patch: Partial<Slot>) => {
    const slots = d.slots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    setEditing({ ...d, slots });
  };
  const rmSlot = (d: Schedule, idx: number) => {
    setEditing({ ...d, slots: d.slots.filter((_, i) => i !== idx) });
  };
  const setMode = (d: Schedule, m: 'weekdays' | 'cycle') => {
    setEditing({ ...d, fill_mode: m, slots: [] });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Укажите наименование графика'); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: editing.name.trim(),
        fill_mode: editing.fill_mode,
        cycle_length: editing.fill_mode === 'cycle' ? (editing.cycle_length || 4) : null,
        timezone: editing.timezone,
        slots: editing.slots.map(s => ({ day_of_week: s.day_of_week ?? null, cycle_day: s.cycle_day ?? null, start_hour: s.start_hour, end_hour: s.end_hour, kind: s.kind })),
      };
      if (isNew) await af('/work-schedules/', { method: 'POST', body: JSON.stringify(body) });
      else await af(`/work-schedules/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null); setIsNew(false);
      await load();
    } catch (e: any) { setError(String(e)); }
    setSaving(false);
  };

  const del = async (s: Schedule) => {
    if (!s.id) return;
    if (!confirm(`Удалить график «${s.name}»?`)) return;
    try { await af(`/work-schedules/${s.id}`, { method: 'DELETE' }); await load(); } catch (e: any) { setError(String(e)); }
  };

  // ── preview bars ──
  const Preview = ({ d }: { d: Schedule }) => {
    const n = dayCount(d);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 4 }}>
        {Array.from({ length: n }).map((_, i) => {
          const segs = slotsForDay(d, i).filter(s => s.kind === 'work');
          return (
            <div key={i}>
              <div style={{ textAlign: 'center', fontSize: 10, color: '#5A7090', marginBottom: 3 }}>{dayLabel(d, i)}</div>
              <div style={{ height: 40, borderRadius: 5, position: 'relative', background: '#0B1526', border: '1px solid #14243C' }}>
                {segs.map((s, j) => {
                  const st = s.start_hour, en = s.end_hour <= s.start_hour ? s.end_hour + 24 : s.end_hour;
                  const top = (st / 24 * 100).toFixed(1) + '%';
                  const h = ((en - st) / 24 * 100).toFixed(1) + '%';
                  return <span key={j} style={{ position: 'absolute', left: 0, right: 0, top, height: h, background: 'rgba(59,130,246,.7)', borderRadius: 3 }} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const input = (style?: React.CSSProperties): React.CSSProperties => ({ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5, ...style });
  const btn = (c: string): React.CSSProperties => ({ background: c, border: 'none', color: '#fff', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });

  return (
    <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
      <div className="panel-hdr" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="panel-title" style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>🕒 Графики работы</span>
        {!editing && <button onClick={startNew} style={btn('#3B82F6')}>＋ Новый график</button>}
      </div>

      {error && <div style={{ color: '#FCA5A5', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {!editing && (
        loading ? <div style={{ color: '#5A7090', fontSize: 13 }}>Загрузка…</div> : (
          list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#5A7090' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🕒</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: '#8FA3BD' }}>Графиков пока нет</div>
              <div style={{ fontSize: 12.5 }}>Создайте первый шаблон: «Пятидневка 40ч», «2/2 по 12ч» и т.п.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }} onClick={() => startEdit(s)}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.fill_mode === 'cycle' ? '#22D3EE' : '#3B82F6', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#E8EEF5' }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: '#5A7090' }}>{MODE_LABEL[s.fill_mode]}{s.fill_mode === 'cycle' ? ` · цикл ${s.cycle_length} дн` : ''} · {workHours(s).toFixed(1)} ч/нед · {s.slots.filter(x => x.kind === 'work').length} интервалов</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); del(s); }} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer' }}>Удалить</button>
                </div>
              ))}
            </div>
          )
        )
      )}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>Наименование</span>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={input()} placeholder="Пятидневка 40ч" autoFocus />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setMode(editing, 'weekdays')} style={{ ...btn(editing.fill_mode === 'weekdays' ? '#3B82F6' : 'transparent'), border: '1px solid #1E3A5F', color: editing.fill_mode === 'weekdays' ? '#fff' : '#8FA3BD', padding: '6px 12px' }}>По дням недели</button>
              <button onClick={() => setMode(editing, 'cycle')} style={{ ...btn(editing.fill_mode === 'cycle' ? '#3B82F6' : 'transparent'), border: '1px solid #1E3A5F', color: editing.fill_mode === 'cycle' ? '#fff' : '#8FA3BD', padding: '6px 12px' }}>По циклу</button>
            </div>
            {editing.fill_mode === 'cycle' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Дней в цикле</span>
                <input type="number" min={1} max={60} value={editing.cycle_length || 4} onChange={e => setEditing({ ...editing, cycle_length: parseInt(e.target.value) || 4 })} style={{ ...input(), width: 70 }} />
              </label>
            )}
          </div>

          {/* slots editor */}
          <div>
            <div style={{ fontSize: 11, color: '#8FA3BD', marginBottom: 8 }}>Интервалы работы и перерывы по дням</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: dayCount(editing) }).map((_, i) => {
                const segs = slotsForDay(editing, i);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 7, padding: '7px 10px' }}>
                    <span style={{ width: 56, fontSize: 12, color: '#8FA3BD', flexShrink: 0 }}>{dayLabel(editing, i)}</span>
                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {segs.length === 0 && <span style={{ fontSize: 11.5, color: '#5A7090' }}>выходной</span>}
                      {segs.map((s, j) => {
                        const slotIdx = editing.slots.indexOf(s);
                        return (
                          <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.kind === 'break' ? 'rgba(245,158,11,.12)' : 'rgba(59,130,246,.13)', border: s.kind === 'break' ? '1px solid rgba(245,158,11,.35)' : '1px solid rgba(59,130,246,.3)', borderRadius: 6, padding: '2px 6px' }}>
                            <input type="time" value={hhmm(s.start_hour)} onChange={e => updSlot(editing, slotIdx, { start_hour: dec(e.target.value) })} style={{ background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: 11.5, fontFamily: 'monospace', width: 52 }} />
                            <span style={{ color: '#5A7090' }}>–</span>
                            <input type="time" value={hhmm(s.end_hour)} onChange={e => updSlot(editing, slotIdx, { end_hour: dec(e.target.value) })} style={{ background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: 11.5, fontFamily: 'monospace', width: 52 }} />
                            <select value={s.kind} onChange={e => updSlot(editing, slotIdx, { kind: e.target.value as 'work' | 'break' })} style={{ background: 'transparent', border: 'none', color: s.kind === 'break' ? '#FCD34D' : '#60A5FA', fontSize: 10.5 }}>
                              <option value="work">работа</option>
                              <option value="break">перерыв</option>
                            </select>
                            <button onClick={() => rmSlot(editing, slotIdx)} style={{ background: 'transparent', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }}>✕</button>
                          </span>
                        );
                      })}
                    </div>
                    <button onClick={() => addSlot(editing, i)} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>＋ интервал</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* preview */}
          <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Предпросмотр</div>
            <Preview d={editing} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={btn('#3B82F6')}>{saving ? 'Сохранение…' : '✓ Сохранить'}</button>
            {!isNew && editing.id && <button onClick={() => del(editing)} style={{ ...btn('transparent'), border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5' }}>Удалить</button>}
            <button onClick={cancel} style={{ ...btn('transparent'), border: '1px solid #1E3A5F', color: '#8FA3BD' }}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
