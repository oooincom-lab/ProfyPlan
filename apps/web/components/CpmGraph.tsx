'use client';
/**
 * Сеть CPM — интерактивный сетевой график проекта (canvas).
 *
 * Перенесён подход утверждённого макета `public/cpm-network.html`
 * (Вариант 2: «дни на связях» + Старт/Финиш, круги/карточки операций,
 * раскладки по датам и по слоям, шкала времени с выходными и праздниками,
 * стрелки зависимостей, перетаскивание, прокрутка, масштаб, подсказка),
 * но реализован как настоящий React-компонент рабочего стола:
 *   • данные берутся из расчёта CPM (POST /projects/{id}/calculate/cpm);
 *   • связи операций — из /projects/{id}/operations/dependencies-map
 *     (в ответе CPM их нет), при необходимости передаются пропом `deps`;
 *   • шапка (область, масштаб, режим), легенда, выбор периода и состояния
 *     загрузки/пустоты/ошибки — на стороне вида.
 *
 * Использование:
 *   как вид рабочего поля:  <CpmGraph cpmResult={netData} height="calc(100vh - 190px)" />
 *   как модальное окно:     <CpmGraphModal open cpmResult={netData} onClose={...} />
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProjectDependencies, getProjectDependencyTypes } from '@/lib/api';
import { getPalette } from '@/lib/graph-styles';
import {
  CARD_W, CARD_H, borderPoint, quadPt, pathHits, DETOUR_OFFSETS, edgeControl, DRAWN_EDGE_DETOUR_SAMPLES,
  computeLayoutMetrics, DEFAULT_GEOMETRY, type LayoutMetrics, type Rect,
} from '@/lib/cpm-metrics';
import { computeLayout as buildCpmLayout } from '@/lib/cpm-layout';
import { checkCpmStructure, detectVisibleEndpoints, intensityK, type StructureIssue } from '@/lib/cpm-structure';
import { checkPlanarity, type PlanarityResult } from '@/lib/cpm-planarity';
import {
  settingsToLayoutOptions, getLayoutPreset, loadLayoutPreset, saveLayoutPreset,
  sanitizeLayoutPreset, LAYOUT_PRESETS, DEFAULT_LAYOUT_PRESET, STRETCH_K,
  type LayoutPreset,
} from '@/lib/cpm-settings';
import {
  nudgeForLabels, requiredRowPitch, LABEL_GAP, countDrawnCrossings,
  type LabelBox, type CompactLabelGeom, type DrawnCrossingReport,
} from '@/lib/cpm-labels';
import CpmReadability from '@/components/CpmReadability';

export type { LayoutMetrics } from '@/lib/cpm-metrics';


/**
 * Отладочная панель графа.
 *
 * По умолчанию никакого отладочного вывода в интерфейсе нет — он не считается и
 * не рисуется. Для разработки его можно включить ТОЛЬКО вручную одним из двух
 * способов и он выключен по умолчанию:
 *   • добавить к адресу параметр `?cpmDiag=1`;
 *   • выполнить в консоли браузера `localStorage.setItem('cpmDiag','1')`.
 * Чтобы снова выключить — убрать параметр и выполнить `localStorage.removeItem('cpmDiag')`.
 */
function cpmDiagEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (/(?:^\?|&)cpmDiag=1(?:&|$)/.test(window.location.search)) return true;
    return window.localStorage.getItem('cpmDiag') === '1';
  } catch {
    return false;
  }
}

/* ─────────────────────────── модель данных ─────────────────────────── */

export interface CpmGraphProps {
  cpmResult?: any;
  ops?: any[];
  deps?: [string, string][];
  height?: number | string;
  title?: string;
  compact?: boolean;
  onSelect?: (id: string | null) => void;
  paletteId?: string;
  /** Колбэк метрик качества раскладки — для строки состояния панели. */
  onMetrics?: (m: LayoutMetrics) => void;
}

interface GOp {
  id: string;
  num: number | string;
  name: string;
  code: string;
  detail: string;
  durDays: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  tf: number;
  crit: boolean;
  branch: boolean;
  hpd: number;
}

type Mode = 'byDate' | 'byLayer';

/** Виртуальное событие сети: начальное «Старт» или завершающее «Финиш».
 *  id уникален: при одной цепочке — 'start'/'finish', при нескольких независимых —
 *  'start#N'/'finish#N' (у каждой своей пары). */
interface VirtualNode {
  id: string;
  kind: 'start' | 'finish';
  label: string;
  x: number;
  y: number;
  color: string;
}

/** Логическая (пунктирная, нулевой длительности) связь со/от виртуального события. */
interface VirtualEdge {
  from: string;
  to: string;
  color: string;
}

/** Маркер обрезки периода: у видимой крайней операции цепочка продолжается
 *  вне периода. Рисуется коротким обрубком со стрелкой в сторону продолжения
 *  вместо значка «Старт»/«Финиш». Позиция считается при отрисовке от узла операции
 *  (opId), так что маркер следует за узлом при перетаскивании и смене масштаба LOD. */
interface CutMarker {
  opId: string;
  kind: 'start' | 'finish';
  color: string;
}

/** Данные связи для подсказки при наведении (полное описание связи). */
interface EdgeTip {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  /** Ожидание между работами в днях (0 — связи без ожидания). */
  wait: number;
  crit: boolean;
  /** Тип связи (FS/SS/FF/SF), если он известен из данных. */
  type: string | null;
}

/* ─────────────────────────── константы ─────────────────────────── */

const MIN_GAP = 12;                       // минимальный зазор между узлами по обеим осям
const COL_GAP = 34;                       // колонки: COL_PITCH = CARD_W + 34 (> CARD_W + MIN_GAP)
const ROW_GAP = 22;                       // ряды: ROW_PITCH = CARD_H + 22 (> CARD_H + MIN_GAP)
const COL_PITCH = CARD_W + COL_GAP;
const ROW_PITCH = CARD_H + ROW_GAP;
const PAD = 70;
const CIRC_WORLD_R = 24;
const LOD_CARD_MIN_SCALE = 0.62;
/**
 * Минимальный масштаб начального показа. Ниже этого кегля подписи операций
 * становятся нечитаемыми, поэтому «на старте» показываем крупнее (с прокруткой),
 * а полный обзор доступен кнопкой «По размеру».
 */
const READABLE_MIN_SCALE = 0.5;
/**
 * Размер шрифта: множитель к базовым кеглям подписей узлов, шкалы времени и легенды.
 * Все три ступени подняты примерно на 18% относительно исходных (1.0/1.18/1.47),
 * разница между ступенями сохранена — шрифты заметно крупнее на всех уровнях.
 */
const FONT_SCALES = { sm: 1.18, md: 1.39, lg: 1.73 } as const;
type FontSize = keyof typeof FONT_SCALES;
const FONT_SIZE_KEY = 'cpm.network.fontSize';

/* ───────── единые стили связей: холст и образцы легенды берут их отсюда ─────────
   Цвет, толщина и узор каждой категории связи заданы ОДИН раз в EDGE_STYLE ниже.
   И отрисовка на полотне, и образцы в блоке условных обозначений берут значения
   отсюда — так образцы не разъедутся с холстом при будущих правках. */
/** Цвета узлов-событий «Старт»/«Финиш» (капсулы, не связи). */
const START_COLOR = '#34D399';
const FINISH_COLOR = '#F472B6';
/** Цвет маркеров обрезки периода (нейтральный стальной — не путать со «Стартом»/«Финишем»). */
const CUT_COLOR = 'rgba(148,163,184,0.95)';
/** Цвета служебных связей от «Старта» и к «Финишу» (тонированные под событие). */
const START_EDGE = 'rgba(52,211,153,0.62)';
const FINISH_EDGE = 'rgba(244,114,182,0.62)';
/**
 * Узор связи без ожидания («логической»): крупный штрих-пунктир — длинный штрих,
 * пробел, точка, пробел. Крупный базовый шаг сохраняет различимость при масштабе
 * ~50 % (вид открывается именно на нём).
 */
const LOGICAL_DASH_BASE = [12, 5, 2.5, 5] as const;
/** Узор служебных связей «Старт»/«Финиш»: короткий тонкий пунктир. */
const ENDPOINT_DASH_BASE = [5, 4] as const;
/** Стили линий связи: цвет, толщина и цвет наконечника. */
export const EDGE_STYLE = {
  /** Связь операций с ожиданием — сплошная синяя. */
  wait: { color: 'rgba(96,165,250,0.42)', width: 1.7, arrow: 'rgba(96,165,250,0.6)' },
  /** Связь с ожиданием в ветви критического пути — сплошная янтарная. */
  branch: { color: 'rgba(245,158,11,0.5)', width: 1.7, arrow: 'rgba(245,158,11,0.75)' },
  /** Связь без ожидания — широкий штрих-пунктир спокойным стальным цветом. */
  logical: { color: 'rgba(148,163,184,0.85)', width: 2.1, arrow: 'rgba(148,163,184,0.9)' },
  /** Критическая связь — сплошная толстая красная. */
  critical: { color: 'rgba(239,68,68,0.72)', width: 3, arrow: 'rgba(239,68,68,0.85)' },
  /** Служебная связь «Старт»/«Финиш» — тонкий пунктир (цвет — по узлу-событию). */
  endpoint: { color: START_EDGE, width: 1.4 },
} as const;
/** Масштабированный узор: шаг не опускается ниже минимума (иначе штрих слипается). */
function scaledDash(base: readonly number[], S: number, mins: readonly number[]): number[] {
  return base.map((v, i) => Math.max(mins[i] ?? 1, v * S));
}
/** Штрих-пунктир «длинный штрих + точка» — узор связей без ожидания. */
function dashLogical(S: number): number[] {
  return scaledDash(LOGICAL_DASH_BASE, S, [10, 4, 2, 4]);
}
/** Короткий пунктир служебных связей «Старт»/«Финиш». */
function dashEndpoint(S: number): number[] {
  return scaledDash(ENDPOINT_DASH_BASE, S, [4, 3]);
}
/** Узор для SVG-образца легенды (в базовом размере, без масштаба полотна). */
function dashAttr(base: readonly number[]): string {
  return base.join(' ');
}
/** Буквенные метки типов связи; основной тип ФС на схеме не подписывается. */
const DEP_TYPE_LABEL: Record<string, string> = { FS: 'ФС', SS: 'СС', FF: 'ФФ', SF: 'СФ' };
/** Полное описание типа связи — для подсказки при наведении на связь. */
const DEP_TYPE_HINT: Record<string, string> = {
  FS: 'Тип связи «Финиш → Старт»: следующая работа начинается после окончания предыдущей',
  SS: 'Тип связи «Старт → Старт»: следующая работа начинается вместе с предыдущей',
  FF: 'Тип связи «Финиш → Финиш»: следующая работа заканчивается вместе с предыдущей',
  SF: 'Тип связи «Старт → Финиш»: следующая работа заканчивается после старта предыдущей',
};

/** Классы панели управления сетью CPM — единый тёмный стиль проекта. */
const PANEL_CSS = [
  '.cpmui-btn{font-family:inherit;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;',
  'background:#0F1E36;color:#B0C4DE;border:1px solid #2A4060;transition:all .12s;white-space:nowrap;line-height:1.2}',
  '.cpmui-btn:hover{border-color:#3B82F6;color:#60A5FA;background:#12233F}',
  '.cpmui-btn:active{background:#162844}',
  '.cpmui-btn:disabled{opacity:.5;cursor:default}',
  '.cpmui-btn.sq{padding:4px 10px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px}',
  '.cpmui-btn.on{background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;border-color:#3B82F6}',
  '.cpmui-sel{background:#0F1E36;color:#E8EEF5;border:1px solid #2A4060;border-radius:6px;padding:3px 7px;font-size:11.5px;font-family:inherit;cursor:pointer}',
  '.cpmui-sel:focus{outline:none;border-color:#3B82F6}',
  '.cpmui-date{background:#0F1E36;color:#E8EEF5;border:1px solid #2A4060;border-radius:6px;padding:3px 6px;font-size:11.5px;color-scheme:dark}',
  '.cpmui-date:focus{outline:none;border-color:#3B82F6}',
  '.cpmui-chk{accent-color:#3B82F6;width:14px;height:14px;cursor:pointer;vertical-align:-2px}',
  '.cpmui-lbl{display:flex;align-items:center;gap:5px;color:#8FA3BD;cursor:pointer;font-size:12px}',
  '.cpmui-num{background:#0F1E36;color:#E8EEF5;border:1px solid #2A4060;border-radius:6px;padding:3px 5px;font-size:11.5px;width:56px;font-family:inherit}',
  '.cpmui-num:focus{outline:none;border-color:#3B82F6}',
  '.cpmui-link{font-family:inherit;font-size:11.5px;font-weight:600;background:none;border:none;padding:0;cursor:pointer;color:#60A5FA;}',
  '.cpmui-link:hover{color:#93C5FD;text-decoration:underline;}',
].join('');
/**
 * Радиус окружности в компактном режиме. Верхняя граница привязывает радиус к
 * шагу раскладки, поэтому на мелком масштабе (большой граф) узлы не слипаются:
 * мировой зазор по вертикали всегда остаётся не меньше MIN_GAP.
 */
function circleRadius(S: number, rowPitch: number = ROW_PITCH): number {
  return Math.max(CIRC_WORLD_R * S, Math.min(9, rowPitch * 0.4 * S));
}
const FONT_MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* ── автоподбор положения подписей узлов ──────────────────────────────
   В компактном режиме у каждого узла две подписи: имя работы и «продолжительность
   + резерв». Они размещаются вокруг окружности узла детерминированным перебором
   позиций (снизу, сверху, справа, слева, по диагоналям), чтобы не накладываться
   друг на друга, на соседние узлы и на линии связей. Размеры подписей берутся в
   «эталонном» масштабе раскладки «Обычно» (вид открывается именно на нём),
   поэтому расстановка воспроизводима и не зависит от зума. */
const LABEL_REF_SCALE = 0.5;              // эталонный масштаб вида «Обычно»
const LABEL_REF_FONT = FONT_SCALES.md;    // эталонный кегль подписей (настройка по умолчанию)
let labelMeasureCtx: CanvasRenderingContext2D | null = null;
/** Контекст для измерения текста подписей (offscreen canvas), ленивый и общий. */
function getLabelMeasureCtx(): CanvasRenderingContext2D | null {
  if (labelMeasureCtx) return labelMeasureCtx;
  if (typeof document === 'undefined') return null;
  try { labelMeasureCtx = document.createElement('canvas').getContext('2d'); } catch { labelMeasureCtx = null; }
  return labelMeasureCtx;
}
/* Подписи узлов теперь не перебирают позиции вокруг узла, а всегда стоят в
   фиксированном месте (имя сверху, числа снизу); наложения разрешает модуль
   lib/cpm-labels вертикальным сдвигом самих узлов. */

/** Праздники РФ (непроизводственные дни), достаточные для тестового стенда. */
const HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
  '2026-02-23', '2026-03-08', '2026-05-01', '2026-05-09', '2026-06-12', '2026-11-04',
  // 2027
  '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08',
  '2027-02-23', '2027-03-08', '2027-05-01', '2027-05-09', '2027-06-12', '2027-11-04',
  // 2028
  '2028-01-01', '2028-01-02', '2028-01-03', '2028-01-04', '2028-01-05', '2028-01-06', '2028-01-07', '2028-01-08',
  '2028-02-23', '2028-03-08', '2028-05-01', '2028-05-09', '2028-06-12', '2028-11-04',
]);

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* ─────────────────────────── утилиты ─────────────────────────── */

function isoDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}
function isHoliday(d: Date): boolean {
  return HOLIDAYS.has(isoDate(d));
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + Math.round(n));
  return r;
}
/** Дата по дробному смещению в сутках (для часовой/минутной шкалы). */
function dayOffsetToDate(start: Date, offsetDays: number): Date {
  return new Date(start.getTime() + offsetDays * 86400000);
}
/** Наименьший шаг из списка, при котором между делениями не меньше minPx пикселей. */
function pickStep(steps: number[], pxPerUnit: number, minPx: number, fallback: number): number {
  for (const s of steps) if (s * pxPerUnit >= minPx) return s;
  return fallback;
}
function fmtDayMonth(d: Date): string {
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function num(v: any, fallback = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function fmtReserve(days: number, unit: string, hpd: number): string {
  if (unit === 'h') return Math.round(days * hpd) + ' ч';
  if (unit === 'm') return Math.round(days * hpd * 60) + ' мин';
  return round1(days) + ' д';
}
function fmtDur(days: number, unit: string, hpd: number): string {
  if (unit === 'h') return Math.round(days * hpd) + ' ч';
  if (unit === 'm') return Math.round(days * hpd * 60) + ' мин';
  return round1(days) + ' д';
}
/** Склонение слова «пересечение» по числу (для честных сообщений панели). */
function crossingsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'пересечение';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'пересечения';
  return 'пересечений';
}

/** Обрезка строки по пикселям с многоточием. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 6) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/* ─────────────────────────── маппинг данных ─────────────────────────── */

function mapOps(p: CpmGraphProps): GOp[] {
  const raw: any[] = Array.isArray(p.ops) && p.ops.length
    ? p.ops
    : ((p.cpmResult && p.cpmResult.nodes) || []);
  const critPath: string[] = (p.cpmResult && p.cpmResult.critical_path) || [];
  const mainSet = new Set(critPath.map(String));
  const branchSet = new Set<string>();
  ((p.cpmResult && p.cpmResult.critical_paths) || []).forEach((b: any) => {
    (b && b.operations ? b.operations : []).forEach((id: any) => branchSet.add(String(id)));
  });

  return raw.map((n: any, i: number) => {
    const hpd = num(n.hours_per_day, 8) || 8;
    const durDays = n.duration_days != null ? num(n.duration_days) : num(n.duration, num(n.duration_base, 0)) / hpd;
    const es = n.early_start_day != null ? num(n.early_start_day) : num(n.early_start, 0) / hpd;
    const ef = n.early_finish_day != null ? num(n.early_finish_day) : num(n.early_finish, es + durDays);
    const ls = n.late_start_day != null ? num(n.late_start_day) : num(n.late_start, es);
    const lf = n.late_finish_day != null ? num(n.late_finish_day) : num(n.late_finish, ef);
    const tf = n.total_float_days != null ? num(n.total_float_days) : num(n.total_float, 0) / hpd;
    const id = String(n.id);
    const fullName = String(n.name || id);
    const sep = fullName.indexOf('·');
    const code = sep > 0 ? fullName.slice(0, sep).trim() : fullName;
    const detail = sep > 0 ? fullName.slice(sep + 1).trim() : '';
    const crit = !!(n.is_critical != null ? n.is_critical : n.critical);
    return {
      id,
      num: n.number != null ? n.number : (n.num != null ? n.num : i + 1),
      name: fullName,
      code,
      detail,
      durDays,
      es, ef, ls, lf, tf,
      crit,
      branch: branchSet.has(id) && !mainSet.has(id),
      hpd,
    };
  });
}

function mapDeps(p: CpmGraphProps, ids: Set<string>): [string, string][] {
  let list: [string, string][] = [];
  if (Array.isArray(p.deps) && p.deps.length) {
    list = p.deps.map((d) => [String(d[0]), String(d[1])] as [string, string]);
  } else if (p.cpmResult && Array.isArray(p.cpmResult.dependencies) && p.cpmResult.dependencies.length) {
    list = p.cpmResult.dependencies.map((d: any) => [String(d.from ?? d.predecessor_id), String(d.to ?? d.successor_id)] as [string, string]);
  }
  return list.filter(([a, b]) => a !== 'undefined' && b !== 'undefined' && ids.has(a) && ids.has(b));
}

/* ─────────────────────────── раскладка ─────────────────────────── */

interface Layout {
  pos: Record<string, [number, number]>;
  minX: number; maxX: number; minY: number; maxY: number;
  pxPerDay: number;
  bucketDays: number;
  minEs: number;
}

function computeLayout(ops: GOp[], deps: [string, string][], mode: Mode, opts?: any): Layout {
  // Раскладка вынесена в чистый модуль @/lib/cpm-layout: колонки по датам/слоям,
  // упорядочивание внутри колонки (барицентр), локальные улучшения по счётчику
  // качества (перестановки соседних узлов) и подтяжка узла к средней линии соседей.
  // opts — веса критерия и число проходов оптимизации (из настроек качества).
  return buildCpmLayout(ops, deps, mode, opts);
}

/* ─────────────────────────── компонент ─────────────────────────── */

/* Число стартов раскладки для планарного подграфа: укладка обязана дать ноль
   пересечений, поэтому перебираем несколько детерминированных стартов и берём
   лучший результат. Для непланарного графа старт один (ноль недостижим). */
const PLANAR_RESTARTS = 8;
/* Число стартов раскладки для компактного режима с разведёнными подписями: нужен
   запас, чтобы укладка «по слоям» устойчиво разошлась под увеличенный шаг ряда
   (только старты «по раннему старту» — слоистость по времени сохраняется). */
const LABEL_RESTARTS = 4;
/* Полуширина вертикального переноса узла/колонки (в шагах ряда) для режима
   поиска укладки без пересечений. Даёт раскладке ту же свободу сдвигать кружки
   по вертикали, какой пользовался человек, разводя сеть вручную. */
const PLANAR_TRANSLATE_RANGE = 6;
/* Запас к минимальному шагу ряда под подписи (мировые единицы): даёт укладке
   немного свободы на доводку порядка, чтобы разведение не ломало пересечения. */
const LABEL_PITCH_EXTRA = 4;

export default function CpmGraph(props: CpmGraphProps) {
  // height не задан → полотно занимает всю доступную высоту родителя (вид рабочего поля).
  const { height, title, compact, onSelect } = props;
  const pal = useMemo(() => getPalette(props.paletteId), [props.paletteId]);
  const reserveColor = '#3B82F6';
  const branchColor = '#F59E0B';
  const critColor = '#EF4444';
  // Напряжённые работы (коэффициент напряжённости выше порога) — отдельный цвет.
  const stretchColor = '#A78BFA';
  // Начальное («Старт») и завершающее («Финиш») события — отдельный цвет и форма.
  // Цвета и стили связей берём из общих констант EDGE_STYLE/START_EDGE/FINISH_EDGE,
  // чтобы холст и образцы легенды рисовались одинаково.
  const startColor = START_COLOR;
  const finishColor = FINISH_COLOR;

  /* ── раскладка качества (единственный видимый орган управления) ──
     Плотно / Обычно / Для печати. Веса, число проходов, цели и порог
     напряжённости убраны из интерфейса — живут в lib/cpm-settings как внутренние
     значения по умолчанию. Выбор раскладки хранится в localStorage. */
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>(DEFAULT_LAYOUT_PRESET);
  useEffect(() => { setLayoutPreset(loadLayoutPreset()); }, []);
  const applyLayoutPreset = useCallback((p: LayoutPreset) => {
    const next = sanitizeLayoutPreset(p);
    setLayoutPreset(next);
    saveLayoutPreset(next);
  }, []);
  const activePreset = useMemo(() => getLayoutPreset(layoutPreset), [layoutPreset]);
  // Геометрия активного пресета: размер узлов, зазоры, отступ и множитель подписей.
  // Используется и укладкой, и метриками, и отрисовкой — поэтому смена раскладки
  // меняет и вид, и числа.
  const geom = activePreset.geom || DEFAULT_GEOMETRY;
  const colPitch = geom.cardW + geom.colGap;
  const rowPitch = geom.cardH + geom.rowGap;

  const [mode, setMode] = useState<Mode>('byDate');
  const [unit, setUnit] = useState<'d' | 'h' | 'm'>('d');
  const [critOnly, setCritOnly] = useState(false);
  const [showEdgeDays, setShowEdgeDays] = useState(true);
  // «Старт и Финиш»: по умолчанию включено — служебные события «Старт»/«Финиш»
  // и их тонкие пунктирные связи показаны. Выключение скрывает ТОЛЬКО эти два
  // служебных события и их связи. Обычные связи (с ожиданием и без), критический
  // путь и операционные связи остаются на схеме всегда.
  const [showEndpoints, setShowEndpoints] = useState(true);
  // Блок условных обозначений внизу рабочей области: по умолчанию свёрнут,
  // разворачивается кликом по ссылке «Условные обозначения».
  const [legendOpen, setLegendOpen] = useState(false);
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  // «Выравнивать обрезки периода»: компановка маркеров обрезки периода по общим
  // вертикалям слева/справа (см. cpm-layout.compactPeriodCuts). Доступно только в
  // структурной укладке «По слоям»; по умолчанию выключено — вид ровно как без
  // компановки. Раскладка «Для печати» компановкой не затрагивается.
  const [alignCutEnds, setAlignCutEnds] = useState(false);
  const [zoomPct, setZoomPct] = useState(80);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; op?: GOp; virt?: VirtualNode; cut?: CutMarker; edge?: EdgeTip } | null>(null);
  const [canvasErr, setCanvasErr] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<FontSize>('md');
  const [resetNonce, setResetNonce] = useState(0);
  // Ручные позиции узлов после перетаскивания (по режимам), живут до «Сброса»;
  // posNonce заставляет пересчитать раскладку/метрики после отпускания мыши.
  const manualRef = useRef<Record<Mode, Record<string, [number, number]>>>({ byDate: {}, byLayer: {} });
  const [posNonce, setPosNonce] = useState(0);
  // Отладочный вывод включён? (по умолчанию нет — см. cpmDiagEnabled)
  const diagOn = useMemo(() => cpmDiagEnabled(), []);
  // Объяснение, если раскладку «Без пересечений» пришлось откатить (см. эффект ниже).
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

  /* Раскладка «Без пересечений» осмысленна только в структурной укладке «По слоям»:
     в «По датам» горизонталь задаётся календарём, а не раскладкой. Если этот пресет
     выбран, а режим — «По датам» (переключились из «По слоям» или пресет сохранён с
     прошлого раза), честно откатываемся на раскладку по умолчанию и объясняем это
     вместо молчаливого «выбрано, но не применено». */
  useEffect(() => {
    if (mode !== 'byDate' || layoutPreset !== 'noplan') return;
    const fallback = getLayoutPreset(DEFAULT_LAYOUT_PRESET);
    applyLayoutPreset(DEFAULT_LAYOUT_PRESET);
    setPresetNotice(
      'Укладка без пересечений неприменима в режиме «По датам»: горизонталь здесь задаётся календарём, а не раскладкой. ' +
      'Возвращена раскладка «' + fallback.label + '». Выбрать «Без пересечений» можно в структурной укладке «По слоям».',
    );
  }, [mode, layoutPreset, applyLayoutPreset]);

  /* размер шрифта: восстановление/сохранение пользовательской настройки */
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(FONT_SIZE_KEY);
      if (v === 'sm' || v === 'md' || v === 'lg') setFontSize(v);
    } catch { /* localStorage недоступен — остаётся значение по умолчанию */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(FONT_SIZE_KEY, fontSize); } catch { /* ignore */ }
  }, [fontSize]);

  /* связи: из пропа, из расчёта или запросом к API */
  const mappedOps = useMemo(() => mapOps(props), [props.cpmResult, props.ops]);
  const ids = useMemo(() => new Set(mappedOps.map((o) => o.id)), [mappedOps]);
  const propDeps = useMemo(() => mapDeps(props, ids), [props.cpmResult, props.deps, ids]);
  const [fetchedDeps, setFetchedDeps] = useState<[string, string][]>([]);
  // Типы связей (FS/SS/FF/SF) — вспомогательный запрос: при ошибке граф строится без меток.
  const [depTypes, setDepTypes] = useState<Record<string, string>>({});
  const projectId = props.cpmResult && props.cpmResult.project_id;
  useEffect(() => {
    if (propDeps.length || !projectId) { if (propDeps.length) setFetchedDeps([]); return; }
    let alive = true;
    getProjectDependencies(String(projectId))
      .then((d: any) => {
        if (!alive) return;
        const items = (d && Array.isArray(d.items)) ? d.items : [];
        setFetchedDeps(items.map((x: any) => [String(x.from), String(x.to)] as [string, string]));
      })
      .catch(() => { if (alive) setFetchedDeps([]); });
    return () => { alive = false; };
  }, [projectId, propDeps.length]);

  const allDeps = propDeps.length ? propDeps : fetchedDeps;

  useEffect(() => {
    if (!projectId) { setDepTypes({}); return; }
    let alive = true;
    getProjectDependencyTypes(String(projectId))
      .then((m) => { if (alive) setDepTypes(m); })
      .catch(() => { if (alive) setDepTypes({}); });
    return () => { alive = false; };
  }, [projectId]);

  const startDate = useMemo<Date | null>(() => {
    const s = props.cpmResult && (props.cpmResult.project_start_date || props.cpmResult.project_start);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [props.cpmResult]);

  const dayToDate = useCallback((day: number): Date | null => (startDate ? addDays(startDate, day) : null), [startDate]);

  /* период: операции, чей интервал [es, ef] пересекается с окном */
  const visibleOps = useMemo(() => {
    if (!startDate || (!periodFrom && !periodTo)) return mappedOps;
    const from = periodFrom ? (new Date(periodFrom).getTime() - startDate.getTime()) / 86400000 : -Infinity;
    const to = periodTo ? (new Date(periodTo).getTime() - startDate.getTime()) / 86400000 : Infinity;
    return mappedOps.filter((o) => o.ef >= from && o.es <= to);
  }, [mappedOps, periodFrom, periodTo, startDate]);

  /* фильтр «только критический путь» участвует в самой раскладке: иначе критичные
     операции остаются на прежних местах и после переключения фильтра уезжают за край */
  const layoutOps = useMemo(
    () => (critOnly ? visibleOps.filter((o) => o.crit) : visibleOps),
    [visibleOps, critOnly],
  );

  /* ── планарность подграфа раскладки и число стартов оптимизации ──
     Если граф планарный, укладка обязана дать ноль пересечений, поэтому
     раскладка считается из нескольких стартов и берётся лучший. Если граф
     непланарный, ноль недостижим — оставляем один старт (обычная оптимизация). */
  const layoutPlanarity = useMemo(
    () => checkPlanarity(layoutOps.map((o) => ({ id: o.id, crit: o.crit })), allDeps, false),
    [layoutOps, allDeps],
  );
  /* ── положение «Без пересечений» в переключателе раскладки ──
     Доступно лишь в структурной укладке («по слоям» — только там не рисуется
     хронология). Ноль пересечений достижим только для планарного (под)графа —
     это и есть исход проверки `layoutPlanarity`. Для непланарного (под)графа
     положение выбирается с честной подписью «ноль недостижим для этой схемы». */
  const noPlanAvailable = mode === 'byLayer';
  const noPlanReachable = layoutPlanarity.state === 'confirmed';
  // Число стартов оптимизации: больше одного — когда нужна укладка без
  // пересечений. Это либо пресет «Без пересечений» (структурная укладка — только
  // в режиме «По слоям»), либо планарный подграф (тогда ноль пересечений
  // достижим и в «Обычно»/«Плотно»/«Для печати»). Для прочих — один старт.
  const noplanActive = layoutPreset === 'noplan' && mode === 'byLayer';
  /* ── геометрия подписей узла и нижняя граница шага ряда под них ──
     В компактном режиме имя работы стоит над узлом, «продолжительность + резерв»
     — под ним. Соседние узлы столбца должны стоять не ближе суммарной высоты этих
     подписей, иначе они налезут друг на друга (при одинаковом x столбца
     горизонтально они совпадают). Значение считается по кеглям подписей и радиусу
     узла при эталонном масштабе, т.е. не зависит от зума. */
  const labelGeom = useMemo<CompactLabelGeom>(() => {
    const S = LABEL_REF_SCALE;
    const FS = LABEL_REF_FONT;
    const LBL = geom.labelScale ?? 1;
    const fszL = (px: number) => Math.max(6, Math.round(px * FS * LBL));
    const codeFp = fszL(clamp(Math.round(9.5 * S + 3), 8, 12));
    const durFp = fszL(clamp(Math.round(9 * S + 2), 7, 11));
    const radius = circleRadius(S, geom.cardH + geom.rowGap) / S;
    return { radius, gap: LABEL_GAP, codeH: (codeFp * 1.2) / S, durH: (durFp * 1.2) / S };
  }, [geom]);
  // Минимальный шаг ряда, при котором подписи не налезают, + небольшой запас.
  const labelPitch = Math.ceil(requiredRowPitch(labelGeom)) + LABEL_PITCH_EXTRA;

  // Планарному (под)графу нужен ноль пересечений — перебираем старты, включая
  // структурные «по связям». Непланарному достаточно нескольких стартов «по раннему
  // старту»: они устойчиво разводят узлы под увеличенный шаг ряда.
  //
  // Важно: на НЕПЛАНАРНОМ (под)графе ноль недостижим, и перебор стартов «по связям»
  // там не помогает, а уводит укладку от лучшего результата (проверено на «Полигоне A»:
  // 14 пересечений и 2 прохода против 6 и 0 у обычной укладки). Поэтому режим «Без
  // пересечений» гонится за нулём только там, где ноль достижим; иначе он использует
  // ту же оптимизацию, что и «Обычно», и не может оказаться хуже неё.
  //
  // Вертикальный ПЕРЕНОС узлов и колонок (свобода сдвигать кружки по вертикали,
  // которой человек и разводит укладку вручную) включается там же, где мы гонимся
  // за нулём — на планарном (под)графе. На непланарном полном графе он не нужен
  // (ноль недостижим) и только уводит вбок от прежнего результата — потому там
  // вертикальная раскладка остаётся классической (без переноса).
  const planarLayout = layoutPlanarity.state === 'confirmed';
  /* Компановка обрезок периода: доступна в структурной укладке «По слоям» и не
     применяется к раскладке «Для печати» (её построение остаётся прежним). */
  const alignCutEndsActive = alignCutEnds && mode === 'byLayer' && layoutPreset !== 'print';
  const layoutOpts = useMemo(
    () => ({
      ...settingsToLayoutOptions(activePreset.settings),
      restarts: planarLayout ? PLANAR_RESTARTS : LABEL_RESTARTS,
      topologicalStarts: planarLayout,
      // Свобода вертикального переноса — только на планарном (под)графе, где
      // укладка без пересечений вообще достижима.
      translateRange: planarLayout ? PLANAR_TRANSLATE_RANGE : 0,
      // Компановка обрезок периода — только по явному крыжику «По слоям».
      ...(alignCutEndsActive ? { alignCutEnds: true } : {}),
      // В «Без пересечений» обещан ноль — компановка принимается, только если
      // пересечений не стало больше. В «Обычно»/«Плотно» она применяется по
      // выбору пользователя без такой страховки (иначе, как было раньше, уже нулевая
      // укладка откатывала любое выравнивание и крыжик ничего не менял).
      ...(alignCutEndsActive ? { alignCutEndsGuard: layoutPreset === 'noplan' } : {}),
      minRowPitch: labelPitch,
      geometry: geom,
    }),
    [activePreset, planarLayout, geom, labelPitch, alignCutEndsActive, layoutPreset],
  );

  /* ── базовая раскладка узлов без ручных сдвигов ──
     Считается отдельно от ручных позиций (перетаскивания), чтобы разведение
     подписей не пересчитывалось на каждый кадр перетаскивания. */
  const rawLayout = useMemo(
    () => computeLayout(layoutOps, allDeps, mode, layoutOpts),
    [layoutOps, allDeps, mode, layoutOpts],
  );

  /* ── подписи узлов в мировых единицах (эталонный масштаб вида «Обычно») ──
     Ширины измеряются тем же способом, что и при отрисовке, чтобы проверка
     наложений совпадала с картинкой. */
  const labelBoxes = useMemo<LabelBox[]>(() => {
    const out: LabelBox[] = [];
    const mtx = getLabelMeasureCtx();
    if (!mtx) return out;
    const S = LABEL_REF_SCALE;
    const FS = LABEL_REF_FONT;
    const LBL = geom.labelScale ?? 1;
    const fszL = (px: number) => Math.max(6, Math.round(px * FS * LBL));
    const CW = geom.cardW;
    visibleOps.forEach((o) => {
      if (critOnly && !o.crit) return;
      const codeFp = fszL(clamp(Math.round(9.5 * S + 3), 8, 12));
      mtx.font = codeFp + 'px ' + FONT_UI;
      const codeText = fitText(mtx, o.code, CW * 0.9);
      if (codeText) {
        out.push({ id: o.id + ':code', nodeId: o.id, kind: 'code', w: mtx.measureText(codeText).width / S, h: (codeFp * 1.2) / S });
      }
      const durTxt = fmtDur(o.durDays, unit, o.hpd);
      const resTxt = o.tf > 0.0001 ? '  +' + fmtReserve(o.tf, unit, o.hpd) : '';
      const durFp = fszL(clamp(Math.round(9 * S + 2), 7, 11));
      mtx.font = 'bold ' + durFp + 'px ' + FONT_MONO;
      const durW = mtx.measureText(durTxt).width + (resTxt ? mtx.measureText(resTxt).width : 0);
      out.push({ id: o.id + ':dur', nodeId: o.id, kind: 'dur', w: durW / S, h: (durFp * 1.2) / S });
    });
    return out;
  }, [visibleOps, critOnly, geom, unit]);

  /* ── разведение подписей вертикальным сдвигом узлов ──
     Детерминированно: фиксированный порядок обхода (колонка, затем позиция) и
     фиксированный шаг. Позиции — в мировых координатах, поэтому результат
     одинаков при любом зуме и воспроизводим. */
  const labelNudge = useMemo(
    () => nudgeForLabels(
      rawLayout.pos,
      visibleOps.filter((o) => !critOnly || o.crit).map((o) => o.id),
      labelBoxes,
      allDeps,
      geom,
      { radius: labelGeom.radius, restoreAfterDeconflict: noplanActive, freezeNodes: noplanActive },
    ),
    [rawLayout, labelBoxes, allDeps, geom, visibleOps, critOnly, labelGeom, noplanActive],
  );

  /* ── линия-поводок для узлов, сдвинутых далеко (страховка) ── */
  const leaderLines = useMemo(
    () => labelNudge.leaders.map((id) => ({
      id,
      x: labelNudge.pos[id][0],
      from: labelNudge.pos[id][1] - (labelNudge.dyById[id] || 0),
      to: labelNudge.pos[id][1],
    })),
    [labelNudge],
  );

  const layout = useMemo(() => {
    const L: Layout = { ...rawLayout, pos: { ...rawLayout.pos } };
    // Позиции узлов после разведения подписей (подписи всегда при своих узлах).
    for (const id in L.pos) { if (labelNudge.pos[id]) L.pos[id] = labelNudge.pos[id]; }
    // Возврат сохранённых вручную позиций (держатся до «Сброса») поверх разведения.
    const man = manualRef.current[mode];
    for (const id in man) { if (L.pos[id]) L.pos[id] = [man[id][0], man[id][1]]; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id in L.pos) {
      const [x, y] = L.pos[id];
      if (x - geom.cardW / 2 < minX) minX = x - geom.cardW / 2;
      if (x + geom.cardW / 2 > maxX) maxX = x + geom.cardW / 2;
      if (y - geom.cardH / 2 < minY) minY = y - geom.cardH / 2;
      if (y + geom.cardH / 2 > maxY) maxY = y + geom.cardH / 2;
    }
    if (Number.isFinite(minX)) { L.minX = minX; L.maxX = maxX; L.minY = minY; L.maxY = maxY; }
    return L;
  }, [rawLayout, labelNudge, mode, posNonce, geom]);

  /* ── служебные события «Старт»/«Финиш» и маркеры обрезки периода ──
     Считаются по ВИДИМОМУ набору операций (после периода, фильтра заказа/куста и
     «только крит. путь»). Операция — видимое начало/завершение, если у неё нет
     предшественников/последователей СРЕДИ ВИДИМЫХ. Значок ставится только к
     истинным началам/завершениям (без связей за пределы видимого); крайние
     операции с продолжением вне периода получают вместо значка маркер обрезки.
     • Видимая часть = вся сеть → одна пара «Старт»/«Финиш» (поведение как было).
     • После фильтрации несколько независимых цепочек → у каждой своя пара,
       соединённая тонким пунктиром со своими видимыми началами/завершениями.
     • Если начал/завершений нет вовсе — значков нет, только маркеры обрезки. */
  const virtualInfo = useMemo(() => {
    const empty = { virtuals: [] as VirtualNode[], vEdges: [] as VirtualEdge[], cutMarkers: [] as CutMarker[] };
    if (!layoutOps.length) return empty;
    const pos = layout.pos;
    const net = detectVisibleEndpoints(
      layoutOps.map((o) => o.id),
      allDeps,
      layoutOps.map((o) => ({ id: o.id, num: o.num, name: o.name, code: o.code })),
    );
    const meanY = (idds: string[]): number => {
      let s = 0;
      let n = 0;
      for (const id of idds) { const p = pos[id]; if (p) { s += p[1]; n++; } }
      return n ? s / n : 0;
    };
    // Крайний x по группе операций (dir = -1 — самый левый, +1 — самый правый).
    const boundCx = (idds: string[], dir: 1 | -1): number => {
      let best = dir < 0 ? Infinity : -Infinity;
      for (const id of idds) {
        const p = pos[id];
        if (!p) continue;
        if (dir < 0 ? p[0] < best : p[0] > best) best = p[0];
      }
      return best;
    };
    const virtuals: VirtualNode[] = [];
    const vEdges: VirtualEdge[] = [];
    const cutMarkers: CutMarker[] = [];

    // Видима ли вся сеть целиком: тогда (как прежде) одна пара событий на всю схему.
    // Выбор заказа/куста — это уже не «вся сеть», у его цепочки своя разметка.
    const orderScoped = !!(props.cpmResult && props.cpmResult.order_id);
    const wholeNetwork = !orderScoped && layoutOps.length === mappedOps.length;

    const attachStart = (sid: string, ids: string[]): void => {
      const x = boundCx(ids, -1);
      if (!Number.isFinite(x)) return;
      virtuals.push({ id: sid, kind: 'start', label: 'Старт', x: x - colPitch, y: meanY(ids), color: startColor });
      ids.forEach((id) => { if (pos[id]) vEdges.push({ from: sid, to: id, color: startColor }); });
    };
    const attachFinish = (fid: string, ids: string[]): void => {
      const x = boundCx(ids, 1);
      if (!Number.isFinite(x)) return;
      virtuals.push({ id: fid, kind: 'finish', label: 'Финиш', x: x + colPitch, y: meanY(ids), color: finishColor });
      ids.forEach((id) => { if (pos[id]) vEdges.push({ from: id, to: fid, color: finishColor }); });
    };

    if (wholeNetwork) {
      // Вся сеть: «Старт» — ко всем истинным началам, «Финиш» — от всех истинных завершений.
      if (!net.hasExplicitStart && net.trueStartIds.length) attachStart('start', net.trueStartIds);
      if (!net.hasExplicitFinish && net.trueFinishIds.length) attachFinish('finish', net.trueFinishIds);
    } else {
      // Фильтрация активна: у каждой независимой цепочки (компоненты) своя пара.
      net.components.forEach((group, ci) => {
        const starts = group.filter((id) => net.trueStartIds.indexOf(id) >= 0);
        const finishes = group.filter((id) => net.trueFinishIds.indexOf(id) >= 0);
        if (starts.length && !net.hasExplicitStart) attachStart('start#' + ci, starts);
        if (finishes.length && !net.hasExplicitFinish) attachFinish('finish#' + ci, finishes);
      });
    }

    // Маркеры обрезки — для крайних видимых операций с продолжением вне периода.
    net.cutStartIds.forEach((id) => { if (pos[id]) cutMarkers.push({ opId: id, kind: 'start', color: CUT_COLOR }); });
    net.cutFinishIds.forEach((id) => { if (pos[id]) cutMarkers.push({ opId: id, kind: 'finish', color: CUT_COLOR }); });

    return { virtuals, vEdges, cutMarkers };
  }, [layout, layoutOps, mappedOps, allDeps, startColor, finishColor, colPitch, props.cpmResult]);

  /* Раскладка с учётом виртуальных событий: их позиции добавляются в pos, а габарит
     полотна расширяется, чтобы «Старт»/«Финиш» попадали в подгонку «По размеру».
     Метрики счётчика считают только реальные операции и связи (см. metrics ниже). */
  const layoutFull = useMemo<Layout>(() => {
    const vs = virtualInfo.virtuals;
    if (!vs.length) return layout;
    const pos: Record<string, [number, number]> = { ...layout.pos };
    let minX = layout.minX;
    let maxX = layout.maxX;
    let minY = layout.minY;
    let maxY = layout.maxY;
    for (const v of vs) {
      pos[v.id] = [v.x, v.y];
      if (v.x - geom.cardW / 2 < minX) minX = v.x - geom.cardW / 2;
      if (v.x + geom.cardW / 2 > maxX) maxX = v.x + geom.cardW / 2;
      if (v.y - geom.cardH / 2 < minY) minY = v.y - geom.cardH / 2;
      if (v.y + geom.cardH / 2 > maxY) maxY = v.y + geom.cardH / 2;
    }
    return { ...layout, pos, minX, maxX, minY, maxY };
  }, [layout, virtualInfo, geom]);

  /* ── пересечения ИТОГОВОЙ геометрии (включая служебные связи) ──
     Считаем ровно те пути, что рисует полотно (`buildDrawnLines` зовёт те же
     `borderPoint`/`edgeControl` с теми же сэмплами), включая:
       • обходы посторонних узлов (кривые) — прежний счётчик считал прямые отрезки;
       • служебные связи «Старт»/«Финиш»;
       • маркеры обрезки периода и линии-поводки подписей.
     Геометрия зависит от уровня детализации полотна (на мелком масштабе узлы —
     окружности), поэтому счёт ведётся в том же виде, что нарисован: по текущему
     масштабу вида. Это и есть честный итог по нарисованному; на него опираются
     подписи о качестве и текст укладки «Без пересечений». */
  const viewScale = Math.max(0.05, (zoomPct || 80) / 100);
  const drawnCompact = viewScale < LOD_CARD_MIN_SCALE;
  const drawnCrossings = useMemo<DrawnCrossingReport>(
    () => {
      const idList = [...layoutOps.map((o) => o.id), ...virtualInfo.virtuals.map((v) => v.id)];
      const svc = showEndpoints ? virtualInfo.vEdges.map((e) => [e.from, e.to] as [string, string]) : [];
      const S = viewScale;
      const cut = showEndpoints
        ? virtualInfo.cutMarkers.map((m) => {
            const p = layoutFull.pos[m.opId];
            return p
              ? {
                  x: p[0], y: p[1],
                  dir: (m.kind === 'start' ? -1 : 1) as 1 | -1,
                  // Длина обрубка — как в отрисовке: max(14, 22·S) экранных пикселей.
                  len: Math.max(14, 22 * S) / S,
                  opId: m.opId,
                }
              : null;
          }).filter(Boolean) as { x: number; y: number; dir: 1 | -1; len: number; opId: string }[]
        : [];
      const leaders = leaderLines.map((ld) => ({ x: ld.x, from: ld.from, to: ld.to, nodeId: ld.id }));
      return countDrawnCrossings(layoutFull.pos, idList, allDeps, svc, geom, {
        compact: drawnCompact,
        radius: CIRC_WORLD_R,
        cutMarkers: cut,
        leaders,
        samples: 16,
      });
    },
    [layoutFull, layoutOps, allDeps, virtualInfo, geom, showEndpoints, leaderLines, viewScale, drawnCompact],
  );

  /* ── метрики качества раскладки (пересечения, наложения, плотность) ──
     Считаются только по реальным операциям и связям; виртуальные «Старт»/«Финиш»
     и их пунктирные связи в подсчёт не входят — числа сопоставимы с прежними. */
  const metrics = useMemo<LayoutMetrics>(
    () =>
      computeLayoutMetrics(
        layoutFull,
        mappedOps.map((o) => ({ id: o.id, crit: o.crit })),
        allDeps,
        critOnly,
        geom,
      ),
    // Пересчитываются при смене раскладки: режим «по датам / по слоям», период,
    // выбор заказа, фильтр крит. пути, размер шрифта, единицы и «Сброс».
    [layoutFull, allDeps, mappedOps, critOnly, fontSize, unit, resetNonce, posNonce, geom],
  );
  /* ── пересечения по укладкам ──
     Обе укладки считаем независимо и показываем их числа как есть: в «По датам»
     время работ зафиксировано, поэтому пересечения — следствие самого графика,
     а не раскладки; в «По слоям» порядок подбирается свободнее. Числа — только
     факты по текущим укладкам; вывод о планарности делает отдельная проверка ниже. */
  const layoutCrossings = useMemo(() => {
    if (!layoutOps.length) return { byDate: 0, byLayer: 0 };
    const ids = visibleOps.filter((o) => !critOnly || o.crit).map((o) => o.id);
    const count = (m: Mode) => {
      const base = computeLayout(layoutOps, allDeps, m, layoutOpts);
      return nudgeForLabels(base.pos, ids, labelBoxes, allDeps, geom, { radius: labelGeom.radius }).crossings;
    };
    return { byDate: count('byDate'), byLayer: count('byLayer') };
  }, [layoutOps, allDeps, layoutOpts, critOnly, geom, labelBoxes, visibleOps, labelGeom]);

  /* ── вердикт о планарности сети ──
     Отдельная проверка, не путать с метриками раскладки: те лишь считают
     фактические пересечения текущей укладки. Здесь — построение укладки без
     пересечений (обход по граням, по нескольким стартам). Вердикт прямой:
     «планарность подтверждена построением» (ноль достижим), «граф непланарный»
     (ноль невозможен, показываем достигнутый минимум) или «не подтверждена»
     (метод не дал ответ). В пояснение передаётся минимум из обеих укладок. */
  const planarity = useMemo<PlanarityResult>(
    () => checkPlanarity(
      mappedOps.map((o) => ({ id: o.id, crit: o.crit })),
      allDeps,
      critOnly,
      Math.min(layoutCrossings.byDate, layoutCrossings.byLayer),
    ),
    [mappedOps, allDeps, critOnly, layoutCrossings],
  );

  const onMetrics = props.onMetrics;
  // Метрики текущей раскладки — то, что уходит в строку состояния вида.
  const metricsForPanel = useMemo<LayoutMetrics>(() => ({ ...metrics }), [metrics]);
  const metricsSig = [metrics.crossings, metrics.edgeNodeHits, metrics.nodeOverlaps, metrics.density, metrics.nodes, metrics.edges, layoutCrossings.byDate, layoutCrossings.byLayer].join('|');
  const metricsSigRef = useRef('');
  useEffect(() => {
    if (!onMetrics || metricsSigRef.current === metricsSig) return;
    metricsSigRef.current = metricsSig;
    onMetrics(metricsForPanel);
  }, [onMetrics, metricsSig, metricsForPanel]);

  /* ── проверки структуры сети (по методичке): показываются, но отрисовку не блокируют ── */
  const structureIssues = useMemo<StructureIssue[]>(() => {
    const vis = new Set(visibleOps.map((o) => o.id));
    const d = allDeps.filter(([a, b]) => vis.has(a) && vis.has(b));
    return checkCpmStructure(
      visibleOps.map((o) => ({ id: o.id, num: o.num, name: o.name })),
      d,
    );
  }, [visibleOps, allDeps]);

  /* фактический диапазон плана — для полей «Период» (заполняются при загрузке расчёта) */
  const planRange = useMemo(() => {
    if (!startDate || !mappedOps.length) return null;
    const minEs = Math.min(...mappedOps.map((o) => o.es));
    const maxEf = Math.max(...mappedOps.map((o) => o.ef));
    return {
      from: isoDate(addDays(startDate, Math.floor(minEs))),
      to: isoDate(addDays(startDate, Math.ceil(maxEf))),
    };
  }, [mappedOps, startDate]);

  const periodAutoRef = useRef<string>('');
  useEffect(() => {
    if (!planRange) return;
    const key = planRange.from + '..' + planRange.to;
    if (periodAutoRef.current === key) return;   // не затираем ручной выбор без новых данных
    periodAutoRef.current = key;
    setPeriodFrom(planRange.from);
    setPeriodTo(planRange.to);
  }, [planRange]);

  /* ── refs ── */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<any>({});
  const autoFitRef = useRef(true);                 // true → при ресайзе подгоняем заново
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const dragRef = useRef<{ id: string; p0: [number, number]; m0: [number, number]; moved: boolean } | null>(null);
  const panRef = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number }>(
    { active: false, sx: 0, sy: 0, px: 0, py: 0 },
  );
  const hoverIdRef = useRef<string | null>(null);
  // Геометрия нарисованных связей (экранные координаты) — для подсказки при наведении.
  const edgesRef = useRef<{ pts: number[]; tip: EdgeTip }[]>([]);

  const fontScale: number = FONT_SCALES[fontSize];

  /* Подписи узлов теперь привязаны к своим узлам и разводятся вертикальным
     сдвигом узлов (см. labelBoxes / labelNudge выше); прежний перебор позиций
     подписи вокруг узла удалён. */

  stateRef.current = {
    ...stateRef.current,   // сохраняем масштаб/смещение между рендерами (иначе canvas остаётся пустым)
    ops: visibleOps,
    allOps: mappedOps,
    deps: allDeps,
    layout: layoutFull,
    virtuals: virtualInfo.virtuals,
    vEdges: virtualInfo.vEdges,
    cutMarkers: virtualInfo.cutMarkers,
    mode, unit, critOnly, showEdgeDays, showEndpoints, depTypes,
    startDate, dayToDate,
    reserveColor, branchColor, critColor, stretchColor,
    fontScale,
    stretchK: STRETCH_K,
    // Геометрия активного пресета раскладки — нужна и узлам, и связям, и шкале.
    geom,
    cardW: geom.cardW,
    cardH: geom.cardH,
    pad: geom.pad,
    colPitch,
    rowPitch,
    labelScale: geom.labelScale ?? 1,
    // Узлы, сдвинутые далеко при разведении подписей, — под отрисовку
    // тонкой линии-поводка (мировые координаты).
    leaders: leaderLines,
    // Смещения рамок подписей от канонического места (режим «Без пересечений»:
    // узел не двигается, свободное место подбирает сама подпись).
    labelOffsets: labelNudge.labelOffsets,
  };

  /* ── рисование ── */
  const draw = useCallback(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = Math.max(1, wrap.clientWidth);
    const H = Math.max(1, wrap.clientHeight);
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const st = stateRef.current;
    const FS: number = st.fontScale || 1;
    const fsz = (px: number) => Math.max(6, Math.round(px * FS));
    // Геометрия активного пресета раскладки. Размер узла и зазоры берём из
    // состояния — так переключатель раскладки реально меняет и вид, и числа.
    const CW: number = st.cardW || CARD_W;
    const CH: number = st.cardH || CARD_H;
    const PADW: number = st.pad != null ? st.pad : PAD;
    const ROWP: number = st.rowPitch || ROW_PITCH;
    const LBL: number = st.labelScale || 1;
    // Подписи узлов масштабируются и размером шрифта, и пресетом раскладки.
    const fszL = (px: number) => Math.max(6, Math.round(px * FS * LBL));
    // Защита от NaN/невалидного масштаба и смещения — canvas не должен оставаться пустым.
    const S: number = (Number.isFinite(st.scale) && st.scale > 0) ? st.scale : 0.8;
    const panX: number = Number.isFinite(st.panX) ? st.panX : 0;
    const panY: number = Number.isFinite(st.panY) ? st.panY : 0;
    st.scale = S; st.panX = panX; st.panY = panY;
    const sx = (x: number) => x * S + panX;
    const sy = (y: number) => y * S + panY;
    const cardMode = S >= LOD_CARD_MIN_SCALE;
    const circR = circleRadius(S, ROWP);

    ctx.fillStyle = '#0A1628';
    ctx.fillRect(0, 0, W, H);

    const TOP = st.mode === 'byDate' ? Math.round(64 + (FS - 1) * 12) : 24; // место под шкалу времени

    /* ── шкала времени (только раскладка «по датам») ── */
    if (st.mode === 'byDate' && st.startDate) {
      const L: Layout = st.layout;
      const ppd = L.pxPerDay;
      const xOfDay = (d: number) => sx(PADW + (d - L.minEs) * ppd + CW / 2);
      const dayAtX = (x: number) => ((x - panX) / S - PADW - CW / 2) / ppd + L.minEs;
      const d0 = Math.floor(dayAtX(0));
      const d1 = Math.ceil(dayAtX(W));
      const ppdScreen = ppd * S;

      // полосы выходных/праздников
      for (let d = Math.max(d0, 0); d <= d1; d++) {
        const date = addDays(st.startDate, d);
        if (!isWeekend(date) && !isHoliday(date)) continue;
        const x1 = xOfDay(d);
        const x2 = xOfDay(d + 1);
        if (x2 < 0 || x1 > W) continue;
        ctx.fillStyle = isHoliday(date) ? 'rgba(239,68,68,0.075)' : 'rgba(239,68,68,0.035)';
        ctx.fillRect(x1, TOP, x2 - x1, H - TOP);
      }

      // Шаг сетки и подписей задаётся выбранными единицами:
      // «дни» — по суткам, «часы» — по часам внутри суток, «минуты» — по минутам.
      const unitNow: string = st.unit || 'd';
      const pxPerHour = ppdScreen / 24;
      const pxPerMin = ppdScreen / 1440;
      let gStep: number;
      let lStep: number;
      if (unitNow === 'm') {
        gStep = pickStep([1, 2, 5, 10, 15, 30, 60, 120, 180, 360], pxPerMin, 9, 720) / 1440;
        lStep = pickStep([1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720], pxPerMin, 48, 720) / 1440;
      } else if (unitNow === 'h') {
        gStep = pickStep([1, 2, 3, 4, 6, 8, 12], pxPerHour, 9, 12) / 24;
        lStep = pickStep([1, 2, 3, 4, 6, 8, 12], pxPerHour, 48, 12) / 24;
      } else if (ppdScreen > 120) { gStep = 1; lStep = 1; }
      else if (ppdScreen > 55) { gStep = 2; lStep = 2; }
      else if (ppdScreen > 26) { gStep = 4; lStep = 4; }
      else if (ppdScreen > 10) { gStep = 7; lStep = 7; }
      else { gStep = 14; lStep = 14; }

      const gStart = Math.floor(d0 / gStep) * gStep;
      for (let d = gStart; d <= d1 + gStep; d += gStep) {
        const gx = xOfDay(d);
        if (gx < -40 || gx > W + 40) continue;
        ctx.beginPath();
        ctx.moveTo(Math.round(gx) + 0.5, TOP);
        ctx.lineTo(Math.round(gx) + 0.5, H);
        ctx.strokeStyle = 'rgba(60,90,130,0.30)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // для часов/минут дополнительно выделяем границы суток
      if (unitNow !== 'd') {
        for (let d = Math.max(d0, 0); d <= d1; d++) {
          const gx = xOfDay(d);
          if (gx < -40 || gx > W + 40) continue;
          ctx.beginPath();
          ctx.moveTo(Math.round(gx) + 0.5, TOP);
          ctx.lineTo(Math.round(gx) + 0.5, H);
          ctx.strokeStyle = 'rgba(96,165,250,0.22)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // плашка шкалы
      const barY = Math.round(10 + (FS - 1) * 10);
      const barH = Math.round(22 + (FS - 1) * 6);
      ctx.fillStyle = 'rgba(15,30,54,0.85)';
      rrect(ctx, 0, barY, W, barH, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, barY + barH / 2);
      ctx.lineTo(W, barY + barH / 2);
      ctx.strokeStyle = 'rgba(96,165,250,0.30)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // подписи месяцев над шкалой
      ctx.font = fsz(10) + 'px ' + FONT_MONO;
      let prevMonth = -1;
      for (let d = Math.max(d0, 0); d <= d1; d++) {
        const date = addDays(st.startDate, d);
        if (date.getDate() !== 1 && d !== Math.max(d0, 0)) continue;
        const gx = xOfDay(d);
        if (gx < 20 || gx > W - 6) continue;
        if (date.getMonth() === prevMonth && d !== Math.max(d0, 0)) continue;
        prevMonth = date.getMonth();
        ctx.fillStyle = 'rgba(148,170,200,0.75)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold ' + fsz(10) + 'px ' + FONT_MONO;
        ctx.fillText(MONTHS[date.getMonth()] + ' ' + date.getFullYear(), gx + 3, barY - 3);
      }

      // деления и подписи под шкалой — в единицах текущего масштаба
      let prevRight = -1e9;
      const lStart = Math.floor(d0 / lStep) * lStep;
      for (let d = lStart; d <= d1 + lStep; d += lStep) {
        const gx = xOfDay(d);
        if (gx < -20 || gx > W + 20) continue;
        ctx.beginPath();
        ctx.moveTo(Math.round(gx) + 0.5, barY + 4);
        ctx.lineTo(Math.round(gx) + 0.5, barY + barH - 4);
        ctx.strokeStyle = 'rgba(90,112,144,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (d < 0) continue;
        const dd = dayOffsetToDate(st.startDate, d);
        const onDay = Math.abs(d - Math.round(d)) < 1e-6;
        let label: string;
        let isTime = false;
        if (unitNow === 'm' && !onDay) {
          isTime = true;
          const tm = Math.round((d - Math.floor(d)) * 1440);
          label = String(Math.floor(tm / 60)).padStart(2, '0') + ':' + String(tm % 60).padStart(2, '0');
        } else if (unitNow === 'h' && !onDay) {
          isTime = true;
          const hh = Math.round((d - Math.floor(d)) * 24) % 24;
          label = String(hh).padStart(2, '0') + ':00';
        } else {
          label = fmtDayMonth(dd);
        }
        ctx.font = 'bold ' + fsz(isTime ? 11 : 10) + 'px ' + FONT_MONO;
        const lw = ctx.measureText(label).width;
        if (gx - lw / 2 <= prevRight) continue;
        prevRight = gx + lw / 2;
        ctx.fillStyle = isTime ? 'rgba(125,180,250,0.9)' : '#B0C4DE';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, gx, barY + barH + 4);
      }
    }

    /* ── данные для отрисовки ── */
    const visIds = new Set<string>();
    st.ops.forEach((o: GOp) => { if (!st.critOnly || o.crit) visIds.add(o.id); });
    const halfOf = (card: boolean): [number, number] => (card ? [CW / 2, CH / 2] : [CIRC_WORLD_R, CIRC_WORLD_R]);

    /* ── связи ── */
    const edgesToDraw: { a: GOp; b: GOp; bothCrit: boolean; anyBranch: boolean }[] = [];
    st.deps.forEach(([aId, bId]: [string, string]) => {
      if (!visIds.has(aId) || !visIds.has(bId)) return;
      const a = st.ops.find((o: GOp) => o.id === aId);
      const b = st.ops.find((o: GOp) => o.id === bId);
      if (!a || !b) return;
      const pa = st.layout.pos[aId];
      const pb = st.layout.pos[bId];
      if (!pa || !pb) return;
      edgesToDraw.push({ a, b, bothCrit: a.crit && b.crit, anyBranch: a.branch || b.branch });
    });

    // Препятствия для обхода — все видимые узлы, кроме концов текущей связи.
    const allRects: (Rect & { id: string })[] = [];
    st.ops.forEach((o: GOp) => {
      if (st.critOnly && !o.crit) return;
      const p = st.layout.pos[o.id];
      if (!p) return;
      const [hwr, hhr] = halfOf(cardMode);
      allRects.push({ id: o.id, x: p[0], y: p[1], hw: hwr + 6, hh: hhr + 6 });
    });
    // Виртуальные события входят в геометрию как препятствия, чтобы связи
    // реальных операций их не задевали (в счётчик качества они не входят).
    // При выключенном «Старт и Финиш» служебных событий нет — и препятствий тоже.
    ((st.showEndpoints ? (st.virtuals || []) : []) as VirtualNode[]).forEach((v) => {
      allRects.push({ id: v.id, x: v.x, y: v.y, hw: CW / 2 + 6, hh: CH / 2 + 6 });
    });

    edgesRef.current = [];
    edgesToDraw.forEach(({ a, b, bothCrit, anyBranch }) => {
      const pa = st.layout.pos[a.id];
      const pb = st.layout.pos[b.id];
      const [ahw, ahh] = halfOf(cardMode);
      const s = borderPoint(pa[0], pa[1], ahw + 3, ahh + 3, pb[0], pb[1]);
      const e = borderPoint(pb[0], pb[1], ahw + 3, ahh + 3, pa[0], pa[1]);

      // Обход посторонних узлов: если прямая проходит сквозь чужой узел,
      // изгибаем связь минимальным отклонением (квадратичная кривая Безье).
      // Путь считается ЕДИНЫМ помощником `edgeControl` с тем же числом сэмплов,
      // что и у счётчика пересечений итоговой геометрии (`countDrawnCrossings`),
      // — картинка и число не могут разъехаться.
      const obstacles = allRects.filter((r) => r.id !== a.id && r.id !== b.id);
      const [cxw, cyw] = edgeControl(s[0], s[1], e[0], e[1], obstacles, DRAWN_EDGE_DETOUR_SAMPLES);
      const ax = sx(s[0]);
      const ay = sy(s[1]);
      const bx = sx(e[0]);
      const by = sy(e[1]);
      const ccx = sx(cxw);
      const ccy = sy(cyw);
      const curve = !(cxw === (s[0] + e[0]) / 2 && cyw === (s[1] + e[1]) / 2);
      // наконечник: направление — касательная в конце (для кривой это E − C)
      const ang = curve ? Math.atan2(by - ccy, bx - ccx) : Math.atan2(by - ay, bx - ax);
      const hl = clamp(9 * S + 3, 6, 12);

      // Оформление связи. Ожидание связи = b.es − a.ef (сколько дней ждёт
      // следующая работа после окончания предыдущей):
      //   • ожидание > 0 — сплошная линия, у середины — число дней;
      //   • ожидания нет — широкая штрих-пунктирная (длинный штрих + точка)
      //     стальная связь, крупный узор — различим и на мелком масштабе;
      //   • критический путь — всегда сплошная, заметно толще и красная;
      //   • служебные связи «Старта»/«Финиша» — отдельный тонкий пунктир (ниже).
      const waitDays = Math.max(0, b.es - a.ef);
      const hasWait = waitDays >= 0.02;
      // связь без ожидания (логическая) — рисуется ВСЕГДА широким штрих-пунктиром,
      // скрыть её нельзя (прежний переключатель логических связей удалён).
      const logical = !hasWait && !bothCrit;
      const depType = (st.depTypes && st.depTypes[a.id + '>' + b.id]) || null;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      if (curve) ctx.quadraticCurveTo(ccx, ccy, bx, by);
      else ctx.lineTo(bx, by);
      ctx.setLineDash(logical ? dashLogical(S) : []);
      ctx.strokeStyle = bothCrit
        ? EDGE_STYLE.critical.color
        : (logical ? EDGE_STYLE.logical.color : (anyBranch ? EDGE_STYLE.branch.color : EDGE_STYLE.wait.color));
      ctx.lineWidth = bothCrit ? EDGE_STYLE.critical.width : (logical ? EDGE_STYLE.logical.width : EDGE_STYLE.wait.width);
      ctx.stroke();
      ctx.setLineDash([]);

      // наконечник
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - hl * Math.cos(ang - 0.45), by - hl * Math.sin(ang - 0.45));
      ctx.lineTo(bx - hl * Math.cos(ang + 0.45), by - hl * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = bothCrit
        ? EDGE_STYLE.critical.arrow
        : (logical ? EDGE_STYLE.logical.arrow : (anyBranch ? EDGE_STYLE.branch.arrow : EDGE_STYLE.wait.arrow));
      ctx.fill();

      const [lxw, lyw] = curve
        ? quadPt(s[0], s[1], cxw, cyw, e[0], e[1], 0.5)
        : [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
      const lmx = sx(lxw);
      const lmy = sy(lyw);

      // Число на связи — только когда ожидание больше нуля (ноль не подписываем).
      if (st.showEdgeDays && hasWait) {
        const lbl = fmtDur(waitDays, st.unit, a.hpd);
        ctx.font = 'bold ' + fsz(clamp(Math.round(9 * S + 2), 8, 12)) + 'px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(lbl).width + 8;
        const th = Math.max(13, fsz(11) + 4);
        ctx.fillStyle = 'rgba(10,22,40,0.85)';
        rrect(ctx, lmx - tw / 2, lmy - th / 2, tw, th, 3);
        ctx.fill();
        ctx.fillStyle = bothCrit ? 'rgba(252,165,165,0.95)' : 'rgba(176,196,222,0.9)';
        ctx.fillText(lbl, lmx, lmy + 0.5);
      }

      // Буквенная метка неосновных типов связи у середины стрелки (ФС не подписываем).
      if (depType && depType !== 'FS' && DEP_TYPE_LABEL[depType]) {
        const lt = DEP_TYPE_LABEL[depType];
        ctx.font = 'bold ' + fsz(clamp(Math.round(8.5 * S + 2), 8, 12)) + 'px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw2 = ctx.measureText(lt).width + 7;
        const th2 = Math.max(12, fsz(10) + 3);
        const offY = (st.showEdgeDays && hasWait) ? -(th2 + 4) : 0;
        ctx.fillStyle = 'rgba(10,22,40,0.8)';
        rrect(ctx, lmx - tw2 / 2, lmy + offY - th2 / 2, tw2, th2, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(125,211,252,0.95)';
        ctx.fillText(lt, lmx, lmy + offY + 0.5);
      }

      // Геометрия связи для подсказки при наведении (полное описание связи).
      const samples = 18;
      const pts: number[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        if (curve) {
          const q = quadPt(s[0], s[1], cxw, cyw, e[0], e[1], t);
          pts.push(sx(q[0]), sy(q[1]));
        } else {
          pts.push(ax + (bx - ax) * t, ay + (by - ay) * t);
        }
      }
      edgesRef.current.push({
        pts,
        tip: {
          fromId: a.id, toId: b.id,
          from: '№' + String(a.num) + ' ' + a.code,
          to: '№' + String(b.num) + ' ' + b.code,
          wait: waitDays, crit: bothCrit, type: depType,
        },
      });
    });

    /* ── связи со «Стартом»/«Финишем» — пунктир, нулевая длительность ──
       Геометрия учитывает все узлы (реальные и виртуальные): обход минимальным
       отклонением. В счётчик качества эти связи не входят. Служебные связи
       скрываются только тумблером «Старт и Финиш» — вместе с самими событиями. */
    ((st.showEndpoints ? (st.vEdges || []) : []) as VirtualEdge[]).forEach((ve) => {
      const pa = st.layout.pos[ve.from];
      const pb = st.layout.pos[ve.to];
      if (!pa || !pb) return;
      const [ahw, ahh] = halfOf(cardMode);
      const s = borderPoint(pa[0], pa[1], ahw + 3, ahh + 3, pb[0], pb[1]);
      const e = borderPoint(pb[0], pb[1], ahw + 3, ahh + 3, pa[0], pa[1]);
      const obstacles = allRects.filter((r) => r.id !== ve.from && r.id !== ve.to);
      const [cw, chy] = edgeControl(s[0], s[1], e[0], e[1], obstacles);
      const curve = !(cw === (s[0] + e[0]) / 2 && chy === (s[1] + e[1]) / 2);
      const ax = sx(s[0]);
      const ay = sy(s[1]);
      const bx = sx(e[0]);
      const by = sy(e[1]);
      const ccx = sx(cw);
      const ccy = sy(chy);
      const ang = curve ? Math.atan2(by - ccy, bx - ccx) : Math.atan2(by - ay, bx - ax);
      const hl = clamp(8 * S + 2, 5, 11);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      if (curve) ctx.quadraticCurveTo(ccx, ccy, bx, by);
      else ctx.lineTo(bx, by);
      ctx.setLineDash(dashEndpoint(S));
      ctx.strokeStyle = ve.color;
      ctx.lineWidth = EDGE_STYLE.endpoint.width;
      ctx.stroke();
      ctx.setLineDash([]);
      // наконечник
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - hl * Math.cos(ang - 0.45), by - hl * Math.sin(ang - 0.45));
      ctx.lineTo(bx - hl * Math.cos(ang + 0.45), by - hl * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = ve.color;
      ctx.fill();
    });

    /* ── линии-поводки узлов, сдвинутых далеко при разведении подписей ──
       Страховка: узел, уехавший больше чем на две высоты узла, тонкой
       пунктирной линией связывается со своим исходным местом в раскладке. */
    const leaders = (st.leaders || []) as { x: number; from: number; to: number }[];
    if (leaders.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (const ld of leaders) {
        ctx.beginPath();
        ctx.moveTo(sx(ld.x), sy(ld.from));
        ctx.lineTo(sx(ld.x), sy(ld.to));
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ── узлы ── */
    st.ops.forEach((o: GOp) => {
      if (st.critOnly && !o.crit) return;
      const p = st.layout.pos[o.id];
      if (!p) return;
      const cx = sx(p[0]);
      const cy = sy(p[1]);
      if (cx < -CW * S - 20 || cx > W + CW * S + 20 || cy < -CH * S - 20 || cy > H + CH * S + 20) return;

      const accent = o.crit ? critColor : (o.branch ? branchColor : reserveColor);
      const hovered = hoverIdRef.current === o.id;

      if (cardMode) {
        const w = CW * S;
        const h = CH * S;
        const x = cx - w / 2;
        const y = cy - h / 2;
        ctx.fillStyle = hovered ? 'rgba(20,38,64,0.98)' : 'rgba(15,30,54,0.96)';
        rrect(ctx, x, y, w, h, 8 * S);
        ctx.fill();
        ctx.strokeStyle = o.crit ? 'rgba(239,68,68,0.85)' : (o.branch ? 'rgba(245,158,11,0.8)' : 'rgba(96,165,250,0.65)');
        ctx.lineWidth = o.crit ? 2 : 1.2;
        ctx.stroke();
        if (o.crit) {
          ctx.save();
          ctx.shadowColor = 'rgba(239,68,68,0.45)';
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        }
        // Напряжённая работа (коэффициент напряжённости выше порога) — фиолетовая полоса слева.
        if (!o.crit && intensityK(o.durDays, o.tf) > (st.stretchK ?? 0.8)) {
          ctx.fillStyle = stretchColor;
          ctx.fillRect(x, y + 8 * S, Math.max(2, 3 * S), Math.max(4, h - 16 * S));
        }

        // номер
        const badgeR = 11 * S + 2;
        const bx = x + badgeR + 4;
        const by = y + badgeR + 4;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = o.crit ? 'rgba(239,68,68,0.22)' : (o.branch ? 'rgba(245,158,11,0.2)' : 'rgba(96,165,250,0.18)');
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#E8EEF5';
        ctx.font = 'bold ' + fszL(clamp(Math.round(11 * S), 8, 14)) + 'px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.num), bx, by + 0.5);

        // код + наименование
        const textLeft = bx + badgeR + 6;
        const textRight = x + w - 6;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#E8EEF5';
        ctx.font = 'bold ' + fszL(clamp(Math.round(10.5 * S), 8, 13)) + 'px ' + FONT_UI;
        const codeLine = fitText(ctx, o.code, textRight - textLeft);
        ctx.fillText(codeLine, textLeft, y + h * 0.32);
        ctx.fillStyle = 'rgba(176,196,222,0.75)';
        ctx.font = fszL(clamp(Math.round(9.5 * S), 7, 12)) + 'px ' + FONT_UI;
        const detailLine = fitText(ctx, o.detail || o.name, textRight - textLeft);
        if (detailLine) ctx.fillText(detailLine, textLeft, y + h * 0.63);

        // длительность и диапазон
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(176,196,222,0.85)';
        ctx.font = fszL(clamp(Math.round(9 * S), 7, 12)) + 'px ' + FONT_MONO;
        const durTxt = '⏱ ' + fmtDur(o.durDays, st.unit, o.hpd);
        ctx.fillText(durTxt, x + 6, y + h - 6);

        // резерв
        if (o.tf > 0.0001) {
          const resTxt = '+' + fmtReserve(o.tf, st.unit, o.hpd);
          ctx.font = 'bold ' + fszL(clamp(Math.round(9 * S), 7, 12)) + 'px ' + FONT_MONO;
          ctx.fillStyle = '#F59E0B';
          ctx.textAlign = 'right';
          ctx.fillText(resTxt, x + w - 6, y + h - 6);
          ctx.textAlign = 'left';
        } else {
          ctx.font = 'bold ' + fszL(clamp(Math.round(9 * S), 7, 12)) + 'px ' + FONT_MONO;
          ctx.fillStyle = 'rgba(239,68,68,0.9)';
          ctx.textAlign = 'right';
          ctx.fillText('крит', x + w - 6, y + h - 6);
          ctx.textAlign = 'left';
        }
      } else {
        // компактный режим — окружность с номером + подпись
        const r = circR;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
        ctx.fillStyle = o.crit ? 'rgba(239,68,68,0.10)' : 'rgba(96,165,250,0.07)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15,30,54,0.95)';
        ctx.fill();
        const stretchCompact = !o.crit && !o.branch && intensityK(o.durDays, o.tf) > (st.stretchK ?? 0.8);
        ctx.strokeStyle = o.crit ? 'rgba(239,68,68,0.9)' : (o.branch ? 'rgba(245,158,11,0.85)' : (stretchCompact ? 'rgba(167,139,250,0.95)' : 'rgba(96,165,250,0.7)'));
        ctx.lineWidth = o.crit ? 2 : (stretchCompact ? 1.8 : 1.3);
        ctx.stroke();
        ctx.fillStyle = '#E8EEF5';
        ctx.font = 'bold ' + fszL(clamp(Math.round(11 * S + 2), 8, 14)) + 'px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.num), cx, cy + 0.5);

        // Подписи узла — всегда в ФИКСИРОВАННОМ месте относительно СВОЕГО узла:
        // имя работы сверху, «продолжительность + резерв» снизу. Узел вместе с
        // подписями мог быть сдвинут вниз при разведении наложений (st.layout),
        // поэтому подпись и узел двигаются как одно целое и не разъезжаются.
        const GAPW = LABEL_GAP;   // мировой зазор между окружностью и подписью (единый с проверкой)
        // Смещение рамки подписи, подобранное под свободное место (режим
        // «Без пересечений»: узел не сдвигается — двигается сама подпись).
        const off = ((st.labelOffsets || {}) as Record<string, [number, number]>);
        const offCode = off[o.id + ':code'] || [0, 0];
        const offDur = off[o.id + ':dur'] || [0, 0];
        if (r >= 11) {
          const codeFp = fszL(clamp(Math.round(9.5 * S + 3), 8, 12));
          ctx.fillStyle = o.crit ? '#E8EEF5' : 'rgba(176,196,222,0.8)';
          ctx.font = codeFp + 'px ' + FONT_UI;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const lbl = fitText(ctx, o.code, CW * 0.9);
          const ly = cy - (r + GAPW * S + codeFp * 1.2 / 2);
          ctx.fillText(lbl, cx + offCode[0] * S, ly + offCode[1] * S + 0.5);
        }
        // Продолжительность операции — в компактном режиме тоже, у всех узлов,
        // включая критические (иначе у красных узлов подписи длительности нет).
        // Резерв, если он есть, выводится рядом справа тем же кеглем.
        if (r >= 9) {
          const durTxt = fmtDur(o.durDays, st.unit, o.hpd);
          const resTxt = o.tf > 0.0001 ? '  +' + fmtReserve(o.tf, st.unit, o.hpd) : '';
          const durFp = fszL(clamp(Math.round(9 * S + 2), 7, 11));
          ctx.font = 'bold ' + durFp + 'px ' + FONT_MONO;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          const durW = ctx.measureText(durTxt).width;
          const resW = resTxt ? ctx.measureText(resTxt).width : 0;
          const by = cy + (r + GAPW * S + durFp * 1.2 / 2);
          const lx = cx - (durW + resW) / 2;
          const dOx = offDur[0] * S;
          const dOy = offDur[1] * S;
          ctx.fillStyle = o.crit ? 'rgba(252,165,165,0.95)' : 'rgba(176,196,222,0.9)';
          ctx.fillText(durTxt, lx + dOx, by + dOy + 0.5);
          if (resTxt) {
            ctx.fillStyle = '#F59E0B';
            ctx.fillText(resTxt, lx + durW + dOx, by + dOy + 0.5);
          }
        }
      }
    });

    /* ── виртуальные события «Старт»/«Финиш» — отдельная форма (капсула) и цвет ──
       Показываются, пока включён тумблер «Старт и Финиш» (по умолчанию включён).
       Обычные связи и критический путь от этого тумблера не зависят. */
    ((st.showEndpoints ? (st.virtuals || []) : []) as VirtualNode[]).forEach((v) => {
      const cx = sx(v.x);
      const cy = sy(v.y);
      if (cx < -CW * S - 20 || cx > W + CW * S + 20 || cy < -CH * S - 20 || cy > H + CH * S + 20) return;
      const hovered = hoverIdRef.current === v.id;
      if (cardMode) {
        const w = CW * S;
        const h = CH * S;
        const x = cx - w / 2;
        const y = cy - h / 2;
        const r = h / 2;
        ctx.save();
        ctx.shadowColor = v.color;
        ctx.shadowBlur = hovered ? 18 : 11;
        ctx.fillStyle = hovered ? 'rgba(24,48,72,0.98)' : 'rgba(12,26,44,0.98)';
        rrect(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = v.color;
        ctx.lineWidth = 2.4;
        rrect(ctx, x, y, w, h, r);
        ctx.stroke();

        // содержимое: цветной маркер + подпись «Старт»/«Финиш»
        ctx.font = 'bold ' + fszL(clamp(Math.round(11 * S), 8, 14)) + 'px ' + FONT_UI;
        const lbl = v.label;
        const tw = ctx.measureText(lbl).width;
        const dotR = Math.max(3, 4 * S);
        const gap = 7 * S;
        const totalW = dotR * 2 + gap + tw;
        const lx = cx - totalW / 2;
        ctx.beginPath();
        ctx.arc(lx + dotR, cy, dotR, 0, Math.PI * 2);
        ctx.fillStyle = v.color;
        ctx.fill();
        ctx.fillStyle = '#E8EEF5';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(lbl, lx + dotR * 2 + gap, cy + 0.5);
      } else {
        const r = circleRadius(S, ROWP) * 1.45;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10,22,40,0.6)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(12,26,44,0.98)';
        ctx.fill();
        ctx.strokeStyle = v.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = v.color;
        ctx.font = 'bold ' + fszL(clamp(Math.round(11 * S + 2), 8, 14)) + 'px ' + FONT_UI;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v.kind === 'start' ? '▶' : '■', cx, cy + 0.5);
      }
    });

    /* ── маркеры обрезки периода — короткий обрубок со стрелкой в сторону продолжения ──
       Рисуются вместо значка «Старт»/«Финиш» у крайних видимых операций, чья
       цепочка продолжается вне выбранного периода. Скрываются тем же тумблером
       «Старт и Финиш», что и сами события. В счётчик качества не входят. */
    ((st.showEndpoints ? (st.cutMarkers || []) : []) as CutMarker[]).forEach((m) => {
      const p = st.layout.pos[m.opId];
      if (!p) return;
      const cx = sx(p[0]);
      const cy = sy(p[1]);
      const hw = (cardMode ? CW / 2 : CIRC_WORLD_R) * S;
      const dir = m.kind === 'start' ? -1 : 1;   // start → продолжение влево (раньше), finish → вправо
      const x0 = cx + dir * (hw + 4);
      const x1 = x0 + dir * Math.max(14, 22 * S);
      if (x1 < -40 || x0 > W + 40 || cy < -60 || cy > H + 60) return;
      ctx.save();
      ctx.setLineDash(dashEndpoint(S));
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, cy);
      ctx.lineTo(x1, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      // наконечник — в сторону продолжения (вне периода)
      const hl = clamp(8 * S + 3, 6, 11);
      const ang = dir < 0 ? Math.PI : 0;
      ctx.beginPath();
      ctx.moveTo(x1, cy);
      ctx.lineTo(x1 - hl * Math.cos(ang - 0.5), cy - hl * Math.sin(ang - 0.5));
      ctx.lineTo(x1 - hl * Math.cos(ang + 0.5), cy - hl * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.fill();
      // точка-ограничитель у основания обрубка (чтобы читалось как граница обрезки)
      ctx.beginPath();
      ctx.arc(x0, cy, Math.max(1.6, 2.2 * S), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }, []);

  /**
   * Подгонка содержимого под полотно.
   * targetScale — верхняя граница масштаба (чтобы не приближать мелкий граф).
   * minScale — нижняя граница: на первом показе/смене данных не уходим в такой
   * мелкий масштаб, где пропадают подписи (иначе теряются наименования операций).
   * Кнопки «По размеру» и «Сброс» вызывают без minScale — они показывают всё.
   */
  const fitToContent = useCallback((targetScale?: number, minScale?: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const st = stateRef.current;
    const L: Layout = st.layout;
    const W = Math.max(1, wrap.clientWidth);
    const H = Math.max(1, wrap.clientHeight);
    const top = st.mode === 'byDate' ? 70 : 26;
    const cw = Math.max(1, L.maxX - L.minX);
    const ch = Math.max(1, L.maxY - L.minY);
    let s = Math.min((W - 40) / cw, (H - top - 24) / ch);
    if (targetScale != null) s = Math.min(s, targetScale);
    s = clamp(s, minScale != null ? minScale : 0.16, 1.25);
    st.scale = s;
    st.panX = 20 - L.minX * s + Math.max(0, (W - 40 - cw * s) / 2);
    st.panY = top + 8 - L.minY * s + Math.max(0, (H - top - 24 - ch * s) / 2);
    autoFitRef.current = true;   // после подгонки следим за размером контейнера автоматически
    setZoomPct(Math.round(s * 100));
    draw();
  }, [draw]);

  /* при смене данных/режима — раскладка и подгонка */
  const sigRef = useRef<string>('');
  useEffect(() => {
    const st = stateRef.current;
    const sig = [
      String(projectId), mode, visibleOps.length, allDeps.length, periodFrom, periodTo,
      critOnly ? 'crit' : 'all', layoutOps.length,
    ].join('|');
    const first = !st.scale;
    if (!first) {
      // сохраняем текущий масштаб/центр, но пересчитываем подгонку при смене раскладки
      const keep = sigRef.current === sig;
      if (keep) { draw(); return; }
    }
    st.scale = st.scale || 0.8;
    st.panX = st.panX || 20;
    st.panY = st.panY || 70;
    fitToContent(0.85, READABLE_MIN_SCALE);
    sigRef.current = sig;
  }, [visibleOps, allDeps, mode, projectId, periodFrom, periodTo, critOnly, layoutOps, fitToContent, draw]);

  /* «Сброс»: после применения состояния гарантированно перерисовываем вид «по размеру».
     Отдельный счётчик заставляет эффект сработать даже если остальные поля уже в норме;
     подгонка выполняется в следующем кадре, когда раскладка уже пересчитана и canvas готов. */
  useEffect(() => {
    if (!resetNonce) return;
    const raf = requestAnimationFrame(() => {
      const st = stateRef.current;
      if (st.layout) fitToContent();
    });
    return () => cancelAnimationFrame(raf);
  }, [resetNonce, fitToContent]);

  useEffect(() => {
    const onResize = () => {
      const st = stateRef.current;
      if (!st.layout) return;
      if (autoFitRef.current) fitToContent(); else draw();
    };
    window.addEventListener('resize', onResize);
    const t = setTimeout(() => { const st = stateRef.current; if (st.layout) fitToContent(0.85, READABLE_MIN_SCALE); }, 60);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [fitToContent, draw]);

  /* перерисовка при изменении размеров контейнера (панель, окно, смена DPR) */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const st = stateRef.current;
      if (!st.layout) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (Math.abs(w - sizeRef.current.w) < 1 && Math.abs(h - sizeRef.current.h) < 1) return;
      sizeRef.current = { w, h };
      if (autoFitRef.current) fitToContent(); else draw();
    });
    ro.observe(wrap);
    sizeRef.current = { w: wrap.clientWidth, h: wrap.clientHeight };
    return () => ro.disconnect();
  }, [draw, fitToContent]);

  /* ── попадание в узел ── */
  const hitTest = useCallback((mx: number, my: number): GOp | null => {
    const st = stateRef.current;
    const S: number = st.scale;
    const cardMode = S >= LOD_CARD_MIN_SCALE;
    const CWv: number = st.cardW || CARD_W;
    const CHv: number = st.cardH || CARD_H;
    const ROWPv: number = st.rowPitch || ROW_PITCH;
    const sxv = (x: number) => x * S + st.panX;
    const syv = (y: number) => y * S + st.panY;
    for (let i = st.ops.length - 1; i >= 0; i--) {
      const o: GOp = st.ops[i];
      if (st.critOnly && !o.crit) continue;
      const p = st.layout.pos[o.id];
      if (!p) continue;
      const cx = sxv(p[0]);
      const cy = syv(p[1]);
      if (cardMode) {
        if (Math.abs(mx - cx) <= (CWv / 2) * S && Math.abs(my - cy) <= (CHv / 2) * S) return o;
      } else {
        const r = circleRadius(S, ROWPv);
        if ((mx - cx) ** 2 + (my - cy) ** 2 <= r * r) return o;
      }
    }
    return null;
  }, []);

  /* ── попадание в виртуальное событие «Старт»/«Финиш» ── */
  const hitVirtual = useCallback((mx: number, my: number): VirtualNode | null => {
    const st = stateRef.current;
    const S: number = st.scale;
    const cardMode = S >= LOD_CARD_MIN_SCALE;
    const CWv: number = st.cardW || CARD_W;
    const CHv: number = st.cardH || CARD_H;
    const ROWPv: number = st.rowPitch || ROW_PITCH;
    const sxv = (x: number) => x * S + st.panX;
    const syv = (y: number) => y * S + st.panY;
    if (!st.showEndpoints) return null;   // события скрыты тумблером — и подсказка не нужна
    const vs: VirtualNode[] = st.virtuals || [];
    for (let i = vs.length - 1; i >= 0; i--) {
      const v = vs[i];
      const cx = sxv(v.x);
      const cy = syv(v.y);
      if (cardMode) {
        if (Math.abs(mx - cx) <= (CWv / 2) * S && Math.abs(my - cy) <= (CHv / 2) * S) return v;
      } else {
        const r = circleRadius(S, ROWPv) * 1.45;
        if ((mx - cx) ** 2 + (my - cy) ** 2 <= r * r) return v;
      }
    }
    return null;
  }, []);

  /* ── попадание в маркер обрезки периода ── */
  const hitCut = useCallback((mx: number, my: number): CutMarker | null => {
    const st = stateRef.current;
    if (!st.showEndpoints) return null;
    const S: number = st.scale;
    const cardMode = S >= LOD_CARD_MIN_SCALE;
    const CWv: number = st.cardW || CARD_W;
    const sxv = (x: number) => x * S + st.panX;
    const syv = (y: number) => y * S + st.panY;
    const list: CutMarker[] = st.cutMarkers || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const p = st.layout.pos[m.opId];
      if (!p) continue;
      const cx = sxv(p[0]);
      const cy = syv(p[1]);
      const hw = (cardMode ? CWv / 2 : CIRC_WORLD_R) * S;
      const dir = m.kind === 'start' ? -1 : 1;
      const x0 = cx + dir * (hw + 4);
      const x1 = x0 + dir * Math.max(14, 22 * S);
      const lo = Math.min(x0, x1);
      const hi = Math.max(x0, x1);
      if (mx >= lo - 6 && mx <= hi + 6 && Math.abs(my - cy) <= 12) return m;
    }
    return null;
  }, []);

  /* ── попадание в связь (подсказка с полным описанием связи) ── */
  const hitEdge = useCallback((mx: number, my: number): EdgeTip | null => {
    const list = edgesRef.current;
    let best: EdgeTip | null = null;
    let bestD = 64;   // порог ~8px
    for (let i = 0; i < list.length; i++) {
      const pts = list[i].pts;
      for (let j = 0; j + 3 < pts.length; j += 2) {
        const x1 = pts[j], y1 = pts[j + 1], x2 = pts[j + 2], y2 = pts[j + 3];
        const vx = x2 - x1, vy = y2 - y1;
        const len2 = vx * vx + vy * vy || 1;
        let t = ((mx - x1) * vx + (my - y1) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = mx - (x1 + vx * t), dy = my - (y1 + vy * t);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = list[i].tip; }
      }
    }
    return best;
  }, []);

  /* ── мышь ── */
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    autoFitRef.current = false;   // ручное перетаскивание — автоподгонку выключаем
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) {
      const p = stateRef.current.layout.pos[hit.id];
      dragRef.current = { id: hit.id, p0: [p[0], p[1]], m0: [mx, my], moved: false };
    } else {
      const st = stateRef.current;
      panRef.current = { active: true, sx: mx, sy: my, px: st.panX, py: st.panY };
    }
  }, [hitTest]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const st = stateRef.current;

    const drag = dragRef.current;
    if (drag) {
      const dx = (mx - drag.m0[0]) / st.scale;
      const dy = (my - drag.m0[1]) / st.scale;
      if (st.mode === 'byDate') {
        // «По датам»: горизонталь привязана к дате — двигаем узел только по вертикали.
        st.layout.pos[drag.id] = [drag.p0[0], drag.p0[1] + dy];
        if (Math.abs(dy) > 2) drag.moved = true;
      } else {
        // «По слоям»: свободное перетаскивание по обеим осям.
        st.layout.pos[drag.id] = [drag.p0[0] + dx, drag.p0[1] + dy];
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      }
      draw();
      return;
    }
    if (panRef.current.active) {
      st.panX = panRef.current.px + (mx - panRef.current.sx);
      st.panY = panRef.current.py + (my - panRef.current.sy);
      draw();
    }

    const hit = hitTest(mx, my);
    const vhit = hit ? null : hitVirtual(mx, my);
    const chit = (hit || vhit) ? null : hitCut(mx, my);
    const ehit = (hit || vhit || chit) ? null : hitEdge(mx, my);
    const newHover = hit ? hit.id : (vhit ? vhit.id : null);
    if (hoverIdRef.current !== newHover) { hoverIdRef.current = newHover; draw(); }
    if (hit) setTooltip({ x: mx, y: my, op: hit });
    else if (vhit) setTooltip({ x: mx, y: my, virt: vhit });
    else if (chit) setTooltip({ x: mx, y: my, cut: chit });
    else if (ehit) setTooltip({ x: mx, y: my, edge: ehit });
    else setTooltip(null);
  }, [draw, hitTest, hitVirtual, hitCut, hitEdge]);

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    panRef.current.active = false;
    if (drag && !drag.moved && onSelect) onSelect(drag.id);
    if (drag && drag.moved) {
      // Фиксируем ручную позицию узла (действует до «Сброса») и заставляем
      // пересчитать число счётчика качества после отпускания мыши.
      const st = stateRef.current;
      const p = st.layout && st.layout.pos ? st.layout.pos[drag.id] : null;
      if (p && st.mode) manualRef.current[st.mode as Mode][drag.id] = [p[0], p[1]];
      draw();
      setPosNonce((n) => n + 1);
    }
  }, [draw, onSelect]);

  const onMouseLeave = useCallback(() => {
    dragRef.current = null;
    panRef.current.active = false;
    if (hoverIdRef.current) { hoverIdRef.current = null; draw(); }
    setTooltip(null);
  }, [draw]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    const st = stateRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - st.panX) / st.scale;
    const wy = (my - st.panY) / st.scale;
    const next = clamp(st.scale * (e.deltaY < 0 ? 1.12 : 0.89), 0.14, 2.6);
    st.panX = mx - wx * next;
    st.panY = my - wy * next;
    st.scale = next;
    autoFitRef.current = false;   // пользователь задал масштаб вручную
    setZoomPct(Math.round(next * 100));
    draw();
  }, [draw]);

  const zoomBy = useCallback((factor: number) => {
    const st = stateRef.current;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const wx = (W / 2 - st.panX) / st.scale;
    const wy = (H / 2 - st.panY) / st.scale;
    const next = clamp(st.scale * factor, 0.14, 2.6);
    st.panX = W / 2 - wx * next;
    st.panY = H / 2 - wy * next;
    st.scale = next;
    autoFitRef.current = false;   // пользователь задал масштаб вручную
    setZoomPct(Math.round(next * 100));
    draw();
  }, [draw]);

  /* «Сброс» — возврат к виду по умолчанию: раскладка «по датам», период «весь проект»,
     фильтр критического пути и подписи связей сняты, масштаб «по размеру».
     Единицы измерения и размер шрифта НЕ сбрасываются. */
  const resetView = useCallback(() => {
    // Ручные позиции узлов сбрасываются вместе с видом.
    manualRef.current = { byDate: {}, byLayer: {} };
    setMode('byDate');
    setPeriodFrom(planRange?.from || '');
    setPeriodTo(planRange?.to || '');
    setCritOnly(false);
    setShowEdgeDays(true);
    setShowEndpoints(true);
    setLegendOpen(false);
    setPosNonce((n) => n + 1);
    setResetNonce((n) => n + 1);
  }, [planRange]);

  useEffect(() => {
    try { draw(); } catch (e: any) { setCanvasErr(String((e && e.message) || e)); }
    // layoutFull — перерисовка при пересчёте раскладки/виртуальных событий/ручных позициях.
    // Порог напряжённости (STRETCH_K) — внутреннее значение, в интерфейсе не меняется.
  }, [draw, visibleOps, allDeps, mode, unit, critOnly, showEdgeDays, showEndpoints, depTypes, fontSize, layoutFull, STRETCH_K]);

  // Явная высота (число/строка) → фиксированное полотно; иначе полотно занимает всю
  // доступную высоту родителя (вид рабочего поля), без пустых полос внизу.
  const h = typeof height === 'number' ? height + 'px' : (height && height !== '100%' ? String(height) : null);
  const total = mappedOps.length;
  const critCount = mappedOps.filter((o) => o.crit).length;
  const shown = visibleOps.length;

  if (!total) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#5A7090' }}>
        Нет операций для отображения.
      </div>
    );
  }

  /* ── честный итог режима «Без пересечений» ──
     Ноль пересечений объявляем ТОЛЬКО если он подтверждён на ИТОГОВОЙ геометрии —
     той, что рисуется, со всеми связями (операционными и служебными). Иначе
     показываем фактическое число и что именно пересекается. */
  const noplanZero = drawnCrossings.total === 0;
  // Что именно пересекается — по классам линий итоговой геометрии.
  const crossWhere = [
    drawnCrossings.opOp > 0 ? 'операционные связи между собой — ' + drawnCrossings.opOp : '',
    drawnCrossings.opSvc > 0 ? 'операционные со служебными «Старт»/«Финиш» — ' + drawnCrossings.opSvc : '',
    drawnCrossings.svcSvc > 0 ? 'служебные между собой — ' + drawnCrossings.svcSvc : '',
    drawnCrossings.cut > 0 ? 'маркеры обрезки периода — ' + drawnCrossings.cut : '',
    drawnCrossings.leader > 0 ? 'поводки подписей — ' + drawnCrossings.leader : '',
  ].filter(Boolean).join('; ');
  const noplanBanner = noplanZero
    ? 'Раскладка «Без пересечений»: на итоговой схеме пересечений линий нет — ноль подтверждён по всем линиям' +
      (showEndpoints ? ' (операционные связи, служебные «Старт»/«Финиш», маркеры обрезки периода)' : '') +
      '. Хронология (даты) в этой укладке не показывается.'
    : 'Раскладка «Без пересечений»: ' +
      (noPlanReachable ? 'ноль на итоговой схеме не подтверждён' : 'ноль пересечений недостижим для этого графа') +
      ' — фактически ' + drawnCrossings.total + ' ' + crossingsWord(drawnCrossings.total) + ' линий' +
      (crossWhere ? ' (' + crossWhere + ')' : '') +
      '. Хронология (даты) в этой укладке не показывается.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, height: '100%', border: '1px solid ' + pal.frame, borderRadius: 10, padding: 10, background: '#0B1626' }}>
      {/* единый тёмный стиль элементов панели (кнопки, селекторы, чекбоксы, даты) */}
      <style dangerouslySetInnerHTML={{ __html: PANEL_CSS }} />
      {/* шапка: область · масштаб · режим */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        {title ? <b style={{ fontSize: 13, color: '#E8EEF5' }}>{title}</b> : null}
        <Badge>Область: {props.cpmResult?.order_id ? 'заказ' : 'весь проект'}</Badge>
        <Badge>Операций: {shown}{shown !== total ? ' / ' + total : ''}</Badge>
        <Badge tone="crit">Критических: {critCount}</Badge>
        <Badge>Масштаб: {zoomPct}%</Badge>
        <CpmReadability
          metrics={metricsForPanel}
          crossingsByDate={layoutCrossings.byDate}
          crossingsByLayer={layoutCrossings.byLayer}
          planarity={planarity}
          drawnCrossings={drawnCrossings.total}
          drawnService={drawnCrossings.service}
          labelOverlaps={labelNudge.stats.labelOverlaps}
          labelOverlapsFixed={labelNudge.statsBefore.labelOverlaps}
        />
        <Badge>Режим: {mode === 'byDate' ? 'по датам' : 'по слоям'}</Badge>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 0, border: '1px solid #26364F', borderRadius: 7, overflow: 'hidden' }}>
          {(['byDate', 'byLayer'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setPresetNotice(null); setMode(m); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: mode === m ? 'linear-gradient(135deg,#3B82F6,#2563EB)' : 'transparent',
                color: mode === m ? '#fff' : '#8FA3BD',
              }}
            >
              {m === 'byDate' ? 'По датам' : 'По слоям'}
            </button>
          ))}
        </div>
      </div>

      {/* управление */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <label className="cpmui-lbl">
          Единицы:
          <select className="cpmui-sel" value={unit} onChange={(e) => setUnit(e.target.value as any)}>
            <option value="d">дни</option>
            <option value="h">часы</option>
            <option value="m">минуты</option>
          </select>
        </label>
        <label className="cpmui-lbl">
          <input className="cpmui-chk" type="checkbox" checked={critOnly} onChange={(e) => setCritOnly(e.target.checked)} />
          Только крит. путь
        </label>
        <label className="cpmui-lbl">
          <input className="cpmui-chk" type="checkbox" checked={showEdgeDays} onChange={(e) => setShowEdgeDays(e.target.checked)} />
          Дни на связях
        </label>
        <label className="cpmui-lbl" title="Выключите, чтобы скрыть только служебные события «Старт» и «Финиш» и их тонкие пунктирные связи. Обычные связи и критический путь остаются на схеме всегда">
          <input className="cpmui-chk" type="checkbox" checked={showEndpoints} onChange={(e) => setShowEndpoints(e.target.checked)} />
          Старт и Финиш
        </label>
        <label className="cpmui-lbl">
          Шрифт:
          <select className="cpmui-sel" value={fontSize} onChange={(e) => setFontSize(e.target.value as FontSize)}>
            <option value="sm">мелкий</option>
            <option value="md">средний</option>
            <option value="lg">крупный</option>
          </select>
        </label>
        {/* Резерв под будущее управление «Разброс» (согласуется с заказчиком) */}
        <span data-reserve="spread" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', minWidth: 96, height: 22 }} />
        <span style={{ color: '#5A7090' }}>Период:</span>
        <input className="cpmui-date" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
        <span style={{ color: '#5A7090' }}>—</span>
        <input className="cpmui-date" type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
        <button className="cpmui-btn" onClick={() => { setPeriodFrom(planRange?.from || ''); setPeriodTo(planRange?.to || ''); }}>Весь проект</button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#5A7090' }}>Раскладка:</span>
          <div style={{ display: 'flex', gap: 0, border: '1px solid #26364F', borderRadius: 7, overflow: 'hidden' }}>
            {LAYOUT_PRESETS.map((p) => {
              const isNoPlan = p.id === 'noplan';
              const disabled = isNoPlan && !noPlanAvailable;
              const selected = layoutPreset === p.id;
              const title = isNoPlan
                ? (disabled
                    ? 'Доступно в структурной укладке «По слоям»'
                    : (noPlanReachable
                        ? 'Структурная укладка без пересечений · хронология (даты) не показывается'
                        : 'Ноль недостижим для этой схемы — будет показан достигнутый минимум'))
                : p.hint;
              const bg = selected
                ? (isNoPlan && !noPlanReachable
                    ? 'linear-gradient(135deg,#B45309,#92400E)'
                    : 'linear-gradient(135deg,#3B82F6,#2563EB)')
                : 'transparent';
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => { setPresetNotice(null); applyLayoutPreset(p.id); }}
                  title={title}
                  data-cpm-layout={p.id}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
                    whiteSpace: 'nowrap',
                    background: bg,
                    color: selected ? '#fff' : '#8FA3BD',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </span>
        {mode === 'byLayer' && (
          <label
            className="cpmui-lbl"
            data-cpm-align-cut={alignCutEnds ? 'on' : 'off'}
            title={layoutPreset === 'print'
              ? 'Раскладка «Для печати» не меняется компановкой — крыжик доступен в «Обычно», «Плотно» и «Без пересечений»'
              : 'Выстроить маркеры обрезки периода по одной вертикали слева и справа, чтобы видимое окно читалось прямоугольником. Раскладка «Для печати» не затрагивается'}
            style={layoutPreset === 'print' ? { opacity: 0.5 } : undefined}
          >
            <input
              className="cpmui-chk"
              type="checkbox"
              checked={alignCutEnds}
              disabled={layoutPreset === 'print'}
              onChange={(e) => setAlignCutEnds(e.target.checked)}
            />
            Выравнивать обрезки периода
          </label>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="cpmui-btn sq" onClick={() => zoomBy(1.2)} title="Приблизить">＋</button>
          <button className="cpmui-btn sq" onClick={() => zoomBy(1 / 1.2)} title="Отдалить">－</button>
          <button className="cpmui-btn" onClick={() => fitToContent()}>По размеру</button>
          <button className="cpmui-btn" onClick={resetView}>Сброс</button>
        </div>
      </div>

      {/* честная подпись к раскладке «Без пересечений» (структурная укладка):
         при планарном подграфе — ноль достигнут и хронология не показывается,
         при непланарном — прямо сказано, что ноль недостижим для этой схемы. */}
      {layoutPreset === 'noplan' && mode === 'byLayer' && (
        <div
          data-cpm-noplan={noplanZero ? 'achieved' : 'unreachable'}
          data-cpm-crossings-drawn={drawnCrossings.total}
          data-cpm-crossings-op={drawnCrossings.opOp}
          data-cpm-crossings-service={drawnCrossings.service}
          style={{
            display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', borderRadius: 8, fontSize: 11.5,
            background: noplanZero ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)',
            border: '1px solid ' + (noplanZero ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'),
            color: noplanZero ? '#6EE7B7' : '#FCD34D',
          }}
        >
          <span aria-hidden="true">🕸</span>
          <span>{noplanBanner}</span>
        </div>
      )}

      {/* Пояснение к «Без пересечений», если укладку пришлось откатить (не «молча не применено»). */}
      {presetNotice && (
        <div
          data-cpm-preset-notice="shown"
          style={{
            display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', borderRadius: 8, fontSize: 11.5,
            background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#FCD34D',
          }}
        >
          <span aria-hidden="true">⚠</span>
          <span>{presetNotice}</span>
        </div>
      )}

      {/* отладочная панель — только по явному ручному флагу (?cpmDiag=1 / localStorage), по умолчанию выключена */}
      {diagOn && (
        <pre
          data-cpm-diag="panel"
          style={{
            margin: 0, padding: '6px 9px', borderRadius: 8, fontSize: 10.5, lineHeight: 1.35,
            background: 'rgba(148,163,184,0.08)', border: '1px dashed rgba(148,163,184,0.35)',
            color: '#94A3B8', fontFamily: FONT_MONO, whiteSpace: 'pre-wrap', overflow: 'hidden',
          }}
        >
          {[
            'mode=' + mode + ' preset=' + layoutPreset + ' noplanActive=' + noplanActive + ' reachable=' + noPlanReachable + ' planarLayout=' + planarLayout,
            'ops all/visible/layout=' + mappedOps.length + '/' + visibleOps.length + '/' + layoutOps.length + ' deps all/visible=' + allDeps.length + '/' + structureIssues.length,
            'drawn total/opOp/svc=' + drawnCrossings.total + '/' + drawnCrossings.opOp + '/' + drawnCrossings.service + ' overlaps=' + labelNudge.stats.labelOverlaps,
          ].join('\n')}
        </pre>
      )}

      {/* условные обозначения перенесены вниз рабочей области (см. блок ниже полотна) */}

      {/* предупреждения структуры сети (по методичке) — отрисовку не блокируют */}
      {structureIssues.length > 0 && (
        <div
          data-cpm-structure="panel"
          style={{
            display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 10px', borderRadius: 8,
            background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)',
            color: '#FCD34D', fontSize: 11.5,
          }}
        >
          {structureIssues.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span><b>{w.title}.</b> {w.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* полотно */}
      <div
        ref={wrapRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        style={{ position: 'relative', flex: h ? '0 0 auto' : '1 1 auto', minHeight: h ? 260 : 120, overflow: 'hidden', borderRadius: 8, cursor: 'grab', background: '#0A1628', border: '1px solid #1E3252', ...(h ? { height: h } : {}) }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        {shown === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5A7090', fontSize: 13, pointerEvents: 'none' }}>
            В выбранном периоде нет операций — нажмите «Весь проект».
          </div>
        )}
        {canvasErr && (
          <div style={{ position: 'absolute', inset: 8, color: '#F87171', fontSize: 12, whiteSpace: 'pre-wrap' }}>Ошибка отрисовки: {canvasErr}</div>
        )}
        {tooltip && (
          <div
            ref={tipRef}
            style={{
              position: 'absolute',
              left: Math.min(tooltip.x + 14, (wrapRef.current?.clientWidth || 800) - 290),
              top: Math.max(6, tooltip.y - 20),
              width: 268, pointerEvents: 'none', zIndex: 20,
              background: '#162844', border: '1px solid #1E3252', borderRadius: 10,
              padding: '10px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', color: '#E8EEF5', fontSize: 12,
            }}
          >
            {tooltip.virt ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6, color: tooltip.virt.color }}>
                  {tooltip.virt.kind === 'start' ? '▶ ' : '■ '}{tooltip.virt.label}
                </div>
                <div style={{ color: '#8FA3BD' }}>
                  {tooltip.virt.kind === 'start' ? 'Начальное событие сети' : 'Завершающее событие сети'}
                </div>
                <div style={{ color: '#8FA3BD', marginTop: 6 }}>
                  {tooltip.virt.kind === 'start'
                    ? 'Логические связи нулевой длительности ко всем начальным операциям.'
                    : 'Логические связи нулевой длительности от всех завершающих операций.'}
                </div>
              </>
            ) : tooltip.cut ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6, color: tooltip.cut.color }}>
                  {tooltip.cut.kind === 'start' ? '⇤ ' : '⇥ '}Обрезка периода
                </div>
                <div style={{ color: '#8FA3BD' }}>
                  {tooltip.cut.kind === 'start'
                    ? 'Продолжение вне периода — цепочка начинается раньше выбранной даты «с».'
                    : 'Продолжение вне периода — цепочка длится позже выбранной даты «по».'}
                </div>
                <div style={{ color: '#8FA3BD', marginTop: 6 }}>
                  Стрелка показывает сторону продолжения. Значки «Старт»/«Финиш» к обрезанным краям не ставятся.
                </div>
              </>
            ) : tooltip.op ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  №{String(tooltip.op.num)} · {tooltip.op.code}
                </div>
                {tooltip.op.detail ? <div style={{ color: '#8FA3BD', marginBottom: 6 }}>{tooltip.op.detail}</div> : null}
                <Row k="Длительность" v={fmtDur(tooltip.op.durDays, unit, tooltip.op.hpd)} />
                {startDate ? (
                  <>
                    <Row k="Ранний старт" v={fmtDayMonth(addDays(startDate, tooltip.op.es))} />
                    <Row k="Ранний финиш" v={fmtDayMonth(addDays(startDate, tooltip.op.ef))} />
                  </>
                ) : null}
                <Row k="ES / EF, дни" v={round1(tooltip.op.es) + ' / ' + round1(tooltip.op.ef)} />
                <Row k="LS / LF, дни" v={round1(tooltip.op.ls) + ' / ' + round1(tooltip.op.lf)} />
                <Row k="Полный резерв" v={fmtReserve(tooltip.op.tf, unit, tooltip.op.hpd)} />
                <Row
                  k="Напряжённость"
                  v={
                    intensityK(tooltip.op.durDays, tooltip.op.tf).toFixed(2) +
                    (intensityK(tooltip.op.durDays, tooltip.op.tf) > STRETCH_K ? ' · натянута' : '')
                  }
                />
                <div style={{ marginTop: 6, color: tooltip.op.crit ? '#EF4444' : (tooltip.op.branch ? '#F59E0B' : '#10B981') }}>
                  {tooltip.op.crit ? '⚠ Критический путь' : (tooltip.op.branch ? '◆ Ветвь критического пути' : 'С резервом')}
                </div>
              </>
            ) : tooltip.edge ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {'Связь: ' + tooltip.edge.from + ' → ' + tooltip.edge.to}
                </div>
                <div style={{ color: '#8FA3BD' }}>{DEP_TYPE_HINT[tooltip.edge.type || 'FS']}</div>
                <div style={{ marginTop: 6, color: tooltip.edge.crit ? '#FCA5A5' : (tooltip.edge.wait > 0.02 ? '#FCD34D' : '#93C5FD') }}>
                  {tooltip.edge.crit
                    ? '⚠ Критическая связь'
                    : (tooltip.edge.wait > 0.02
                        ? 'Ожидание ' + fmtDur(tooltip.edge.wait, unit, 8) + ' — следующая работа ждёт'
                        : 'Без ожидания — следующая работа начинается сразу')}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── условные обозначения: внизу рабочей области, свёрнуты по умолчанию ── */}
      <div data-cpm-legend="panel" style={{ borderTop: '1px solid ' + pal.frame, paddingTop: 6 }}>
        <button
          type="button"
          data-cpm-legend="toggle"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen((v) => !v)}
          className="cpmui-btn"
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            color: legendOpen ? '#93C5FD' : '#8FA3BD',
            fontSize: Math.round(11.5 * fontScale), fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: legendOpen ? '#60A5FA' : '#5A7090' }}>{legendOpen ? '▾' : '▸'}</span>
          Условные обозначения
        </button>

        {legendOpen && (
          <div
            data-cpm-legend="body"
            style={{
              marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
              gap: '12px 26px', fontSize: 12, lineHeight: 1.45, color: '#B0C4DE',
              maxHeight: 220, overflowY: 'auto', paddingRight: 4,
            }}
          >
            <LegendItem
              sample={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <LegendLine variant="wait" />
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: 700, color: '#B0C4DE', background: 'rgba(10,22,40,0.85)', border: '1px solid #2A4060', borderRadius: 4, padding: '1px 4px' }}>3 д</span>
                </span>
              }
              caption="Связь с ожиданием — сплошная линия с числом"
              desc="Число на линии — сколько дней следующая работа ждёт после окончания предыдущей. Если числа нет, ожидания нет."
            />
            <LegendItem
              sample={<LegendLine variant="logical" />}
              caption="Связь без ожидания — широкая штрих-пунктирная"
              desc="Следующая работа начинается сразу после предыдущей — паузы между ними нет. Это и есть логическая связь."
            />
            <LegendItem
              sample={<LegendLine variant="endpoints" />}
              caption="Связи «Старта» и «Финиша» — тонкий пунктир"
              desc="Идут от значка «Старт» к первым работам и от последних работ к значку «Финиш». Времени не занимают — просто показывают начало и конец схемы."
            />
            <LegendItem
              sample={<LegendLine variant="critical" />}
              caption="Критический путь — толстая красная линия"
              desc="Цепочка работ, от которой зависит срок сдачи. Если любая красная работа задержится — сдвинется весь проект. Поэтому она красная и толстая."
            />
            <LegendItem
              sample={<span style={{ display: 'inline-flex', gap: 6 }}><LegendPill color={startColor} label="Старт" kind="start" /><LegendPill color={finishColor} label="Финиш" kind="finish" /></span>}
              caption="Значки «Старт» и «Финиш»"
              desc="«Старт» — начало схемы (от него идут первые работы), «Финиш» — конец (к нему сходятся последние работы)."
            />
            <LegendItem
              sample={<LegendLine variant="endpoints" />}
              caption="Тумблер «Старт и Финиш» скрывает события, а не связи"
              desc="Выключенный тумблер убирает только служебные события «Старт»/«Финиш», их тонкий пунктир и маркеры обрезки. Обычные связи, связи без ожидания и критический путь остаются на схеме всегда."
            />
            <LegendItem
              sample={
                <svg width="58" height="14" aria-hidden="true">
                  <line x1="4" y1="7" x2="38" y2="7" stroke={CUT_COLOR} strokeWidth="2" strokeDasharray="5 4" />
                  <circle cx="4" cy="7" r="2.2" fill={CUT_COLOR} />
                  <path d="M38 3 L46 7 L38 11 Z" fill={CUT_COLOR} />
                </svg>
              }
              caption="Маркеры обрезки периода"
              desc="Крайняя видимая операция, у которой цепочка продолжается вне периода, получает вместо значка «Старт»/«Финиш» короткий обрубок со стрелкой в сторону продолжения."
            />
            <LegendItem
              sample={<LegendNode />}
              caption="Что написано на работе"
              desc="В кружке — номер работы, далее код и название. Внизу слева — сколько работа длится, справа жёлтое «+N д» — резерв (запас дней) или красное «крит» — запаса нет."
            />
            <LegendItem
              sample={<b style={{ fontFamily: FONT_MONO, color: '#93C5FD', fontSize: 11 }}>СС</b>}
              caption="Буква у связи — особый тип связи"
              desc="ФС — обычная связь (не подписывается); СС, ФФ, СФ — особые типы. Наведите курсор на связь или на работу — появится подробная подсказка."
            />

            {/* работы — категории узлов (как на полотне) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center', gridColumn: '1 / -1', color: '#8FA3BD', fontSize: Math.round(11 * fontScale) }}>
              <span style={{ color: '#5A7090' }}>Цвет работы:</span>
              <LegendDot color={critColor} label="критическая" />
              <LegendDot color={branchColor} label="ветвь крит. пути" />
              <LegendDot color={reserveColor} label="с резервом" />
              <LegendDot color={stretchColor} label={'напряжённая (K>' + String(STRETCH_K).replace('.', ',') + ')'} />
            </div>

            {/* управление — компактно, рядом с образцами */}
            <span style={{ color: '#5A7090', display: 'inline-flex', alignItems: 'center', gap: 6, gridColumn: '1 / -1' }}>
              <span aria-hidden="true">🖱</span>
              Колесо — масштаб · Наведение — подсказка · Перетаскивание — сдвиг узла
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── мелкие элементы ─────────────────────────── */

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'crit' | 'ok' | 'warn' }) {
  const palette =
    tone === 'crit' ? { color: '#FCA5A5', bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.28)' }
    : tone === 'ok' ? { color: '#6EE7B7', bg: 'rgba(16,185,129,0.14)', bd: 'rgba(16,185,129,0.30)' }
    : tone === 'warn' ? { color: '#FCD34D', bg: 'rgba(245,158,11,0.13)', bd: 'rgba(245,158,11,0.30)' }
    : { color: '#93C5FD', bg: 'rgba(59,130,246,0.12)', bd: 'rgba(59,130,246,0.22)' };
  return (
    <span
      style={{
        fontFamily: FONT_MONO, fontSize: 10.5, padding: '2px 8px', borderRadius: 100,
        color: palette.color, background: palette.bg, border: '1px solid ' + palette.bd,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 50, border: '2px solid ' + color, background: 'rgba(255,255,255,0.04)', display: 'inline-block' }} />
      {label}
    </span>
  );
}

