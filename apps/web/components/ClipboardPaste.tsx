'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ── Nomenclature match type ──
type NomenclatureMatch = { id: string; name: string; code: string | null; article: string | null };
type NomenclatureSearchFn = (query: string) => Promise<NomenclatureMatch[]>;

// ── Column synonym dictionary ──
const FIELD_SYNONYMS: Record<string, string[]> = {
  ext_id: ['номер', 'id', 'код', '№', 'артикул', 'order', 'order_id', 'ext_id', 'заказ'],
  specification_name: ['название', 'продукт', 'изделие', 'номенклатура', 'name', 'product', 'spec', 'specification_name', 'продукция'],
  quantity: ['кол-во', 'количество', 'штук', 'объём', 'qty', 'quantity', 'amount', 'count', 'число'],
  unit: ['ед', 'единица', 'unit', 'шт', 'pcs', 'кг', 'м', 'изм'],
  client: ['клиент', 'заказчик', 'контрагент', 'customer', 'client', 'покупатель'],
  start_date: ['старт', 'начало', 'с', 'от', 'start', 'begin', 'from', 'начать', 'дата начала'],
  due_date: ['финиш', 'конец', 'до', 'по', 'end', 'finish', 'to', 'due', 'окончание', 'дата окончания'],
  priority: ['приоритет', 'важность', 'priority', 'срочность', 'срочно'],
  notes: ['примечание', 'комментарий', 'notes', 'comment', 'описание', 'заметки'],
};

const FIELD_LABELS: Record<string, string> = {
  ext_id: 'ID заказа', specification_name: 'Продукт', quantity: 'Кол-во',
  unit: 'Ед. изм.', client: 'Клиент', start_date: 'Старт', due_date: 'Финиш',
  priority: 'Приоритет', notes: 'Примечание',
};

function guessField(header: string): string | null {
  const h = header.toLowerCase().trim();
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    if (synonyms.some(s => h === s || h.startsWith(s) || s.startsWith(h))) return field;
  }
  return null;
}

function parseTSV(text: string): string[][] {
  return text.split('\n').filter(r => r.trim()).map(r => r.split('\t').map(c => c.trim()));
}

// ── Fuzzy match scoring ──
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().replace(/[^a-zа-яё0-9]/g, '').trim();
  const t = target.toLowerCase().replace(/[^a-zа-яё0-9]/g, '').trim();
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (t.includes(q)) return 90;
  if (q.includes(t)) return 80;

  // Word-level matching: each query word must appear as a prefix/substring in target
  const qWords = q.split(/\s+/).filter(Boolean);
  const tWords = t.split(/\s+/).filter(Boolean);
  if (qWords.length === 0) return 0;

  let matched = 0;
  for (const qw of qWords) {
    if (tWords.some(tw => tw.startsWith(qw) || qw.startsWith(tw) || tw.includes(qw) || qw.includes(tw))) {
      matched++;
    }
  }
  return Math.round((matched / qWords.length) * 75); // max 75 for word match since not exact
}

// ── Batch lookup: unique product names → nomenclature matches ──
async function lookupNomenclature(
  rows: string[][],
  specColIdx: number | null,
  searchFn: NomenclatureSearchFn,
): Promise<Map<string, NomenclatureMatch | null>> {
  const cache = new Map<string, NomenclatureMatch | null>();
  if (specColIdx === null) return cache;

  const unique = [...new Set(rows.map(r => r[specColIdx] || '').filter(Boolean))];
  await Promise.all(unique.map(async (name) => {
    try {
      const results = await searchFn(name);
      if (results.length > 0) {
        // Score all results, pick the best
        let best = results[0];
        let bestScore = fuzzyScore(name, best.name);
        for (const r of results) {
          const s = fuzzyScore(name, r.name);
          if (s > bestScore) { best = r; bestScore = s; }
        }
        // Only return if score >= 40
        if (bestScore >= 40) {
          cache.set(name, best);
        } else {
          cache.set(name, null);
        }
      } else {
        cache.set(name, null);
      }
    } catch {
      cache.set(name, null);
    }
  }));

  return cache;
}

