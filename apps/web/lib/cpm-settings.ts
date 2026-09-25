/**
 * Настройки счётчика качества сети CPM.
 *
 * Модуль чистый (без React): значения хранятся в localStorage, читаются/пишутся
 * панелью графика (`CpmGraph`) и напрямую влияют на:
 *   • оптимизацию раскладки — число проходов и веса приоритетов критерия
 *     (наложение узлов важнее прохода линии сквозь узел, а тот важнее простого
 *     пересечения связей);
 *   • подсветку «цель достигнута» — цели по пересечениям и проходам сквозь узлы;
 *   • порог критичности коэффициента напряжённости работ.
 *
 * Значения по умолчанию подобраны так, чтобы качество раскладки на эталонном
 * стенде не ухудшалось (вес прохода сквозь узел равен весу пересечения — на
 * реальных данных дальнейший рост этого веса ухудшает число пересечений,
 * см. отчёт), при этом наложение узлов весит в 50 раз больше.
 */

import { DEFAULT_GEOMETRY, type LayoutGeometry } from './cpm-metrics';

export interface CpmSettings {
  /** Порог коэффициента напряжённости K, выше которого работа подсвечивается. */
  stretchK: number;
  /** Цель по числу пересечений связей (по ней показывается «цель достигнута»). */
  crossingsTarget: number;
  /** Цель по числу проходов связей сквозь посторонние узлы. */
  hitsTarget: number;
  /** Вес простого пересечения связей в критерии оптимизации. */
  weightCross: number;
  /** Вес прохода связи сквозь посторонний узел. */
  weightHit: number;
  /** Вес наложения узлов друг на друга. */
  weightOverlap: number;
  /** Число проходов локальной оптимизации раскладки. */
  optPasses: number;
}

export const DEFAULT_SETTINGS: CpmSettings = {
  stretchK: 0.8,
  crossingsTarget: 20,
  hitsTarget: 0,
  weightCross: 1,
  weightHit: 1,
  weightOverlap: 50,
  optPasses: 8,
};

export const SETTINGS_KEY = 'cpm.qualitySettings';

export type PresetId = 'custom' | 'compact' | 'readable' | 'print';

export interface CpmPreset {
  id: Exclude<PresetId, 'custom'>;
  label: string;
  hint: string;
  settings: CpmSettings;
}

/**
 * Три готовых профиля: быстрый, сбалансированный и максимально тщательный.
 *
 * Вес прохода сквозь узел по умолчанию оставлен равным весу пересечения: на
 * эталонных данных подъём этого веса УХУДШАЕТ число пересечений (жадный локальный
 * поиск уходит в другую ямку), поэтому профили различаются числом проходов,
 * весом наложения узлов и целями, а не «перекосом» в сторону прохода сквозь узел.
 */
export const PRESETS: CpmPreset[] = [
  {
    id: 'compact',
    label: 'компактный',
    hint: 'быстрая раскладка, мягкие цели',
    settings: { stretchK: 0.75, crossingsTarget: 30, hitsTarget: 2, weightCross: 1, weightHit: 1, weightOverlap: 50, optPasses: 7 },
  },
  {
    id: 'readable',
    label: 'читаемый',
    hint: 'сбалансированно, цели по эталону',
    settings: { stretchK: 0.8, crossingsTarget: 16, hitsTarget: 0, weightCross: 1, weightHit: 1, weightOverlap: 60, optPasses: 10 },
  },
  {
    id: 'print',
    label: 'для печати',
    hint: 'максимум проходов, строгие цели',
    settings: { stretchK: 0.85, crossingsTarget: 0, hitsTarget: 0, weightCross: 1, weightHit: 1, weightOverlap: 80, optPasses: 20 },
  },
];

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

/** Приводит произвольный объект к корректным настройкам (защита localStorage/инпутов). */
export function sanitizeSettings(v: any): CpmSettings {
  const d = DEFAULT_SETTINGS;
  const src = v && typeof v === 'object' ? v : {};
  return {
    stretchK: clampNum(src.stretchK, 0.3, 1, d.stretchK),
    crossingsTarget: Math.round(clampNum(src.crossingsTarget, 0, 999, d.crossingsTarget)),
    hitsTarget: Math.round(clampNum(src.hitsTarget, 0, 999, d.hitsTarget)),
    weightCross: clampNum(src.weightCross, 0.1, 1000, d.weightCross),
    weightHit: clampNum(src.weightHit, 0.1, 1000, d.weightHit),
    weightOverlap: clampNum(src.weightOverlap, 0.1, 5000, d.weightOverlap),
    optPasses: Math.round(clampNum(src.optPasses, 0, 40, d.optPasses)),
  };
}