/** Образец линии связи: рисуется тем же стилем, что и соответствующая связь на полотне. */
function LegendLine({ variant }: { variant: 'wait' | 'logical' | 'critical' | 'endpoints' }) {
  if (variant === 'endpoints') {
    // связи начального («Старт») и завершающего («Финиш») события — тонкий пунктир.
    return (
      <svg width="58" height="16" viewBox="0 0 58 16" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
        <line x1="1" y1="5" x2="57" y2="5" stroke={START_EDGE} strokeWidth={EDGE_STYLE.endpoint.width} strokeDasharray={dashAttr(ENDPOINT_DASH_BASE)} />
        <line x1="1" y1="11" x2="57" y2="11" stroke={FINISH_EDGE} strokeWidth={EDGE_STYLE.endpoint.width} strokeDasharray={dashAttr(ENDPOINT_DASH_BASE)} />
      </svg>
    );
  }
  // Образцы рисуются ровно теми же цветом, толщиной и узором, что и связи на холсте.
  const style =
    variant === 'wait' ? { color: EDGE_STYLE.wait.color, w: EDGE_STYLE.wait.width, dash: undefined as string | undefined, arrow: EDGE_STYLE.wait.arrow }
    : variant === 'logical' ? { color: EDGE_STYLE.logical.color, w: EDGE_STYLE.logical.width, dash: dashAttr(LOGICAL_DASH_BASE), arrow: EDGE_STYLE.logical.arrow }
    : { color: EDGE_STYLE.critical.color, w: EDGE_STYLE.critical.width, dash: undefined as string | undefined, arrow: EDGE_STYLE.critical.arrow };
  return (
    <svg width="64" height="14" viewBox="0 0 64 14" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <line x1="1" y1="7" x2="54" y2="7" stroke={style.color} strokeWidth={style.w} strokeDasharray={style.dash} />
      <polygon points="54,2 63,7 54,12" fill={style.arrow} />
    </svg>
  );
}

