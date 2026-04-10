import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Database,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  MessageSquare,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getChatAnalytics,
  getChatLogs,
  type ChatAnalytics,
  type ChatLogEntry,
} from '@/lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKey(key: string): string {
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function conformanceColor(v: number | null | undefined): string {
  if (v == null) return '#888888'
  if (v >= 0.9) return '#0D9488'
  if (v >= 0.8) return '#F59E0B'
  return '#F43F5E'
}

const TICKET_LABELS: Record<string, string> = {
  order_status:    'Order & Delivery',
  refund_request:  'Refund & Returns',
  billing_dispute: 'Billing & Charges',
  escalation:      'Escalation',
}

const TOOL_COLORS: Record<string, string> = {
  lookup_customer:          '#2e5299',
  get_order_details:        '#0D9488',
  check_return_eligibility: '#F59E0B',
  get_return_label:         '#7755cc',
  get_billing_charges:      '#cc3333',
  get_order_history:        '#888888',
}

function ToolBadge({ name }: { name: string }) {
  const color = TOOL_COLORS[name] ?? '#888888'
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium text-white whitespace-nowrap"
      style={{ backgroundColor: color }}
    >
      {name}
    </span>
  )
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({ analytics }: { analytics: ChatAnalytics }) {
  const s = analytics.summary
  const cards = [
    {
      icon: MessageSquare,
      label: 'Total Sessions',
      value: s.total_sessions.toString(),
      sub: `${s.total_turns} total turns`,
      color: '#2e5299',
    },
    {
      icon: Layers,
      label: 'Avg Turns / Session',
      value: s.avg_turns_per_session.toFixed(1),
      sub: 'tool calls + response per session',
      color: '#0D9488',
    },
    {
      icon: TrendingUp,
      label: 'Avg Conformance',
      value: s.avg_conformance != null ? `${(s.avg_conformance * 100).toFixed(1)}%` : '—',
      sub: 'across all scored turns',
      color: conformanceColor(s.avg_conformance),
    },
    {
      icon: s.non_negotiable_failure_rate > 0 ? AlertTriangle : CheckCircle2,
      label: 'Non-Neg Failure Rate',
      value: `${(s.non_negotiable_failure_rate * 100).toFixed(1)}%`,
      sub: 'of turns with at least one violation',
      color: s.non_negotiable_failure_rate > 0.05 ? '#F43F5E' : '#0D9488',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <c.icon className="h-4 w-4" style={{ color: c.color }} />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</p>
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{c.sub}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Tool frequency ───────────────────────────────────────────────────────────

function ToolFrequencyPanel({ analytics }: { analytics: ChatAnalytics }) {
  const overall = analytics.tool_call_frequency.overall
  const total = Object.values(overall).reduce((a, b) => a + b, 0)

  if (total === 0) return (
    <div className="rounded-xl border border-border bg-card p-6 flex flex-col">
      <p className="text-sm font-semibold mb-1">Tool Call Frequency</p>
      <p className="text-xs text-muted-foreground flex-1 flex items-center">No tool calls recorded yet.</p>
    </div>
  )

  const sorted = Object.entries(overall).sort(([, a], [, b]) => b - a)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Tool Call Frequency</p>
        <span className="ml-auto text-[11px] text-muted-foreground">{total} total calls</span>
      </div>
      <div className="space-y-3">
        {sorted.map(([name, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0
          const color = TOOL_COLORS[name] ?? '#888888'
          return (
            <div key={name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-mono text-foreground">{name}</span>
                <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
                  {count} <span className="text-muted-foreground font-normal">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tool sequences ───────────────────────────────────────────────────────────

function ToolSequencesPanel({ analytics }: { analytics: ChatAnalytics }) {
  const sequences = analytics.tool_sequences

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Common Tool Sequences</p>
        <span className="ml-auto text-[11px] text-muted-foreground">top {sequences.length}</span>
      </div>
      {sequences.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No sequences yet.</p>
      ) : (
        <div className="space-y-2">
          {sequences.map((s, i) => (
            <div key={i} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
              <span className="text-[11px] font-bold tabular-nums text-muted-foreground w-4 flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1">
                  {s.sequence.split(' → ').map((tool, j) => (
                    <span key={j} className="flex items-center gap-1">
                      {j > 0 && <span className="text-muted-foreground text-[10px]">→</span>}
                      <ToolBadge name={tool} />
                    </span>
                  ))}
                </div>
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-muted-foreground flex-shrink-0">
                ×{s.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Ticket type breakdown ────────────────────────────────────────────────────

function TicketTypeBreakdown({ analytics }: { analytics: ChatAnalytics }) {
  const breakdown = analytics.ticket_type_breakdown
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b.turns - a.turns)
  const maxTurns = Math.max(...entries.map(([, v]) => v.turns), 1)

  const typeColors: Record<string, string> = {
    order_status:    '#0D9488',
    refund_request:  '#2e5299',
    billing_dispute: '#e6a800',
    escalation:      '#cc3333',
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Database className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Ticket Type Breakdown</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No data yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map(([type, stats]) => {
            const color = typeColors[type] ?? '#888888'
            const pct = (stats.turns / maxTurns) * 100
            return (
              <div key={type}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-foreground">{TICKET_LABELS[type] ?? formatKey(type)}</span>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{stats.sessions} session{stats.sessions !== 1 ? 's' : ''}</span>
                    <span className="font-semibold" style={{ color }}>{stats.turns} turns</span>
                    <span>avg {stats.avg_turns.toFixed(1)}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Recent sessions table ────────────────────────────────────────────────────

function RecentSessionsTable({
  analytics,
  onSelectSession,
}: {
  analytics: ChatAnalytics
  onSelectSession: (sessionId: string) => void
}) {
  const sessions = analytics.recent_sessions

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Recent Sessions</p>
        <span className="ml-auto text-[11px] text-muted-foreground">last {sessions.length} · click to inspect</span>
      </div>
      {sessions.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-muted-foreground">
          No sessions logged yet. Go to the Live Runtime page to start a conversation.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Session', 'Type', 'Turns', 'Conformance', 'Tools Used', 'Last Activity', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const conf = s.avg_conformance
                const color = conformanceColor(conf)
                return (
                  <tr
                    key={i}
                    className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => onSelectSession(s.session_id)}
                  >
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">
                      {s.session_id.length > 12 ? `…${s.session_id.slice(-8)}` : s.session_id}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {TICKET_LABELS[s.ticket_type ?? ''] ?? s.ticket_type ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold">{s.turn_count}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {conf != null ? (
                        <span className="font-semibold" style={{ color }}>
                          {(conf * 100).toFixed(1)}%
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {s.tools_used.length > 0
                          ? s.tools_used.slice(0, 3).map((t) => <ToolBadge key={t} name={t} />)
                          : <span className="text-muted-foreground">none</span>}
                        {s.tools_used.length > 3 && (
                          <span className="text-muted-foreground text-[10px]">+{s.tools_used.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatTime(s.last_turn_at)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <span style={{ color: '#0D9488' }} className="text-[10px] font-medium">View →</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Log feed ─────────────────────────────────────────────────────────────────

const TICKET_TYPES = [
  { value: '', label: 'All types' },
  { value: 'order_status',    label: 'Order & Delivery' },
  { value: 'refund_request',  label: 'Refund & Returns' },
  { value: 'billing_dispute', label: 'Billing & Charges' },
  { value: 'escalation',      label: 'Escalation' },
]

const NON_NEG_LABELS: Record<string, string> = {
  no_premature_refund:            'No premature refund',
  escalation_threshold:           'Escalation threshold',
  no_unauthorized_account_details:'No unauthorized account details',
}

const PROP_LABELS: Record<string, string> = {
  issue_acknowledged:  'Issue acknowledged',
  resolution_matching: 'Resolution matching',
  professional_tone:   'Professional tone',
  concise_response:    'Concise response',
}

function LogEntry({ entry, initialExpanded = false }: { entry: ChatLogEntry; initialExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const conf = entry.verdict_summary?.overall_conformance
  const failed = entry.verdict_summary?.any_non_negotiable_failed
  const propertyScores = entry.verdict_summary?.property_scores ?? {}
  const nonNegResults = entry.verdict_summary?.non_negotiable_results ?? {}
  const behavioralScores = entry.verdict_summary?.behavioral_scores ?? {}
  const color = conformanceColor(conf)

  return (
    <div className="divide-y divide-border/20">
      {/* Summary row — always visible, click to expand */}
      <div
        className="px-5 py-3 hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white"
                style={{ backgroundColor: '#2e5299' }}>
                {TICKET_LABELS[entry.ticket_type ?? ''] ?? entry.ticket_type ?? '—'}
              </span>
              <span className="text-[10px] text-muted-foreground">Turn {entry.turn_number}</span>
              {failed && (
                <span className="text-[10px] font-semibold" style={{ color: '#F43F5E' }}>⚠ violation</span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">{formatTime(entry.created_at)}</span>
            </div>
            <p className="text-[11px] text-foreground leading-relaxed truncate">
              {entry.customer_message ?? '—'}
            </p>
            {entry.tool_names.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {entry.tool_names.map((t, i) => <ToolBadge key={i} name={t} />)}
              </div>
            )}
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            {conf != null && (
              <span className="text-[12px] font-bold tabular-nums" style={{ color }}>
                {(conf * 100).toFixed(0)}%
              </span>
            )}
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-5 py-4 bg-muted/10 space-y-4">

          {/* Non-negotiables */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Non-Negotiables</p>
            <div className="space-y-2">
              {Object.entries(NON_NEG_LABELS).map(([key, label]) => {
                const result = nonNegResults[key]
                const pass = result ? result.passed : !failed
                return (
                  <div key={key} className="flex items-start gap-2">
                    <span style={{ color: pass ? '#0D9488' : '#F43F5E' }} className="text-[11px] font-semibold mt-0.5 flex-shrink-0">
                      {pass ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-foreground">{label}</span>
                      {result?.reasoning && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{result.reasoning}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Behavioral property scores with reasoning */}
          {Object.keys(propertyScores).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Behavioral Properties</p>
              <div className="space-y-3">
                {Object.entries(propertyScores).map(([key, score]) => {
                  const c = conformanceColor(score)
                  const reasoning = behavioralScores[key]?.reasoning
                  return (
                    <div key={key}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-medium text-foreground w-36 flex-shrink-0">
                          {PROP_LABELS[key] ?? key}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${score * 100}%`, backgroundColor: c }} />
                        </div>
                        <span className="text-[11px] font-semibold tabular-nums w-9 text-right flex-shrink-0" style={{ color: c }}>
                          {(score * 100).toFixed(0)}%
                        </span>
                      </div>
                      {reasoning && (
                        <p className="text-[11px] text-muted-foreground ml-36 pl-2">{reasoning}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Agent response */}
          {entry.response && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Agent Response</p>
              <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap bg-background border border-border rounded-lg px-3 py-2.5">
                {entry.response}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LogFeed({
  sessionId,
  onClearSession,
}: {
  sessionId?: string
  onClearSession: () => void
}) {
  const [ticketType, setTicketType] = useState('')

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['chatlogs', ticketType, sessionId],
    queryFn: () => getChatLogs({ limit: 100, ticket_type: ticketType || undefined, session_id: sessionId }),
  })

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <Database className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Turn Log</p>
        {sessionId ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-border text-muted-foreground">
              session …{sessionId.slice(-8)}
            </span>
            <button
              onClick={onClearSession}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ✕ clear
            </button>
          </div>
        ) : (
          <select
            value={ticketType}
            onChange={(e) => setTicketType(e.target.value)}
            className="ml-auto text-[11px] rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none hover:border-foreground/30 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            {TICKET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        )}
        <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] text-muted-foreground">{logs.length} entries</span>
      </div>

      {isLoading ? (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Database className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">No turns logged yet.</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            Submit a ticket on the <a href="/runtime" className="underline" style={{ color: '#0D9488' }}>Live Runtime</a> page to populate the log.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {logs.map((entry) => (
            <LogEntry key={entry.id} entry={entry} initialExpanded={!!sessionId} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'analytics' | 'log'

export default function ChatLogsPage() {
  const [tab, setTab] = useState<Tab>('analytics')
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>()

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId)
    setTab('log')
  }

  function handleClearSession() {
    setSelectedSessionId(undefined)
  }

  const { data: analytics, isLoading, error, refetch } = useQuery({
    queryKey: ['chatAnalytics'],
    queryFn: getChatAnalytics,
    refetchInterval: 30_000,
  })

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Chat Log Analytics</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Tool call sequences, session patterns, and recurring issues — from the async log store.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 border-b border-transparent">
          {(['analytics', 'log'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-t transition-colors border-b-2 -mb-px',
                tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
              style={tab === t ? { borderBottomColor: '#0D9488', color: '#0D9488' } : undefined}
            >
              {t === 'analytics' ? 'Analytics' : 'Turn Log'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'log' && <LogFeed sessionId={selectedSessionId} onClearSession={handleClearSession} />}

        {tab === 'analytics' && (
          <>
            {isLoading && (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading analytics…
              </div>
            )}

            {error && (
              <div className="rounded-lg px-4 py-3 text-sm"
                style={{ backgroundColor: '#F59E0B18', color: '#D97706', borderLeft: '3px solid #F59E0B' }}>
                Failed to load analytics. Is the backend running?
              </div>
            )}

            {analytics && (
              <div className="space-y-6">
                <SummaryCards analytics={analytics} />

                <div className="grid grid-cols-2 gap-4">
                  <ToolFrequencyPanel analytics={analytics} />
                  <ToolSequencesPanel analytics={analytics} />
                </div>

                <TicketTypeBreakdown analytics={analytics} />

                <RecentSessionsTable analytics={analytics} onSelectSession={handleSelectSession} />
              </div>
            )}

            {analytics && analytics.summary.total_turns === 0 && !isLoading && (
              <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
                <Database className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
                <p className="text-sm font-medium text-foreground">No log data yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
                  Analytics populate as live conversations happen. Submit a ticket on the{' '}
                  <a href="/runtime" className="underline" style={{ color: '#0D9488' }}>Live Runtime</a> page to generate data.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
