/**
 * TypeScript-типы для ProfyPlan API.
 */

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  ext_id?: string;
  due_date?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  customer?: string;
  created_at: string;
}

export interface Operation {
  id: string;
  project_id: string;
  name: string;
  duration_base: number;
  duration_unit: string;
  setup_time: number;
  teardown_time: number;
  operation_type: 'production' | 'procurement' | 'quality_check' | 'assembly';
  output_product?: string;
  output_quantity?: number;
  yield_rate: number;
  is_critical: boolean;
  is_milestone: boolean;
  ext_id?: string;
  position?: number;
}

export interface Resource {
  id: string;
  name: string;
  resource_type: 'equipment' | 'employee' | 'team' | 'line' | 'area';
  capacity_per_unit: number;
  capacity_unit: string;
  unit?: string;
  ext_id?: string;
}

export interface CPMNode {
  id: string;
  name: string;
  duration: number;
  early_start: number;
  early_finish: number;
  late_start: number;
  late_finish: number;
  total_float: number;
  free_float: number;
  is_critical: boolean;
}

export interface CPMResult {
  project_id: string;
  method: string;
  total_duration: number;
  critical_path: string[];
  nodes: CPMNode[];
  node_count: number;
  critical_count: number;
}

export interface MergedCPMResult extends CPMResult {
  projects: string[];
  inter_project_deps: number;
}

export interface ResourceLevelResult {
  method: string;
  total_makespan_hours: number;
  conflicts_resolved: number;
  operation_count: number;
  resource_utilization: Record<string, number>;
  bottlenecks: string[];
  queue_lengths?: Record<string, number>;
  operations: ScheduledOperation[];
}

export interface ScheduledOperation {
  operation_id: string;
  operation_name: string;
  resource_name?: string;
  planned_start_hour: number;
  planned_end_hour: number;
  duration_hours: number;
  is_critical: boolean;
  total_float: number;
  predecessor_ids: string[];
}

export interface ForecastResult {
  project_id: string;
  method: string;
  baseline_finish_hours: number;
  forecast_finish_hours: number;
  delay_hours: number;
  is_delayed: boolean;
  operation_status: {
    total: number;
    completed: number;
    in_progress: number;
    not_started: number;
  };
  deviations: ForecastDeviation[];
}

export interface ForecastDeviation {
  operation_id: string;
  operation_name: string;
  baseline_start_hour: number;
  baseline_end_hour: number;
  forecast_start_hour: number;
  forecast_end_hour: number;
  deviation_hours: number;
  reason: string;
}

export interface Baseline {
  id: string;
  version: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface ActualFact {
  operation_id: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'delayed' | 'cancelled';
  fact_start?: string;
  fact_end?: string;
  quantity_completed?: number;
  quantity_defect?: number;
  deviation_reason?: string;
  comment?: string;
  source?: 'manual' | 'google_sheets' | 'erp_sync';
}
