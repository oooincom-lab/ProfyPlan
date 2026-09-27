/**
 * Сохранённые виды — клиент реестра сохранений (блок 6.13а).
 *
 * Модуль чистый (без React): типы конверта настроек, тонкий клиент к серверному
 * API `/v1/saved-views`, разбор структурированных ошибок (лимит, конфликт имён,
 * требование подтверждения), мост «снять/применить состояние сетевого графика»
 * к компоненту CpmGraph и резервный локальный реестр на случай недоступности
 * сервера (вид тогда помечается «только локально»).
 *
 * Сервер — источник истины; в браузере остаётся только кэш последнего
 * применённого вида (ключ LAST_APPLIED_KEY) и аварийный локальный список.
 */
import { API_ORIGIN } from './api';

/* ─────────────────────────── конверт настроек ─────────────────────────── */

/** Разделы конверта по видам рабочего поля (совпадает с сервером). */
export const ENVELOPE_SECTIONS = ['cpm', 'gantt', 'pools', 'general'] as const;
export type EnvelopeSection = (typeof ENVELOPE_SECTIONS)[number];
export const DEFAULT_SCHEMA_VERSION = 1;

export type NodePositions = Record<string, Record<string, { x: number; y: number }>>;

export interface ViewEnvelope {
  schema_version: number;
  sections: Record<string, any>;
  node_positions: NodePositions;
  layout: Record<string, any>;
}

/* ─────────────────── состояние сетевого графика для вида ─────────────────── */

/**
 * Снимок настроек сетевого графика, попадающий в раздел `cpm` конверта:
 * раскладка, режим укладки, единица, границы периода, масштаб, показ только
 * критического пути и прочие переключатели. Ручные позиции узлов — отдельно,
 * в `node_positions` (по раскладкам «по датам» / «по слоям»).
 */
export interface CpmGraphViewState {
  layoutPreset?: string;
  mode?: string;
  unit?: string;
  critOnly?: boolean;
  showEdgeDays?: boolean;
  showEndpoints?: boolean;
  periodFrom?: string;
  periodTo?: string;
  alignCutEnds?: boolean;
  zoomPct?: number;
  nodePositions?: { byDate?: Record<string, [number, number]>; byLayer?: Record<string, [number, number]> };
}

/** Имя события «снять текущее состояние»: граф отвечает событием CPM_STATE_EVENT. */
export const CPM_CAPTURE_EVENT = 'profyplan:cpm:capture';
/** Событие-ответ графа с текущим состоянием (detail = CpmGraphViewState). */
export const CPM_STATE_EVENT = 'profyplan:cpm:state';
/** Событие «применить состояние к графу» (detail = CpmGraphViewState). */
export const CPM_APPLY_EVENT = 'profyplan:cpm:apply';

/** Снять текущее состояние сетевого графика (если граф не смонтирован — null). */
export function captureGraphState(timeoutMs = 500): Promise<CpmGraphViewState | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: CpmGraphViewState | null) => {
      if (done) return;
      done = true;
      window.removeEventListener(CPM_STATE_EVENT, onState as EventListener);
      resolve(v);
    };
    const onState = (e: Event) => finish(((e as CustomEvent).detail as CpmGraphViewState) || null);
    window.addEventListener(CPM_STATE_EVENT, onState as EventListener);
    window.dispatchEvent(new CustomEvent(CPM_CAPTURE_EVENT));
    window.setTimeout(() => finish(null), timeoutMs);
  });
}

/** Применить состояние к сетевому графику (граф вернёт рабочее поле в снимок). */
export function applyGraphState(state: CpmGraphViewState): void {
  if (typeof window === 'undefined' || !state) return;
  window.dispatchEvent(new CustomEvent(CPM_APPLY_EVENT, { detail: state }));
}