/** Читает настройки из localStorage (при любой ошибке — значения по умолчанию). */
export function loadSettings(): CpmSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Сохраняет настройки в localStorage (ошибки квоты/приватного режима игнорируются). */
export function saveSettings(s: CpmSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s)));
  } catch {
    /* localStorage недоступен — настройки действуют только в текущей сессии */
  }
}

/** Опции раскладки, вытекающие из настроек (передаются в computeLayout). */
export function settingsToLayoutOptions(s: CpmSettings): {
  localPasses: number;
  crossWeight: number;
  hitWeight: number;
  overlapWeight: number;
} {
  return {
    localPasses: s.optPasses,
    crossWeight: s.weightCross,
    hitWeight: s.weightHit,
    overlapWeight: s.weightOverlap,
  };
}

/** Какому готовому профилю соответствуют настройки (или 'custom'). */
export function matchPreset(s: CpmSettings): PresetId {
  for (const p of PRESETS) {
    const t = p.settings;
    if (
      t.stretchK === s.stretchK &&
      t.crossingsTarget === s.crossingsTarget &&
      t.hitsTarget === s.hitsTarget &&
      t.weightCross === s.weightCross &&
      t.weightHit === s.weightHit &&
      t.weightOverlap === s.weightOverlap &&
      t.optPasses === s.optPasses
    ) return p.id;
  }
  return 'custom';
}

/* ─────────────────────── раскладка (единственный орган управления) ─────────────────────── */

/**
 * Раскладка — единственная настройка качества, видимая пользователю.
 * Четыре положения: «Плотно» (больше на экране), «Обычно» (рабочий вид),
 * «Для печати» (крупные узлы и подписи) и «Без пересечений» — структурная
 * укладка под ноль пересечений связей (доступна в раскладке «По слоям»,
 * хронология в ней не показывается).
 */
export type LayoutPreset = 'compact' | 'normal' | 'print' | 'noplan';

export const LAYOUT_PRESET_KEY = 'cpm.layoutPreset';
export const DEFAULT_LAYOUT_PRESET: LayoutPreset = 'normal';

/**
 * Порог коэффициента напряжённости K. Зафиксирован как внутреннее значение
 * (в интерфейсе больше не настраивается): выше порога работа подсвечивается
 * как «натянутая».
 */
export const STRETCH_K = 0.8;

export interface LayoutPresetDef {
  id: LayoutPreset;
  label: string;
  hint: string;
  /** Внутренние параметры оптимизации раскладки (в интерфейсе не показываются). */
  settings: CpmSettings;
  /**
   * Геометрия раскладки: размер узла, зазоры и отступ. Именно она заставляет
   * пресеты отличаться по виду и числам (плотность, читаемость), а не только по
   * внутренним проходам оптимизации.
   */
  geom: LayoutGeometry;
  /** Целевой масштаб начальной подгонки вида (как показать сеть при открытии). */
  fitTarget: number;
  /** Минимальный масштаб начальной подгонки вида. */
  fitMin: number;
}

/**
 * Четыре положения переключателя раскладки. Веса, число проходов, цели и порог
 * напряжённости остаются здесь как разумные значения по умолчанию:
 *   • «Обычно» — текущее поведение (наложение узлов приоритетнее, порог K = 0,8);
 *   • «Плотно» — быстрее и плотнее (меньше проходов оптимизации, мелкий начальный вид);
 *   • «Для печати» — тщательнее (больше проходов, выше вес наложения узлов, крупный начальный вид);
 *   • «Без пересечений» — структурная укладка с максимумом проходов под ноль
 *     пересечений связей. Доступна только в раскладке «По слоям» (хронология в
 *     ней не рисуется); при непланарном (под)графе честно сообщает, что ноль
 *     недостижим, и показывает достигнутый минимум.
 */
