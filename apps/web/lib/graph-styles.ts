/**
 * Палитры стилей графиков (вид «Сеть CPM»).
 *
 * Используется в настройках рабочего стола: пункт «Стиль графиков» открывает окно
 * с примерами (те же сцены, что в макете) и сохраняет выбранный вариант.
 *
 * Цвета разделены на смысловые и объектовые:
 *   смысловые — критические операции (красный), операции с резервом (синий);
 *   объектовые — простой заказ, группа с маркерами, пул (варьируется палитрой).
 */

export type GraphPaletteGroup = 'plain' | 'deep' | 'deepest' | 'brand';

export interface GraphPalette {
  id: string;
  group: GraphPaletteGroup;
  name: string;
  /** цвет рамки и контура объектов пула */
  frame: string;
  /** цвет заливки области пула */
  fill: string;
  /** плотность заливки области пула (0..1) */
  fillOpacity: number;
  note: string;
}

export const PALETTE_GROUP_TITLES: Record<GraphPaletteGroup, string> = {
  plain: 'Обычная заливка',
  deep: 'Глубокая тёмная заливка',
  deepest: 'Максимально глубокая заливка (почти чёрная)',
  brand: 'Основные цвета сайта (фирменный синий и его оттенки)',
};

export const GRAPH_PALETTES: GraphPalette[] = [
  // 1–6 обычная заливка
  { id: 'jade', group: 'plain', name: 'Нефрит', frame: '#4FB79B', fill: '#17453C', fillOpacity: 0.55, note: 'Спокойный зелёный: не спорит с критическим.' },
  { id: 'sea', group: 'plain', name: 'Море', frame: '#3FA9C9', fill: '#123F4C', fillOpacity: 0.55, note: 'Близок к цвету заказа, отличие по насыщенности.' },
  { id: 'graphite', group: 'plain', name: 'Графит', frame: '#8A9CB3', fill: '#26313F', fillOpacity: 0.7, note: 'Нейтральный: пул как служебный объект.' },
  { id: 'rose', group: 'plain', name: 'Пыльная роза', frame: '#C77E93', fill: '#4A2531', fillOpacity: 0.6, note: 'Явно «не красный», пул и критические не спутать.' },
  { id: 'lavender', group: 'plain', name: 'Глубокая лаванда', frame: '#9C8BE0', fill: '#2E2A4D', fillOpacity: 0.65, note: 'Близко к цвету группы — только вместе со сменой цвета группы.' },
  { id: 'copper', group: 'plain', name: 'Медь', frame: '#C08A5A', fill: '#4A2F1C', fillOpacity: 0.6, note: 'Тёплый, мягче янтарного.' },

  // 7–12 глубокая
  { id: 'jade-deep', group: 'deep', name: 'Нефрит глубокий', frame: '#3E9A82', fill: '#08211C', fillOpacity: 0.95, note: 'Плотный тёмный фон: пул как отдельная зона.' },
  { id: 'sea-deep', group: 'deep', name: 'Море глубокое', frame: '#2E86A3', fill: '#07202A', fillOpacity: 0.95, note: 'Плотный фон, бирюзовая рамка.' },
  { id: 'graphite-deep', group: 'deep', name: 'Графит глубокий', frame: '#6E7F94', fill: '#151D26', fillOpacity: 0.95, note: 'Сдержанный служебный вид.' },
  { id: 'rose-deep', group: 'deep', name: 'Роза глубокая', frame: '#A96377', fill: '#2A1119', fillOpacity: 0.95, note: 'Тёмный фон, розовая рамка.' },
  { id: 'lavender-deep', group: 'deep', name: 'Лаванда глубокая', frame: '#8272C4', fill: '#181430', fillOpacity: 0.95, note: 'Требует перекраски группы, иначе путается.' },
  { id: 'copper-deep', group: 'deep', name: 'Медь глубокая', frame: '#A5714A', fill: '#2A1809', fillOpacity: 0.95, note: 'Тёплый тёмный фон.' },

  // 13–18 бездонная
  { id: 'jade-abyss', group: 'deepest', name: 'Нефрит бездонный', frame: '#2E7D69', fill: '#051512', fillOpacity: 1, note: 'Почти чёрный фон, рамка несёт гамму.' },
  { id: 'sea-abyss', group: 'deepest', name: 'Море бездонное', frame: '#24708A', fill: '#04141C', fillOpacity: 1, note: 'Максимальный контраст для критических внутри пула.' },
  { id: 'graphite-abyss', group: 'deepest', name: 'Графит бездонный', frame: '#55637A', fill: '#0C1117', fillOpacity: 1, note: 'Пул как «тёмная зона» без цвета.' },
  { id: 'rose-abyss', group: 'deepest', name: 'Роза бездонная', frame: '#8C4C60', fill: '#1B0A10', fillOpacity: 1, note: 'Тёмная зона с розовой рамкой.' },
  { id: 'lavender-abyss', group: 'deepest', name: 'Лаванда бездонная', frame: '#6A5CA8', fill: '#0F0B20', fillOpacity: 1, note: 'Тёмная зона с фиолетовой рамкой.' },
  { id: 'copper-abyss', group: 'deepest', name: 'Медь бездонная', frame: '#8A5C3A', fill: '#1B0F06', fillOpacity: 1, note: 'Тёмная зона с медной рамкой.' },

  // 19–24 фирменные цвета сайта
  { id: 'brand', group: 'brand', name: 'Фирменный синий', frame: '#3B82F6', fill: '#0A1B33', fillOpacity: 0.95, note: 'Гамма сайта; совпадает с цветом операций с резервом.' },
  { id: 'brand-deep', group: 'brand', name: 'Синий глубже', frame: '#2563EB', fill: '#08142B', fillOpacity: 0.95, note: 'Плотнее фирменного.' },
  { id: 'sky', group: 'brand', name: 'Небесный', frame: '#38BDF8', fill: '#06202F', fillOpacity: 0.95, note: 'Светлая рамка, тёмный фон.' },
  { id: 'indigo', group: 'brand', name: 'Индиго', frame: '#6366F1', fill: '#0D1033', fillOpacity: 0.95, note: 'Ближе к фиолетовому — осторожно с группой.' },
  { id: 'steel', group: 'brand', name: 'Стальной', frame: '#60A5FA', fill: '#0B1A2E', fillOpacity: 0.95, note: 'Мягкий синий.' },
  { id: 'panel', group: 'brand', name: 'Панель (тёмно-синий)', frame: '#4C7DBE', fill: '#101C2E', fillOpacity: 0.95, note: 'Совпадает с тоном панелей интерфейса.' },
];

