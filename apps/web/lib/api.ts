/**
 * ProfyPlan API client — типизированные запросы к бэкенду.
 */
import type {
  Project, Operation, Resource,
  CPMResult, MergedCPMResult, ResourceLevelResult,
  ForecastResult, Baseline, ActualFact,
  OrderGroup, OrderPool,
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
export interface TenantInfo {
  id: string;
  name: string;
  role: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  tenants?: TenantInfo[];
}

export async function login(email: string, password: string) {
  const data = await request<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem('profyplan_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('profyplan_refresh', data.refresh_token);
    if (data.tenants) localStorage.setItem('profyplan_tenants', JSON.stringify(data.tenants));
  }
  return data;
}

export async function selectTenant(tenantId: string) {
  const data = await request<AuthResponse>('/v1/auth/select-tenant', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem('profyplan_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('profyplan_refresh', data.refresh_token);
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
  return request<{ items: Project[]; total: number }>('/v1/projects');
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
    `/v1/ccm/projects/${projectId}/baseline?name=${encodeURIComponent(name)}`,
    { method: 'POST' }
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
      body: JSON.stringify(facts),
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

// --- BOM ---

export function getBOMTree(projectId: string) {
  return request<{ project_id: string; nodes: BOMNode[]; total_nodes: number }>(
    `/v1/bom/projects/${projectId}/tree`
  );
}

export function uploadBOM(projectId: string, file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  return fetch(`${API_BASE}/v1/bom/projects/${projectId}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(r => r.json()) as Promise<{ imported: number; skipped: number; errors: string[]; root_ids: string[] }>;
}

export function createBOMNode(projectId: string, body: Record<string, any>) {
  return request<BOMNode>(`/v1/bom/projects/${projectId}/nodes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateBOMNode(nodeId: string, body: Record<string, any>) {
  return request<BOMNode>(`/v1/bom/nodes/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteBOMNode(projectId: string, nodeId: string) {
  return request<void>(`/v1/bom/projects/${projectId}/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

export interface OrderClusterInfo {
  id: string;
  ext_id: string | null;
  specification_name: string | null;
  status: string;
  group_id: string | null;
  pool_id: string | null;
  parent_order_id: string | null;
  has_cpm: boolean;
  in_pool: boolean;
  relation: 'self' | 'child' | 'parent';
}

export interface OrderClusterResult {
  order_id: string;
  orders: OrderClusterInfo[];
  total: number;
  parents: string[];
  children: string[];
}

export function getOrderCluster(projectId: string, orderId: string) {
  return request<OrderClusterResult>(`/v1/bom/projects/${projectId}/orders/${orderId}/cluster`);
}

export function explodeBOM(projectId: string, projectQuantity?: number) {
  return request<{
    operations: any[];
    dependencies: any[];
    materials: any[];
    warnings: string[];
  }>(`/v1/bom/projects/${projectId}/explode`, {
    method: 'POST',
    body: JSON.stringify({ project_quantity: projectQuantity || 1 }),
  });
}

export function explodeAndSaveBOM(projectId: string, projectQuantity?: number) {
  return request<{
    created_operations: number;
    created_dependencies: number;
    materials_count: number;
    warnings: string[];
  }>(`/v1/bom/projects/${projectId}/explode-and-save`, {
    method: 'POST',
    body: JSON.stringify({ project_quantity: projectQuantity || 1 }),
  });
}

export interface BOMNode {
  id: string;
  tenant_id: string;
  project_id: string | null;
  parent_id: string | null;
  level: number;
  path: string | null;
  node_type: string;
  nomenclature_id: string | null;
  nomenclature_name: string;
  quantity_per_parent: number;
  unit: string;
  is_make_or_buy: string;
  procurement_lead_time_days: number | null;
  is_phantom: boolean;
  sort_order: number;
  routing_id: string | null;
  order_id: string | null;
  ext_id: string | null;
  notes: string | null;
}

// --- Production Orders (Excel Import) ---

export interface ImportValidationError {
  row: number;
  sheet: string;
  field: string;
  message: string;
}

export interface ExcelImportResult {
  orders_created: number;
  bom_nodes_created: number;
  routings_created: number;
  routing_ops_created: number;
  nomenclature_created: number;
  nomenclature_linked: number;
  resources_created: number;
  errors: ImportValidationError[];
  warnings: string[];
}

export function importProductionOrders(file: File, projectId?: string) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  if (projectId) formData.append('project_id', projectId);
  return fetch(`${API_BASE}/v1/production-orders/import`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(r => r.json()) as Promise<ExcelImportResult>;
}

export interface ProductionOrder {
  id: string;
  ext_id: string | null;
  product_name: string;
  specification_id: string | null;
  specification_name: string | null;
  quantity: number;
  unit: string;
  priority: string;
  client: string | null;
  start_date: string | null;
  due_date: string | null;
  status: string;
  project_id: string | null;
  group_id: string | null;
  pool_id: string | null;
  created_at: string;
}

export function getProductionOrders(projectId?: string) {
  const qs = projectId ? `?project_id=${projectId}` : '';
  return request<ProductionOrder[]>(`/v1/production-orders/${qs}`);
}

export function expandProductionOrder(orderId: string) {
  return request<{
    order_id: string;
    status: string;
    operations_created: number;
    dependencies_created: number;
    materials_required: number;
    warnings: string[];
  }>(`/v1/production-orders/${orderId}/expand`, { method: 'POST' });
}

// --- Order Groups & Pools ---
export function getGroups(projectId: string) {
  return request<{ items: OrderGroup[] }>(`/v1/projects/${projectId}/groups`);
}

export function createGroup(projectId: string, name: string, sortOrder = 0) {
  return request<{ id: string; name: string }>(`/v1/projects/${projectId}/groups`, {
    method: 'POST',
    body: JSON.stringify({ name, sort_order: sortOrder }),
  });
}

export function updateGroup(projectId: string, groupId: string, data: { name?: string; sort_order?: number }) {
  return request<{ id: string; name: string }>(`/v1/projects/${projectId}/groups/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteGroup(projectId: string, groupId: string) {
  return request<{ ok: boolean }>(`/v1/projects/${projectId}/groups/${groupId}`, {
    method: 'DELETE',
  });
}

export function getPools(projectId: string) {
  return request<{ items: OrderPool[] }>(`/v1/projects/${projectId}/pools`);
}

export function createPool(projectId: string, name: string, groupId: string | null, orderIds: string[]) {
  return request<{ id: string; name: string; order_ids: string[] }>(`/v1/projects/${projectId}/pools`, {
    method: 'POST',
    body: JSON.stringify({ name, group_id: groupId, order_ids: orderIds }),
  });
}

export function deletePool(projectId: string, poolId: string) {
  return request<{ ok: boolean }>(`/v1/projects/${projectId}/pools/${poolId}`, {
    method: 'DELETE',
  });
}

export function moveOrder(orderId: string, target: 'group' | 'pool' | 'root', targetId?: string) {
  return request<{ ok: boolean; group_id: string | null; pool_id: string | null }>(
    `/v1/orders/${orderId}/move`,
    { method: 'POST', body: JSON.stringify({ target, id: targetId || null }) }
  );
}
