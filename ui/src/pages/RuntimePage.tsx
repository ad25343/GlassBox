import { useState, useRef, useEffect } from 'react'
import { CheckCircle2, XCircle, Send, Loader2, Terminal, ChevronDown, ChevronRight, AlertTriangle, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  submitTicket,
  type JudgeVerdict,
  type RunResponse,
} from '@/lib/api'

type TicketTypeValue = 'order_status' | 'refund_request' | 'billing_dispute' | 'escalation'

interface MessageMeta {
  latency_ms: number
  total_tokens: number
  retried: boolean
  model: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  verdict?: JudgeVerdict
  meta?: MessageMeta
  system_prompt?: string
  resolution_path?: string
}

const TICKET_TYPES: { value: TicketTypeValue; label: string }[] = [
  { value: 'order_status', label: 'Order Status' },
  { value: 'refund_request', label: 'Refund Request' },
  { value: 'billing_dispute', label: 'Billing Dispute' },
  { value: 'escalation', label: 'Escalation' },
]

const SEED_MESSAGES: Message[] = [
  {
    role: 'user',
    content: "My order #4821 hasn't arrived and it's been 10 days. Can you help?",
  },
  {
    role: 'assistant',
    content:
      "I'm sorry to hear your order hasn't arrived yet. I've looked up order #4821 and can see it shipped via FedEx on March 25th with tracking number 7489234723. According to the carrier, your package is currently in transit and is estimated to arrive by end of day tomorrow. If it doesn't arrive within 48 hours, please reach back out and we'll arrange a replacement or full refund. Is there anything else I can help you with?",
  },
]

function formatKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function scoreColor(score: number, target: number, alertThreshold: number): string {
  if (score >= target) return '#0D9488'
  if (score >= alertThreshold) return '#F59E0B'
  return '#F43F5E'
}

