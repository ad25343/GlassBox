import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react'
import { getSpec, type BehavioralSpec } from '@/lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ScoreRing({ value, color }: { value: number; color: string }) {
  const pct = Math.round(value * 100)
  const r = 20
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="56" height="56" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor"
          strokeWidth="4" className="text-muted/40" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color}
          strokeWidth="4" strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function NonNegotiablesSection({ items }: { items: BehavioralSpec['non_negotiables'] }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <ShieldAlert className="h-5 w-5 flex-shrink-0" style={{ color: '#F43F5E' }} />
        <div>
          <h2 className="text-base font-semibold">Non-Negotiables</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Binary pass/fail. Zero tolerance. A single violation triggers an automatic retry.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((nn) => (
          <div key={nn.id} className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold leading-snug">{nn.name}</p>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 text-white"
                style={{ backgroundColor: '#F43F5E' }}>
                ZERO TOLERANCE
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{nn.description}</p>
            <div className="space-y-1.5 pt-1 border-t border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                How it's enforced
              </p>
              {[
                'Included in the system prompt',
                'Independently verified by the judge',
                'Retry fired if violated',
              ].map((step) => (
                <div key={step} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 flex-shrink-0" style={{ color: '#0D9488' }} />
                  {step}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function BehavioralPropertiesSection({ items }: { items: BehavioralSpec['behavioral_properties'] }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <TrendingUp className="h-5 w-5 flex-shrink-0" style={{ color: '#0D9488' }} />
        <div>
          <h2 className="text-base font-semibold">Behavioral Properties</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scored 0–1 by the judge on every response. Tracked over time for drift.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((bp) => {
          const targetPct  = Math.round(bp.target * 100)
          const alertPct   = Math.round(bp.alert_threshold * 100)
          return (
            <div key={bp.id} className="rounded-xl border border-border p-4 flex gap-4">
              <div className="flex-shrink-0 pt-1">
                <ScoreRing value={bp.target} color="#0D9488" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm font-semibold">{bp.name}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{bp.description}</p>
                <div className="flex gap-3 pt-1">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Target</p>
                    <p className="text-xs font-bold" style={{ color: '#0D9488' }}>{targetPct}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Alert below</p>
                    <p className="text-xs font-bold" style={{ color: '#F59E0B' }}>{alertPct}%</p>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Framework loop ───────────────────────────────────────────────────────────

const LOOP_STEPS = [
  { label: 'Spec',      desc: 'Non-negotiables + behavioral properties define what good looks like', color: '#0D9488' },
  { label: 'Runtime',   desc: 'System prompt constructed from spec + resolution path + customer context', color: '#3B82F6' },
  { label: 'Model',     desc: 'Claude Sonnet generates a response', color: '#8B5CF6' },
  { label: 'Judge',     desc: 'Claude Haiku independently scores every response against the spec', color: '#F59E0B' },
  { label: 'Verdict',   desc: 'Per-property scores + pass/fail on non-negotiables', color: '#F59E0B' },
  { label: 'Pass',      desc: 'Log to database → return to customer', color: '#0D9488' },
  { label: 'Fail',      desc: 'Retry once with a correction instruction → re-score', color: '#F43F5E' },
]

function FrameworkLoop() {
  return (
    <section className="rounded-xl border border-border p-6">
      <h2 className="text-base font-semibold mb-1">The Framework Loop</h2>
      <p className="text-xs text-muted-foreground mb-6">
        Every response goes through this cycle. The spec is the anchor — everything else is verification.
      </p>

      <div className="flex flex-col gap-0">
        {LOOP_STEPS.map((step, i) => (
          <div key={step.label} className="flex gap-4 items-start">
            {/* Connector */}
            <div className="flex flex-col items-center flex-shrink-0 w-8">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: step.color }}>
                {i + 1}
              </div>
              {i < LOOP_STEPS.length - 1 && (
                <div className="w-px flex-1 my-1" style={{ backgroundColor: step.color, opacity: 0.25, minHeight: 16 }} />
              )}
            </div>
            {/* Content */}
            <div className="pb-4">
              <p className="text-sm font-semibold">{step.label}</p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpecPage() {
  const { data: spec, isLoading, error } = useQuery({
    queryKey: ['spec'],
    queryFn: getSpec,
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b flex-shrink-0">
        <h1 className="text-xl font-semibold">Behavioral Spec</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The contract that governs every response.{' '}
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">spec.json</span>
          {spec && (
            <span className="ml-2 text-xs text-muted-foreground/60">v{spec.version}</span>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-4xl">
        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading spec…</div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm" style={{ color: '#F43F5E' }}>
            <AlertTriangle className="h-4 w-4" />
            Failed to load spec.json
          </div>
        )}
        {spec && (
          <>
            <NonNegotiablesSection items={spec.non_negotiables} />
            <BehavioralPropertiesSection items={spec.behavioral_properties} />
            <FrameworkLoop />
          </>
        )}
      </div>
    </div>
  )
}
