/**
 * Режимы расчёта: описания для конструктора (блок 6.29 плана; спецификация — Дополнение 15).
 *
 * Один источник текстов и требований на всё приложение: карточки настроек, рекомендация
 * и будущая справка берут режимы отсюда — чтобы описания не расходились между экранами.
 *
 * Принцип: у каждого режима шесть пунктов — что считает · что получите · что нужно ·
 * чего не будет · время · когда выбирать. Пустое место лучше правдоподобного числа,
 * поэтому требования оформлены проверками, а не обещаниями.
 */

export type ModeRequirement = 'estimates' | 'dependencies' | 'resources' | 'portfolio';

export type CalcMode = {
  id: string;
  title: string;
  /** Что считает одной строкой */
  computes: string;
  /** Что получите */
  gives: string[];
  /** Требования: проверки, выполняемые по данным проекта */
  requires: ModeRequirement[];
  /** Чего не будет */
  limits: string[];
  /** Цена времени */
  time: string;
  /** Когда выбирать */
  when: string;
};

export const MODE_REQUIREMENT_TEXT: Record<ModeRequirement, string> = {
  estimates: 'тройные оценки по операциям',
  dependencies: 'связи между операциями',
  resources: 'ресурсы и графики работы',
  portfolio: 'несколько проектов с общими ресурсами',
};

export const CALC_MODES: CalcMode[] = [
  {
    id: 'plan',
    title: '1. Срок и резервы',
    computes: 'один проход по сети с календарями и событиями мощности',
    gives: ['срок проекта', 'критический путь', 'резерв каждой операции'],
    requires: ['dependencies'],
    limits: ['никакой оценки вероятности — только «как посчитано»'],
    time: 'мгновенно',
    when: 'известны длительности, нужен срок и понимание, что критично',
  },
  {
    id: 'pert',
    title: '2. Риск срока — аналитический (PERT)',
    computes: 'ожидаемые длительности и разброс по критическому пути',
    gives: ['интервал 68 %', 'интервал 95 %', 'вклад операций в разброс'],
    requires: ['dependencies', 'estimates'],
    limits: ['не увидит, как критическими становятся другие пути: состав критического пути считается неизменным'],
    time: 'мгновенно',
    when: 'оценки есть, нужен быстрый интервал',
  },
  {
    id: 'monte-carlo',
    title: '3. Риск срока — численный (Монте-Карло)',
    computes: 'много прогонов с розыгрышем длительностей и полным пересчётом сети',
    gives: ['распределение срока', 'процентили p50 / p80 / p95', 'вероятность уложиться в дату', 'операции, чаще всего попадающие на критический путь'],
    requires: ['dependencies', 'estimates'],
    limits: ['ресурсы внутри прогонов не пересчитываются — результат оптимистичнее реальности'],
    time: 'секунды',
    when: 'нужна вероятность даты, а не только интервал',
  },
  {
    id: 'both',
    title: '4. Риск срока — оба метода',
    computes: 'PERT и Монте-Карло на одних данных',
    gives: ['оба ответа рядом', 'видно, где аналитический расчёт расходится с численным'],
    requires: ['dependencies', 'estimates'],
    limits: ['числа не усредняются: это два разных ответа, и подписываются они своим методом'],
    time: 'секунды',
    when: 'нужно сравнить быструю оценку с точной',
  },
  {
    id: 'resources',
    title: '5. Риск срока с ресурсами',
    computes: 'как численный режим, но в каждом прогоне ресурсы перераспределяются заново',
    gives: ['честный разброс с учётом конфликтов ресурсов и потерь'],
    requires: ['dependencies', 'estimates', 'resources'],
    limits: ['дорого по времени; не подходит для прикидочного расчёта'],
    time: 'минуты',
    when: 'ресурсы ограничивают и нужна точность',
  },
  {
    id: 'portfolio',
    title: '6. Портфель (CCM)',
    computes: 'объединение проектов: общие ресурсы и критическая цепь',
    gives: ['сроки портфеля', 'кто кого сдвигает', 'критические проекты'],
    requires: ['dependencies', 'portfolio'],
    limits: ['анализ разброса — отдельным выбором внутри режима'],
    time: 'секунды–минуты',
    when: 'у проектов общие ресурсы',
  },
  {
    id: 'buffers',
    title: '7. Защита срока буферами',
    computes: 'надстройка к любому режиму: агрессивные длительности и буферы',
    gives: ['проектный буфер', 'питающие буферы', 'ресурсные буферы', 'правило расхода буфера'],
    requires: ['dependencies', 'estimates'],
    limits: ['меняет входные данные: сроки становятся напряжённее — это подписывается в результате'],
    time: 'мгновенно',
    when: 'дату нужно защитить запасом, а не показать «средний» срок',
  },
];