/** Мини-образец карточки работы: номер, код, продолжительность и резерв. */
function LegendNode() {
  return (
    <svg width="104" height="40" viewBox="0 0 104 40" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <rect x="1" y="1" width="102" height="38" rx="7" fill="rgba(15,30,54,0.96)" stroke="rgba(96,165,250,0.7)" strokeWidth="1.2" />
      <circle cx="13" cy="12" r="6" fill="rgba(96,165,250,0.18)" stroke="#3B82F6" strokeWidth="1" />
      <text x="13" y="15" textAnchor="middle" fill="#E8EEF5" fontSize="7" fontFamily="monospace">7</text>
      <text x="23" y="11" fill="#E8EEF5" fontSize="7.5" fontWeight="700" fontFamily="sans-serif">СВАРКА СТЫКОВ</text>
      <text x="23" y="20" fill="rgba(176,196,222,0.8)" fontSize="6.5" fontFamily="sans-serif">секция 3</text>
      <text x="7" y="34" fill="rgba(176,196,222,0.9)" fontSize="8" fontFamily="monospace">4 д</text>
      <text x="97" y="34" textAnchor="end" fill="#F59E0B" fontSize="8" fontFamily="monospace">+2 д</text>
    </svg>
  );
}

/** Подпись к образцу: слева — образец, справа — короткое название и пояснение. */
function LegendItem({ sample, caption, desc }: { sample: React.ReactNode; caption: string; desc?: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 18, paddingTop: 1 }}>{sample}</span>
      <div>
        <b style={{ color: '#E8EEF5' }}>{caption}</b>
        {desc ? <div style={{ color: '#8FA3BD', marginTop: 1 }}>{desc}</div> : null}
      </div>
    </div>
  );
}

