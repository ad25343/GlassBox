import { type ReactNode } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

// ─── Property descriptions ───────────────────────────────────────────────────
// Single source of truth used across Test Suite, Drift, Compare, and Monitor.

export const PROPERTY_DESCRIPTIONS: Record<string, string> = {
  issue_acknowledged:
    "Did the model explicitly acknowledge the customer's issue before jumping to a resolution? A score of 95% means 34 of 36 test cases passed. Target ≥ 95%, alert below 85%.",
  resolution_matching:
    'Did the proposed resolution match the recommended path for this ticket type — correct policy, correct action, no hallucinated steps? Target ≥ 90%, alert below 80%.',
  professional_tone:
    'Was the response professional and empathetic throughout — not robotic, not dismissive, not overly casual? Target ≥ 90%, alert below 80%.',
  concise_response:
    'Was the response appropriately brief — no filler phrases, unnecessary repetition, or over-explanation? Verbosity is a real cost in production. Target ≥ 85%, alert below 75%.',
}

// ─── InfoTooltip ─────────────────────────────────────────────────────────────
// Small "?" badge that shows explanatory text on hover.

export function InfoTooltip({
  text,
  side = 'right',
}: {
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border text-muted-foreground cursor-help text-[9px] font-bold ml-1.5 opacity-40 hover:opacity-100 transition-opacity select-none">
            ?
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[240px] leading-relaxed text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─── ScoreTooltip ─────────────────────────────────────────────────────────────
// Wraps any element (score bar, percentage) and shows context on hover:
// how many of 36 test cases passed, status vs. target, and thresholds.

export function ScoreTooltip({
  value,
  target,
  alertThreshold,
  children,
}: {
  value: number
  target: number
  alertThreshold: number
  children: ReactNode
}) {
  const pct = (value * 100).toFixed(1)
  const approxPassed = Math.round(value * 36)
  const status =
    value >= target
      ? 'On target'
      : value >= alertThreshold
        ? 'Below target — monitor'
        : 'Below alert threshold'
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs leading-relaxed">
          <p className="font-semibold">
            ~{approxPassed} of 36 test cases passed ({pct}%)
          </p>
          <p className="opacity-75 mt-0.5">
            The test suite runs 36 labeled customer support scenarios through the model. Each is
            graded pass/fail by the judge on this criterion.
          </p>
          <p className="opacity-75 mt-0.5">
            {status} · Target ≥ {(target * 100).toFixed(0)}% · alert &lt;{' '}
            {(alertThreshold * 100).toFixed(0)}%
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