/** Состояние данных проекта — по нему считается рекомендация и проверяются требования. */
export type ModeContext = {
  operations: number;
  withEstimates: number;
  dependencies: number;
  resources: number;
  sharedResources: number;
  projectsWithSharedResources: number;
};

export type RequirementStatus = { ok: boolean; text: string };

export function modeRequirements(mode: CalcMode, ctx: ModeContext): RequirementStatus[] {
  return mode.requires.map((r) => {
    if (r === 'estimates') {
      const ok = ctx.withEstimates > 0;
      return { ok, text: `${MODE_REQUIREMENT_TEXT[r]}: заполнено ${ctx.withEstimates} из ${ctx.operations}` };
    }
    if (r === 'dependencies') {
      const ok = ctx.dependencies > 1;
      return { ok, text: `${MODE_REQUIREMENT_TEXT[r]}: ${ctx.dependencies}` };
    }
    if (r === 'resources') {
      const ok = ctx.resources > 0;
      return { ok, text: `${MODE_REQUIREMENT_TEXT[r]}: ${ctx.resources}` };
    }
    const ok = ctx.projectsWithSharedResources > 1;
    return { ok, text: `${MODE_REQUIREMENT_TEXT[r]}: проектов ${ctx.projectsWithSharedResources}` };
  });
}

/** Куда ведёт режим в интерфейсе — для интерактивных схем справки (блок 6.31.4). */
export const MODE_UI_TARGET: Record<string, string> = {
  plan: 'gantt',
  pert: 'pert',
  'monte-carlo': 'monte-carlo',
  both: 'pert',
  resources: 'monte-carlo',
  portfolio: 'network',
  buffers: 'pert',
};

/** Подписи мест интерфейса для кнопок схем. */
export const NAV_TARGET_LABEL: Record<string, string> = {
  overview: 'Обзор',
  gantt: 'Гант (рассчитать проект)',
  network: 'Сетевой график',
  estimates: 'Оценки',
  pert: 'PERT',
  'monte-carlo': 'Монте-Карло',
  runs: 'Запуски',
  settings: 'Настройки расчёта',
};

/** Шаги режима для живой схемы справки (блок 6.31.4): каждая ступень ведёт в интерфейс. */
export const MODE_STEPS: Record<string, { label: string; target: string }[]> = {
  plan: [
    { label: 'Связи и данные', target: 'network' },
    { label: 'Рассчитать проект', target: 'gantt' },
    { label: 'Результат — обзор', target: 'overview' },
  ],
  pert: [
    { label: 'Оценки O/M/P', target: 'estimates' },
    { label: 'Расчёт PERT', target: 'pert' },
  ],
  'monte-carlo': [
    { label: 'Оценки O/M/P', target: 'estimates' },
    { label: 'Прогоны МК', target: 'monte-carlo' },
  ],
  both: [
    { label: 'Оценки O/M/P', target: 'estimates' },
    { label: 'PERT', target: 'pert' },
    { label: 'Монте-Карло', target: 'monte-carlo' },
  ],
  resources: [
    { label: 'Оценки O/M/P', target: 'estimates' },
    { label: 'Прогоны с мощностями', target: 'monte-carlo' },
  ],
  portfolio: [
    { label: 'Сетевой график', target: 'network' },
    { label: 'Настройки расчёта', target: 'settings' },
  ],
  buffers: [
    { label: 'Оценки O/P', target: 'estimates' },
    { label: 'Буферы на PERT', target: 'pert' },
  ],
};

/** Рекомендация по данным проекта — с причиной, а не галочкой. */
export function recommendMode(ctx: ModeContext): { modeId: string; reason: string } {
  if (ctx.withEstimates === 0) {
    return {
      modeId: 'plan',
      reason: 'оценок нет — пока считаем срок и резервы; интервалы появятся после заполнения оценок',
    };
  }
  if (ctx.projectsWithSharedResources > 1) {
    return {
      modeId: 'portfolio',
      reason: 'у проектов есть общие ресурсы — сначала объединение, иначе общие работы будут посчитаны дважды',
    };
  }
  if (ctx.sharedResources > 0 && ctx.resources > 0) {
    return {
      modeId: 'resources',
      reason: `оценки заполнены, а общих ресурсов внутри проекта ${ctx.sharedResources} — численный режим с ресурсами даст честный разброс`,
    };
  }
  if (ctx.withEstimates >= ctx.operations && ctx.operations > 0) {
    return {
      modeId: 'monte-carlo',
      reason: 'оценки заполнены по всем операциям — можно получить вероятность даты, а не только интервал',
    };
  }
  return {
    modeId: 'pert',
    reason: `оценки заполнены частично (${ctx.withEstimates} из ${ctx.operations}) — аналитический режим работает и на неполных данных`,
  };
}