/** Метка виртуального события «Старт»/«Финиш» — та же форма и цвет, что и на полотне. */
function LegendPill({ color, label, kind }: { color: string; label: string; kind: 'start' | 'finish' }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 18, padding: '0 8px',
        borderRadius: 9, border: '2.4px solid ' + color, background: 'rgba(12,26,44,0.98)',
        boxShadow: '0 0 6px ' + color + '66',
      }}
    >
      <span style={{ fontSize: 9.5, lineHeight: 1, color }} aria-hidden="true">{kind === 'start' ? '▶' : '■'}</span>
      <span style={{ fontSize: 9.5, lineHeight: 1, fontWeight: 700, color: '#E8EEF5', fontFamily: FONT_UI }}>{label}</span>
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '1px 0', color: '#8FA3BD' }}>
      <span>{k}</span>
      <b style={{ fontFamily: FONT_MONO, color: '#E8EEF5' }}>{v}</b>
    </div>
  );
}

/** Тот же граф в модальном окне. */
export function CpmGraphModal({ open, onClose, ...rest }: CpmGraphProps & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,22,0.72)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(1400px, 97vw)', background: '#0F1B2D', border: '1px solid #26364F', borderRadius: 12, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: 14 }}>{rest.title || 'Граф CPM'}</b>
          <button className="cpmui-btn" onClick={onClose} style={{ marginLeft: 'auto' }}>Закрыть</button>
        </div>
        <CpmGraph {...rest} compact height="calc(88vh - 150px)" />
      </div>
    </div>
  );
}