export const LAYOUT_PRESETS: LayoutPresetDef[] = [
  {
    id: 'compact', label: 'Плотно', hint: 'больше работ на экране · мелкие узлы и узкие отступы',
    settings: { ...DEFAULT_SETTINGS, optPasses: 6 },
    // Мелкие карточки + сильно сжатые зазоры: на экран влезает заметно больше
    // работ, а плотность (доля площади узлов) растёт.
    geom: { ...DEFAULT_GEOMETRY, cardW: 152, cardH: 42, colGap: 10, rowGap: 6, pad: 48, labelScale: 0.9 },
    fitTarget: 0.7, fitMin: 0.4,
  },
  {
    id: 'normal', label: 'Обычно', hint: 'рабочий вид',
    settings: { ...DEFAULT_SETTINGS },
    // Рабочее состояние: базовые размеры и зазоры.
    geom: { ...DEFAULT_GEOMETRY },
    fitTarget: 0.85, fitMin: 0.5,
  },
  {
    id: 'print', label: 'Для печати', hint: 'крупные узлы и подписи',
    settings: { ...DEFAULT_SETTINGS, optPasses: 16, weightOverlap: 80 },
    // Крупные карточки и подписи, увеличенные зазоры. Карточка растёт сильнее
    // зазоров, поэтому доля площади узлов (плотность) тоже выше.
    geom: { ...DEFAULT_GEOMETRY, cardW: 300, cardH: 96, colGap: 40, rowGap: 28, pad: 96, labelScale: 1.22 },
    fitTarget: 1.15, fitMin: 0.7,
  },
  {
    id: 'noplan', label: 'Без пересечений',
    hint: 'структурная укладка без пересечений · хронология не показывается',
    // Настройки оптимизации как в «Обычно»: отличие этого пресета — не в весах,
    // а в том, что для него включается перебор нескольких детерминированных
    // стартов структурной укладки (в т.ч. слой «по связям») и берётся лучший по
    // счётчику качества. Это и даёт укладку без пересечений на планарных
    // подграфах; на непланарных — достигнутый минимум без ухудшения «Обычно».
    settings: { ...DEFAULT_SETTINGS },
    geom: { ...DEFAULT_GEOMETRY },
    fitTarget: 0.9, fitMin: 0.5,
  },
];

/** Нормализует произвольное значение к известному положению раскладки. */
export function sanitizeLayoutPreset(v: unknown): LayoutPreset {
  return v === 'compact' || v === 'normal' || v === 'print' || v === 'noplan'
    ? v
    : DEFAULT_LAYOUT_PRESET;
}

/** Определение раскладки по идентификатору (с откатом к «Обычно»). */
export function getLayoutPreset(id: string | null | undefined): LayoutPresetDef {
  return LAYOUT_PRESETS.find((p) => p.id === id) || LAYOUT_PRESETS[1];
}

/** Читает выбранную раскладку из localStorage (при любой ошибке — «Обычно»). */
export function loadLayoutPreset(): LayoutPreset {
  try {
    return sanitizeLayoutPreset(window.localStorage.getItem(LAYOUT_PRESET_KEY));
  } catch {
    return DEFAULT_LAYOUT_PRESET;
  }
}

/** Сохраняет выбранную раскладку в localStorage. */
export function saveLayoutPreset(p: LayoutPreset): void {
  try {
    window.localStorage.setItem(LAYOUT_PRESET_KEY, sanitizeLayoutPreset(p));
  } catch {
    /* localStorage недоступен — выбор действует в текущей сессии */
  }
}

/* ─────────────────── крыжик «Выравнивать по границам периода» ─────────────────── */

/**
 * Ключ хранения крыжика «Выравнивать по границам периода» (структурная укладка
 * «По слоям»). Ключ ВЕРСИОНИРОВАН (`.v2`): раньше значение по умолчанию было
 * «выключено», поэтому любая запись прошлого вида неотличима от «никогда не
 * трогали» и не должна продолжать гасить крыжик. Новая версия ключа начинает
 * с чистого листа — наследованное «выключено» не читается вовсе.
 */
export const ALIGN_CUT_KEY = 'cpm.align-cut-ends.v2';
/** Устаревший (безверсионный) ключ прошлой версии — читается только чтобы осознанно его игнорировать. */
export const LEGACY_ALIGN_CUT_KEY = 'cpm.align-cut-ends';
/** Значение крыжика по умолчанию: включён. */
export const DEFAULT_ALIGN_CUT = true;

/**
 * Читает крыжик «Выравнивать по границам периода» из localStorage.
 *
 * Значение по умолчанию — ВКЛЮЧЕНО. Если ключа новой версии нет, возвращается
 * умолчание независимо от возможного старого (безверсионного) значения: прежнее
 * умолчание было «выключено», поэтому такая запись не может трактоваться как
 * осознанный выбор пользователя. Явное выключение под новым ключом уважается.
 */
export function loadAlignCutEnds(): boolean {
  try {
    const raw = window.localStorage.getItem(ALIGN_CUT_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return DEFAULT_ALIGN_CUT;
  } catch {
    return DEFAULT_ALIGN_CUT;
  }
}

/** Сохраняет осознанный выбор крыжика (включено/выключено) в localStorage. */
export function saveAlignCutEnds(on: boolean): void {
  try {
    window.localStorage.setItem(ALIGN_CUT_KEY, on ? '1' : '0');
  } catch {
    /* localStorage недоступен — выбор действует только в текущей сессии */
  }
}
