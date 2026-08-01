/**
 * ProfyPlan API client.
 * Базовый URL: http://localhost:8000 (dev) или относительный (prod через nginx).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('profyplan_token')
    : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// --- Auth ---
export async function login(email: string, password: string) {
  return request<{ access_token: string }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// --- Projects ---
export async function getProjects() {
  return request<any[]>('/v1/projects');
}

export async function getProject(id: string) {
  return request<any>(`/v1/projects/${id}`);
}

// --- CPM ---
export async function runCPM(projectId: string) {
  return request<any>(`/v1/projects/${projectId}/calculate/cpm`, {
    method: 'POST',
  });
}

// --- CCM ---
export async function mergeProjects(projectIds: string[]) {
  return request<any>('/v1/ccm/merge', {
    method: 'POST',
    body: JSON.stringify(projectIds),
  });
}

export async function resourceLeveling(projectId: string) {
  return request<any>(`/v1/ccm/projects/${projectId}/resource-leveling`, {
    method: 'POST',
  });
}

export async function recalculateForecast(projectId: string) {
  return request<any>(`/v1/ccm/projects/${projectId}/recalculate-forecast`, {
    method: 'POST',
  });
}

export async function createBaseline(projectId: string, name: string) {
  return request<any>(`/v1/ccm/projects/${projectId}/baseline`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function getBaselines(projectId: string) {
  return request<any>(`/v1/ccm/projects/${projectId}/baselines`);
}

export async function importFacts(projectId: string, facts: any[]) {
  return request<any>(`/v1/ccm/projects/${projectId}/facts`, {
    method: 'POST',
    body: JSON.stringify({ facts }),
  });
}

// --- Resources ---
export async function getResources(projectId?: string) {
  const qs = projectId ? `?project_id=${projectId}` : '';
  return request<any[]>(`/v1/resources${qs}`);
}
