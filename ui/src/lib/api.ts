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

// Tool call — one entry per tool invoked by the agent during a turn
export interface ToolCall {
  name: string
  input: Record<string, unknown>
  result: Record<string, unknown>
  tool_use_id: string
}

// Run response (returned when submitting a ticket)
export interface RunResponse {
  run_id: number
  session_id: string
  turn_number: number
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
  tool_calls: ToolCall[]
}

// Session — full conversation thread
export interface SessionTurn {
  id: number
  turn_number: number
  customer_message: string
  response: string
  latency_ms: number
  total_tokens: number
  conversation_history: { role: string; content: string }[]
}

export interface Session {
  id: string
  created_at: string
  ticket_type: string
  scenario_id: string
  context: Record<string, unknown>
  turns: SessionTurn[]
  turn_count: number
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
  category_scores: Record<string, Record<string, number>>
  input_tokens: number
  output_tokens: number
}

// Per-example result stored for each snapshot run
export interface SnapshotExampleItem {
  id: number
  snapshot_id: number
  corpus_example_id: string
  ticket_type: string
  customer_message_truncated: string
  overall_score: number
  property_scores: Record<string, number>
  non_negotiables_passed: boolean
}

// One example that changed status between two snapshots
export interface ExampleDiffEntry {
  corpus_example_id: string
  ticket_type: string
  customer_message_truncated: string
  previous_overall_score: number
  current_overall_score: number
  score_delta: number
  status: 'newly_failed' | 'newly_recovered' | 'degraded' | 'improved'
  changed_properties: Record<string, number>
}

// Full diff between a snapshot and its predecessor
export interface SnapshotDiffResponse {
  snapshot_id: number
  previous_snapshot_id: number
  snapshot_created_at: string
  previous_snapshot_created_at: string
  newly_failed: ExampleDiffEntry[]
  newly_recovered: ExampleDiffEntry[]
  degraded: ExampleDiffEntry[]
  improved: ExampleDiffEntry[]
  total_changed: number
  summary: Record<string, number>
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
  conversation_history?: { role: string; content: string }[]
  session_id?: string | null
  scenario_id?: string
}

// Submit a live ticket
export async function submitTicket(req: SubmitTicketRequest): Promise<RunResponse> {
  return apiFetch<RunResponse>('/api/v1/traces/', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

// Get all snapshots (drift history)
export async function getSnapshots(runType?: 'test' | 'baseline' | 'compare'): Promise<SnapshotResponse[]> {
  const qs = runType ? `?run_type=${runType}` : ''
  return apiFetch<SnapshotResponse[]>(`/api/v1/runs/snapshots${qs}`)
}

// Trigger a fresh test suite snapshot
export async function triggerSnapshot(model: string, runType: 'test' | 'baseline' = 'test'): Promise<SnapshotResponse> {
  return apiFetch<SnapshotResponse>('/api/v1/runs/snapshot', {
    method: 'POST',
    body: JSON.stringify({ model, run_type: runType }),
  })
}

// Delete a snapshot
export async function deleteSnapshot(id: number): Promise<void> {
  await fetch(`${BASE}/api/v1/runs/snapshot/${id}`, { method: 'DELETE' })
}

// Get incidents
export async function getIncidents(): Promise<IncidentResponse[]> {
  return apiFetch<IncidentResponse[]>('/api/v1/runs/incidents')
}

export async function getSnapshotDiff(snapshotId: number): Promise<SnapshotDiffResponse> {
  return apiFetch<SnapshotDiffResponse>(`/api/v1/runs/snapshots/${snapshotId}/diff`)
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

// Behavioral spec types
export interface NonNegotiable {
  id: string
  name: string
  description: string
  zero_tolerance: boolean
}

export interface BehavioralProperty {
  id: string
  name: string
  description: string
  target: number
  alert_threshold: number
}

export interface BehavioralSpec {
  version: string
  non_negotiables: NonNegotiable[]
  behavioral_properties: BehavioralProperty[]
}

// Get the behavioral spec
export async function getSpec(): Promise<BehavioralSpec> {
  return apiFetch<BehavioralSpec>('/api/v1/spec')
}

// Get a full session (conversation thread + turns)
export async function getSession(sessionId: string): Promise<Session> {
  return apiFetch<Session>(`/api/v1/sessions/${sessionId}`)
}

// ── Chat log analytics ─────────────────────────────────────────────────────

export interface ChatLogEntry {
  id: number
  created_at: string
  session_id: string | null
  run_id: number | null
  turn_number: number | null
  ticket_type: string | null
  customer_message: string | null
  tool_names: string[]
  response: string | null
  verdict_summary: {
    overall_conformance?: number
    any_non_negotiable_failed?: boolean
    property_scores?: Record<string, number>
    non_negotiable_results?: Record<string, { passed: boolean; reasoning: string }>
    behavioral_scores?: Record<string, { score: number; reasoning: string }>
  }
}

export interface ToolFrequency {
  overall: Record<string, number>
  by_ticket_type: Record<string, Record<string, number>>
}

export interface ToolSequence {
  sequence: string
  count: number
}

export interface TicketTypeBreakdown {
  sessions: number
  turns: number
  avg_turns: number
}

export interface RecentSession {
  session_id: string
  ticket_type: string | null
  turn_count: number
  avg_conformance: number | null
  tools_used: string[]
  created_at: string
  last_turn_at: string
}

export interface ChatAnalytics {
  summary: {
    total_sessions: number
    total_turns: number
    avg_turns_per_session: number
    avg_conformance: number | null
    non_negotiable_failure_rate: number
  }
  tool_call_frequency: ToolFrequency
  tool_sequences: ToolSequence[]
  ticket_type_breakdown: Record<string, TicketTypeBreakdown>
  recent_sessions: RecentSession[]
}

export async function getChatLogs(params?: { limit?: number; ticket_type?: string; session_id?: string }): Promise<ChatLogEntry[]> {
  const query = new URLSearchParams()
  if (params?.limit)       query.set('limit', String(params.limit))
  if (params?.ticket_type) query.set('ticket_type', params.ticket_type)
  if (params?.session_id)  query.set('session_id', params.session_id)
  const qs = query.toString()
  return apiFetch<ChatLogEntry[]>(`/api/v1/chatlogs/${qs ? `?${qs}` : ''}`)
}

export async function getChatAnalytics(): Promise<ChatAnalytics> {
  return apiFetch<ChatAnalytics>('/api/v1/chatlogs/analytics')
}