export default function ClipboardPaste({
  onApply,
  nomenclatureSearchFn,
}: {
  onApply: (rows: Record<string, string>[], matches: Record<string, { id: string; name: string } | null>) => void;
  nomenclatureSearchFn?: NomenclatureSearchFn;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [pasted, setPasted] = useState(false);
  const [nomenMatches, setNomenMatches] = useState<Map<string, NomenclatureMatch | null>>(new Map());
  const [matchLoading, setMatchLoading] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;

    const data = parseTSV(text);
    if (data.length < 2) return;

    const hdrs = data[0];
    const body = data.slice(1);
    const m: Record<number, string> = {};
    hdrs.forEach((h, i) => {
      const guessed = guessField(h);
      if (guessed) m[i] = guessed;
    });

    setHeaders(hdrs);
    setRows(body);
    setMapping(m);
    setPasted(true);
    setNomenMatches(new Map());
  }, []);

  // Auto-lookup nomenclature when mapping changes (debounced)
  useEffect(() => {
    if (!nomenclatureSearchFn || !pasted) return;

    const specColIdx = Object.entries(mapping).find(([, field]) => field === 'specification_name');
    if (!specColIdx) { setNomenMatches(new Map()); return; }

    const colIdx = parseInt(specColIdx[0]);
    setMatchLoading(true);
    const timer = setTimeout(async () => {
      const matches = await lookupNomenclature(rows, colIdx, nomenclatureSearchFn);
      setNomenMatches(matches);
      setMatchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [mapping, rows, pasted, nomenclatureSearchFn]);

  const setField = (colIdx: number, field: string) => {
    setMapping(prev => {
      const next = { ...prev };
      if (field === '__skip__') {
        delete next[colIdx];
      } else {
        next[colIdx] = field;
      }
      return next;
    });
  };

  const handleApply = () => {
    const result = rows.map(row => {
      const obj: Record<string, string> = {};
      Object.entries(mapping).forEach(([colIdx, field]) => {
        obj[field] = row[parseInt(colIdx)] || '';
      });
      return obj;
    });
    // Build match map: specification_name → { id, name } | null
    const matches: Record<string, { id: string; name: string } | null> = {};
    nomenMatches.forEach((match, name) => {
      matches[name] = match ? { id: match.id, name: match.name } : null;
    });
    onApply(result, matches);
  };

  const availableFields = Object.keys(FIELD_LABELS);
  const matchCount = [...nomenMatches.values()].filter(Boolean).length;
  const uniqueNames = [...new Set(
    Object.entries(mapping)
      .filter(([, field]) => field === 'specification_name')
      .flatMap(([colIdx]) => rows.map(r => r[parseInt(colIdx)] || '').filter(Boolean))
  )];

  return (
    <div>
      <div
        ref={areaRef}
        onPaste={handlePaste}
        tabIndex={0}
        style={{
          border: '2px dashed #1E3252', borderRadius: 12, padding: pasted ? 20 : 40,
          textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
          background: pasted ? '#0A1628' : 'transparent',
          borderColor: pasted ? '#2A4060' : '#1E3252',
          outline: 'none',
        }}
        onFocus={e => e.currentTarget.style.borderColor = '#3B82F6'}
        onBlur={e => e.currentTarget.style.borderColor = pasted ? '#2A4060' : '#1E3252'}
      >
        {!pasted ? (
          <div style={{ color: '#5A7090' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Вставьте данные из таблицы</div>
            <div style={{ fontSize: 13 }}>Скопируйте таблицу в Excel (Ctrl+C), затем нажмите сюда и вставьте (Ctrl+V)</div>
            <div style={{ fontSize: 11, marginTop: 8, color: '#374151' }}>Первая строка будет использована как заголовки</div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 12, fontSize: 13, color: '#5A7090' }}>
              Вставлено: {rows.length} строк × {headers.length} колонок. Проверьте сопоставление полей.
            </div>

            {/* Column mapping selectors */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              {headers.map((h, i) => {
                const mapped = mapping[i];
                return (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{
                      fontSize: 11, color: mapped ? '#60A5FA' : '#EF4444',
                      fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4,
                    }}>
                      {mapped ? FIELD_LABELS[mapped] : '?'}
                    </div>
                    <select
                      value={mapped || '__skip__'}
                      onChange={e => setField(i, e.target.value)}
                      style={{
                        padding: '4px 8px', background: '#0A1628', border: `1px solid ${mapped ? '#1E3252' : '#7f1d1d'}`,
                        borderRadius: 6, color: '#E8EEF5', fontSize: 12, fontFamily: 'Inter, sans-serif',
                      }}>
                      {!mapped && <option value="__skip__">— выберите поле —</option>}
                      {availableFields.map(f => (
                        <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                      ))}
                      <option value="__skip__">Пропустить</option>
                    </select>
                    <div style={{ fontSize: 10, color: '#374151', marginTop: 2, fontFamily: "'IBM Plex Mono', monospace" }}>
                      «{h.length > 12 ? h.slice(0, 12) + '…' : h}»
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Nomenclature match summary */}
            {nomenclatureSearchFn && matchLoading && (
              <div style={{ fontSize: 12, color: '#F59E0B', marginBottom: 8, textAlign: 'center' }}>
                🔍 Сопоставление с номенклатурой...
              </div>
            )}
            {nomenclatureSearchFn && !matchLoading && matchCount > 0 && (
              <div style={{
                fontSize: 12, color: '#10B981', marginBottom: 8, textAlign: 'center',
                background: 'rgba(16,185,129,0.08)', borderRadius: 6, padding: '4px 12px', display: 'inline-block',
              }}>
                ✓ Сопоставлено: {matchCount} из {uniqueNames.length} уникальных продуктов
              </div>
            )}
            {nomenclatureSearchFn && !matchLoading && matchCount === 0 && uniqueNames.length > 0 && (
              <div style={{
                fontSize: 12, color: '#F59E0B', marginBottom: 8, textAlign: 'center',
                background: 'rgba(245,158,11,0.08)', borderRadius: 6, padding: '4px 12px', display: 'inline-block',
              }}>
                ⚠ Нет совпадений в номенклатуре для {uniqueNames.length} продуктов
              </div>
            )}

            {/* Preview table */}
            <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto', textAlign: 'left' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} style={{
                        padding: '6px 10px', color: '#60A5FA', fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid #1E3252',
                        whiteSpace: 'nowrap',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => {
                        const isSpecName = mapping[ci] === 'specification_name';
                        const match = isSpecName && cell ? nomenMatches.get(cell) : undefined;
                        const hasMatch = match && match !== undefined;
                        return (
                          <td key={ci} style={{
                            padding: '4px 10px', color: '#B0C4DE', borderBottom: '1px solid #162844', whiteSpace: 'nowrap',
                          }}>
                            {cell}
                            {isSpecName && nomenclatureSearchFn && cell && match !== undefined && (
                              <span style={{
                                marginLeft: 6, fontSize: 10,
                                color: match ? '#10B981' : '#EF4444',
                              }} title={match ? `✓ ${match.name} (${match.code || '—'})` : '✗ Не найдено в номенклатуре'}>
                                {match ? '✓' : '✗'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 10 && (
                <div style={{ textAlign: 'center', padding: 8, color: '#5A7090', fontSize: 12 }}>
                  ... и ещё {rows.length - 10} строк
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={() => { setPasted(false); setRows([]); setHeaders([]); setMapping({}); setNomenMatches(new Map()); }}
                className="btn btn-sm" style={{ marginRight: 8, background: 'transparent', border: '1px solid #2A4060', color: '#B0C4DE', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12 }}>
                ✕ Очистить
              </button>
              <button onClick={handleApply}
                disabled={Object.keys(mapping).length === 0}
                style={{
                  background: Object.keys(mapping).length === 0 ? '#1E3252' : 'linear-gradient(135deg, #3B82F6, #2563EB)',
                  color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}>
                ✓ Сохранить и продолжить ({rows.length} стр.)
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#374151', textAlign: 'center' }}>
        💡 Поддерживаются колонки: {availableFields.map(f => FIELD_LABELS[f]).join(', ')}
        {nomenclatureSearchFn && ' · ⚡ с автосопоставлением номенклатуры'}
      </div>
    </div>
  );
}
