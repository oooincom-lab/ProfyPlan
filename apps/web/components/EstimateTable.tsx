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
 *
 * Блок 6.24: столбцы «Факт, ч» и «Завершена» собирают факт по завершённым операциям,
 * а панель «Калибровка по истории» показывает отношение «факт / оценка» как подсказку.
 * Переключатель «использовать исторические данные» по умолчанию выключен; оценки
 * меняются только по нажатию человека, с подтверждением.
 */
import React, { useMemo, useState } from 'react';
import { CalibrationGroup, calibrationGroups, calibrationStats, factObservations, fmtDateRu, fmtRatio } from '@/lib/calibration';

export type EstimateOp = {
  id: string;
  name: string;
  duration_base?: number | string | null;
  to_optimistic?: number | string | null;
  tm_likely?: number | string | null;
  tp_pessimistic?: number | string | null;
  estimate_source?: string | null;
  fact_hours?: number | string | null;
  fact_finished_on?: string | null;
  operation_type?: string | null;
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
  useHistory,
  onToggleHistory,
  calLog,
  onCalRecord,
  onCalRevert,
}: {
  operations: EstimateOp[];
  onSave: (id: string, patch: Record<string, number | string | null>) => Promise<void>;
  schedHours?: Record<string, number>;
  schedAt?: string | null;
  useHistory?: boolean;
  onToggleHistory?: (value: boolean) => void | Promise<void>;
  calLog?: { id: string; at: string; coefficient: number; observations: number; appliedCount: number; reverted: boolean; scope?: string | null }[];
  onCalRecord?: (payload: {
    coefficient: number;
    observationsCount: number;
    periodFrom: string | null;
    periodTo: string | null;
    appliedCount: number;
    skippedHistory: number;
    skippedNoTriple: number;
    scope?: string | null;
    items: { op_id: string; op_name: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
  }) => Promise<void> | void;
  onCalRevert?: (entryId: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Record<string, { to: string; tm: string; tp: string; src: string; fact: string; factDate: string }>>({});
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

  /** Начальные значения факта по операции — и для черновика, и для сравнения «изменено ли». */
  const factInit = (op: EstimateOp | undefined): { fact: string; factDate: string } => ({
    fact: op && op.fact_hours !== null && op.fact_hours !== undefined ? String(Number(op.fact_hours)) : '',
    factDate: op && op.fact_finished_on ? String(op.fact_finished_on).slice(0, 10) : '',
  });

  const setCell = (id: string, key: 'to' | 'tm' | 'tp', value: string) => {
    setDraft((prev) => {
      const op = operations.find((o) => o.id === id);
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp'), src: cellSource(id), ...factInit(op) };
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
      const op = operations.find((o) => o.id === id);
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp'), src: cellSource(id), ...factInit(op) };
      return { ...prev, [id]: { ...cur, src: value } };
    });
  };

  // ── Факт (блок 6.24): фактические часы и дата завершения ──
  const factCell = (op: EstimateOp): string => {
    const d = draft[op.id];
    return d ? d.fact : factInit(op).fact;
  };
  const factDateCell = (op: EstimateOp): string => {
    const d = draft[op.id];
    return d ? d.factDate : factInit(op).factDate;
  };
  const setFactCell = (id: string, value: string) => {
    setDraft((prev) => {
      const op = operations.find((o) => o.id === id);
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp'), src: cellSource(id), ...factInit(op) };
      return { ...prev, [id]: { ...cur, fact: value } };
    });
  };
  const setFactDateCell = (id: string, value: string) => {
    setDraft((prev) => {
      const op = operations.find((o) => o.id === id);
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp'), src: cellSource(id), ...factInit(op) };
      return { ...prev, [id]: { ...cur, factDate: value } };
    });
  };
  const parseFact = (v: string): { ok: boolean; value: number | null } => {
    const s = v.trim();
    if (!s) return { ok: true, value: null };
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false, value: null };
  };
  const factDirty = (op: EstimateOp): boolean => {
    const d = draft[op.id];
    if (!d) return false;
    const init = factInit(op);
    return d.fact !== init.fact || d.factDate !== init.factDate;
  };

  const rowNumbers = (op: EstimateOp) => ({
    to: num(cell(op.id, 'to')),
    tm: num(cell(op.id, 'tm')),
    tp: num(cell(op.id, 'tp')),
  });

  const saveRow = async (op: EstimateOp) => {
    const { to, tm, tp } = rowNumbers(op);
    const src = cellSource(op.id);
    const fDirty = factDirty(op);
    const pf = parseFact(factCell(op));
    if (!pf.ok) {
      setNote('Факт, ч: нужно число (или оставьте пустым)');
      return;
    }
    if (!fDirty && to === null && tm === null && tp === null && src === 'expert') return;
    if (to !== null && tm !== null && tp !== null && !(to <= tm && tm <= tp)) {
      setNote('Порядок оценок нарушен: должно быть оптимистичная ≤ вероятная ≤ пессимистичная');
      return;
    }
    const patch: Record<string, number | string | null> = { to_optimistic: to, tm_likely: tm, tp_pessimistic: tp, estimate_source: src };
    if (fDirty) {
      patch.fact_hours = pf.value;
      patch.fact_finished_on = factDateCell(op).trim() || null;
    }
    setSavingId(op.id);
    try {
      await onSave(op.id, patch);
      setDraft((prev) => {
        const next = { ...prev };
        delete next[op.id];
        return next;
      });
      setNote(fDirty ? 'Оценки и факт сохранены' : 'Оценки сохранены');
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

  // ── Калибровка по истории (блок 6.24): наблюдения факта и подсказка коэффициента ──
  const obs = useMemo(() => factObservations(operations), [operations]);
  const calStats = useMemo(() => calibrationStats(obs), [obs]);
  const [calConfirm, setCalConfirm] = useState(false);
  const [calTypeConfirm, setCalTypeConfirm] = useState<string | null>(null);
  const [calNote, setCalNote] = useState('');
  const [calOpen, setCalOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const calTargets = useMemo(() => {
    const targets: EstimateOp[] = [];
    if (!calStats) return targets;
    for (const op of operations) {
      if (draft[op.id]) continue;
      const to = num(op.to_optimistic);
      const tm = num(op.tm_likely);
      const tp = num(op.tp_pessimistic);
      const hasFact = num(op.fact_hours) !== null;
      const fromHistory = op.estimate_source === 'fact';
      if (to !== null && tm !== null && tp !== null && !hasFact && !fromHistory) targets.push(op);
    }
    return targets;
  }, [operations, draft, calStats]);

  const calSkipNoTriple = useMemo(() => {
    if (!calStats) return 0;
    let k = 0;
    for (const op of operations) {
      if (draft[op.id]) continue;
      const to = num(op.to_optimistic);
      const tm = num(op.tm_likely);
      const tp = num(op.tp_pessimistic);
      const hasFact = num(op.fact_hours) !== null;
      const full = to !== null && tm !== null && tp !== null;
      if (!full && !hasFact) k += 1;
    }
    return k;
  }, [operations, draft, calStats]);

  /** Строки, заполненные из истории (источник «факт»): в применение коэффициента не попадают — оценка уже калибрована. */
  const calSkipHistory = useMemo(() => {
    if (!calStats) return 0;
    let k = 0;
    for (const op of operations) {
      if (draft[op.id]) continue;
      const to = num(op.to_optimistic);
      const tm = num(op.tm_likely);
      const tp = num(op.tp_pessimistic);
      const hasFact = num(op.fact_hours) !== null;
      const full = to !== null && tm !== null && tp !== null;
      if (full && !hasFact && op.estimate_source === 'fact') k += 1;
    }
    return k;
  }, [operations, draft, calStats]);

  /** Разбивка по типам операций — показывается, когда типов больше одного. */
  const calGroups = useMemo(() => calibrationGroups(obs), [obs]);

  /** Строки к применению и пропуски — в разрезе типов операций (для выборочного применения). */
  const calByType = useMemo(() => {
    const m = new Map<string, { targets: EstimateOp[]; skipHistory: number; skipNoTriple: number }>();
    if (!calStats) return m;
    const take = (k2: string) => {
      if (!m.has(k2)) m.set(k2, { targets: [], skipHistory: 0, skipNoTriple: 0 });
      return m.get(k2)!;
    };
    for (const op of operations) {
      if (draft[op.id]) continue;
      const key = op.operation_type ? String(op.operation_type) : 'other';
      const to = num(op.to_optimistic);
      const tm = num(op.tm_likely);
      const tp = num(op.tp_pessimistic);
      const hasFact = num(op.fact_hours) !== null;
      const full = to !== null && tm !== null && tp !== null;
      const b = take(key);
      if (full && !hasFact && op.estimate_source !== 'fact') b.targets.push(op);
      else if (full && !hasFact && op.estimate_source === 'fact') b.skipHistory += 1;
      else if (!hasFact) b.skipNoTriple += 1;
    }
    return m;
  }, [operations, draft, calStats]);

  const toggleHistory = async (v: boolean) => {
    if (!onToggleHistory) return;
    setToggling(true);
    try {
      await onToggleHistory(v);
    } finally {
      setToggling(false);
    }
  };

  /** Общий проход применения: сохраняет строки и пишет запись в журнал. */
  const runCalibrationApply = async (
    k: number,
    targets: EstimateOp[],
    meta: {
      observationsCount: number;
      from: string | null;
      to: string | null;
      skippedHistory: number;
      skippedNoTriple: number;
      scope: string | null;
      label: string;
    },
  ) => {
    setSavingId('cal');
    let done = 0;
    let failed = 0;
    let firstErr = '';
    const items: { op_id: string; op_name: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
    for (const op of targets) {
      const toNew = Math.round(Number(op.to_optimistic) * k * 100) / 100;
      const tmNew = Math.round(Number(op.tm_likely) * k * 100) / 100;
      const tpNew = Math.round(Number(op.tp_pessimistic) * k * 100) / 100;
      try {
        await onSave(op.id, { to_optimistic: toNew, tm_likely: tmNew, tp_pessimistic: tpNew, estimate_source: 'coefficient' });
        done += 1;
        items.push({
          op_id: op.id,
          op_name: op.name,
          before: { to: num(op.to_optimistic), tm: num(op.tm_likely), tp: num(op.tp_pessimistic), source: op.estimate_source ?? null },
          after: { to: toNew, tm: tmNew, tp: tpNew },
        });
      } catch (e: any) {
        failed += 1;
        if (!firstErr) firstErr = (e?.message || String(e)).slice(0, 140);
      }
    }
    let logNote = '';
    if (onCalRecord && items.length) {
      try {
        await onCalRecord({
          coefficient: k,
          observationsCount: meta.observationsCount,
          periodFrom: meta.from,
          periodTo: meta.to,
          appliedCount: done,
          skippedHistory: meta.skippedHistory,
          skippedNoTriple: meta.skippedNoTriple,
          scope: meta.scope,
          items,
        });
        logNote = ' Запись добавлена в журнал применений.';
      } catch {
        logNote = ' Внимание: запись в журнал не удалась.';
      }
    }
    setSavingId(null);
    setCalNote(
      `${meta.label}: строк ${done}${failed ? `, ошибок: ${failed} — первая: ${firstErr}` : ''}. Источник оценок — «коэффициент» (пересчёт, не измерение).${logNote}`,
    );
  };

  /** Применение медианного коэффициента ко всем строкам с полной тройкой без факта. */
  const applyCalibration = async () => {
    if (!calStats || savingId === 'cal') return;
    const k = calStats.median;
    if (!calConfirm) {
      setCalTypeConfirm(null);
      setCalConfirm(true);
      setCalNote(
        `Умножить оценки на медиану ${fmtRatio(k)}? Строк: ${calTargets.length}` +
          (calSkipHistory ? ` (заполненные из истории пропускаются: ${calSkipHistory})` : '') +
          (calSkipNoTriple ? ` (без полной тройки пропустятся: ${calSkipNoTriple})` : '') +
          `. Завершённые строки не трогаем. Повторное применение умножит ещё раз — коэффициент применяйте один раз.`,
      );
      return;
    }
    setCalConfirm(false);
    await runCalibrationApply(k, calTargets, {
      observationsCount: calStats.n,
      from: calStats.from,
      to: calStats.to,
      skippedHistory: calSkipHistory,
      skippedNoTriple: calSkipNoTriple,
      scope: null,
      label: 'Применено ко всем строкам',
    });
  };

  /** Выборочное применение: коэффициент типа операции — только к строкам этого типа. */
  const applyCalibrationType = async (g: CalibrationGroup) => {
    if (savingId === 'cal') return;
    const bucket = calByType.get(g.key);
    const targets = bucket ? bucket.targets : [];
    if (!targets.length) return;
    if (calTypeConfirm !== g.key) {
      setCalConfirm(false);
      setCalTypeConfirm(g.key);
      setCalNote(
        `Умножить оценки типа «${g.label}» на медиану ${fmtRatio(g.median)}? Строк: ${targets.length}` +
          (bucket && bucket.skipHistory ? ` (заполненные из истории пропускаются: ${bucket.skipHistory})` : '') +
          (bucket && bucket.skipNoTriple ? ` (без полной тройки пропустятся: ${bucket.skipNoTriple})` : '') +
          `. Завершённые строки не трогаем.`,
      );
      return;
    }
    setCalTypeConfirm(null);
    await runCalibrationApply(g.median, targets, {
      observationsCount: g.n,
      from: g.from,
      to: g.to,
      skippedHistory: bucket ? bucket.skipHistory : 0,
      skippedNoTriple: bucket ? bucket.skipNoTriple : 0,
      scope: `тип: ${g.label}`,
      label: `Применено (тип «${g.label}»)`,
    });
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
  // Основа для «Заполнить пустые» (блок 6.17.7): из расчёта графика (по умолчанию), из нормы маршрута или из истории (блок 6.24).
  const [fillSrc, setFillSrc] = useState<'schedule' | 'base' | 'history'>('schedule');
  const [confirmClear, setConfirmClear] = useState(false);

  /**
   * Заполнение пустых оценок по варианту:
   *   профиль — от одной длительности по коэффициенту (источник «коэффициент», это допущение, а не измерение);
   *   из истории — от медианы фактических отношений (источник «факт», блок 6.24).
   * Заполняются только строки без полной тройки; сохраняет человек кнопкой — молча ничего не пишется.
   */
  const fillEmpty = () => {
    if (fillSrc === 'history') {
      if (!useHistory) {
        setNote('Исторические данные выключены: включите переключатель в строке «Калибровка по истории» (по умолчанию выключено — включается решением пользователя).');
        return;
      }
      if (!calStats) {
        setNote('Нет данных: нет завершённых операций с фактической длительностью — заполните столбец «Факт, ч».');
        return;
      }
      const p = Number(fillMode) / 100;
      const k = calStats.median;
      const next: Record<string, { to: string; tm: string; tp: string; src: string; fact: string; factDate: string }> = { ...draft };
      let filledCount = 0;
      for (const op of operations) {
        const base = Number(op.duration_base || 0);
        if (!base) continue;
        const already = num(op.to_optimistic) !== null && num(op.tm_likely) !== null && num(op.tp_pessimistic) !== null;
        if (already) continue;
        const m = base * k;
        next[op.id] = {
          to: (m * (1 - p)).toFixed(2),
          tm: m.toFixed(2),
          tp: (m * (1 + p)).toFixed(2),
          src: 'fact',
          ...factInit(op),
        };
        filledCount += 1;
      }
      setDraft(next);
      setNote(
        filledCount
          ? `Заполнено из истории: медиана ${fmtRatio(k)} (наблюдений ${calStats.n}), профиль ±${Math.round(p * 100)} %. Строк: ${filledCount}. Источник — «факт»; проверьте и нажмите «Сохранить все».`
          : 'Заполнять нечего: у всех операций уже есть полная тройка оценок',
      );
      return;
    }
    const schedAvail = !!(schedHours && Object.keys(schedHours).length > 0);
    const useSched = fillSrc === 'schedule' && schedAvail;
    const p = Number(fillMode) / 100;
    const next: Record<string, { to: string; tm: string; tp: string; src: string; fact: string; factDate: string }> = { ...draft };
    let filledCount = 0;
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
        ...factInit(op),
      };
      filledCount += 1;
    }
    setDraft(next);
    const srcText = useSched
      ? `из расчёта графика${schedAt ? ` от ${String(schedAt).slice(0, 10).split('-').reverse().join('.')}` : ''}`
      : 'по норме маршрута';
    const fb = fillSrc === 'schedule' && !schedAvail ? ' Расчёт графика не найден — сначала «Рассчитать проект»; заполнено по норме.' : '';
    setNote(
      filledCount
        ? `Заполнено ${srcText} (профиль ±${Math.round(p * 100)} %): строк ${filledCount}. Это допущение, а не измерение — проверьте и нажмите «Сохранить все».${fb}`
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
    let badOrder = 0;
    let badFact = 0;
    let failed = 0;
    let failText = '';
    for (const id of ids) {
      const op = operations.find((o) => o.id === id);
      if (!op) continue;
      const { to, tm, tp } = rowNumbers(op);
      const src = cellSource(id);
      const fDirty = factDirty(op);
      const pf = parseFact(factCell(op));
      if (!pf.ok) {
        badFact += 1;
        continue;
      }
      if (to !== null && tm !== null && tp !== null && !(to <= tm && tm <= tp)) {
        badOrder += 1;
        continue;
      }
      const patch: Record<string, number | string | null> = { to_optimistic: to, tm_likely: tm, tp_pessimistic: tp, estimate_source: src };
      if (fDirty) {
        patch.fact_hours = pf.value;
        patch.fact_finished_on = factDateCell(op).trim() || null;
      }
      setSavingId(id);
      try {
        await onSave(id, patch);
        saved += 1;
        setDraft((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      } catch (e: any) {
        failed += 1;
        if (!failText) failText = (e?.message || String(e)).slice(0, 140);
      }
    }
    setSavingId(null);
    setNote(
      `Сохранено строк: ${saved}` +
      (badOrder ? `, нарушен порядок оценок: ${badOrder}` : '') +
      (badFact ? `, факт не число: ${badFact}` : '') +
      (failed ? `, ошибок сохранения: ${failed}${failText ? ` — первая: ${failText}` : ''}` : ''),
    );
  };

  const exportCsv = () => {
    const head = 'ID;Операция;Опт.;Вероятн.;Пессим.;Ожидаемая;Разброс;Факт,ч;Завершена';
    const lines = operations.map((op) => {
      const { to, tm, tp } = rowNumbers(op);
      const est = to !== null && tm !== null && tp !== null ? pertEstimate(to, tm, tp) : null;
      const fh = num(op.fact_hours);
      return [
        op.id,
        '"' + String(op.name).replace(/"/g, '""') + '"',
        to ?? '',
        tm ?? '',
        tp ?? '',
        est ? est.mean.toFixed(2) : '',
        est ? est.sigma.toFixed(2) : '',
        fh ?? '',
        op.fact_finished_on ? String(op.fact_finished_on).slice(0, 10) : '',
      ].join(';');
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
          {confirmClear ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setConfirmClear(false);
                setNote('Очистка отменена — данные не тронуты');
              }}
              title="Снять подтверждение — оценки останутся как были"
            >
              Отмена
            </button>
          ) : null}
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
          <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
            {useHistory
              ? calStats
                ? `Из истории: пустые строки заполняются от медианы ${fmtRatio(calStats.median)} (наблюдений ${calStats.n}); источник — «факт».`
                : 'Из истории: нет данных — нет завершённых операций с фактической длительностью.'
              : 'Из истории выключено: включите «Использовать исторические данные» в строке «Калибровка по истории».'}
          </div>
        ) : null}
        {note ? <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}>{note}</div> : null}
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        {/* ── Калибровка по истории (блок 6.24): компактная строка над таблицей; полная панель — по развороту ── */}
        {operations.length ? (
          <div data-help-id="calc.calibration" style={{ margin: '8px 0 8px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--bg-2)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>Калибровка по истории</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useHistory === true}
                disabled={toggling || !onToggleHistory}
                onChange={(e) => toggleHistory(e.target.checked)}
                style={{ accentColor: '#3B82F6', width: 14, height: 14, cursor: 'pointer' }}
              />
              Использовать исторические данные
              <span style={{ color: 'var(--fg-4)' }}>по умолчанию выключено</span>
            </label>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
              {!useHistory
                ? 'выключено — подсказки по факту скрыты; данные собираются'
                : calStats
                  ? `наблюдений ${calStats.n} · медиана ${fmtRatio(calStats.median)}`
                  : calLog && calLog.length
                    ? `наблюдений нет · применений: ${calLog.length}`
                    : 'нет данных — заполните «Факт, ч» у завершённых операций'}
            </div>
            {(useHistory && calStats) || (calLog && calLog.length) ? (
              <button className="btn btn-secondary btn-sm" onClick={() => { if (calOpen && (calConfirm || calTypeConfirm)) { setCalConfirm(false); setCalTypeConfirm(null); setCalNote(''); } setCalOpen((v) => !v); }} title="Показать наблюдения и применение коэффициента к оценкам">
                {calOpen ? 'Свернуть' : 'Развернуть'}
              </button>
            ) : null}
          </div>
        ) : null}
        {operations.length && calOpen && ((useHistory && calStats) || (calLog && calLog.length)) ? (
          <div style={{ border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--bg-2)', padding: '10px 14px', display: 'grid', gap: 8, margin: '0 0 10px' }}>
            {useHistory && calStats ? (
              <>
            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
              Наблюдений: <b>{calStats.n}</b> · период: {fmtDateRu(calStats.from)} — {fmtDateRu(calStats.to)} · медиана отношения
              «факт / оценка»: <b>{fmtRatio(calStats.median)}</b> (среднее {fmtRatio(calStats.mean)}) · факт больше оценки: {calStats.over}, меньше: {calStats.under}
            </div>
            {calGroups.length > 1 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                <div style={{ marginBottom: 4 }}>По типам операций — можно применять выборочно (одна кнопка — один тип):</div>
                <table className="tbl" style={{ maxWidth: 860 }}>
                  <thead>
                    <tr><th>Тип</th><th>Наблюдений</th><th>Медиана</th><th>Строк к применению</th><th /></tr>
                  </thead>
                  <tbody>
                    {calGroups.map((g) => {
                      const bucket = calByType.get(g.key);
                      const targets = bucket ? bucket.targets : [];
                      const confirming = calTypeConfirm === g.key;
                      return (
                        <tr key={g.key}>
                          <td>{g.label}</td>
                          <td className="t-mono">{g.n}</td>
                          <td className="t-mono">{fmtRatio(g.median)}</td>
                          <td className="t-mono" title={`из истории пропустятся: ${bucket ? bucket.skipHistory : 0}; без полной тройки: ${bucket ? bucket.skipNoTriple : 0}`}>{targets.length}</td>
                          <td>
                            {targets.length === 0 ? (
                              <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>— нет строк</span>
                            ) : confirming ? (
                              <span style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={savingId === 'cal'}
                                  onClick={() => applyCalibrationType(g)}
                                  style={{ borderColor: '#F59E0B', color: '#FCD34D' }}
                                >
                                  Подтвердить ×{g.median.toFixed(2)}
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setCalTypeConfirm(null);
                                    setCalNote('');
                                  }}
                                  title="Снять подтверждение"
                                >
                                  Отмена
                                </button>
                              </span>
                            ) : (
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled={savingId === 'cal'}
                                onClick={() => applyCalibrationType(g)}
                                title={`Умножить оценки строк типа «${g.label}» на медиану типа`}
                              >
                                Применить ×{g.median.toFixed(2)}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <table className="tbl" style={{ maxWidth: 860 }}>
              <thead>
                <tr><th>Операция</th><th>Оценка M, ч</th><th>Факт, ч</th><th>Отношение</th><th>Завершена</th></tr>
              </thead>
              <tbody>
                {obs.slice(0, 12).map((o) => (
                  <tr key={o.id}>
                    <td style={{ maxWidth: 300 }}>{o.name}</td>
                    <td className="t-mono">{o.estimate.toFixed(2)}</td>
                    <td className="t-mono">{o.fact.toFixed(2)}</td>
                    <td className="t-mono" style={{ color: o.ratio > 1.001 ? '#FCD34D' : o.ratio < 0.999 ? '#93C5FD' : 'var(--fg-2)' }}>{fmtRatio(o.ratio)}</td>
                    <td className="t-mono">{fmtDateRu(o.finishedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {obs.length > 12 ? <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>…и ещё {obs.length - 12}; в подсказке участвуют все наблюдения.</div> : null}
            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
              Предложение: умножить оценки на медиану {fmtRatio(calStats.median)} — строк с полной тройкой без факта: {calTargets.length}
              {calSkipHistory ? `, заполнены из истории (не трогаем): ${calSkipHistory}` : ''}
              {calSkipNoTriple ? `, без полной тройки пропустятся: ${calSkipNoTriple}` : ''}. Завершённые строки не трогаем: их оценка уже история.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={savingId === 'cal' || !calTargets.length}
                onClick={applyCalibration}
                style={calConfirm ? { borderColor: '#F59E0B', color: '#FCD34D' } : undefined}
              >
                {savingId === 'cal' ? 'Применяю…' : calConfirm ? `Подтвердить умножение` : `Применить ${fmtRatio(calStats.median)} к оценкам`}
              </button>
              {calConfirm ? (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setCalConfirm(false);
                    setCalNote('Умножение отменено — оценки не тронуты.');
                  }}
                  title="Снять подтверждение — ничего не будет применено"
                >
                  Отмена
                </button>
              ) : null}
              <span style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>источник оценок станет «коэффициент»; это пересчёт, а не новое измерение</span>
            </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
                {useHistory
                  ? 'Нет наблюдений — заполните «Факт, ч» у завершённых операций.'
                  : 'Исторические данные выключены — включите переключатель, чтобы увидеть подсказки; журнал применений доступен ниже.'}
              </div>
            )}
            {calLog && calLog.length ? (
              <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                Применения (журнал): {calLog.length}
                <table className="tbl" style={{ maxWidth: 860, marginTop: 4 }}>
                  <thead>
                    <tr><th>Когда</th><th>Коэффициент</th><th>Охват</th><th>Строк</th><th>Наблюдений</th><th>Статус</th><th /></tr>
                  </thead>
                  <tbody>
                    {calLog.map((e) => (
                      <tr key={e.id}>
                        <td className="t-mono">{e.at}</td>
                        <td className="t-mono">{fmtRatio(e.coefficient)}</td>
                        <td>{e.scope || 'все строки'}</td>
                        <td className="t-mono">{e.appliedCount}</td>
                        <td className="t-mono">{e.observations}</td>
                        <td>{e.reverted ? '(возвращено)' : 'применено'}</td>
                        <td>
                          {!e.reverted && onCalRevert ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={savingId === 'calrev-' + e.id}
                              onClick={async () => {
                                setSavingId('calrev-' + e.id);
                                try {
                                  await onCalRevert(e.id);
                                  setCalNote('Применение возвращено — оценки восстановлены.');
                                } catch (err: any) {
                                  setCalNote('Не удалось вернуть: ' + (err?.message || String(err)));
                                } finally {
                                  setSavingId(null);
                                }
                              }}
                              title="Вернуть оценки, которые были до этого применения"
                            >
                              {savingId === 'calrev-' + e.id ? '…' : 'Вернуть'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {calNote ? <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{calNote}</div> : null}
          </div>
        ) : null}
        <div style={{ fontSize: 12, color: 'var(--fg-3)', margin: '8px 0 10px' }}>
          Введите три оценки по каждой операции. Порядок: оптимистичная ≤ вероятная ≤ пессимистичная — иначе строка
          не сохранится. Ожидаемая длительность и разброс считаются тут же и ничего не меняют в данных.
          Для завершённых операций заполните «Факт, ч» и дату — это основа калибровки.
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
                <th>Факт, ч</th>
                <th>Завершена</th>
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
                      <input
                        style={{ ...inputStyle, width: 66 }}
                        value={factCell(op)}
                        onChange={(e) => setFactCell(op.id, e.target.value)}
                        placeholder="—"
                        title="Фактическая длительность завершённой операции, ч — основа калибровки"
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        style={{ ...inputStyle, width: 132, textAlign: 'left', colorScheme: 'dark' }}
                        value={factDateCell(op)}
                        onChange={(e) => setFactDateCell(op.id, e.target.value)}
                        title="Дата завершения операции — по датам считается период наблюдений"
                      />
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