/** Собрать конверт вида из снимка сетевого графика. */
export function buildEnvelopeFromGraph(state: CpmGraphViewState | null): ViewEnvelope {
  const cpm: Record<string, any> = {};
  if (state) {
    const keys: (keyof CpmGraphViewState)[] = [
      'layoutPreset', 'mode', 'unit', 'critOnly', 'showEdgeDays',
      'showEndpoints', 'periodFrom', 'periodTo', 'alignCutEnds', 'zoomPct',
    ];
    for (const k of keys) {
      const v = (state as any)[k];
      if (v !== undefined && v !== null && v !== '') cpm[k] = v;
    }
  }
  const node_positions: NodePositions = {};
  if (state && state.nodePositions) {
    for (const layout of Object.keys(state.nodePositions)) {
      const entries = (state.nodePositions as any)[layout] || {};
      const out: Record<string, { x: number; y: number }> = {};
      for (const id of Object.keys(entries)) {
        const p = entries[id];
        if (Array.isArray(p) && p.length >= 2) {
          const x = Number(p[0]);
          const y = Number(p[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) out[id] = { x, y };
        }
      }
      if (Object.keys(out).length) node_positions[layout] = out;
    }
  }
  return {
    schema_version: DEFAULT_SCHEMA_VERSION,
    sections: { cpm, gantt: {}, pools: {}, general: {} },
    node_positions,
    layout: {},
  };
}

/** Достать состояние сетевого графика из конверта вида (для применения). */
export function graphStateFromEnvelope(content: any): CpmGraphViewState | null {
  if (!content || typeof content !== 'object') return null;
  const cpm = (content.sections && content.sections.cpm) || {};
  const rawPositions = content.node_positions || {};
  const nodePositions: CpmGraphViewState['nodePositions'] = {};
  for (const layout of Object.keys(rawPositions)) {
    const entries = rawPositions[layout] || {};
    const out: Record<string, [number, number]> = {};
    for (const id of Object.keys(entries)) {
      const p = entries[id];
      if (p && typeof p === 'object') {
        const x = Number(p.x);
        const y = Number(p.y);
        if (Number.isFinite(x) && Number.isFinite(y)) out[id] = [x, y];
      }
    }
    if (Object.keys(out).length) (nodePositions as any)[layout] = out;
  }
  return {
    layoutPreset: cpm.layoutPreset,
    mode: cpm.mode,
    unit: cpm.unit,
    critOnly: cpm.critOnly,
    showEdgeDays: cpm.showEdgeDays,
    showEndpoints: cpm.showEndpoints,
    periodFrom: cpm.periodFrom,
    periodTo: cpm.periodTo,
    alignCutEnds: cpm.alignCutEnds,
    zoomPct: cpm.zoomPct,
    nodePositions,
  };
}

/* ─────────────────────────── модели реестра ─────────────────────────── */

export interface SavedViewLimit {
  key: string;
  value: number;
  source: string;
  source_label: string;
  used: number;
  remaining: number;
}

export interface SavedViewRow {
  id: string;
  name: string;
  owner_name?: string | null;
  is_own: boolean;
  kind: 'private' | 'shared';
  share_mode?: 'read' | 'write' | null;
  status: string;
  schema_version: number;
  imported: boolean;
  sections: string[];
  node_positions: number;
  can_write: boolean;
  can_manage: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  /** Где лежит вид: на сервере или только в локальном резерве. */
  storage: 'server' | 'local';
  /** Конверт — заполнен только у локальных видов (у серверных грузится по требованию). */
  content?: ViewEnvelope | null;
}

export interface SavedViewsList {
  items: SavedViewRow[];
  limit: SavedViewLimit;
  sections: string[];
  my_shared_view_id: string | null;
}

export interface SavedViewLogItem {
  id: string;
  action: string;
  at: string | null;
  user_id: string | null;
  user_name?: string | null;
  payload: Record<string, any>;
  note?: string | null;
}

/** Структурированная ошибка API с кодом (лимит, конфликт имён, подтверждение…). */
export class SavedViewsError extends Error {
  status: number;
  code?: string;
  detail: any;
  constructor(status: number, message: string, detail?: any) {
    super(message);
    this.name = 'SavedViewsError';
    this.status = status;
    this.detail = detail;
    this.code = detail && typeof detail === 'object' ? detail.code : undefined;
  }
}

/* ─────────────────────────── клиент API ─────────────────────────── */

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('profyplan_token');
}

async function svRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(API_ORIGIN + path, { ...options, headers });
  } catch (e: any) {
    throw new SavedViewsError(0, 'Сервер недоступен: ' + (e?.message || String(e)), { code: 'network_error' });
  }

  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? (body as any).detail : body;
    const message = typeof detail === 'string'
      ? detail
      : (detail && typeof detail === 'object' && detail.message) || `Ошибка ${res.status}`;
    throw new SavedViewsError(res.status, message, detail);
  }
  return body as T;
}

/** Список видов проекта + текущий лимит. */
export async function listSavedViews(projectId: string): Promise<SavedViewsList> {
  const data = await svRequest<{
    items: any[];
    limit: SavedViewLimit;
    schema_version: number;
    sections: string[];
    my_shared_view_id: string | null;
  }>(`/v1/saved-views?project_id=${encodeURIComponent(projectId)}`);
  return {
    items: (data.items || []).map((v) => ({
      ...v,
      storage: 'server' as const,
      sections: Array.isArray(v.sections) ? v.sections : [],
    })),
    limit: data.limit,
    sections: data.sections || [...ENVELOPE_SECTIONS],
    my_shared_view_id: data.my_shared_view_id || null,
  };
}

/** Создать новый личный вид. */
export async function createSavedView(projectId: string, name: string, content: ViewEnvelope) {
  return svRequest<{ item: any; limit: SavedViewLimit }>('/v1/saved-views', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, name, content, schema_version: content.schema_version }),
  });
}

