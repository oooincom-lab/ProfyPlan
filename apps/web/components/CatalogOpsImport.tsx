'use client';
/**
 * Импорт операций из буфера: вставка таблицы (Excel/CSV), сопоставление колонок,
 * проверка совпадений с существующими записями и предпросмотр с решением по каждой строке.
 *
 * Решение по строке: «создать» / «привязать к существующей» / «пропустить».
 * Привязка не создаёт дубль, а обновляет выбранную запись данными из строки.
 */
import React, { useMemo, useState } from 'react';

type Row = Record<string, string>;
type Decision = { action: 'create' | 'bind' | 'skip'; targetId?: string; targetName?: string };

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
const NUM_FIELDS = ['norm_typical', 'norm_min', 'norm_max', 'setup_time', 'teardown_time'];

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
  const [matching, setMatching] = useState(false);
  const [cands, setCands] = useState<Record<number, any[]>>({});
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [report, setReport] = useState<{ created: number; bound: number; skipped: number; failed: number; messages: string[] } | null>(null);

  const parsed = useMemo(() => parse(text), [text]);
  const autoMap = useMemo(() => {
    const m: Record<number, string> = {};
    parsed.header.forEach((h, i) => { const f = matchField(h); if (f) m[i] = f; });
    return m;
  }, [parsed.header]);
  const map = Object.keys(mapping).length ? mapping : autoMap;
  const nameIdx = Object.entries(map).find(([, v]) => v === 'name')?.[0];
  const auth = () => ({ 'Content-Type': 'application/json', Authorization: '***' + 'rer ' + (localStorage.getItem('profyplan_token') || '') });

  const rowBody = (r: string[]): any => {
    const body: any = {};
    Object.entries(map).forEach(([idx, key]) => {
      const v = (r[Number(idx)] ?? '').trim();
      if (!v) return;
      if (NUM_FIELDS.includes(key)) body[key] = Number(v.replace(',', '.'));
      else if (key === 'op_type') body[key] = TYPE_MAP[v.toLowerCase()] || 'work';
      else if (key === 'unit') body[key] = UNIT_MAP[v.toLowerCase()] || 'hour';
      else body[key] = v;
    });
    return body;
  };

  /** Ищем совпадения по каждой строке и заранее расставляем решения. */
  const checkMatches = async () => {
    setMatching(true);
    const found: Record<number, any[]> = {};
    const dec: Record<number, Decision> = {};
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const nm = nameIdx != null ? (r[Number(nameIdx)] || '').trim() : '';
      if (!nm) { dec[i] = { action: 'skip' }; continue; }
      let list: any[] = [];
      try {
        const q = encodeURIComponent(nm);
        const rq = await fetch(apiBase + '/v1/catalog-operations/similar?name=' + q + '&q=' + q + '&limit=5', { headers: auth() });
        if (rq.ok) {
          const j = await rq.json();
          list = Array.isArray(j) ? j : (j.items || j.similar || []);
        }
      } catch { /* нет связи — работаем без подсказок */ }
      found[i] = list;
      dec[i] = list.length ? { action: 'bind', targetId: list[0].id, targetName: list[0].name } : { action: 'create' };
    }
    setCands(found);
    setDecisions(dec);
    setMatching(false);
  };

  const doImport = async () => {
    setBusy(true);
    const res = { created: 0, bound: 0, skipped: 0, failed: 0, messages: [] as string[] };
    for (let i = 0; i < parsed.rows.length; i++) {
      const body = rowBody(parsed.rows[i]);
      const d: Decision = decisions[i] || (body.name ? { action: 'create' } : { action: 'skip' });
      if (!body.name || d.action === 'skip') { res.skipped++; continue; }
      try {
        if (d.action === 'bind' && d.targetId) {
          const rq = await fetch(apiBase + '/v1/catalog-operations/' + d.targetId, { method: 'PATCH', headers: auth(), body: JSON.stringify(body) });
          if (rq.ok || rq.status === 200) res.bound++;
          else { res.failed++; if (res.messages.length < 5) res.messages.push(body.name + ': привязка ' + rq.status); }
        } else {
          const rq = await fetch(apiBase + '/v1/catalog-operations', { method: 'POST', headers: auth(), body: JSON.stringify(body) });
          if (rq.status === 201) res.created++;
          else if (rq.status === 409) { res.skipped++; }
          else { res.failed++; if (res.messages.length < 5) res.messages.push(body.name + ': ' + rq.status); }
        }
      } catch (e: any) {
        res.failed++;
        if (res.messages.length < 5) res.messages.push(body.name + ': ' + String(e).slice(0, 60));
      }
    }
    setReport(res);
    setBusy(false);
    onDone();
  };

  const decOf = (i: number): Decision => decisions[i] || { action: 'create' };
  const setDec = (i: number, d: Decision) => setDecisions({ ...decisions, [i]: d });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ color: '#8FA3BD', fontSize: 12.5 }}>
        1) скопируйте таблицу из Excel и вставьте ниже (Ctrl+V) · 2) проверьте сопоставление колонок ·
        3) нажмите «Проверить совпадения» и выберите решение по каждой строке · 4) загрузите.
        Первая строка — заголовки.
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setReport(null); setCands({}); setDecisions({}); }}
        placeholder="Название&#9;Код&#9;Типовая норма&#9;Минимум&#9;Максимум&#9;Единица&#9;Теги"
        rows={6}
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

          <div style={{ overflow: 'auto', maxHeight: 300, border: '1px solid #26364F', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#1B2A44', color: '#CBD8EA' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', width: 40 }}>#</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Название из файла</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Норма</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', width: 170 }}>Решение</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Совпадение</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 40).map((r, ri) => {
                  const nm = nameIdx != null ? (r[Number(nameIdx)] || '') : '';
                  const d = decOf(ri);
                  const list = cands[ri] || [];
                  const normIdx = Object.entries(map).find(([, v]) => v === 'norm_typical')?.[0];
                  const col = d.action === 'skip' ? '#94A3B8' : d.action === 'bind' ? '#FBBF24' : '#4ADE80';
                  return (
                    <tr key={ri}>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #1E2C42', color: '#5A7090' }}>{ri + 1}</td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #1E2C42' }}>{(nm || '—').slice(0, 44)}</td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #1E2C42' }}>{(normIdx != null ? (r[Number(normIdx)] || '—') : '—').slice(0, 12)}</td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #1E2C42' }}>
                        <select value={d.action} onChange={(e) => setDec(ri, { action: e.target.value as any, targetId: d.targetId, targetName: d.targetName })}
                          style={{ background: 'rgba(0,0,0,.25)', color: col, border: '1px solid #26364F', borderRadius: 6, fontSize: 11.5, padding: '2px 4px', fontWeight: 600 }}>
                          <option value="create">Создать</option>
                          <option value="bind" disabled={!list.length}>Привязать{list.length ? '' : ' (нет совпадений)'}</option>
                          <option value="skip">Пропустить</option>
                        </select>
                        {d.action === 'bind' && list.length > 1 ? (
                          <select value={d.targetId} onChange={(e) => {
                            const c = list.find((x) => x.id === e.target.value);
                            setDec(ri, { action: 'bind', targetId: e.target.value, targetName: c?.name });
                          }} style={{ marginLeft: 6, fontSize: 11, maxWidth: 150 }}>
                            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : null}
                      </td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #1E2C42', color: '#8FA3BD' }}>
                        {list.length ? (list[0].name || '').slice(0, 40) : (cands[ri] ? 'не найдено — будет создана' : 'не проверялось')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" disabled={matching || busy || !parsed.rows.length} onClick={checkMatches}>
              {matching ? '⏳ Поиск совпадений…' : '🔍 Проверить совпадения'}
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy || !parsed.rows.length} onClick={doImport}>
              {busy ? '⏳ Загрузка…' : 'Загрузить ' + parsed.rows.length + ' строк'}
            </button>
            {report ? (
              <span style={{ fontSize: 12.5, color: '#CBD8EA' }}>
                создано: <b>{report.created}</b> · привязано: <b>{report.bound}</b> · пропущено: <b>{report.skipped}</b> · ошибок: <b>{report.failed}</b>
                {report.messages.length ? ' · ' + report.messages.join('; ') : ''}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