/** Смысловые цвета — не меняются палитрой. */
export const SEMANTIC_COLORS = {
  critical: '#EF4444',
  criticalFill: '#7F1D1D',
  reserve: '#3B82F6',
  reserveFill: '#16324F',
  orderFrame: '#38BDF8',
  groupFrame: '#A78BFA',
  text: '#E8EEF8',
  muted: '#8FA3BD',
  background: '#0F1B2D',
  line: '#26364F',
};

export const DEFAULT_PALETTE_ID = 'rose-abyss';

export function getPalette(id?: string | null): GraphPalette {
  return GRAPH_PALETTES.find((p) => p.id === id) || GRAPH_PALETTES.find((p) => p.id === DEFAULT_PALETTE_ID) || GRAPH_PALETTES[0];
}

// ── Светлая тема ────────────────────────────────────────────────────────────
// Тёмная палитра зеркалится: заливка осветляется, рамка затемняется.
// Значения подобраны функцией смешивания, при необходимости конкретные
// оттенки можно переопределить вручную в GRAPH_PALETTES_LIGHT_OVERRIDES.

export type ThemeName = 'dark' | 'light';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** Смешивание цвета с белым (amount > 0) или с чёрным (amount < 0). */
export function mixColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount >= 0 ? [255, 255, 255] : [0, 0, 0];
  const k = Math.abs(amount);
  return rgbToHex([
    r + (target[0] - r) * k,
    g + (target[1] - g) * k,
    b + (target[2] - b) * k,
  ] as [number, number, number]);
}

/** Зеркальный вариант палитры для светлой темы. */
export function mirrorPaletteToLight(p: GraphPalette): GraphPalette {
  const override = GRAPH_PALETTES_LIGHT_OVERRIDES[p.id];
  if (override) return { ...p, ...override, id: p.id + '-light', group: p.group };
  return {
    ...p,
    id: p.id + '-light',
    frame: mixColor(p.frame, -0.35),
    fill: mixColor(p.fill, 0.86),
    fillOpacity: Math.max(0.25, Math.min(0.6, p.fillOpacity * 0.55)),
    note: p.note + ' (светлая тема)',
  };
}

/** Точечные переопределения для светлой темы — если зеркало окажется неидеальным. */
export const GRAPH_PALETTES_LIGHT_OVERRIDES: Record<string, Partial<GraphPalette>> = {
  // пример: 'rose': { frame: '#9E4A5E', fill: '#F7E7EB', fillOpacity: 0.5 },
};

export function palettesForTheme(theme: ThemeName): GraphPalette[] {
  return theme === 'light' ? GRAPH_PALETTES.map(mirrorPaletteToLight) : GRAPH_PALETTES;
}

/** Смысловые цвета светлой темы. */
export const SEMANTIC_COLORS_LIGHT = {
  critical: '#B91C1C',
  criticalFill: '#FEE2E2',
  reserve: '#1D4ED8',
  reserveFill: '#DBEAFE',
  orderFrame: '#0284C7',
  groupFrame: '#7C3AED',
  text: '#0F172A',
  muted: '#64748B',
  background: '#FFFFFF',
  line: '#E2E8F0',
};
