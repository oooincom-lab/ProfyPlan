'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import DebugBadge from './DebugBadge';

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

export default function WorkScheduleManager({ debug = false }: { debug?: boolean }) {
  const [list, setList] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [copyTo, setCopyTo] = useState<number[]>([]);

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
    return d.slots.filter(s => s.kind === 'work').reduce((acc, s) => acc + Math.max(0, s.end_hour - s.start_hour), 0);
  };
  const invalid = (s: Slot) => s.end_hour <= s.start_hour;

  const newDraft = (): Schedule => ({ name: '', fill_mode: 'weekdays', cycle_length: 4, timezone: 'Europe/Moscow', slots: [] });

  const startNew = () => { setEditing(newDraft()); setIsNew(true); };
  const startEdit = (s: Schedule) => { setEditing({ ...s, slots: s.slots.map(x => ({ ...x })) }); setIsNew(false); };
  const cancel = () => { setEditing(null); setIsNew(false); setCopyFrom(null); };

  // ── slot mutations ──
  const addSlot = (d: Schedule, dayIdx: number) => {
    const k = dayKey(d, dayIdx);
    const last = slotsForDay(d, dayIdx).slice(-1)[0];
    const start = last ? Math.min(last.end_hour, 23) : 8;
    const end = Math.min(start + 1, 24);
    const slot: Slot = { start_hour: start, end_hour: end, kind: 'work', ...(d.fill_mode === 'cycle' ? { cycle_day: k } : { day_of_week: k }) };
    setEditing({ ...d, slots: [...d.slots, slot] });
  };
  const updSlot = (d: Schedule, idx: number, patch: Partial<Slot>) => {
    setEditing({ ...d, slots: d.slots.map((s, i) => i === idx ? { ...s, ...patch } : s) });
  };
  const rmSlot = (d: Schedule, idx: number) => setEditing({ ...d, slots: d.slots.filter((_, i) => i !== idx) });
  const clearDay = (d: Schedule, dayIdx: number) => {
    const k = dayKey(d, dayIdx);
    setEditing({ ...d, slots: d.slots.filter(s => d.fill_mode === 'cycle' ? s.cycle_day !== k : s.day_of_week !== k) });
  };
  const setMode = (d: Schedule, m: 'weekdays' | 'cycle') => setEditing({ ...d, fill_mode: m, slots: [] });

  // ── copy day ──
  const openCopy = (i: number) => { setCopyFrom(i); setCopyTo([]); };
  const toggleCopyTarget = (j: number) => setCopyTo(prev => prev.includes(j) ? prev.filter(x => x !== j) : [...prev, j]);
  const applyCopy = () => {
    if (!editing || copyFrom === null) return;
    const src = slotsForDay(editing, copyFrom);
    const added: Slot[] = [];
    for (const j of copyTo) {
      const k = dayKey(editing, j);
      for (const s of src) {
        added.push({ start_hour: s.start_hour, end_hour: s.end_hour, kind: s.kind, ...(editing.fill_mode === 'cycle' ? { cycle_day: k } : { day_of_week: k }) });
      }
    }
    setEditing({ ...editing, slots: [...editing.slots, ...added] });
    setCopyFrom(null); setCopyTo([]);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Укажите наименование графика'); return; }
    if (editing.slots.some(invalid)) { setError('Есть интервал, у которого конец раньше или равен началу — исправьте.'); return; }
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

  // ── preview ──
  const Preview = ({ d }: { d: Schedule }) => {
    const n = dayCount(d);
    const ticks = [0, 6, 12, 18, 24];
    return (
      <div>
        <div style={{ display: 'flex', gap: 16, fontSize: 10.5, color: '#8FA3BD', marginBottom: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><i style={{ width: 10, height: 10, background: 'rgba(59,130,246,.7)', borderRadius: 2, display: 'inline-block' }} /> Работа</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><i style={{ width: 10, height: 10, background: 'rgba(245,158,11,.7)', borderRadius: 2, display: 'inline-block' }} /> Перерыв</span>
        </div>
        <div style={{ display: 'flex', marginLeft: 52, marginBottom: 2 }}>
          <div style={{ flex: 1, position: 'relative', height: 14 }}>
            {ticks.map(h => <span key={h} style={{ position: 'absolute', left: `${h / 24 * 100}%`, transform: 'translateX(-50%)', fontSize: 9, color: '#5A7090' }}>{h}ч</span>)}
          </div>
        </div>
        {Array.from({ length: n }).map((_, i) => {
          const all = slotsForDay(d, i);
          const segs = all.filter(s => s.kind === 'work');
          const text = segs.map(s => `${hhmm(s.start_hour)}–${hhmm(s.end_hour)}`).join(' · ') || 'выходной';
          const work = segs.reduce((a, s) => a + Math.max(0, s.end_hour - s.start_hour), 0);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ width: 44, fontSize: 11, color: '#8FA3BD', flexShrink: 0, textAlign: 'right' }}>{dayLabel(d, i)}</span>
              <div style={{ flex: 1, position: 'relative', height: 22, background: '#0B1526', border: '1px solid #14243C', borderRadius: 4, overflow: 'hidden' }}>
                {ticks.map(h => <span key={h} style={{ position: 'absolute', left: `${h / 24 * 100}%`, top: 0, bottom: 0, width: 1, background: '#162844' }} />)}
                {all.map((s, j) => {
                  const left = `${s.start_hour / 24 * 100}%`;
                  const w = `${Math.max(0, s.end_hour - s.start_hour) / 24 * 100}%`;
                  return <span key={j} style={{ position: 'absolute', left, width: w, top: 3, bottom: 3, background: s.kind === 'break' ? 'rgba(245,158,11,.65)' : 'rgba(59,130,246,.65)', borderRadius: 2 }} />;
                })}
              </div>
              <span style={{ width: 168, fontSize: 10, color: '#8FA3BD', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>{text}</span>
              <span style={{ width: 42, fontSize: 10, color: '#60A5FA', textAlign: 'right', flexShrink: 0 }}>{work > 0 ? `${work.toFixed(1)}ч` : ''}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const input = (style?: CSSProperties): CSSProperties => ({ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '5px 8px', fontSize: 12.5, ...style });
  const btn = (c: string): CSSProperties => ({ background: c, border: 'none', color: '#fff', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' });
  const iconBtn = (_title: string): CSSProperties => ({ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '3px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1 });

  return (
    <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
      <div className="panel-hdr" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="panel-title" style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>🕒 Графики работы</span>
        <DebugBadge debug={debug} text="[wschedule:manager]" copy="[wschedule:manager] «Графики работы»" />
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
            <div style={{ fontSize: 11, color: '#8FA3BD', marginBottom: 8 }}>Интервалы работы и перерывов по дням — кнопки справа: копировать день, очистить, добавить интервал</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: dayCount(editing) }).map((_, i) => {
                const segs = slotsForDay(editing, i);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 7, padding: '7px 10px' }}>
                    <span style={{ width: 52, fontSize: 12, color: '#8FA3BD', flexShrink: 0 }}>{dayLabel(editing, i)}</span>
                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                      {segs.length === 0 && <span style={{ fontSize: 11.5, color: '#5A7090' }}>выходной</span>}
                      {segs.map((s, j) => {
                        const slotIdx = editing.slots.indexOf(s);
                        const bad = invalid(s);
                        return (
                          <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: s.kind === 'break' ? 'rgba(245,158,11,.12)' : 'rgba(59,130,246,.13)', border: `1px solid ${bad ? 'rgba(239,68,68,.7)' : s.kind === 'break' ? 'rgba(245,158,11,.35)' : 'rgba(59,130,246,.3)'}`, borderRadius: 6, padding: '2px 5px' }}>
                            <input type="time" value={hhmm(s.start_hour)} onChange={e => updSlot(editing, slotIdx, { start_hour: dec(e.target.value) })} style={{ background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: 12, padding: 0, width: 66 }} />
                            <span style={{ color: '#5A7090' }}>–</span>
                            <input type="time" value={hhmm(s.end_hour)} onChange={e => updSlot(editing, slotIdx, { end_hour: dec(e.target.value) })} style={{ background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: 12, padding: 0, width: 66 }} />
                            <select value={s.kind} onChange={e => updSlot(editing, slotIdx, { kind: e.target.value as 'work' | 'break' })} style={{ background: 'transparent', border: 'none', color: s.kind === 'break' ? '#FCD34D' : '#60A5FA', fontSize: 10.5 }}>
                              <option value="work">работа</option>
                              <option value="break">перерыв</option>
                            </select>
                            <button onClick={() => rmSlot(editing, slotIdx)} title="Удалить интервал" style={{ background: 'transparent', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 12 }}>✕</button>
                          </span>
                        );
                      })}
                    </div>
                    <button onClick={() => openCopy(i)} title="Копировать день" style={iconBtn('copy')}>⧉</button>
                    <button onClick={() => clearDay(editing, i)} title="Очистить день" style={iconBtn('clear')}>✕</button>
                    <button onClick={() => addSlot(editing, i)} title="Добавить интервал" style={iconBtn('add')}>＋</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* preview */}
          <div style={{ background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Предпросмотр недели / цикла</div>
            <Preview d={editing} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={btn('#3B82F6')}>{saving ? 'Сохранение…' : '✓ Сохранить'}</button>
            {!isNew && editing.id && <button onClick={() => del(editing)} style={{ ...btn('transparent'), border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5' }}>Удалить</button>}
            <button onClick={cancel} style={{ ...btn('transparent'), border: '1px solid #1E3A5F', color: '#8FA3BD' }}>Отмена</button>
          </div>
        </div>
      )}

      {/* copy-day modal */}
      {copyFrom !== null && editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,12,24,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0F1E36', border: '1px solid #1E3A5F', borderRadius: 10, padding: 18, width: 360, maxHeight: '72vh', overflow: 'auto' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#E8EEF5', marginBottom: 4 }}>Копировать интервалы из «{dayLabel(editing, copyFrom)}»</div>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 10 }}>Выберите дни, в которые скопировать:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflow: 'auto' }}>
              {Array.from({ length: dayCount(editing) }).map((_, j) => j !== copyFrom && (
                <label key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#CBD5E1', padding: '4px 6px', cursor: 'pointer', borderRadius: 4 }}>
                  <input type="checkbox" checked={copyTo.includes(j)} onChange={() => toggleCopyTarget(j)} style={{ accentColor: '#3B82F6' }} />
                  {dayLabel(editing, j)}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={applyCopy} disabled={copyTo.length === 0} style={{ ...btn('#3B82F6'), opacity: copyTo.length === 0 ? 0.5 : 1 }}>Скопировать</button>
              <button onClick={() => setCopyFrom(null)} style={{ ...btn('transparent'), border: '1px solid #1E3A5F', color: '#8FA3BD' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