/** Сохранить состояние в существующий вид. */
export async function saveIntoView(viewId: string, content: ViewEnvelope) {
  return svRequest<{ item: any; content: ViewEnvelope }>(`/v1/saved-views/${viewId}`, {
    method: 'PUT',
    body: JSON.stringify({ content, schema_version: content.schema_version }),
  });
}

/** Получить вид целиком (конверт) — действие «применить». */
export async function getSavedView(viewId: string) {
  return svRequest<{ item: any; content: ViewEnvelope }>(`/v1/saved-views/${viewId}`);
}

export async function renameSavedView(viewId: string, name: string) {
  return svRequest<{ item: any }>(`/v1/saved-views/${viewId}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteSavedView(viewId: string) {
  return svRequest<{ ok: boolean; deleted: string; name: string }>(
    `/v1/saved-views/${viewId}?confirm=true`,
    { method: 'DELETE' },
  );
}

export async function shareSavedView(viewId: string, mode: 'read' | 'write') {
  return svRequest<{ item: any }>(`/v1/saved-views/${viewId}/share`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export async function unshareSavedView(viewId: string) {
  return svRequest<{ item: any }>(`/v1/saved-views/${viewId}/unshare`, { method: 'POST' });
}

export async function copySavedView(viewId: string) {
  return svRequest<{ item: any; source_id: string }>(`/v1/saved-views/${viewId}/copy`, { method: 'POST' });
}

/** Выгрузить в файл один вид или все доступные. */
export async function exportSavedViews(projectId: string, ids?: string[]) {
  const qs = ids && ids.length ? `&ids=${encodeURIComponent(ids.join(','))}` : '';
  return svRequest<any>(`/v1/saved-views/export?project_id=${encodeURIComponent(projectId)}${qs}`);
}

/** Загрузить виды из файла (при конфликте имён — отказ с подсказками переименования). */
export async function importSavedViews(projectId: string, payload: any, renames?: Record<string, string>) {
  return svRequest<{
    created: { id: string; name: string }[];
    renamed: { from: string; to: string }[];
    limit: SavedViewLimit;
  }>('/v1/saved-views/import', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, payload, renames: renames || {} }),
  });
}

/** Журнал изменений вида (кто и когда). */
export async function getSavedViewLog(viewId: string, limit = 50) {
  return svRequest<{ view_id: string; items: SavedViewLogItem[] }>(
    `/v1/saved-views/${viewId}/log?limit=${limit}`,
  );
}

/* ───────────── резервный локальный реестр (сервер недоступен) ───────────── */

const LOCAL_KEY = (pid: string) => `profyplan.savedviews.local.${pid}`;
const LAST_APPLIED_KEY = (pid: string) => `profyplan.savedviews.last.${pid}`;

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function loadLocalViews(projectId: string): SavedViewRow[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY(projectId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveLocalViews(projectId: string, rows: SavedViewRow[]): void {
  try { window.localStorage.setItem(LOCAL_KEY(projectId), JSON.stringify(rows)); } catch { /* ignore */ }
}

export function localCreateView(projectId: string, name: string, content: ViewEnvelope): SavedViewRow {
  const rows = loadLocalViews(projectId);
  const row: SavedViewRow = {
    id: uuid(),
    name,
    owner_name: 'вы',
    is_own: true,
    kind: 'private',
    share_mode: null,
    status: 'личный',
    schema_version: content.schema_version,
    imported: false,
    sections: Object.keys(content.sections || {}).filter((k) => Object.keys(content.sections[k] || {}).length > 0),
    node_positions: Object.values(content.node_positions || {}).reduce((n, m) => n + Object.keys(m).length, 0),
    can_write: true,
    can_manage: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    storage: 'local',
    content,
  };
  saveLocalViews(projectId, [row, ...rows]);
  return row;
}

export function localRenameView(projectId: string, id: string, name: string): void {
  const rows = loadLocalViews(projectId).map((r) => (r.id === id ? { ...r, name, updated_at: new Date().toISOString() } : r));
  saveLocalViews(projectId, rows);
}

export function localDeleteView(projectId: string, id: string): void {
  saveLocalViews(projectId, loadLocalViews(projectId).filter((r) => r.id !== id));
}

/* ─────────────── кэш последнего применённого вида ─────────────── */

export interface LastApplied { id: string; name: string; at: string }

export function loadLastApplied(projectId: string): LastApplied | null {
  try {
    const raw = window.localStorage.getItem(LAST_APPLIED_KEY(projectId));
    return raw ? (JSON.parse(raw) as LastApplied) : null;
  } catch {
    return null;
  }
}

export function saveLastApplied(projectId: string, id: string, name: string): void {
  try {
    window.localStorage.setItem(LAST_APPLIED_KEY(projectId), JSON.stringify({ id, name, at: new Date().toISOString() }));
  } catch { /* ignore */ }
}
