'use client';

import { useState, useEffect, useRef } from 'react';

type ColumnDef = { key: string; label: string };
type SynonymMap = Record<string, string[]>;  // key -> синонимы
type MatchResult = { header: string; field: string | null; confidence: number; values: string[] };

type Props = {
  entity: string;
  columns: ColumnDef[];
  synonyms: SynonymMap;
  apiBase: string;
  onImport: (rows: Record<string, string>[]) => Promise<void>;
  onClose: () => void;
};

const TOKEN = () => typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
const H = () => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = TOKEN();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
};

export default function DataImport({ entity, columns, synonyms, apiBase, onImport, onClose }: Props) {
  const [mode, setMode] = useState<'clipboard' | 'manual'>('clipboard');
  const [rawText, setRawText] = useState('');
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(() => {
    if (typeof window === 'undefined') return { threshold: 50, fuzzy: false, substring: true, synonyms: true };
    const s = localStorage.getItem('dataimport_settings_' + entity);
    return s ? JSON.parse(s) : { threshold: 50, fuzzy: false, substring: true, synonyms: true };
  });
  const [showSettings, setShowSettings] = useState(false);

  // Normalize text for matching
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/g, '').trim();

  // Parse TSV/CSV
  const parse = (text: string): string[][] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    // Detect delimiter: tab or comma or semicolon
    const sep = lines[0].split('\t').length > 1 ? '\t'
      : lines[0].split(';').length > 1 ? ';'
      : ',';

    return lines.map(l => l.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim()));
  };

  // Match headers to fields
  const matchHeaders = (headers: string[]): MatchResult[] => {
    return headers.map(h => {
      const hn = norm(h);
      if (!hn) return { header: h, field: null, confidence: 0, values: [] };

      // 1. Exact canonical match
      for (const c of columns) {
        if (norm(c.key) === hn || norm(c.label) === hn) return { header: h, field: c.key, confidence: 100, values: [] };
      }

      // 2. Synonym match
      if (settings.synonyms) {
        for (const [key, syns] of Object.entries(synonyms)) {
          if (syns.some(s => norm(s) === hn)) return { header: h, field: key, confidence: 95, values: [] };
        }
      }

      // 3. Substring
      if (settings.substring) {
        for (const [key, syns] of Object.entries(synonyms)) {
          for (const s of syns) {
            if (hn.includes(norm(s)) || norm(s).includes(hn)) return { header: h, field: key, confidence: 70, values: [] };
          }
        }
        for (const c of columns) {
          if (hn.includes(norm(c.key)) || norm(c.label).toLowerCase().replace(/[^a-zа-яё0-9]/g, '') === hn) return { header: h, field: c.key, confidence: 60, values: [] };
        }
      }

      return { header: h, field: null, confidence: 0, values: [] };
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    setRawText(text);

    const grid = parse(text);
    if (grid.length < 2) return;

    const headers = grid[0];
    const dataRows = grid.slice(1);
    const m = matchHeaders(headers);

    // Collect sample values for preview
    m.forEach((match, i) => {
      match.values = dataRows.slice(0, 3).map(r => r[i] || '');
    });

    setMatches(m);

    // Build rows
    const built = dataRows.map(row => {
      const obj: Record<string, string> = {};
      m.forEach((match, i) => {
        if (match.field && match.confidence >= settings.threshold) {
          obj[match.field] = row[i] || '';
        }
      });
      return obj;
    });
    setRows(built);
  };

  const handleFieldChange = (headerIdx: number, field: string) => {
    const newMatches = [...matches];
    newMatches[headerIdx].field = field || null;
    newMatches[headerIdx].confidence = field ? 100 : 0;
    setMatches(newMatches);

    // Rebuild rows
    const grid = parse(rawText);
    const headers = grid[0];
    const dataRows = grid.slice(1);
    const built = dataRows.map(row => {
      const obj: Record<string, string> = {};
      newMatches.forEach((m, i) => {
        if (m.field && m.confidence >= settings.threshold) {
          obj[m.field] = row[i] || '';
        }
      });
      return obj;
    });
    setRows(built);
  };

  const saveSettings = (s: typeof settings) => {
    setSettings(s);
    localStorage.setItem('dataimport_settings_' + entity, JSON.stringify(s));
    setShowSettings(false);

    // Re-match with new settings
    const grid = parse(rawText);
    if (grid.length >= 2) {
      const m = matchHeaders(grid[0]);
      const dataRows = grid.slice(1);
      m.forEach((match, i) => {
        match.values = dataRows.slice(0, 3).map(r => r[i] || '');
      });
      setMatches(m);
      const built = dataRows.map(row => {
        const obj: Record<string, string> = {};
        m.forEach((match, i) => {
          if (match.field && match.confidence >= s.threshold) {
            obj[match.field] = row[i] || '';
          }
        });
        return obj;
      });
      setRows(built);
    }
  };

  const handleSave = async () => {
    const valid = rows.filter(r => r.name && r.name.trim());
    if (valid.length === 0) { alert('Нет строк с названием'); return; }
    setSaving(true);
    try { await onImport(valid); onClose(); }
    catch (e: any) { alert('Ошибка: ' + (e.message || e)); }
    setSaving(false);
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0F1E36, #162844)', border: '1px solid #1E3252',
      borderRadius: 12, padding: 24,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => setMode('clipboard')}
            style={{
              background: mode === 'clipboard' ? '#1E3252' : 'transparent', border: '1px solid #2A4060',
              borderRadius: 8, color: mode === 'clipboard' ? '#E8EEF5' : '#5A7090', padding: '6px 14px',
              cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif',
            }}
          >
            📋 Из буфера
          </button>
          <button
            onClick={() => setMode('manual')}
            style={{
              background: mode === 'manual' ? '#1E3252' : 'transparent', border: '1px solid #2A4060',
              borderRadius: 8, color: mode === 'manual' ? '#E8EEF5' : '#5A7090', padding: '6px 14px',
              cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif',
            }}
          >
            ✍️ Ручной ввод
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'transparent', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 18 }}>⚙️</button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: 14, marginBottom: 16,
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
        }}>
          <div>
            <div style={{ color: '#5A7090', fontSize: 11, marginBottom: 4 }}>Порог уверенности: {settings.threshold}%</div>
            <input type="range" min="0" max="100" value={settings.threshold}
              onChange={e => saveSettings({ ...settings, threshold: Number(e.target.value) })}
              style={{ width: 120 }} />
          </div>
          <label style={{ color: '#B0C4DE', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={settings.synonyms} onChange={e => saveSettings({ ...settings, synonyms: e.target.checked })} /> Синонимы
          </label>
          <label style={{ color: '#B0C4DE', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={settings.substring} onChange={e => saveSettings({ ...settings, substring: e.target.checked })} /> Подстрока
          </label>
          <label style={{ color: '#B0C4DE', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={settings.fuzzy} onChange={e => saveSettings({ ...settings, fuzzy: e.target.checked })} /> Нечёткий поиск
          </label>
        </div>
      )}

      {/* Clipboard mode */}
      {mode === 'clipboard' && (
        <div>
          <textarea
            onPaste={handlePaste}
            placeholder="Вставьте таблицу сюда (Ctrl+V) — из Excel, Google Sheets, TSV/CSV"
            style={{
              width: '100%', minHeight: 80, background: '#0A1628', border: '1px solid #1E3252',
              borderRadius: 8, color: '#B0C4DE', padding: 12, fontSize: 13, resize: 'vertical',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
            value={rawText}
            onChange={e => { setRawText(e.target.value); }}
          />

          {matches.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#60A5FA', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', marginBottom: 8 }}>
                Сопоставление полей ({rows.length} строк)
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {matches.map((m, i) => (
                  <div key={i} style={{
                    background: m.confidence >= settings.threshold ? 'rgba(16,185,129,.1)' : m.confidence > 0 ? 'rgba(245,158,11,.1)' : 'rgba(239,68,68,.1)',
                    border: `1px solid ${m.confidence >= settings.threshold ? '#10B981' : m.confidence > 0 ? '#F59E0B' : '#EF4444'}`,
                    borderRadius: 6, padding: '4px 8px', fontSize: 11,
                  }}>
                    <div style={{ color: '#5A7090', marginBottom: 2 }}>{m.header || '(пусто)'}</div>
                    <select
                      value={m.field || ''}
                      onChange={e => handleFieldChange(i, e.target.value)}
                      style={{
                        background: '#0A1628', border: 'none', color: m.field ? '#E8EEF5' : '#EF4444',
                        fontSize: 10, padding: '2px 4px', borderRadius: 3, width: 130,
                      }}
                    >
                      <option value="">— пропустить —</option>
                      {columns.map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                    {m.confidence > 0 && (
                      <div style={{ color: m.confidence >= settings.threshold ? '#10B981' : '#F59E0B', fontSize: 9, marginTop: 2 }}>
                        {m.confidence}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && (
            <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {columns.filter(c => rows[0] && c.key in rows[0]).map(c => (
                      <th key={c.key} style={{ textAlign: 'left', padding: '4px 8px', color: '#60A5FA', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, borderBottom: '1px solid #1E3252' }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #162844' }}>
                      {columns.filter(c => c.key in row).map(c => (
                        <td key={c.key} style={{ padding: '3px 8px', color: '#B0C4DE' }}>{row[c.key] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 && <div style={{ textAlign: 'center', color: '#5A7090', fontSize: 12, padding: 8 }}>... и ещё {rows.length - 20} строк</div>}
            </div>
          )}
        </div>
      )}

      {/* Bottom actions */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 12 }}>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid #2A4060', borderRadius: 8, color: '#5A7090', padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: 'linear-gradient(135deg, #3B82F6, #2563EB)', border: 'none', borderRadius: 8,
              color: '#fff', padding: '8px 24px', cursor: saving ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? 'Сохранение...' : `Сохранить ${rows.length} записей`}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══ Preset synonym maps ═══

export const NOMENCLATURE_SYNONYMS: SynonymMap = {
  name: ['название', 'наименование', 'продукт', 'изделие', 'номенклатура', 'деталь', 'узел', 'сборка', 'name', 'product', 'item', 'part'],
  code: ['код', 'артикул', 'арт', 'статья', 'обозначение', 'шифр', 'code', 'article', 'sku', 'id'],
  article: ['артикул', 'арт', 'article', 'art', 'артикул поставщика'],
  ntype: ['тип', 'вид', 'категория', 'класс', 'группа', 'type', 'kind', 'category'],
  unit: ['ед', 'ед.изм', 'единица', 'единицы', 'измерения', 'uom', 'unit', 'pcs', 'шт'],
  description: ['описание', 'примечание', 'комментарий', 'характеристика', 'note', 'desc', 'description'],
};

export const RESOURCE_SYNONYMS: SynonymMap = {
  name: ['название', 'наименование', 'ресурс', 'станок', 'оборудование', 'рабочий', 'бригада', 'name', 'resource', 'machine', 'worker'],
  resource_type: ['тип', 'вид ресурса', 'категория', 'resource_type', 'type'],
  unit: ['ед', 'ед.изм', 'единица', 'uom', 'unit'],
  capacity_per_unit: ['мощность', 'производительность', 'выработка', 'capacity'],
  capacity_unit: ['ед.мощности', 'capacity unit', 'час', 'смена'],
};

export const UNIT_SYNONYMS: SynonymMap = {
  code: ['код', 'код океи', 'обозначение', 'code', 'okei'],
  symbol_int: ['межд', 'международный', 'символ', 'int', 'international', 'symbol'],
  symbol_ru: ['рус', 'русский', 'обозначение ru', 'ru'],
  name_ru: ['название', 'наименование', 'единица', 'name', 'unit', 'ед. изм.'],
  name_en: ['english', 'английский', 'название en', 'name en'],
};
