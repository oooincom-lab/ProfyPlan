'use client';

import { useState, useEffect, type CSSProperties } from 'react';

const API = 'https://profyplan.ru/api/v1';

type DayType = 'work' | 'weekend' | 'holiday' | 'preholiday';
type Day = { date: string; day_type: DayType; hours: number | null };
type Calendar = {
  id?: string; country_code: string; year: number; name: string; days: Day[];
  source?: string; status?: string; last_error?: string | null; source_synced_at?: string | null;
};

// Официальные нерабочие праздничные дни РФ (ст. 112 ТК РФ), без переносов.
const RU_HOLIDAYS = new Set([
  '01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08',
  '02-23', '03-08', '05-01', '05-09', '06-12', '11-04',
]);

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const TYPE_LABEL: Record<DayType, string> = {
  work: 'Работа', weekend: 'Выходной', holiday: 'Праздник', preholiday: 'Предпраздничный',
};
const NEXT_TYPE: Record<DayType, DayType> = { work: 'weekend', weekend: 'holiday', holiday: 'preholiday', preholiday: 'work' };
const TYPE_COLOR: Record<DayType, string> = {
  work: 'rgba(59,130,246,.30)',
  weekend: 'rgba(148,163,184,.12)',
  holiday: 'rgba(239,68,68,.34)',
  preholiday: 'rgba(245,158,11,.32)',
};
const STATUS_LABEL: Record<string, string> = { ok: 'загружено', fallback: 'базовый', missing: 'нет', error: 'ошибка' };
const STATUS_COLOR: Record<string, string> = { ok: '#22D3EE', fallback: '#FBBF24', missing: '#94A3B8', error: '#F87171' };
const SRC_LABEL: Record<string, string> = { xmlcalendar: 'xmlcalendar.ru', base: 'базовая', excel: 'Excel', manual: 'вручную' };

const fmt = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

const prevDate = (key: string) => {
  const [y, m, dd] = key.split('-').map(Number);
  return fmt(new Date(Date.UTC(y, m - 1, dd - 1)));
};

