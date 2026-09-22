/**
 * Проверки структуры сети CPM перед отрисовкой (по методичке):
 *   • цикл в зависимостях;
 *   • узел без предшественников (кроме исходного);
 *   • узел без последующих (кроме завершающего);
 *   • полный дубль связи — одна и та же пара операций.
 *
 * Модуль чистый (без React) — используется панелью графика и автотестом.
 * Отрисовку не блокирует: возвращает список предупреждений для показа.
 *
 * Особенность реальных данных: сеть может иметь НЕСКОЛЬКО исходных и завершающих
 * операций (несколько параллельных цепочек заказов), поэтому «исходный» — это
 * любая операция без предшественников, «завершающий» — любая без последующих.
 * Предупреждение выдаётся только по-настоящему «висящей» операции — той, у
 * которой нет ни предшественников, ни последующих (полностью изолированной).
 */

export interface StructureNode {
  id: string;
  num?: number | string;
  name?: string;
  code?: string;
}

/** Описание начального/завершающего события сети (виртуальные «Старт» и «Финиш»). */
export interface EndpointInfo {
  /** Операции без предшественников (несколько независимых цепочек — их может быть много). */
  initialIds: string[];
  /** Операции без последующих. */
  finalIds: string[];
  /** В данных уже есть явная операция начала (например, «Начало») — дублировать не нужно. */
  hasExplicitStart: boolean;
  /** В данных уже есть явная операция завершения (например, «Сдача») — дублировать не нужно. */
  hasExplicitFinish: boolean;
}

/**
 * Имена, по которым операция распознаётся как ЯВНОЕ (выделенное) начало / завершение.
 * Проверяется начало имени (а не вхождение подстроки), чтобы обычные работы
 * вроде «Нанесение разметки и сдача» не считались выделенным завершающим событием
 * и не подавляли виртуальный «Финиш». Распознаются только узлы-маркеры:
 * «Начало», «Старт», «Сдача», «Финиш», «Завершение», «Окончание» и т.п.
 */
const START_NAME_RE = /^\s*(начал|старт|start)/i;
const FINISH_NAME_RE = /^\s*(финиш|окончан|завершен|сдач|finish|end)/i;

/**
 * Определяет начальные (без предшественников) и завершающие (без последующих)
 * операции сети, а также признак того, что в данных уже есть явные операции
 * начала/завершения — тогда виртуальное событие рисовать не нужно (не дублируем).
 * Изолированная операция (без связей вовсе) попадает и в начальные, и в завершающие.
 */
export function detectEndpoints(nodes: StructureNode[], deps: [string, string][]): EndpointInfo {
  const byId = new Map<string, StructureNode>();
  nodes.forEach((n) => byId.set(n.id, n));
  const ids = new Set(byId.keys());

  const hasPred = new Set<string>();
  const hasSucc = new Set<string>();
  const seen = new Set<string>();
  for (const [a, b] of deps) {
    if (!ids.has(a) || !ids.has(b) || a === b) continue;
    const key = a + '\u0001' + b;
    if (seen.has(key)) continue;
    seen.add(key);
    hasSucc.add(a);
    hasPred.add(b);
  }

  const initialIds = nodes.filter((n) => !hasPred.has(n.id)).map((n) => n.id);
  const finalIds = nodes.filter((n) => !hasSucc.has(n.id)).map((n) => n.id);

  const looks = (id: string, re: RegExp): boolean => {
    const n = byId.get(id);
    if (!n) return false;
    return re.test(String(n.name || '')) || re.test(String(n.code || ''));
  };

  return {
    initialIds,
    finalIds,
    hasExplicitStart: initialIds.some((id) => looks(id, START_NAME_RE)),
    hasExplicitFinish: finalIds.some((id) => looks(id, FINISH_NAME_RE)),
  };
}

export type StructureIssueKind = 'cycle' | 'noPred' | 'noSucc' | 'dupEdge';

export interface StructureIssue {
  kind: StructureIssueKind;
  /** Короткий заголовок для плашки панели. */
  title: string;
  /** Человекочитаемое пояснение (номера/имена операций). */
  detail: string;
  /** Id операций, к которым относится предупреждение. */
  ids: string[];
}

function label(n: StructureNode | undefined, id: string): string {
  if (!n) return '№' + id;
  const num = n.num != null && n.num !== '' ? String(n.num) : id;
  return '№' + num;
}

