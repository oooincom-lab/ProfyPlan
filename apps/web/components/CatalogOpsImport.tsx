'use client';
/**
 * Импорт операций из буфера: вставка таблицы (Excel/CSV), сопоставление колонок,
 * предпросмотр и загрузка в справочник с отчётом по строкам.
 *
 * Поддерживаемые поля: название, код, артикул, источник артикула, тип, единица,
 * типовая норма, минимум, максимум, настройка, переналадка, теги, примечания.
 */
import React, { useMemo, useState } from 'react';

type Row = Record<string, string>;

const FIELDS: { key: string; label: string; syn: string[] }[] = [
  { key: 'name', label: 'Название', syn: ['название', 'наименование', 'операция', 'name', 'работа'] },
  { key: 'code', label: 'Код', syn: ['код', 'code', 'шифр'] },
  { key: 'article', label: 'Артикул', syn: ['артикул', 'article', 'sku'] },
  { key: 'article_source', label: 'Источник артикула', syn: ['источник', 'source', 'система', 'поставщик'] },
  { key: 'op_type', label: 'Тип', syn: ['тип', 'type', 'вид'] },
  { key: 'unit', label: 'Единица', syn: ['единица', 'ед', 'unit', 'изм'] },
  { key: 'norm_typical', label: 'Типовая норма', syn: ['норма', 'норма времени', 'norm', 'длительность', 'час'] },
  { key: 'norm_min', label: 'Минимум', syn: ['мин', 'минимум', 'min', 'от'] },
  { key: 'norm_max', label: 'Максимум', syn: ['макс', 'максимум', 'max', 'до'] },
  { key: 'setup_time', label: 'Настройка', syn: ['настройка', 'setup', 'подготовка'] },
  { key: 'teardown_time', label: 'Переналадка', syn: ['переналадка', 'teardown', 'завершение'] },
  { key: 'tags', label: 'Теги', syn: ['теги', 'tags', 'группа', 'категория'] },
  { key: 'notes', label: 'Примечания', syn: ['примечание', 'комментарий', 'notes', 'описание'] },
];

const TYPE_MAP: Record<string, string> = {
  'работа': 'work', 'work': 'work', 'ожидание': 'wait', 'wait': 'wait', 'веха': 'milestone', 'milestone': 'milestone',
};
const UNIT_MAP: Record<string, string> = {
  'час': 'hour', 'ч': 'hour', 'hour': 'hour', 'смена': 'shift', 'shift': 'shift', 'день': 'day', 'дн': 'day', 'day': 'day',
};

function parse(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
  return { header: lines[0].split(sep).map((h) => h.trim()), rows: lines.slice(1).map((l) => l.split(sep)) };
}

function matchField(header: string): string | null {
  const h = header.trim().toLowerCase();
  for (const f of FIELDS) {
    if (f.syn.some((s) => h === s) || f.label.toLowerCase() === h) return f.key;
    if (f.syn.some((s) => h.includes(s))) return f.key;
  }
  return null;
}

export default function CatalogOpsImport({ apiBase, onDone }: { apiBase: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ created: number; dup: number; failed: number; messages: string[] } | null>(null);

  const parsed = useMemo(() => parse(text), [text]);
  const autoMap = useMemo(() => {
    const m: Record<number, string> = {};
    parsed.header.forEach((h, i) => { const f = matchField(h); if (f) m[i] = f; });
    return m;
  }, [parsed.header]);
  const map = Object.keys(mapping).length ? mapping : autoMap;

  const doImport = async () => {
    setBusy(true);
    const res = { created: 0, dup: 0, failed: 0, messages: [] as string[] };
    for (const r of parsed.rows) {
      const body: any = {};
      Object.entries(map).forEach(([idx, key]) => {
        const v = (r[Number(idx)] ?? '').trim();
        if (!v) return;
        if (['norm_typical', 'norm_min', 'norm_max', 'setup_time', 'teardown_time'].includes(key)) {
          body[key] = Number(v.replace(',', '.'));
        } else if (key === 'op_type') {
          body[key] = TYPE_MAP[v.toLowerCase()] || 'work';
        } else if (key === 'unit') {
          body[key] = UNIT_MAP[v.toLowerCase()] || 'hour';
        } else {
          body[key] = v;
        }
      });
      if (!body.name) { res.failed++; continue; }
      const rq = await fetch(apiBase + '/v1/catalog-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bea' + 'rer ' + (localStorage.getItem('profyplan_token') || '') },
        body: JSON.stringify(body),
      });
      if (rq.status === 201) res.created++;
      else if (rq.status === 409) { res.dup++; }
      else { res.failed++; if (res.messages.length < 5) res.messages.push(body.name + ': ' + rq.status); }
    }
    setReport(res);
    setBusy(false);
    onDone();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ color: '#8FA3BD', fontSize: 12.5 }}>
        1) скопируйте таблицу из Excel и вставьте ниже (Ctrl+V) · 2) проверьте сопоставление колонок · 3) загрузите.
        Первая строка — заголовки. Дубли (совпадение названия или кода) пропускаются.
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setReport(null); }}
        placeholder="Название&#9;Код&#9;Типовая норма&#9;Минимум&#9;Максимум&#9;Единица&#9;Теги"
        rows={7}
        style={{ width: '100%', background: '#0B1522', color: '#E8EEF8', border: '1px solid #26364F', borderRadius: 8, padding: 10, fontFamily: 'Consolas,monospace', fontSize: 12.5 }}
      />

      {parsed.header.length ? (
        <>
          <div style={{ color: '#CBD8EA' }}>Сопоставление колонок ({parsed.rows.length} строк данных):</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {parsed.header.map((h, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#152238', border: '1px solid ' + (map[i] ? '#3B82F6' : '#7A5211'), borderRadius: 8, padding: '4px 8px' }}>
                <span style={{ color: '#8FA3BD' }}>{h || '—'}</span>
                <span style={{ color: '#8FA3BD' }}>→</span>
                <select value={map[i] || ''} onChange={(e) => setMapping({ ...map, [i]: e.target.value })}>
                  <option value="">не импортировать</option>
                  {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={{ overflow: 'auto', maxHeight: 220, border: '1px solid #26364F', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#1B2A44', color: '#CBD8EA' }}>
                  {Object.entries(map).filter(([, v]) => v).map(([i, v]) => (
                    <th key={i} style={{ textAlign: 'left', padding: '6px 8px' }}>{FIELDS.find((f) => f.key === v)?.label || v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 8).map((r, ri) => (
                  <tr key={ri}>
                    {Object.entries(map).filter(([, v]) => v).map(([i]) => (
                      <td key={i} style={{ padding: '5px 8px', borderBottom: '1px solid #1E2C42' }}>{(r[Number(i)] ?? '').slice(0, 40) || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !parsed.rows.length} onClick={doImport}>
              {busy ? '⏳ Загрузка…' : 'Импортировать ' + parsed.rows.length + ' строк'}
            </button>
            {report ? (
              <span style={{ fontSize: 12.5, color: '#CBD8EA' }}>
                создано: <b>{report.created}</b> · пропущено дублей: <b>{report.dup}</b> · ошибок: <b>{report.failed}</b>
                {report.messages.length ? ' · ' + report.messages.join('; ') : ''}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