function genDays(country: string, year: number): Day[] {
  const holidays = country === 'RU' ? RU_HOLIDAYS : new Set<string>();
  const map = new Map<string, Day>();
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    const key = fmt(d);
    const mmdd = key.slice(5);
    let type: DayType;
    if (holidays.has(mmdd)) type = 'holiday';
    else if (d.getUTCDay() === 0 || d.getUTCDay() === 6) type = 'weekend';
    else type = 'work';
    map.set(key, { date: key, day_type: type, hours: type === 'work' ? 8 : null });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  for (const [key, day] of map) {
    if (day.day_type === 'holiday') {
      const p = map.get(prevDate(key));
      if (p && p.day_type === 'work') { p.day_type = 'preholiday'; p.hours = 7; }
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function normalizeDate(s: string): string | null {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseImport(text: string): Day[] {
  const typeMap: Record<string, DayType> = {
    'работа': 'work', 'раб': 'work', 'work': 'work', 'р': 'work',
    'выходной': 'weekend', 'вых': 'weekend', 'weekend': 'weekend', 'в': 'weekend',
    'праздник': 'holiday', 'празд': 'holiday', 'holiday': 'holiday', 'п': 'holiday',
    'предпраздничный': 'preholiday', 'предпразд': 'preholiday', 'preholiday': 'preholiday',
  };
  const out: Day[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\t;,]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const date = normalizeDate(parts[0]);
    if (!date) continue;
    const type = typeMap[parts[1].toLowerCase()] || 'work';
    let hours: number | null = parts.length > 2 ? parseFloat(parts[2].replace(',', '.')) : null;
    if (hours === null || isNaN(hours)) hours = type === 'work' ? 8 : type === 'preholiday' ? 7 : null;
    out.push({ date, day_type: type, hours });
  }
  return out;
}

export default function ProductionCalendarManager() {
  const [list, setList] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [xmlBusy, setXmlBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<Day[]>([]);

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
    setLoading(true); setError(null);
    try { setList(await af('/production-calendars/')); } catch (e: any) { setError(String(e)); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const stats = (c: Calendar) => {
    const cnt = (t: DayType) => c.days.filter(d => d.day_type === t).length;
    const hours = c.days.reduce((a, d) => a + (d.hours || 0), 0);
    return { work: cnt('work'), weekend: cnt('weekend'), holiday: cnt('holiday'), pre: cnt('preholiday'), hours };
  };

  const startNew = () => {
    const year = new Date().getFullYear();
    setEditing({ country_code: 'RU', year, name: `РФ ${year}`, days: genDays('RU', year) });
    setIsNew(true);
  };
  const startEdit = (c: Calendar) => {
    setEditing({ ...c, days: c.days.map(d => ({ ...d })) });
    setIsNew(false);
  };
  const cancel = () => { setEditing(null); setIsNew(false); setImportOpen(false); };

  const setCountry = (cc: string) => setEditing(e => e ? { ...e, country_code: cc.toUpperCase(), days: genDays(cc.toUpperCase(), e.year) } : e);
  const setYear = (y: number) => setEditing(e => e ? { ...e, year: y, days: genDays(e.country_code, y) } : e);
  const regenerate = () => setEditing(e => e ? { ...e, days: genDays(e.country_code, e.year) } : e);

  const toggleDay = (key: string) => {
    setEditing(e => !e ? e : ({
      ...e,
      days: e.days.map(d => {
        if (d.date !== key) return d;
        const nt = NEXT_TYPE[d.day_type];
        return { ...d, day_type: nt, hours: nt === 'work' ? 8 : nt === 'preholiday' ? 7 : null };
      }),
    }));
  };

  const parsePreview = () => { setImportPreview(parseImport(importText)); };
  const applyImport = () => {
    if (!editing) return;
    const map = new Map(editing.days.map(d => [d.date, d]));
    for (const d of importPreview) map.set(d.date, d);
    setEditing({ ...editing, days: Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1)) });
    setImportOpen(false); setImportText(''); setImportPreview([]);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.country_code || editing.country_code.length !== 2) { setError('Укажите код страны (2 буквы, напр. RU)'); return; }
    if (!editing.name.trim()) { setError('Укажите название календаря'); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        country_code: editing.country_code.toUpperCase(),
        year: editing.year,
        name: editing.name.trim(),
        days: editing.days.map(d => ({ date: d.date, day_type: d.day_type, hours: d.hours })),
      };
      if (isNew) await af('/production-calendars/', { method: 'POST', body: JSON.stringify(body) });
      else await af(`/production-calendars/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null); setIsNew(false);
      await load();
    } catch (e: any) { setError(String(e)); }
    setSaving(false);
  };

  const del = async (c: Calendar) => {
    if (!c.id) return;
    if (!confirm(`Удалить календарь «${c.name}»?`)) return;
    try { await af(`/production-calendars/${c.id}`, { method: 'DELETE' }); await load(); } catch (e: any) { setError(String(e)); }
  };

  const preset = async () => {
    setPresetBusy(true); setError(null);
    try {
      const year = new Date().getFullYear();
      for (const cc of ['RU', 'BY', 'KZ'] as const) {
        await af('/production-calendars/seed', { method: 'POST', body: JSON.stringify({ country_code: cc, year }) });
      }
      await load();
    } catch (e: any) { setError(String(e)); }
    setPresetBusy(false);
  };

  const importXml = async (cc?: string, year?: number) => {
    const y = year ?? new Date().getFullYear();
    const countries: readonly string[] = cc ? [cc] : ['RU', 'BY', 'KZ'];
    setXmlBusy(true); setError(null); setNotice(null);
    const results: string[] = [];
    for (const c of countries) {
      try {
        const r = await af('/production-calendars/import-xmlcalendar', { method: 'POST', body: JSON.stringify({ country_code: c, year: y }) });
        results.push(`${c}: ✓ ${r.status === 'ok' ? 'загружено' : r.status}`);
        if (cc && c === cc) {
          setEditing(e => e ? { ...e, days: r.days.map((d: any) => ({ date: d.date, day_type: d.day_type, hours: d.hours })) } : e);
        }
      } catch (e: any) {
        results.push(`${c}: ✗ ${String(e)}`);
      }
    }
    setNotice(results.join(' · '));
    await load();
    setXmlBusy(false);
  };

  // ── year grid ──
  const MonthGrid = ({ year, month, days }: { year: number; month: number; days: Day[] }) => {
    const map = new Map(days.map(d => [d.date, d]));
    const first = new Date(Date.UTC(year, month - 1, 1));
    const startDow = (first.getUTCDay() + 6) % 7; // Пн=0
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return (
      <div style={{ background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 8, padding: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#8FA3BD', marginBottom: 5 }}>{MONTHS[month - 1]}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {DOW.map(w => <div key={w} style={{ fontSize: 8.5, color: '#5A7090', textAlign: 'center' }}>{w}</div>)}
          {cells.map((dd, i) => {
            if (dd === null) return <div key={i} />;
            const key = `${year}-${String(month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
            const day = map.get(key);
            const type = day?.day_type || 'weekend';
            return (
              <button
                key={i}
                onClick={() => toggleDay(key)}
                title={`${key} — ${TYPE_LABEL[type]}${day?.hours ? ` (${day.hours}ч)` : ''}`}
                style={{
                  height: 19, fontSize: 9.5, color: '#D7E0EA', background: TYPE_COLOR[type],
                  border: '1px solid transparent', borderRadius: 3, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}
              >
                {dd}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const input = (style?: CSSProperties): CSSProperties => ({ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '6px 9px', fontSize: 13, ...style });
  const btn = (c: string): CSSProperties => ({ background: c, border: 'none', color: '#fff', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
  const ghost = (): CSSProperties => ({ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });

  return (
    <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>📅 Производственные календари</span>
        {!editing && (
          <>
            <button onClick={startNew} style={btn('#3B82F6')}>＋ Новый календарь</button>
            <button onClick={preset} disabled={presetBusy} style={ghost()}>{presetBusy ? 'Загрузка…' : '⚡ Предзагрузить РФ/РБ/РК'}</button>
            <button onClick={() => importXml()} disabled={xmlBusy} style={ghost()}>{xmlBusy ? 'Загрузка…' : '⬇ Загрузить из xmlcalendar.ru'}</button>
          </>
        )}
      </div>

      {error && <div style={{ color: '#FCA5A5', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ color: '#8FA3BD', fontSize: 12.5, marginBottom: 12 }}>{notice}</div>}

      {!editing && (
        loading ? <div style={{ color: '#5A7090', fontSize: 13 }}>Загрузка…</div> : (
          list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#5A7090' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: '#8FA3BD' }}>Календарей пока нет</div>
              <div style={{ fontSize: 12.5 }}>Нажмите «⚡ Предзагрузить РФ/РБ/РК» или создайте календарь вручную.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map(c => {
                const st = stats(c);
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }} onClick={() => startEdit(c)}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[c.status || 'ok'], flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#E8EEF5' }}>{c.name}</div>
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: STATUS_COLOR[c.status || 'ok'] + '26', color: STATUS_COLOR[c.status || 'ok'], border: '1px solid ' + STATUS_COLOR[c.status || 'ok'] + '55' }}>
                          {SRC_LABEL[c.source || 'base']} · {STATUS_LABEL[c.status || 'ok']}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#5A7090' }}>
                        {c.country_code} · {c.year} · работа {st.work} · выходной {st.weekend} · праздник {st.holiday} · предпраздн. {st.pre} · {st.hours}ч
                      </div>
                      {c.last_error && <div style={{ fontSize: 10.5, color: '#FCA5A5' }}>⚠ {c.last_error}</div>}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); del(c); }} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer' }}>Удалить</button>
                  </div>
                );
              })}
            </div>
          )
        )
      )}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.05em' }}>Страна (код)</span>
              <input value={editing.country_code} maxLength={2} onChange={e => setCountry(e.target.value)} style={{ ...input(), width: 70, textTransform: 'uppercase' }} placeholder="RU" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Год</span>
              <input type="number" min={2000} max={2100} value={editing.year} onChange={e => setYear(parseInt(e.target.value) || editing.year)} style={{ ...input(), width: 90 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Название</span>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={input()} placeholder="РФ 2026" />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', flex: 1 }}>
              Клик по дню переключает тип: <span style={{ color: '#60A5FA' }}>работа</span> → <span style={{ color: '#94A3B8' }}>выходной</span> → <span style={{ color: '#F87171' }}>праздник</span> → <span style={{ color: '#FBBF24' }}>предпраздничный</span>.
            </div>
            <button onClick={() => setImportOpen(true)} style={ghost()}>📥 Импорт из Excel/буфера</button>
            <button onClick={() => importXml(editing.country_code, editing.year)} disabled={xmlBusy} style={ghost()}>⬇ Загрузить из xmlcalendar.ru</button>
            <button onClick={regenerate} style={ghost()}>⚡ Сгенерировать базовый</button>
            <button onClick={save} disabled={saving} style={btn('#3B82F6')}>{saving ? 'Сохранение…' : '✓ Сохранить'}</button>
            {!isNew && editing.id && <button onClick={() => del(editing)} style={{ ...btn('transparent'), border: '1px solid rgba(239,68,68,.4)', color: '#FCA5A5' }}>Удалить</button>}
            <button onClick={cancel} style={ghost()}>Отмена</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <MonthGrid key={i} year={editing.year} month={i + 1} days={editing.days} />
            ))}
          </div>
        </div>
      )}

      {/* import modal */}
      {importOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,12,24,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#0F1E36', border: '1px solid #1E3A5F', borderRadius: 10, padding: 18, width: 520, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#E8EEF5', marginBottom: 6 }}>Импорт дней из Excel / буфера</div>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 10 }}>
              Вставьте строки в формате <b>дата · тип · часы</b> (разделитель — таб, запятая или точка с запятой).<br />
              Тип: <i>работа / выходной / праздник / предпраздничный</i> (или work/weekend/holiday/preholiday). Часы необязательны.
            </div>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'2026-05-01\tпраздник\n2026-05-08\tпредпраздничный\t7\n2026-05-11\tработа\t8'}
              style={{ ...input(), width: '100%', minHeight: 130, fontFamily: 'monospace', fontSize: 11.5, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={parsePreview} style={ghost()}>Проверить</button>
              <button onClick={applyImport} disabled={importPreview.length === 0} style={{ ...btn('#3B82F6'), opacity: importPreview.length === 0 ? 0.5 : 1 }}>Применить ({importPreview.length})</button>
              <button onClick={() => { setImportOpen(false); setImportText(''); setImportPreview([]); }} style={ghost()}>Отмена</button>
            </div>
            {importPreview.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#8FA3BD', maxHeight: 140, overflow: 'auto' }}>
                {importPreview.slice(0, 30).map((d, i) => (
                  <div key={i}>{d.date} · {TYPE_LABEL[d.day_type]}{d.hours ? ` · ${d.hours}ч` : ''}</div>
                ))}
                {importPreview.length > 30 && <div>… и ещё {importPreview.length - 30}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
