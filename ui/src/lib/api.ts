// All API types and fetch helpers

const BASE = 'http://localhost:8888'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  const json = await res.json()
  return json.data as T
}

// Non-negotiable verdict
export interface NonNegotiableResult {
  passed: boolean
  reasoning: string
}

// Behavioral score
export interface BehavioralScore {
  score: number
  reasoning: string
}

// Judge verdict
export interface JudgeVerdict {
  non_negotiable_results: Record<string, NonNegotiableResult>
  behavioral_scores: Record<string, BehavioralScore>
  overall_conformance: number
  any_non_negotiable_failed: boolean
}

// Run response (returned when submitting a ticket)
export interface RunResponse {
  run_id: number
  model: string
  ticket_type: string
  customer_message: string
  response: string
  verdict: JudgeVerdict
  latency_ms: number
  total_tokens: number
  retried: boolean
  prompt_version: string
  system_prompt: string
  resolution_path: string
}

// Snapshot (drift history)
export interface SnapshotResponse {
  id: number | null
  created_at: string
  model: string
  prompt_version: string
  corpus_version: string
  overall_conformance: number
  property_scores: Record<string, number>
  non_negotiable_results: Record<string, unknown>
}

// Incident
export interface IncidentResponse {
  snapshot_id: number | null
  created_at: string
  model: string
  property_id: string
  score: number
  alert_threshold: number
  delta_from_baseline: number | null
}

// Cost estimate
export interface CostEstimate {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost_usd: number
}

// Single model result in comparison
export interface ModelCompareResult {
  model: string
  overall_conformance: number
  property_scores: Record<string, number>
  non_negotiable_pass_rates: Record<string, number>
  cost_estimate: CostEstimate
  snapshot: SnapshotResponse
}

// Full comparison response
export interface CompareResponse {
  models: ModelCompareResult[]
  winner: string | null
  winner_reason: string | null
}

// Monitor status
export interface MonitorStatus {
  overall_conformance_rate: number
  category_breakdown: Record<string, number>
  alert_count: number
  total_verdicts: number
}

// Production verdict
export interface VerdictResponse {
  id: number
  created_at: string
  run_id: number
  overall_score: number
  property_scores: Record<string, number>
  alert_triggered: boolean
}

// Submit ticket request
export interface SubmitTicketRequest {
  customer_message: string
  ticket_type: string
  context: Record<string, unknown>
  model?: string
}

// Submit a live ticket
export async function submitTicket(req: SubmitTicketRequest): Promise<RunResponse> {
  return apiFetch<RunResponse>('/api/v1/traces/', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

// Get all snapshots (drift history)
export async function getSnapshots(): Promise<SnapshotResponse[]> {
  return apiFetch<SnapshotResponse[]>('/api/v1/runs/snapshots')
}

// Trigger a fresh test suite snapshot
export async function triggerSnapshot(model: string): Promise<SnapshotResponse> {
  return apiFetch<SnapshotResponse>('/api/v1/runs/snapshot', {
    method: 'POST',
    body: JSON.stringify({ model }),
  })
}

// Get incidents
export async function getIncidents(): Promise<IncidentResponse[]> {
  return apiFetch<IncidentResponse[]>('/api/v1/runs/incidents')
}

// Run model comparison
export async function compareModels(models?: string[]): Promise<CompareResponse> {
  return apiFetch<CompareResponse>('/api/v1/compare/', {
    method: 'POST',
    body: JSON.stringify({ models: models ?? ['claude-sonnet-4-5', 'claude-haiku-4-5'] }),
  })
}

// Get monitor status
export async function getMonitorStatus(): Promise<MonitorStatus> {
  return apiFetch<MonitorStatus>('/api/v1/monitor/status')
}

// Get recent verdicts
export async function getVerdicts(): Promise<VerdictResponse[]> {
  return apiFetch<VerdictResponse[]>('/api/v1/monitor/verdicts')
}

// Get alerts only
export async function getAlerts(): Promise<VerdictResponse[]> {
  return apiFetch<VerdictResponse[]>('/api/v1/monitor/alerts')
}
