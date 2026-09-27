/**
 * Расчёты — модель методов (блок 6.16 плана; спецификация — Дополнение 11 промта).
 *
 * Две НЕЗАВИСИМЫЕ оси:
 *   1) логика планирования — CPM (критический путь) или CCM (межпроектное объединение);
 *   2) модель оценки — детерминированная, PERT или Монте-Карло.
 * Сочетания допустимы любые; оси нельзя скрещивать в один «составной» метод.
 *
 * В коде проекта пока хранится ОДНА строка `projects.default_method`
 * (cpm | pert_cpm | cpm_ccm | pert_ccm). Здесь она раскладывается на оси ЧТЕНИЕМ —
 * хранение не меняется. Перевод хранения на две оси и раздел настроек расчёта —
 * отдельная работа блока 6.16.7 (сейчас не сделано).
 */

export type PlanningLogic = 'cpm' | 'ccm';
export type UncertaintyAnalysis = 'none' | 'pert' | 'mc';

export type CalcMethods = {
  logic: PlanningLogic;
  analysis: UncertaintyAnalysis;
  /** Исходное значение из проекта — чтобы показать, откуда взяты оси. */
  raw: string;
};

const LOGIC_LABEL: Record<PlanningLogic, string> = {
  cpm: 'CPM — критический путь',
  ccm: 'CCM — межпроектное объединение',
};

const ANALYSIS_LABEL: Record<UncertaintyAnalysis, string> = {
  none: 'без анализа неопределённости',
  pert: 'PERT — аналитическая оценка',
  mc: 'Монте-Карло — симуляция',
};

export function parseCalcMethods(
  defaultMethod?: string | null,
  planningLogic?: string | null,
  uncertaintyAnalysis?: string | null,
): CalcMethods {
  const raw = String(defaultMethod || 'cpm').toLowerCase();
  const fromMethodLogic: PlanningLogic = raw.includes('ccm') ? 'ccm' : 'cpm';
  const fromMethodAnalysis: UncertaintyAnalysis = raw.includes('pert')
    ? 'pert'
    : raw.includes('mc')
      ? 'mc'
      : 'none';

  // Хранимые оси (projects.planning_logic / projects.uncertainty_analysis) — источник истины.
  // Строка default_method остаётся для совместимости и используется, если осей в ответе нет.
  const logic: PlanningLogic =
    planningLogic === 'cpm' || planningLogic === 'ccm' ? (planningLogic as PlanningLogic) : fromMethodLogic;
  const analysis: UncertaintyAnalysis =
    uncertaintyAnalysis === 'none' || uncertaintyAnalysis === 'pert' || uncertaintyAnalysis === 'mc'
      ? (uncertaintyAnalysis as UncertaintyAnalysis)
      : fromMethodAnalysis;

  return { logic, analysis, raw };
}

export function logicLabel(logic: PlanningLogic): string {
  return LOGIC_LABEL[logic];
}

export function analysisLabel(analysis: UncertaintyAnalysis): string {
  return ANALYSIS_LABEL[analysis];
}

/**
 * Три состояния значка метода: заполнено / частично / не заполнено
 * (Дополнение 11, пункт 11; отображается одинаково во всех вкладках).
 */
export type MethodFill = 'filled' | 'partial' | 'empty';

export const METHOD_FILL_LABEL: Record<MethodFill, string> = {
  filled: 'заполнено',
  partial: 'частично',
  empty: 'не заполнено',
};

/** Цвет состояния — только из палитры темы, без хардкода. */
export const METHOD_FILL_COLOR: Record<MethodFill, string> = {
  filled: 'var(--success)',
  partial: 'var(--warning)',
  empty: 'var(--fg-4)',
};