function VerdictPanel({ verdict, meta }: { verdict: JudgeVerdict; meta?: MessageMeta }) {
  const conformanceColor = scoreColor(verdict.overall_conformance, 0.9, 0.8)

  return (
    <div className="space-y-5">
      {/* Overall conformance */}
      <div className="flex items-center justify-between rounded-md px-3 py-2" style={{ backgroundColor: conformanceColor + '22' }}>
        <span className="text-sm font-semibold" style={{ color: conformanceColor }}>
          Overall Conformance
        </span>
        <span className="text-2xl font-bold" style={{ color: conformanceColor }}>
          {(verdict.overall_conformance * 100).toFixed(1)}%
        </span>
      </div>

      {/* Non-Negotiables */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Non-Negotiables
        </p>
        <div className="space-y-2">
          {Object.entries(verdict.non_negotiable_results).map(([key, result]) => (
            <div key={key}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {result.passed ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: '#0D9488' }} />
                  ) : (
                    <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: '#F43F5E' }} />
                  )}
                  <span className="text-xs text-foreground truncate">{formatKey(key)}</span>
                </div>
                <Badge
                  className="text-xs flex-shrink-0"
                  style={
                    result.passed
                      ? { backgroundColor: '#0D9488', color: '#fff' }
                      : { backgroundColor: '#F43F5E', color: '#fff' }
                  }
                >
                  {result.passed ? 'PASS' : 'FAIL'}
                </Badge>
              </div>
              {result.reasoning && (
                <p className="text-[11px] text-muted-foreground mt-0.5 ml-6 leading-relaxed">
                  {result.reasoning}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Behavioral Properties */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Behavioral Properties
        </p>
        <div className="space-y-3">
          {Object.entries(verdict.behavioral_scores).map(([key, bs]) => {
            const color = scoreColor(bs.score, 0.85, 0.75)
            return (
              <div key={key}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-foreground">{formatKey(key)}</span>
                  <span className="text-xs font-mono font-medium" style={{ color }}>
                    {(bs.score * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${bs.score * 100}%`, backgroundColor: color }}
                  />
                </div>
                {bs.reasoning && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {bs.reasoning}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Stats */}
      {meta && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Stats
          </p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Latency</span>
              <span className="font-mono">{meta.latency_ms}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tokens</span>
              <span className="font-mono">{meta.total_tokens}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono">{meta.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Retried</span>
              <span className="font-mono">{meta.retried ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface InternalsPanelProps {
  verdict: JudgeVerdict
  system_prompt: string
  resolution_path: string
}

function InternalsPanel({ verdict, system_prompt, resolution_path }: InternalsPanelProps) {
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const [judgeOpen, setJudgeOpen] = useState(true)
  const [rawJsonOpen, setRawJsonOpen] = useState(false)

  return (
    <div className="border rounded-lg bg-card">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Terminal className="h-4 w-4" style={{ color: '#0D9488' }} />
        <span className="text-sm font-semibold">Under the Hood</span>
      </div>

      <div className="divide-y">
        {/* Section 1: System Prompt */}
        <div>
          <button
            onClick={() => setSystemPromptOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
          >
            <span className="text-xs font-medium text-foreground">System Prompt sent to Claude Sonnet</span>
            {systemPromptOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}
          </button>
          {systemPromptOpen && (
            <div className="px-4 pb-3 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ color: '#0D9488', backgroundColor: '#0D948822' }}
                >
                  Resolution Path
                </span>
                <span className="text-[11px] text-muted-foreground">{resolution_path}</span>
              </div>
              <pre className="text-xs font-mono bg-muted rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
                {system_prompt}
              </pre>
            </div>
          )}
        </div>

        {/* Section 2: Judge Evaluation */}
        <div>
          <button
            onClick={() => setJudgeOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
          >
            <span className="text-xs font-medium text-foreground">Judge Prompt (Claude Haiku evaluated this)</span>
            {judgeOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}
          </button>
          {judgeOpen && (
            <div className="px-4 pb-3 space-y-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                The judge receives the customer message, resolution path, and response — then scores each property independently.
              </p>

              {/* Non-negotiable violation banner */}
              {verdict.any_non_negotiable_failed ? (
                <div
                  className="flex items-start gap-2 rounded px-3 py-2 text-[11px] leading-snug"
                  style={{ backgroundColor: '#F59E0B22', color: '#D97706' }}
                >
                  <span>⚠️</span>
                  <span>Non-negotiable violation detected — response was retried</span>
                </div>
              ) : (
                <div
                  className="flex items-start gap-2 rounded px-3 py-2 text-[11px] leading-snug"
                  style={{ backgroundColor: '#0D948822', color: '#0D9488' }}
                >
                  <span>✓</span>
                  <span>All non-negotiables passed on first attempt</span>
                </div>
              )}

              {/* Non-negotiable results */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Non-Negotiables
                </p>
                {Object.entries(verdict.non_negotiable_results).map(([key, result]) => (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      {result.passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#0D9488' }} />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#F43F5E' }} />
                      )}
                      <span className="text-[11px] font-medium text-foreground">{formatKey(key)}</span>
                      <span
                        className="text-[10px] font-mono font-semibold ml-auto"
                        style={{ color: result.passed ? '#0D9488' : '#F43F5E' }}
                      >
                        {result.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    {result.reasoning && (
                      <p className="text-[11px] text-muted-foreground ml-5 leading-relaxed">
                        {result.reasoning}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Behavioral scores */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Behavioral Scores
                </p>
                {Object.entries(verdict.behavioral_scores).map(([key, bs]) => {
                  const color = scoreColor(bs.score, 0.85, 0.75)
                  return (
                    <div key={key} className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-foreground">{formatKey(key)}</span>
                        <span className="text-[10px] font-mono font-semibold ml-auto" style={{ color }}>
                          {(bs.score * 100).toFixed(1)}%
                        </span>
                      </div>
                      {bs.reasoning && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {bs.reasoning}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Raw Verdict JSON */}
        <div>
          <button
            onClick={() => setRawJsonOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
          >
            <span className="text-xs font-medium text-foreground">Raw Judge Verdict JSON</span>
            {rawJsonOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}
          </button>
          {rawJsonOpen && (
            <div className="px-4 pb-3">
              <pre className="text-xs font-mono bg-muted rounded p-3 overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(verdict, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function parseErrorMessage(raw: string): string {
  if (raw.includes('500') || raw.toLowerCase().includes('failed to process')) {
    return 'Something went wrong on our end. Please try again.'
  }
  if (raw.includes('401') || raw.toLowerCase().includes('authentication')) {
    return 'API key issue — check your configuration.'
  }
  if (raw.includes('429')) {
    return 'Rate limit reached. Please wait a moment and try again.'
  }
  if (raw.toLowerCase().includes('network') || raw.toLowerCase().includes('fetch')) {
    return 'Could not reach the server. Is it running?'
  }
  return 'Request failed. Please try again.'
}

export default function TryItPage() {
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES)
  const [input, setInput] = useState('')
  const [ticketType, setTicketType] = useState<TicketTypeValue>('order_status')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUserMessage, setLastUserMessage] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const latestVerdict = messages
    .slice()
    .reverse()
    .find((m) => m.role === 'assistant' && m.verdict)

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
      const result: RunResponse = await submitTicket({
        customer_message: trimmed,
        ticket_type: ticketType,
        context: {},
      })

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
          },
          system_prompt: result.system_prompt,
          resolution_path: result.resolution_path,
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
      <div className="p-6 border-b">
        <h1 className="text-xl font-semibold">Live Runtime</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Submit a real support ticket. Watch the response — and the verification.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 gap-6 p-6 overflow-hidden">
        {/* Left: Chat panel */}
        <div className="flex flex-col flex-1 min-w-0">
          <Card className="flex flex-col flex-1 overflow-hidden">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm font-medium">Support Chat</CardTitle>
            </CardHeader>

            {/* Scrollable messages */}
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed',
                      msg.role === 'user' ? 'text-white' : 'bg-muted text-foreground',
                    )}
                    style={msg.role === 'user' ? { backgroundColor: '#0D9488' } : undefined}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-4 py-3 flex flex-col gap-2 text-sm text-muted-foreground w-64">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                      Generating response...
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </CardContent>

            {/* Error banner */}
            {error && (
              <div
                className="mx-4 mb-0 mt-2 flex items-start gap-3 rounded-md px-3 py-2.5 text-sm"
                style={{ backgroundColor: '#F59E0B22', color: '#D97706', borderLeft: '3px solid #F59E0B' }}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
                <span className="flex-1 leading-snug">{error}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleSend(lastUserMessage)}
                    className="text-xs font-semibold underline underline-offset-2 hover:opacity-70 transition-opacity"
                    style={{ color: '#D97706' }}
                  >
                    Try again
                  </button>
                  <button
                    onClick={() => setError(null)}
                    className="hover:opacity-70 transition-opacity"
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5" style={{ color: '#D97706' }} />
                  </button>
                </div>
              </div>
            )}

            {/* Input row */}
            <div className="border-t p-4 space-y-2">
              <select
                value={ticketType}
                onChange={(e) => setTicketType(e.target.value as TicketTypeValue)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2"
              >
                {TICKET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    if (error) setError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Describe your issue…"
                  rows={2}
                  disabled={isLoading}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 disabled:opacity-50"
                />
                <Button
                  onClick={() => handleSend()}
                  disabled={isLoading || !input.trim()}
                  className="self-end text-white"
                  style={{ backgroundColor: '#0D9488' }}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-1" />
                      Send
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Verification + Internals panel */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-4 overflow-y-auto">
          {/* Retry banner */}
          {latestVerdict?.meta?.retried && (
            <div
              className="rounded-md px-4 py-3 text-xs leading-relaxed"
              style={{ backgroundColor: '#F59E0B22', color: '#D97706', borderLeft: '3px solid #F59E0B' }}
            >
              <p className="font-semibold mb-0.5">⚠ This response was retried</p>
              <p>
                The first attempt violated a non-negotiable rule. The system detected the violation
                and automatically corrected the response.
              </p>
            </div>
          )}

          {/* Verification Results */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm font-medium">Verification Results</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {latestVerdict?.verdict ? (
                <VerdictPanel verdict={latestVerdict.verdict} meta={latestVerdict.meta} />
              ) : (
                <div className="py-8 flex items-center justify-center">
                  <p className="text-sm text-muted-foreground text-center px-4">
                    Submit a new ticket to see live verification
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Internals panel */}
          {latestVerdict?.verdict && latestVerdict.system_prompt && latestVerdict.resolution_path ? (
            <InternalsPanel
              verdict={latestVerdict.verdict}
              system_prompt={latestVerdict.system_prompt}
              resolution_path={latestVerdict.resolution_path}
            />
          ) : (
            <div className="rounded-md border border-dashed border-border px-4 py-5 text-center">
              <p className="text-xs text-muted-foreground">
                Internals will appear here after you submit a ticket.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
