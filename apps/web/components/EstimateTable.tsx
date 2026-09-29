'use client';
/**
 * Экспертная таблица тройных оценок (блок 6.17 плана).
 *
 * Ввод по всем операциям проекта: оптимистичная, наиболее вероятная и пессимистичная оценки.
 * Рядом сразу видно, что из них следует: ожидаемая длительность и разброс (PERT).
 * Правило порядка — оптимистичная ≤ вероятная ≤ пессимистичная: нарушение подсвечивается,
 * и такая строка не сохраняется, пока порядок не исправлен.
 *
 * Значения по умолчанию не подставляются: пустая оценка остаётся пустой, а не превращается
 * в правдоподобное число.
 */
import React, { useMemo, useState } from 'react';

export type EstimateOp = {
  id: string;
  name: string;
  duration_base?: number | string | null;
  to_optimistic?: number | string | null;
  tm_likely?: number | string | null;
  tp_pessimistic?: number | string | null;
  estimate_source?: string | null;
};

/** Ожидаемая длительность и разброс по трём оценкам (PERT). */
export function pertEstimate(to: number, tm: number, tp: number): { mean: number; sigma: number } {
  const mean = (to + 4 * tm + tp) / 6;
  const sigma = (tp - to) / 6;
  return { mean, sigma };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function EstimateTable({
  operations,
  onSave,
  schedHours,
  schedAt,
}: {
  operations: EstimateOp[];
  onSave: (id: string, patch: Record<string, number | null>) => Promise<void>;
  schedHours?: Record<string, number>;
  schedAt?: string | null;
}) {
  const [draft, setDraft] = useState<Record<string, { to: string; tm: string; tp: string; src: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const filled = useMemo(
    () => operations.filter((o) => num(o.to_optimistic) !== null && num(o.tm_likely) !== null && num(o.tp_pessimistic) !== null).length,
    [operations],
  );

  const cell = (id: string, key: 'to' | 'tm' | 'tp'): string => {
    const d = draft[id];
    if (d) return d[key];
    const op = operations.find((o) => o.id === id);
    const v = op ? num(key === 'to' ? op.to_optimistic : key === 'tm' ? op.tm_likely : op.tp_pessimistic) : null;
    return v === null ? '' : String(v);
  };

  const setCell = (id: string, key: 'to' | 'tm' | 'tp', value: string) => {
    setDraft((prev) => {
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp'), src: cellSource(id) };
      return { ...prev, [id]: { ...cur, [key]: value } };
    });
  };

  /** Источник оценок: эксперт — ввёл человек, факт — из истории, ИИ — принято от советника. */
  const cellSource = (id: string): string => {
    const d = draft[id];
    if (d) return d.src;
    const op = operations.find((o) => o.id === id);
    return (op && op.estimate_source) || 'expert';
  };
  const setSource = (id: string, value: string) => {
    setDraft((prev) => {
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp'), src: cellSource(id) };
      return { ...prev, [id]: { ...cur, src: value } };
    });
  };

  const rowNumbers = (op: EstimateOp) => ({
    to: num(cell(op.id, 'to')),
    tm: num(cell(op.id, 'tm')),
    tp: num(cell(op.id, 'tp')),
  });

  const saveRow = async (op: EstimateOp) => {
    const { to, tm, tp } = rowNumbers(op);
    const src = cellSource(op.id);
    if (to === null && tm === null && tp === null && src === 'expert') return;
    if (to !== null && tm !== null && tp !== null && !(to <= tm && tm <= tp)) {
      setNote('Порядок оценок нарушен: должно быть оптимистичная ≤ вероятная ≤ пессимистичная');
      return;
    }
    setSavingId(op.id);
    try {
      await onSave(op.id, { to_optimistic: to, tm_likely: tm, tp_pessimistic: tp, estimate_source: src } as any);
      setDraft((prev) => {
        const next = { ...prev };
        delete next[op.id];
        return next;
      });
      setNote('Оценки сохранены');
    } catch (e: any) {
      setNote('Не удалось сохранить: ' + (e?.message || String(e)));
    } finally {
      setSavingId(null);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: 62,
    background: '#0B1B33',
    color: 'var(--fg)',
    border: '1px solid var(--border-2)',
    borderRadius: 5,
    padding: '3px 6px',
    fontSize: 12,
    textAlign: 'right',
    fontFamily: 'ui-monospace, monospace',
  };

  // ── Выгрузка и загрузка таблицы оценок (блок 6.17) ──
  type PreviewRow = {
    id: string;
    name: string;
    before: string;
    after: string;
    status: 'меняется' | 'без изменений' | 'нарушен порядок' | 'не найдена';
    patch?: Record<string, number | null>;
  };
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; fileName: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [fillMode, setFillMode] = useState('25');
  // Основа для «Заполнить пустые» (блок 6.17.7): из расчёта графика (по умолчанию), из нормы маршрута или из истории (после 6.24).
  const [fillSrc, setFillSrc] = useState<'schedule' | 'base' | 'history'>('schedule');
  const [confirmClear, setConfirmClear] = useState(false);

  /**
   * Заполнение пустых оценок по варианту:
   *   профиль — от одной длительности по коэффициенту (источник «коэффициент», это допущение, а не измерение);
   *   из истории — по завершённым операциям (когда появится факт, блок 6.24).
   * Заполняются только строки без полной тройки; сохраняет человек кнопкой — молча ничего не пишется.
   */
  const fillEmpty = () => {
    if (fillSrc === 'history') {
      setNote('Заполнение из истории пока недоступно: нет завершённых операций с фактической длительностью. Появится вместе с блоком 6.24 — тогда источником станет «факт».');
      return;
    }
    const schedAvail = !!(schedHours && Object.keys(schedHours).length > 0);
    const useSched = fillSrc === 'schedule' && schedAvail;
    const p = Number(fillMode) / 100;
    const next: Record<string, { to: string; tm: string; tp: string; src: string }> = { ...draft };
    let filled = 0;
    for (const op of operations) {
      const base = useSched ? Number(schedHours?.[op.id] || 0) : Number(op.duration_base || 0);
      if (!base) continue;
      const already = num(op.to_optimistic) !== null && num(op.tm_likely) !== null && num(op.tp_pessimistic) !== null;
      if (already) continue;
      next[op.id] = {
        to: (base * (1 - p)).toFixed(2),
        tm: base.toFixed(2),
        tp: (base * (1 + p)).toFixed(2),
        src: useSched ? 'schedule' : 'coefficient',
      };
      filled += 1;
    }
    setDraft(next);
    const srcText = useSched
      ? `из расчёта графика${schedAt ? ` от ${String(schedAt).slice(0, 10).split('-').reverse().join('.')}` : ''}`
      : 'по норме маршрута';
    const fb = fillSrc === 'schedule' && !schedAvail ? ' Расчёт графика не найден — сначала «Рассчитать проект»; заполнено по норме.' : '';
    setNote(
      filled
        ? `Заполнено ${srcText} (профиль ±${Math.round(p * 100)} %): строк ${filled}. Это допущение, а не измерение — проверьте и нажмите «Сохранить все».${fb}`
        : 'Заполнять нечего: у всех операций уже есть полная тройка оценок',
    );
  };

  /** Очистка всех оценок: сначала запрос подтверждения — действие необратимо. */
  const clearAll = async () => {
    const targets = operations.filter(
      (o) => o.to_optimistic !== null && o.to_optimistic !== undefined || o.tm_likely !== null && o.tm_likely !== undefined || o.tp_pessimistic !== null && o.tp_pessimistic !== undefined,
    );
    if (!confirmClear) {
      setConfirmClear(true);
      setNote(
        `Очистить оценки у всех операций? Будут затронуты строки: ${targets.length}. Сначала можно выгрузить таблицу в файл — действие необратимо.`,
      );
      return;
    }
    setConfirmClear(false);
    setSavingId('all');
    let cleared = 0;
    for (const op of targets) {
      try {
        await onSave(op.id, { to_optimistic: null, tm_likely: null, tp_pessimistic: null, estimate_source: 'expert' } as any);
        cleared += 1;
      } catch {
        setNote('Очистка прервана на строке: ' + op.name);
        setSavingId(null);
        return;
      }
    }
    setDraft({});
    setSavingId(null);
    setNote(`Очищено строк: ${cleared}. Оценки можно ввести заново или заполнить профилем.`);
  };

  /** Сохранение всех изменённых строк: по одной, чтобы видеть ошибки и не потерять порядок оценок. */
  const saveAllDrafts = async () => {
    const ids = Object.keys(draft);
    let saved = 0;
    let failed = 0;
    for (const id of ids) {
      const op = operations.find((o) => o.id === id);
      if (!op) continue;
      const { to, tm, tp } = rowNumbers(op);
      const src = cellSource(id);
      if (to !== null && tm !== null && tp !== null && !(to <= tm && tm <= tp)) {
        failed += 1;
        continue;
      }
      setSavingId(id);
      try {
        await onSave(id, { to_optimistic: to, tm_likely: tm, tp_pessimistic: tp, estimate_source: src } as any);
        saved += 1;
        setDraft((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      } catch {
        failed += 1;
      }
    }
    setSavingId(null);
    setNote(`Сохранено строк: ${saved}${failed ? `, не прошло: ${failed} (порядок оценок)` : ''}`);
  };

  const exportCsv = () => {
    const head = 'ID;Операция;Опт.;Вероятн.;Пессим.;Ожидаемая;Разброс';
    const lines = operations.map((op) => {
      const { to, tm, tp } = rowNumbers(op);
      const est = to !== null && tm !== null && tp !== null ? pertEstimate(to, tm, tp) : null;
      return [op.id, '"' + String(op.name).replace(/"/g, '""') + '"', to ?? '', tm ?? '', tp ?? '', est ? est.mean.toFixed(2) : '', est ? est.sigma.toFixed(2) : ''].join(';');
    });
    const blob = new Blob(['\uFEFF' + [head, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'оценки-операций.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNote('Файл выгружен: ' + operations.length + ' строк');
  };

  /** Сухой прогон: разбираем файл и показываем, что изменится. Данные не трогаем. */
  const dryRun = async (file: File) => {
    const text = await file.text();
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) {
      setPreview({ rows: [], fileName: file.name });
      return;
    }
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const split = (line: string) => {
      const out: string[] = [];
      let cur = '';
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === sep && !quoted) {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const header = split(lines[0]).map((h) => h.toLowerCase());
    const iId = header.findIndex((h) => h === 'id');
    const iName = header.findIndex((h) => h.includes('опер'));
    const iTo = header.findIndex((h) => h.startsWith('опт'));
    const iTm = header.findIndex((h) => h.startsWith('вероят'));
    const iTp = header.findIndex((h) => h.startsWith('пессим'));
    const rows: PreviewRow[] = [];
    for (const line of lines.slice(1)) {
      const cells = split(line);
      const rawId = (iId >= 0 ? cells[iId] : '') || '';
      const rawName = (iName >= 0 ? cells[iName] : '') || '';
      const op = operations.find((o) => o.id === rawId) || operations.find((o) => o.name === rawName);
      const to = num(iTo >= 0 ? cells[iTo] : null);
      const tm = num(iTm >= 0 ? cells[iTm] : null);
      const tp = num(iTp >= 0 ? cells[iTp] : null);
      if (!op) {
        rows.push({ id: rawId, name: rawName || '(без названия)', before: '—', after: `${to ?? ''} / ${tm ?? ''} / ${tp ?? ''}`, status: 'не найдена' });
        continue;
      }
      const cur = rowNumbers(op);
      const before = `${cur.to ?? '—'} / ${cur.tm ?? '—'} / ${cur.tp ?? '—'}`;
      const after = `${to ?? '—'} / ${tm ?? '—'} / ${tp ?? '—'}`;
      const bad = to !== null && tm !== null && tp !== null && !(to <= tm && tm <= tp);
      const changed = cur.to !== to || cur.tm !== tm || cur.tp !== tp;
      rows.push({
        id: op.id,
        name: op.name,
        before,
        after,
        status: bad ? 'нарушен порядок' : changed ? 'меняется' : 'без изменений',
        patch: bad ? undefined : { to_optimistic: to, tm_likely: tm, tp_pessimistic: tp },
      });
    }
    setPreview({ rows, fileName: file.name });
  };

  const applyPreview = async () => {
    if (!preview) return;
    const toSave = preview.rows.filter((r) => r.status === 'меняется' && r.patch);
    setSavingId('all');
    try {
      for (const r of toSave) {
        await onSave(r.id, r.patch!);
      }
      setNote('Применено строк: ' + toSave.length);
      setPreview(null);
    } catch (e: any) {
      setNote('Не удалось применить: ' + (e?.message || String(e)));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <span className="panel-title">Экспертная таблица оценок</span>
          <span className="panel-sub">
            операций {operations.length} · оценок заполнено {filled} из {operations.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} title="Выгрузить таблицу в файл (CSV для Excel)">
            Выгрузить в файл
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} title="Загрузить оценки из файла: сначала будет показан сухой прогон">
            Загрузить из файла
          </button>
          <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            вариант заполнения
            <select
              value={fillMode}
              onChange={(e) => setFillMode(e.target.value)}
              title="Чем заполнять пустые оценки"
              style={{ background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '4px 6px', fontSize: 12 }}
            >
              <option value="15">профиль ±15 %</option>
              <option value="25">профиль ±25 %</option>
              <option value="40">профиль ±40 %</option>
            </select>
          </label>
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            основа
            <select
              value={fillSrc}
              onChange={(e) => setFillSrc(e.target.value as 'schedule' | 'base' | 'history')}
              title="Основа для заполнения: длительность выполнения из последнего расчёта графика, базовая норма из маршрута или факт из истории"
              style={{ background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '4px 6px', fontSize: 12 }}
            >
              <option value="schedule">из расчёта (график)</option>
              <option value="base">из маршрута (норма)</option>
              <option value="history">из истории (факт)</option>
            </select>
          </label>
          <button className="btn btn-secondary btn-sm" onClick={fillEmpty} title="Заполнить только строки без полной тройки оценок">
            Заполнить пустые
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!Object.keys(draft).length || savingId === 'all'}
            onClick={saveAllDrafts}
            title="Сохранить все изменённые строки"
          >
            {savingId === 'all' ? 'Сохраняю…' : 'Сохранить все'}
          </button>
          {Object.keys(draft).length ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setDraft({});
                setNote('Изменения сброшены — данные не тронуты');
              }}
              title="Отменить несохранённые изменения в таблице"
            >
              Сбросить изменения
            </button>
          ) : null}
          <button
            className="btn btn-secondary btn-sm"
            disabled={savingId === 'all'}
            onClick={clearAll}
            title="Очистить тройные оценки у всех операций (с подтверждением)"
            style={confirmClear ? { borderColor: '#F59E0B', color: '#FCD34D' } : undefined}
          >
            {confirmClear ? 'Подтвердить очистку' : 'Очистить все'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) dryRun(f);
              e.target.value = '';
            }}
          />
        </div>
        {fillSrc === 'history' ? (
          <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>Из истории пока недоступно: нет завершённых операций с фактической длительностью — появится вместе с калибровкой (блок 6.24).</div>
        ) : null}
        {note ? <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}>{note}</div> : null}
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', margin: '8px 0 10px' }}>
          Введите три оценки по каждой операции. Порядок: оптимистичная ≤ вероятная ≤ пессимистичная — иначе строка
          не сохранится. Ожидаемая длительность и разброс считаются тут же и ничего не меняют в данных.
        </div>
        {preview ? (
          <div style={{ border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--bg-2)', padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Сухой прогон: файл «{preview.fileName}»</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>
              Изменится строк: {preview.rows.filter((r) => r.status === 'меняется').length} · без изменений: {preview.rows.filter((r) => r.status === 'без изменений').length} · с нарушенным порядком: {preview.rows.filter((r) => r.status === 'нарушен порядок').length} · не найдено операций: {preview.rows.filter((r) => r.status === 'не найдена').length}.
              Пока ничего не применено.
            </div>
            <table className="tbl">
              <thead>
                <tr><th>Операция</th><th>Было (опт. / вероятн. / пессим.)</th><th>Станет</th><th>Что будет</th></tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((r, i) => (
                  <tr key={r.id + i}>
                    <td>{r.name}</td>
                    <td className="t-mono">{r.before}</td>
                    <td className="t-mono">{r.after}</td>
                    <td style={{ color: r.status === 'нарушен порядок' ? '#FCD34D' : r.status === 'не найдена' ? '#F59E0B' : 'var(--fg-2)' }}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" disabled={!preview.rows.some((r) => r.status === 'меняется') || savingId === 'all'} onClick={applyPreview}>
                {savingId === 'all' ? 'Применяю…' : 'Применить изменения'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>Отмена</button>
            </div>
          </div>
        ) : null}
        {operations.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            У проекта ещё нет операций: сначала нужен состав и маршрут (окно заказа, вкладка «Маршрут»).
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Операция</th>
                <th>Опт.</th>
                <th>Вероятн.</th>
                <th>Пессим.</th>
                <th>Ожидаемая</th>
                <th>Разброс σ</th>
                <th>Источник</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => {
                const { to, tm, tp } = rowNumbers(op);
                const allThree = to !== null && tm !== null && tp !== null;
                const badOrder = allThree && !(to! <= tm! && tm! <= tp!);
                const est = allThree ? pertEstimate(to!, tm!, tp!) : null;
                const dirty = !!draft[op.id];
                return (
                  <tr key={op.id}>
                    <td style={{ maxWidth: 340 }}>{op.name}</td>
                    <td><input style={{ ...inputStyle, borderColor: badOrder ? '#F59E0B' : undefined }} value={cell(op.id, 'to')} onChange={(e) => setCell(op.id, 'to', e.target.value)} placeholder="—" /></td>
                    <td><input style={{ ...inputStyle, borderColor: badOrder ? '#F59E0B' : undefined }} value={cell(op.id, 'tm')} onChange={(e) => setCell(op.id, 'tm', e.target.value)} placeholder="—" /></td>
                    <td><input style={{ ...inputStyle, borderColor: badOrder ? '#F59E0B' : undefined }} value={cell(op.id, 'tp')} onChange={(e) => setCell(op.id, 'tp', e.target.value)} placeholder="—" /></td>
                    <td className="t-mono">{est ? est.mean.toFixed(2) : '—'}</td>
                    <td className="t-mono">{est ? est.sigma.toFixed(2) : '—'}</td>
                    <td>
                      <select
                        value={cellSource(op.id)}
                        onChange={(e) => setSource(op.id, e.target.value)}
                        title="Откуда взяты оценки: ввёл человек, получено из истории или принято от ИИ-советника"
                        style={{ background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '3px 6px', fontSize: 12 }}
                      >
                        <option value="expert">эксперт</option>
                        <option value="fact">факт</option>
                        <option value="ai">предложено ИИ</option>
                        <option value="coefficient">коэффициент</option>
                        <option value="schedule">из расчёта</option>
                      </select>
                    </td>
                    <td>
                      {dirty ? (
                        <button className="btn btn-primary btn-sm" disabled={badOrder || savingId === op.id} onClick={() => saveRow(op)} title={badOrder ? 'Проверьте порядок оценок' : 'Сохранить строку'}>
                          {savingId === op.id ? '…' : 'Сохранить'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
