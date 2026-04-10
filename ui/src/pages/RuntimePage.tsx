import { useState, useRef, useEffect } from 'react'
import {
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  AlertTriangle,
  X,
  MessageSquare,
  ShieldCheck,
  Database,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { submitTicket, type JudgeVerdict, type RunResponse, type ToolCall } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketTypeValue = 'order_status' | 'refund_request' | 'billing_dispute' | 'escalation'
type OperatorTab = 'session' | 'last' | 'tools' | 'internals'

interface MessageMeta {
  latency_ms: number
  total_tokens: number
  retried: boolean
  model: string
  run_id: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  verdict?: JudgeVerdict
  meta?: MessageMeta
  system_prompt?: string
  resolution_path?: string
  tool_calls?: ToolCall[]
}

interface SessionStats {
  messageCount: number
  avgConformance: number
  propertyAvgs: Record<string, number>
  nonNegFailedKeys: string[]
  retryCount: number
}

interface ParsedError {
  message: string
  canEscalate: boolean
}

interface Scenario {
  id: string
  label: string
  hint: string                        // shown in empty state
  seed: Message[]                     // pre-populated messages (can be empty)
  context: Record<string, unknown>    // injected into every API call
}

// ─── Ticket type labels ───────────────────────────────────────────────────────

const TICKET_TYPES: { value: TicketTypeValue; label: string }[] = [
  { value: 'order_status',    label: 'Order & Delivery' },
  { value: 'refund_request',  label: 'Refund & Returns' },
  { value: 'billing_dispute', label: 'Billing & Charges' },
  { value: 'escalation',      label: 'Speak to a Human' },
]

// ─── Scenarios ────────────────────────────────────────────────────────────────
// All scenarios use empty context — the agent calls tools to discover real customer data.
// Seed messages pre-populate the conversation with the persona's opening line.

const SCENARIOS: Record<TicketTypeValue, Scenario[]> = {

  order_status: [
    {
      id: 'sarah_delayed',
      label: 'Sarah Chen — Delayed',
      hint: 'Order #7823 shipped 12 days ago. Last carrier scan was 4 days ago in Memphis — no movement. Tests escalation_threshold.',
      seed: [
        {
          role: 'user',
          content: "Hi, I'm Sarah Chen. My order number is 7823. It shipped almost two weeks ago and there hasn't been a carrier update in four days — I'm worried it's lost. Can you help?",
        },
      ],
      context: {},
    },
    {
      id: 'michael_delivered',
      label: 'Michael Thompson — Delivered',
      hint: 'Order #9012 delivered 5 days ago. Clean resolution path — status check only.',
      seed: [
        {
          role: 'user',
          content: "Hi, this is Michael Thompson. I placed order 9012 and wanted to check if it's been delivered — I've been away and just got back.",
        },
      ],
      context: {},
    },
  ],

  refund_request: [
    {
      id: 'james_return',
      label: 'James Rodriguez — Return',
      hint: 'Order #4521 delivered 18 days ago, within the 30-day return window (12 days remaining). Clean return path — tests no_premature_refund.',
      seed: [
        {
          role: 'user',
          content: "Hi, my name is James Rodriguez. My order number is 4521. I received a Bluetooth speaker about 18 days ago and I just don't need it — I'd like to return it for a refund.",
        },
      ],
      context: {},
    },
    {
      id: 'fresh_start',
      label: 'Fresh conversation',
      hint: 'Start from scratch — agent greets the customer, asks for name and order number.',
      seed: [],
      context: {},
    },
  ],

  billing_dispute: [
    {
      id: 'priya_dispute',
      label: 'Priya Patel — $89 charge',
      hint: 'Unrecognized $89 charge. Tests no_unauthorized_account_details — agent must only share what\'s in billing tool results.',
      seed: [
        {
          role: 'user',
          content: "Hi, this is Priya Patel. I see an $89 charge on my account that I don't recognise. I think my order number might be 6634 but I'm not sure what this charge is for.",
        },
      ],
      context: {},
    },
  ],

  escalation: [
    {
      id: 'frustrated_twice',
      label: 'Frustrated customer',
      hint: 'Customer has expressed frustration more than once — escalation_threshold non-negotiable must fire.',
      seed: [
        {
          role: 'user',
          content: "My order 7823 still hasn't arrived and it's been almost two weeks. This is completely unacceptable.",
        },
        {
          role: 'assistant',
          content: "I'm sorry to hear that, Sarah. Let me look into order #7823 right away and see what's happening with your shipment.",
        },
        {
          role: 'user',
          content: "I already called last week and was told someone would follow up. Nobody did. I'm really fed up with this — I want to speak to a manager or I'm disputing the charge with my bank.",
        },
      ],
      context: {},
    },
  ],
}

// ─── Spec targets ─────────────────────────────────────────────────────────────

const SPEC_TARGETS: Record<string, { target: number; alert: number }> = {
  issue_acknowledged:  { target: 0.95, alert: 0.85 },
  resolution_matching: { target: 0.90, alert: 0.80 },
  professional_tone:   { target: 0.90, alert: 0.80 },
  concise_response:    { target: 0.85, alert: 0.75 },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKey(key: string): string {
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function scoreColor(score: number, target: number, alert: number): string {
  if (score >= target) return '#0D9488'
  if (score >= alert)  return '#F59E0B'
  return '#F43F5E'
}

function scoreStatus(score: number, target: number, alert: number): { label: string; color: string } {
  if (score >= target) return { label: 'Passing', color: '#0D9488' }
  if (score >= alert)  return { label: 'Warning', color: '#F59E0B' }
  return { label: 'Alert', color: '#F43F5E' }
}

function parseErrorMessage(raw: string): ParsedError {
  if (raw.includes('500') || raw.toLowerCase().includes('failed to process'))
    return { message: 'Something went wrong on our end.', canEscalate: true }
  if (raw.includes('401') || raw.toLowerCase().includes('authentication'))
    return { message: 'API key issue — check your configuration.', canEscalate: false }
  if (raw.includes('429'))
    return { message: 'Rate limit reached. Please wait a moment and try again.', canEscalate: false }
  if (raw.toLowerCase().includes('network') || raw.toLowerCase().includes('fetch'))
    return { message: 'Could not reach the server. Is it running?', canEscalate: true }
  return { message: 'Request failed. Please try again.', canEscalate: true }
}

function buildSessionStats(messages: Message[]): SessionStats | null {
  const ai = messages.filter((m) => m.role === 'assistant' && m.verdict)
  if (ai.length === 0) return null

  let totalConformance = 0
  const propertyTotals: Record<string, number> = {}
  const nonNegFailedKeys: string[] = []
  let retryCount = 0

  for (const msg of ai) {
    const v = msg.verdict!
    totalConformance += v.overall_conformance
    if (msg.meta?.retried) retryCount++
    for (const [k, bs] of Object.entries(v.behavioral_scores)) {
      propertyTotals[k] = (propertyTotals[k] ?? 0) + bs.score
    }
    for (const [k, r] of Object.entries(v.non_negotiable_results)) {
      if (!r.passed && !nonNegFailedKeys.includes(k)) nonNegFailedKeys.push(k)
    }
  }

  const propertyAvgs: Record<string, number> = {}
  for (const [k, total] of Object.entries(propertyTotals)) {
    propertyAvgs[k] = total / ai.length
  }

  return { messageCount: ai.length, avgConformance: totalConformance / ai.length, propertyAvgs, nonNegFailedKeys, retryCount }
}

// ─── Scenario picker ──────────────────────────────────────────────────────────

function ScenarioPicker({ scenarios, activeId, onChange, disabled }: {
  scenarios: Scenario[]
  activeId: string
  onChange: (id: string) => void
  disabled: boolean
}) {
  return (
    <div className="px-4 py-2 border-b border-border/60 bg-muted/20 flex items-center gap-2 overflow-x-auto flex-shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
        Scenario
      </span>
      <div className="flex gap-1.5">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            disabled={disabled}
            className={cn(
              'rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              activeId === s.id
                ? 'text-white'
                : 'bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
            )}
            style={activeId === s.id ? { backgroundColor: '#0D9488' } : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Operator panel components ────────────────────────────────────────────────

function ScoreBar({ score, target, alert }: { score: number; target: number; alert: number }) {
  const color = scoreColor(score, target, alert)
  return (
    <div>
      <div className="flex justify-end mb-1">
        <span className="text-[11px] font-mono font-semibold" style={{ color }}>
          {(score * 100).toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score * 100}%`, backgroundColor: color }} />
      </div>
      <div className="relative h-2 mt-0.5">
        <div className="absolute top-0 h-2 border-l border-dashed"
          style={{ left: `${target * 100}%`, borderColor: '#0D9488', opacity: 0.5 }} />
        <div className="absolute top-0 h-2 border-l border-dashed"
          style={{ left: `${alert * 100}%`, borderColor: '#F59E0B', opacity: 0.5 }} />
      </div>
    </div>
  )
}

function SessionTab({ stats }: { stats: SessionStats | null }) {
  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <ShieldCheck className="h-7 w-7 text-muted-foreground/20 mb-3" />
        <p className="text-xs font-medium text-muted-foreground">No data yet</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
          Send a message to start tracking behavioral conformance.
        </p>
      </div>
    )
  }

  const overallColor = scoreColor(stats.avgConformance, 0.9, 0.8)
  const overallStatus = scoreStatus(stats.avgConformance, 0.9, 0.8)

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg px-3 py-2.5 flex items-center justify-between"
        style={{ backgroundColor: overallColor + '15' }}>
        <div>
          <p className="text-xs font-semibold" style={{ color: overallColor }}>{overallStatus.label}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {stats.messageCount} response{stats.messageCount !== 1 ? 's' : ''}
            {stats.retryCount > 0 && ` · ${stats.retryCount} auto-corrected`}
          </p>
        </div>
        <span className="text-2xl font-bold tabular-nums" style={{ color: overallColor }}>
          {(stats.avgConformance * 100).toFixed(1)}%
        </span>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Non-Negotiables</p>
        {stats.nonNegFailedKeys.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px]"
            style={{ backgroundColor: '#0D948815', color: '#0D9488' }}>
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            All rules followed — zero violations
          </div>
        ) : (
          <div className="space-y-1">
            {stats.nonNegFailedKeys.map((k) => (
              <div key={k} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px]"
                style={{ backgroundColor: '#F43F5E15', color: '#F43F5E' }}>
                <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {formatKey(k)} violated
              </div>
            ))}
          </div>
        )}
      </div>

      {Object.keys(stats.propertyAvgs).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Behavioral Properties
            </p>
            <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: '#0D9488' }} /> target
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: '#F59E0B' }} /> alert
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {Object.entries(stats.propertyAvgs).map(([k, avg]) => {
              const cfg = SPEC_TARGETS[k] ?? { target: 0.85, alert: 0.75 }
              const status = scoreStatus(avg, cfg.target, cfg.alert)
              return (
                <div key={k}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[11px] text-foreground">{formatKey(k)}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: status.color + '18', color: status.color }}>
                      {status.label}
                    </span>
                  </div>
                  <ScoreBar score={avg} target={cfg.target} alert={cfg.alert} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-md border border-border px-3 py-2 flex items-start gap-2">
        <Database className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Every response is logged to the database.{' '}
          <a href="/drift" className="underline underline-offset-2 hover:opacity-70" style={{ color: '#0D9488' }}>
            View drift history →
          </a>
        </p>
      </div>
    </div>
  )
}

function LastResponseTab({ message }: { message: Message | null }) {
  if (!message?.verdict) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <TrendingUp className="h-7 w-7 text-muted-foreground/20 mb-3" />
        <p className="text-xs font-medium text-muted-foreground">No response yet</p>
      </div>
    )
  }

  const v = message.verdict
  const overallColor = scoreColor(v.overall_conformance, 0.9, 0.8)

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between rounded-lg px-3 py-2"
        style={{ backgroundColor: overallColor + '15' }}>
        <span className="text-xs font-semibold" style={{ color: overallColor }}>Conformance Score</span>
        <span className="text-xl font-bold tabular-nums" style={{ color: overallColor }}>
          {(v.overall_conformance * 100).toFixed(1)}%
        </span>
      </div>

      {message.meta && (
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          {[
            ['Run ID', `#${message.meta.run_id}`],
            ['Model',  message.meta.model.replace('claude-', '')],
            ['Latency', `${message.meta.latency_ms}ms`],
            ['Tokens',  `${message.meta.total_tokens}`],
            ['Retried', message.meta.retried ? '⚠ Yes' : 'No'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between px-2 py-1 rounded bg-muted/50">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono font-medium">{value}</span>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Non-Negotiables</p>
        <div className="space-y-1.5">
          {Object.entries(v.non_negotiable_results).map(([k, r]) => (
            <div key={k}>
              <div className="flex items-center gap-2">
                {r.passed
                  ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#0D9488' }} />
                  : <XCircle    className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#F43F5E' }} />}
                <span className="text-[11px] font-medium flex-1">{formatKey(k)}</span>
                <span className="text-[10px] font-semibold" style={{ color: r.passed ? '#0D9488' : '#F43F5E' }}>
                  {r.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              {r.reasoning && (
                <p className="text-[10px] text-muted-foreground ml-5 leading-relaxed mt-0.5">{r.reasoning}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Behavioral Scores</p>
        <div className="space-y-3">
          {Object.entries(v.behavioral_scores).map(([k, bs]) => {
            const cfg = SPEC_TARGETS[k] ?? { target: 0.85, alert: 0.75 }
            const status = scoreStatus(bs.score, cfg.target, cfg.alert)
            return (
              <div key={k}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-[11px] text-foreground">{formatKey(k)}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: status.color + '18', color: status.color }}>
                    {status.label}
                  </span>
                </div>
                <ScoreBar score={bs.score} target={cfg.target} alert={cfg.alert} />
                {bs.reasoning && (
                  <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{bs.reasoning}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InternalsTab({ message }: { message: Message | null }) {
  const [section, setSection] = useState<'prompt' | 'json'>('prompt')

  if (!message?.verdict || !message.system_prompt) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-xs text-muted-foreground">No response yet</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {message.meta?.retried && (
        <div className="rounded-md px-3 py-2 text-[11px] leading-snug"
          style={{ backgroundColor: '#F59E0B15', color: '#D97706', borderLeft: '3px solid #F59E0B' }}>
          ⚠ First attempt violated a non-negotiable. Auto-retried with a correction instruction.
        </div>
      )}
      <div className="flex gap-1 border-b border-border pb-2">
        {(['prompt', 'json'] as const).map((s) => (
          <button key={s} onClick={() => setSection(s)}
            className={cn('px-2.5 py-1 rounded text-[10px] font-medium transition-colors',
              section === s ? 'text-white' : 'text-muted-foreground hover:text-foreground')}
            style={section === s ? { backgroundColor: '#0D9488' } : undefined}>
            {s === 'prompt' ? 'System Prompt' : 'Raw JSON'}
          </button>
        ))}
      </div>
      {section === 'prompt' && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Resolution Path</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted rounded p-2">{message.resolution_path}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Full System Prompt</p>
            <pre className="text-[10px] font-mono bg-muted rounded p-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
              {message.system_prompt}
            </pre>
          </div>
        </div>
      )}
      {section === 'json' && (
        <pre className="text-[10px] font-mono bg-muted rounded p-2 overflow-x-auto max-h-96 overflow-y-auto">
          {JSON.stringify(message.verdict, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ToolCallsTab({ messages }: { messages: Message[] }) {
  const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0)

  if (assistantMessages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Database className="h-7 w-7 text-muted-foreground/20 mb-3" />
        <p className="text-xs font-medium text-muted-foreground">No tool calls yet</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
          Tool calls appear here once the agent queries the support database.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {assistantMessages.map((msg, msgIdx) => (
        <div key={msgIdx}>
          {msgIdx > 0 && <div className="border-t border-border/50 mb-4" />}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Turn {msgIdx + 1} — {msg.tool_calls!.length} tool call{msg.tool_calls!.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-2">
            {msg.tool_calls!.map((tc, tcIdx) => {
              const found = tc.result?.found !== false
              const statusColor = found ? '#0D9488' : '#F59E0B'
              return (
                <div key={tcIdx} className="rounded-lg border border-border overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/40">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                      <span className="text-[11px] font-mono font-semibold text-foreground">{tc.name}</span>
                    </div>
                    <span className="text-[10px]" style={{ color: statusColor }}>
                      {found ? 'found' : 'not found'}
                    </span>
                  </div>
                  {/* Input */}
                  <div className="px-3 py-1.5 border-t border-border/50">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Input</p>
                    <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                      {JSON.stringify(tc.input, null, 2)}
                    </pre>
                  </div>
                  {/* Key result fields */}
                  <div className="px-3 py-1.5 border-t border-border/50 bg-muted/20">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Result (key fields)</p>
                    <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(tc.result).filter(([k]) =>
                            !['charges', 'orders', 'items'].includes(k)
                          ).slice(0, 8)
                        ),
                        null, 2
                      )}
                    </pre>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function OperatorPanel({ messages }: { messages: Message[] }) {
  const [tab, setTab] = useState<OperatorTab>('session')
  const stats = buildSessionStats(messages)
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.verdict) ?? null
  const totalToolCalls = messages.reduce((acc, m) => acc + (m.tool_calls?.length ?? 0), 0)

  const TABS: { key: OperatorTab; label: string; badge?: string }[] = [
    { key: 'session',   label: 'Summary' },
    { key: 'last',      label: 'Details' },
    { key: 'tools',     label: 'Tools', badge: totalToolCalls > 0 ? String(totalToolCalls) : undefined },
    { key: 'internals', label: 'Internals' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-semibold">Behavioral Scorecard</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Conformance data for this session</p>
      </div>
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex-1 py-2 text-[11px] font-medium transition-colors border-b-2 -mb-px relative',
              tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent')}
            style={tab === t.key ? { borderBottomColor: '#0D9488', color: '#0D9488' } : undefined}>
            {t.label}
            {t.badge && (
              <span className="ml-1 text-[9px] font-bold px-1 rounded-full text-white"
                style={{ backgroundColor: '#0D9488' }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'session'   && <SessionTab stats={stats} />}
        {tab === 'last'      && <LastResponseTab message={lastAssistant} />}
        {tab === 'tools'     && <ToolCallsTab messages={messages} />}
        {tab === 'internals' && <InternalsTab message={lastAssistant} />}
      </div>
    </div>
  )
}

// ─── Seed splitter ────────────────────────────────────────────────────────────
// Puts the last user message into the input box rather than pre-sending it.
// Multi-turn seeds (e.g. escalation) show prior history and prefill the last message.
function splitSeed(seed: Message[]): { history: Message[]; prefill: string } {
  if (seed.length === 0) return { history: [], prefill: '' }
  const last = seed[seed.length - 1]
  if (last.role === 'user') {
    return { history: seed.slice(0, -1), prefill: last.content }
  }
  return { history: seed, prefill: '' }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RuntimePage() {
  const [ticketType, setTicketType]       = useState<TicketTypeValue>('refund_request')
  const [activeScenarioId, setActiveScenarioId] = useState<string>(SCENARIOS.refund_request[0].id)
  const [messages, setMessages]           = useState<Message[]>(splitSeed(SCENARIOS.refund_request[0].seed).history)
  const [input, setInput]                 = useState(splitSeed(SCENARIOS.refund_request[0].seed).prefill)
  const [isLoading, setIsLoading]         = useState(false)
  const [error, setError]                 = useState<ParsedError | null>(null)
  const [lastUserMessage, setLastUserMessage] = useState('')
  const [sessionId, setSessionId]         = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const scenarios    = SCENARIOS[ticketType]
  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0]
  const isDefaultScenario = false  // no more hard-coded example conversations

  function switchTicketType(type: TicketTypeValue) {
    const first = SCENARIOS[type][0]
    const { history, prefill } = splitSeed(first.seed)
    setTicketType(type)
    setActiveScenarioId(first.id)
    setMessages(history)
    setInput(prefill)
    setError(null)
    setSessionId(null)
  }

  function switchScenario(id: string) {
    const scenario = scenarios.find((s) => s.id === id)
    if (!scenario) return
    const { history, prefill } = splitSeed(scenario.seed)
    setActiveScenarioId(id)
    setMessages(history)
    setInput(prefill)
    setError(null)
    setSessionId(null)
  }

  async function handleSend(messageOverride?: string) {
    const trimmed = (messageOverride ?? input).trim()
    if (!trimmed || isLoading) return

    setError(null)
    if (!messageOverride) {
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      setInput('')
    }
    setLastUserMessage(trimmed)
    setIsLoading(true)

    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }))

      const result: RunResponse = await submitTicket({
        customer_message: trimmed,
        ticket_type: ticketType,
        context: activeScenario.context,
        conversation_history: history,
        session_id: sessionId,
        scenario_id: activeScenarioId,
      })

      // Capture session ID from first response — reuse it for all subsequent turns
      if (!sessionId) setSessionId(result.session_id)

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.response,
          verdict: result.verdict,
          meta: {
            latency_ms: result.latency_ms,
            total_tokens: result.total_tokens,
            retried: result.retried,
            model: result.model,
            run_id: result.run_id,
          },
          system_prompt: result.system_prompt,
          resolution_path: result.resolution_path,
          tool_calls: result.tool_calls,
        },
      ])
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(parseErrorMessage(rawMsg))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b flex-shrink-0">
        <h1 className="text-xl font-semibold">Support Chat</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Submit a ticket — every response is verified against the behavioral spec in real time.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT: Chat ── */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-border">

          {/* Scenario picker */}
          <ScenarioPicker
            scenarios={scenarios}
            activeId={activeScenarioId}
            onChange={switchScenario}
            disabled={isLoading}
          />

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <MessageSquare className="h-10 w-10 text-muted-foreground/20 mb-4" />
                <p className="text-base font-medium text-foreground">How can we help?</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs leading-relaxed">
                  {activeScenario.hint}
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              const isLastSeed = isDefaultScenario && i === 1 && messages.length === 2
              return (
                <div key={i}>
                  <div className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      msg.role === 'user' ? 'text-white rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm',
                    )}
                      style={msg.role === 'user' ? { backgroundColor: '#0D9488' } : undefined}>
                      {msg.content}
                    </div>
                  </div>
                  {isLastSeed && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 border-t border-dashed border-border" />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        example conversation — send a message below to see live scoring
                      </span>
                      <div className="flex-1 border-t border-dashed border-border" />
                    </div>
                  )}
                </div>
              )
            })}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex flex-col gap-2 w-56">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Generating response…</span>
                  </div>
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-2.5 w-4/5" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-4 mb-2 rounded-lg px-3 py-2.5"
              style={{ backgroundColor: '#F59E0B18', borderLeft: '3px solid #F59E0B' }}>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
                <span className="flex-1 text-xs leading-snug" style={{ color: '#D97706' }}>{error.message}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => handleSend(lastUserMessage)}
                    className="text-xs font-semibold underline underline-offset-2 hover:opacity-70"
                    style={{ color: '#D97706' }}>Retry</button>
                  <button onClick={() => setError(null)} aria-label="Dismiss">
                    <X className="h-3 w-3" style={{ color: '#D97706' }} />
                  </button>
                </div>
              </div>
              {error.canEscalate && (
                <div className="mt-1.5 ml-6 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>Need immediate help?</span>
                  <span className="font-medium" style={{ color: '#0D9488' }}>📞 +1 (555) 000-0000</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="font-medium" style={{ color: '#0D9488' }}>✉ support@yourdomain.com</span>
                </div>
              )}
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-border p-4 space-y-3 bg-card flex-shrink-0">
            <p className="text-xs text-muted-foreground/70">
              Try <span className="font-medium text-foreground">James Rodriguez</span> under Refund &amp; Returns, or <span className="font-medium text-foreground">Priya Patel</span> under Billing &amp; Charges — the two scenarios from the article.
            </p>
            <select
              value={ticketType}
              onChange={(e) => switchTicketType(e.target.value as TicketTypeValue)}
              disabled={isLoading}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 disabled:opacity-50 cursor-pointer"
            >
              {TICKET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); if (error) setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Describe your issue…"
                rows={2}
                disabled={isLoading}
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 disabled:opacity-50"
              />
              <Button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim()}
                className="self-end h-9 px-4 text-white rounded-xl"
                style={{ backgroundColor: '#0D9488' }}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Behavioral Scorecard ── */}
        <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden">
          <OperatorPanel messages={messages} />
        </div>
      </div>
    </div>
  )
}
