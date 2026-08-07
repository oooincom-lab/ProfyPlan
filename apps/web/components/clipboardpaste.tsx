'use client';

import { useState, useCallback, useRef } from 'react';

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

export default function ClipboardPaste({ onApply }: { onApply: (rows: Record<string, string>[]) => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [pasted, setPasted] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;

    const data = parseTSV(text);
    if (data.length < 2) return; // need header + at least 1 row

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
  }, []);

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
    onApply(result);
  };

  const availableFields = Object.keys(FIELD_LABELS);

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
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '4px 10px', color: '#B0C4DE', borderBottom: '1px solid #162844', whiteSpace: 'nowrap' }}>
                          {cell}
                        </td>
                      ))}
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
              <button onClick={() => { setPasted(false); setRows([]); setHeaders([]); setMapping({}); }}
                className="btn btn-sm" style={{ marginRight: 8, background: 'transparent', border: '1px solid #2A4060', color: '#B0C4DE', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12 }}>
                ✕ Очистить
              </button>
              <button onClick={handleApply}
                className="btn btn-sm"
                disabled={Object.keys(mapping).length === 0}
                style={{
                  background: Object.keys(mapping).length === 0 ? '#1E3252' : 'linear-gradient(135deg, #3B82F6, #2563EB)',
                  color: 'white', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}>
                ✓ Применить ({rows.length} строк)
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#374151', textAlign: 'center' }}>
        💡 Поддерживаются колонки: {availableFields.map(f => FIELD_LABELS[f]).join(', ')}
      </div>
    </div>
  );
}
