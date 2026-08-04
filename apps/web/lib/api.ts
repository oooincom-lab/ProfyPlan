/**
 * ProfyPlan API client — типизированные запросы к бэкенду.
 */
import type {
  Project, Operation, Resource,
  CPMResult, MergedCPMResult, ResourceLevelResult,
  ForecastResult, Baseline, ActualFact,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('profyplan_token');
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// --- Auth ---
export async function login(email: string, password: string) {
  const data = await request<{ access_token: string }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem('profyplan_token', data.access_token);
  }
  return data;
}

export function logout() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('profyplan_token');
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// --- Projects ---
export function getProjects() {
  return request<Project[]>('/v1/projects');
}

export function getProject(id: string) {
  return request<Project>(`/v1/projects/${id}`);
}

// --- Operations ---
export function getOperations(projectId: string) {
  return request<Operation[]>(`/v1/projects/${projectId}/operations`);
}

// --- Resources ---
export function getResources(projectId?: string) {
  const qs = projectId ? `?project_id=${projectId}` : '';
  return request<Resource[]>(`/v1/resources${qs}`);
}

// --- CPM ---
export function runCPM(projectId: string) {
  return request<CPMResult>(`/v1/projects/${projectId}/calculate/cpm`, {
    method: 'POST',
  });
}

// --- CCM ---
export function mergeProjects(projectIds: string[]) {
  return request<MergedCPMResult>('/v1/ccm/merge', {
    method: 'POST',
    body: JSON.stringify(projectIds),
  });
}

export function resourceLeveling(
  projectId: string,
  useCpmResult = true,
) {
  return request<ResourceLevelResult>(
    `/v1/ccm/projects/${projectId}/resource-leveling?use_cpm_result=${useCpmResult}`,
    { method: 'POST' }
  );
}

export function recalculateForecast(projectId: string) {
  return request<ForecastResult>(
    `/v1/ccm/projects/${projectId}/recalculate-forecast`,
    { method: 'POST' }
  );
}

export function createBaseline(projectId: string, name: string) {
  return request<Baseline>(
    `/v1/ccm/projects/${projectId}/baseline`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    }
  );
}

export function getBaselines(projectId: string) {
  return request<{ project_id: string; baselines: Baseline[]; total: number }>(
    `/v1/ccm/projects/${projectId}/baselines`
  );
}

export function importFacts(projectId: string, facts: ActualFact[]) {
  return request<{ imported: number; errors: string[] }>(
    `/v1/ccm/projects/${projectId}/facts`,
    {
      method: 'POST',
      body: JSON.stringify({ facts }),
    }
  );
}

// --- Actual Execution (факт) ---
export function getActual(operationId: string) {
  return request<ActualFact | null>(`/v1/operations/${operationId}/actual`);
}

export function saveActual(operationId: string, data: ActualFact) {
  return request<ActualFact>(`/v1/operations/${operationId}/actual`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function autoClosePredecessors(operationId: string) {
  return request<{ closed: number; closed_operation_ids: string[] }>(
    `/v1/operations/${operationId}/auto-close`,
    { method: 'POST' }
  );
}

export function uncloseChain(operationId: string) {
  return request<{ removed: number; removed_operation_ids: string[] }>(
    `/v1/operations/${operationId}/unclose`,
    { method: 'POST' }
  );
}