/**
 * Проверяет структуру сети. Возвращает список предупреждений; на корректных
 * данных список пуст. Порядок предупреждений — по важности (сначала цикл).
 */
export function checkCpmStructure(
  nodes: StructureNode[],
  deps: [string, string][],
): StructureIssue[] {
  const byId = new Map<string, StructureNode>();
  nodes.forEach((n) => byId.set(n.id, n));
  const ids = new Set(byId.keys());

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  ids.forEach((id) => { preds.set(id, []); succs.set(id, []); });

  // ── полный дубль связи: одна и та же пара операций встречается дважды ──
  const seen = new Set<string>();
  let dupCount = 0;
  const dupIds = new Set<string>();
  const edges: [string, string][] = [];
  for (const [a, b] of deps) {
    if (!ids.has(a) || !ids.has(b) || a === b) continue;
    const key = a + '\u0001' + b;
    if (seen.has(key)) {
      dupCount++;
      dupIds.add(a);
      dupIds.add(b);
      continue;
    }
    seen.add(key);
    edges.push([a, b]);
    preds.get(b)!.push(a);
    succs.get(a)!.push(b);
  }

  const issues: StructureIssue[] = [];

  // ── цикл в зависимостях (алгоритм Кана: необработанные узлы образуют цикл) ──
  {
    const indeg = new Map<string, number>();
    ids.forEach((id) => indeg.set(id, preds.get(id)!.length));
    const queue: string[] = [];
    indeg.forEach((d, id) => { if (d === 0) queue.push(id); });
    let seenCount = 0;
    const q = queue.slice();
    while (q.length) {
      const id = q.shift()!;
      seenCount++;
      for (const s of succs.get(id)!) {
        const nd = (indeg.get(s) || 0) - 1;
        indeg.set(s, nd);
        if (nd === 0) q.push(s);
      }
    }
    if (seenCount < ids.size) {
      const cyclic = Array.from(ids).filter((id) => (indeg.get(id) || 0) > 0);
      issues.push({
        kind: 'cycle',
        title: 'Цикл в зависимостях',
        detail: 'Операции образуют замкнутый контур, расчёт расписания некорректен: ' +
          cyclic.map((id) => label(byId.get(id), id)).join(', ') + '.',
        ids: cyclic,
      });
    }
  }

  // ── висящие операции ──
  // «Исходных» и «завершающих» может быть несколько (параллельные цепочки),
  // поэтому сами по себе они не предупреждение. Предупреждаем только о
  // по-настоящему «висящей» операции — у неё нет ни предшественников,
  // ни последующих (она одинока в сети). Сначала сработает один набор связей,
  // затем второй — но на одних и тех же одиноких операциях.
  const isolated = nodes.length > 1
    ? Array.from(ids).filter((id) => preds.get(id)!.length === 0 && succs.get(id)!.length === 0)
    : [];
  if (isolated.length) {
    const names = isolated.map((id) => label(byId.get(id), id)).join(', ');
    issues.push({
      kind: 'noPred',
      title: 'Операции без предшественников',
      detail: 'Связи не заданы ни с одной другой операцией: ' + names + '.',
      ids: isolated,
    });
    issues.push({
      kind: 'noSucc',
      title: 'Операции без последующих',
      detail: 'Связи не заданы ни с одной другой операцией: ' + names + '.',
      ids: isolated,
    });
  }

  // ── полный дубль связи ──
  if (dupCount > 0) {
    issues.push({
      kind: 'dupEdge',
      title: 'Дублирующиеся связи',
      detail: 'Одна и та же пара операций соединена более одного раза (' + dupCount +
        ' лишних связей): ' + Array.from(dupIds).map((id) => label(byId.get(id), id)).join(', ') + '.',
      ids: Array.from(dupIds),
    });
  }

  return issues;
}

/**
 * Коэффициент напряжённости работы: K = длительность / (длительность + полный резерв).
 * K = 1 — работа критическая (резерва нет). Чем ближе к 1, тем «натянутее» работа.
 * Возвращает 1, если резерв нулевой или данные некорректны.
 */
export function intensityK(durationDays: number, totalFloatDays: number): number {
  const d = Math.max(0, durationDays);
  const f = Math.max(0, totalFloatDays);
  if (d + f <= 0) return 1;
  return d / (d + f);
}
