import { useState } from 'react'
import { RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip, PROPERTY_DESCRIPTIONS } from '@/components/ui/score-tooltip'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSnapshots,
  getSnapshotDiff,
  triggerSnapshot,
  type SnapshotResponse,
  type SnapshotDiffResponse,
  type ExampleDiffEntry,
} from '@/lib/api'

// ─── Config ──────────────────────────────────────────────────────────────────

const CATEGORY_TABS = [
  { id: null, label: 'All' },
  { id: 'order_status', label: 'Order Status' },
  { id: 'refund_request', label: 'Refund & Returns' },
  { id: 'billing_dispute', label: 'Billing & Charges' },
  { id: 'escalation', label: 'Escalation' },
]

interface PropertyConfig {
  id: string
  displayName: string
  target: number
  alertThreshold: number
  color: string
}

const PROPERTY_CONFIGS: PropertyConfig[] = [
  { id: 'issue_acknowledged', displayName: 'Issue Acknowledged', target: 0.95, alertThreshold: 0.85, color: '#0D9488' },
  { id: 'resolution_matching', displayName: 'Resolution Matching', target: 0.90, alertThreshold: 0.80, color: '#3B82F6' },
  { id: 'professional_tone', displayName: 'Professional Tone', target: 0.90, alertThreshold: 0.80, color: '#8B5CF6' },
  { id: 'concise_response', displayName: 'Concise Response', target: 0.85, alertThreshold: 0.75, color: '#F59E0B' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score: number, target: number, alertThreshold: number): string {
  if (score >= target) return '#0D9488'
  if (score >= alertThreshold) return '#F59E0B'
  return '#F43F5E'
}

function getScore(snap: SnapshotResponse, propId: string, category: string | null): number {
  return category
    ? (snap.category_scores?.[category]?.[propId] ?? 0)
    : (snap.property_scores[propId] ?? 0)
}

// ─── TrendChart ───────────────────────────────────────────────────────────────
// SVG line chart: trend line + target line + alert threshold line.
// Y range fixed at 60–100% so differences are visible without exaggeration.

const VB_W = 600
const VB_H = 90
const PAD = { top: 8, right: 52, bottom: 22, left: 36 }
const Y_MIN = 0.6
const Y_MAX = 1.0

function chartY(val: number): number {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, val))
  return PAD.top + ((Y_MAX - clamped) / (Y_MAX - Y_MIN)) * (VB_H - PAD.top - PAD.bottom)
}

function chartX(i: number, total: number): number {
  if (total === 1) return PAD.left + (VB_W - PAD.left - PAD.right) / 2
  return PAD.left + (i / (total - 1)) * (VB_W - PAD.left - PAD.right)
}

function TrendChart({
  prop,
  snapshots,
  activeCategory,
  selectedIdx,
  onPointClick,
}: {
  prop: PropertyConfig
  snapshots: SnapshotResponse[]
  activeCategory: string | null
  selectedIdx: number | null
  onPointClick: (idx: number) => void
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const scores = snapshots.map((s) => getScore(s, prop.id, activeCategory))
  const current = scores[scores.length - 1] ?? 0
  const lineColor = scoreColor(current, prop.target, prop.alertThreshold)

  const pts = snapshots.map((s, i) => {
    const score = scores[i] ?? 0
    const prev = scores[i - 1]
    const delta = prev !== undefined ? score - prev : null
    const status =
      score >= prop.target ? 'On target'
      : score >= prop.alertThreshold ? 'Near threshold'
      : 'Below alert'
    const pointColor = scoreColor(score, prop.target, prop.alertThreshold)
    const isBreach = score < prop.alertThreshold
    return {
      x: chartX(i, snapshots.length),
      y: chartY(score),
      score,
      date: s.created_at,
      delta,
      status,
      pointColor,
      isBreach,
    }
  })

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ')
  const areaPath = pts.length > 0
    ? `M ${pts[0].x},${chartY(Y_MIN)} L ${pts.map((p) => `${p.x},${p.y}`).join(' L ')} L ${pts[pts.length - 1].x},${chartY(Y_MIN)} Z`
    : ''

  const targetY = chartY(prop.target)
  const alertY = chartY(prop.alertThreshold)
  const yLabels = [1.0, 0.9, 0.8, 0.7]

  // Tooltip dimensions
  const TIP_W = 110
  const TIP_H = 44

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yLabels.map((v) => (
        <line key={v} x1={PAD.left} x2={VB_W - PAD.right} y1={chartY(v)} y2={chartY(v)} stroke="currentColor" strokeWidth="0.4" className="text-muted-foreground/20" />
      ))}

      {/* Y axis labels */}
      {yLabels.map((v) => (
        <text key={v} x={PAD.left - 4} y={chartY(v) + 3} textAnchor="end" fontSize="7" fill="#9ca3af">
          {(v * 100).toFixed(0)}%
        </text>
      ))}

      {/* Alert threshold line */}
      <line x1={PAD.left} x2={VB_W - PAD.right} y1={alertY} y2={alertY} stroke="#F59E0B" strokeWidth="0.8" strokeDasharray="3,2" />
      <text x={VB_W - PAD.right + 3} y={alertY + 3} fontSize="7" fill="#F59E0B">alert</text>

      {/* Target line */}
      <line x1={PAD.left} x2={VB_W - PAD.right} y1={targetY} y2={targetY} stroke="#0D9488" strokeWidth="0.8" strokeDasharray="5,2" />
      <text x={VB_W - PAD.right + 3} y={targetY + 3} fontSize="7" fill="#0D9488">target</text>

      {/* Area fill */}
      {areaPath && <path d={areaPath} fill={lineColor} fillOpacity="0.06" />}

      {/* Trend line */}
      {pts.length >= 2 && (
        <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* Data points — breach points get a diamond marker, normal get a circle */}
      {pts.map((p, i) => {
        const isSelected = selectedIdx === i
        return (
          <g key={i}>
            {p.isBreach ? (
              <polygon
                points={`${p.x},${p.y - 4.5} ${p.x + 4},${p.y} ${p.x},${p.y + 4.5} ${p.x - 4},${p.y}`}
                fill={hoveredIdx === i || isSelected ? '#F43F5E' : 'white'}
                stroke="#F43F5E"
                strokeWidth={isSelected ? 2.5 : 1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => onPointClick(i)}
              />
            ) : (
              <circle
                cx={p.x}
                cy={p.y}
                r={hoveredIdx === i || isSelected ? 4.5 : 2.5}
                fill={hoveredIdx === i || isSelected ? p.pointColor : 'white'}
                stroke={p.pointColor}
                strokeWidth={isSelected ? 2.5 : 1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => onPointClick(i)}
              />
            )}
            {/* Invisible larger hit area */}
            <circle
              cx={p.x} cy={p.y} r="8"
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onPointClick(i)}
            />
          </g>
        )
      })}

      {/* Hover tooltip — richer context */}
      {hoveredIdx !== null && (() => {
        const p = pts[hoveredIdx]
        const tipX = p.x > VB_W * 0.75 ? p.x - TIP_W - 6 : p.x + 10
        const tipY = p.y > VB_H * 0.55 ? p.y - TIP_H - 4 : p.y + 4
        const deltaStr = p.delta !== null
          ? (p.delta >= 0 ? `▲ +${(p.delta * 100).toFixed(1)}pp` : `▼ ${(p.delta * 100).toFixed(1)}pp`)
          : null
        const deltaColor = p.delta !== null ? (p.delta >= 0 ? '#0D9488' : '#F43F5E') : '#9ca3af'
        const statusColor = p.score >= prop.target ? '#0D9488' : p.score >= prop.alertThreshold ? '#F59E0B' : '#F43F5E'
        return (
          <g>
            <rect x={tipX} y={tipY} width={TIP_W} height={TIP_H} rx="4" fill="#111827" opacity="0.92" />
            {/* Date */}
            <text x={tipX + 7} y={tipY + 12} fontSize="7.5" fill="#9ca3af">
              {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </text>
            {/* Score */}
            <text x={tipX + 7} y={tipY + 25} fontSize="10" fill="white" fontWeight="bold">
              {(p.score * 100).toFixed(1)}%
            </text>
            {/* Status */}
            <text x={tipX + 46} y={tipY + 25} fontSize="7.5" fill={statusColor}>
              {p.status}
            </text>
            {/* Delta from previous */}
            {deltaStr && (
              <text x={tipX + 7} y={tipY + 38} fontSize="7.5" fill={deltaColor}>
                {deltaStr} from prev run
              </text>
            )}
          </g>
        )
      })()}

      {/* X axis: first and last date */}
      {snapshots.length > 0 && (
        <>
          <text x={PAD.left} y={VB_H - 2} fontSize="7" fill="#9ca3af">
            {new Date(snapshots[0].created_at).toLocaleDateString()}
          </text>
          {snapshots.length > 1 && (
            <text x={VB_W - PAD.right} y={VB_H - 2} fontSize="7" fill="#9ca3af" textAnchor="end">
              {new Date(snapshots[snapshots.length - 1].created_at).toLocaleDateString()}
            </text>
          )}
        </>
      )}
    </svg>
  )
}

// ─── DeltaBadge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  const pp = Math.abs(delta * 100).toFixed(1)
  if (delta > 0.005) return (
    <span className="flex items-center gap-0.5 text-xs font-mono" style={{ color: '#0D9488' }}>
      <TrendingUp className="h-3 w-3" />+{pp}pp vs baseline
    </span>
  )
  if (delta < -0.005) return (
    <span className="flex items-center gap-0.5 text-xs font-mono" style={{ color: '#F43F5E' }}>
      <TrendingDown className="h-3 w-3" />−{pp}pp vs baseline
    </span>
  )
  return (
    <span className="flex items-center gap-0.5 text-xs font-mono text-muted-foreground">
      <Minus className="h-3 w-3" />Stable vs baseline
    </span>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

const PROP_LABELS: Record<string, string> = {
  issue_acknowledged: 'Issue Acknowledged',
  resolution_matching: 'Resolution Matching',
  professional_tone: 'Professional Tone',
  concise_response: 'Concise Response',
}

function DiffSection({ title, entries, color }: { title: string; entries: ExampleDiffEntry[]; color: string }) {
  const [expanded, setExpanded] = useState(true)
  if (entries.length === 0) return null
  return (
    <div>
      <button
        className="w-full flex items-center justify-between mb-2 px-2 py-1 rounded hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="flex items-center gap-2">
          <Badge className="text-xs" style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}>
            {title}
          </Badge>
          <span className="text-xs text-muted-foreground">{entries.length} scenario{entries.length !== 1 ? 's' : ''}</span>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div key={i} className="rounded-lg border p-3 text-sm" style={{ borderColor: color + '33', backgroundColor: color + '08' }}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.ticket_type.replace(/_/g, ' ')} · {entry.corpus_example_id}
                </span>
                <span className="font-mono text-xs font-semibold shrink-0" style={{ color }}>
                  {(entry.previous_overall_score * 100).toFixed(1)}% → {(entry.current_overall_score * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-muted-foreground text-xs mb-2 leading-relaxed">
                "{entry.customer_message_truncated}"
              </p>
              {Object.keys(entry.changed_properties).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(entry.changed_properties).map(([prop, delta]) => (
                    <span key={prop} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: color + '15', color }}>
                      {PROP_LABELS[prop] ?? prop} {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}pp
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DriftPage() {
  const queryClient = useQueryClient()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedSnapIdx, setSelectedSnapIdx] = useState<number | null>(null)

  const { data: snapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => getSnapshots('baseline'),
  })

  const runMutation = useMutation({
    mutationFn: () => triggerSnapshot('claude-sonnet-4-5', 'baseline'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
    },
  })

  const isRunning = runMutation.isPending
  const chronological = snapshots ? [...snapshots].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ) : []
  const baseline = chronological[0] ?? null
  const current = chronological[chronological.length - 1] ?? null
  const hasHistory = chronological.length >= 2

  const selectedSnapshot = selectedSnapIdx !== null ? chronological[selectedSnapIdx] : null
  const selectedSnapshotId = selectedSnapshot?.id ?? null

  const { data: diffData, isLoading: diffLoading } = useQuery<SnapshotDiffResponse>({
    queryKey: ['snapshot-diff', selectedSnapshotId],
    queryFn: () => getSnapshotDiff(selectedSnapshotId!),
    enabled: selectedSnapshotId != null,
    retry: false,  // 409 (first snapshot) should not retry
  })

  const handlePointClick = (snapIdx: number) => {
    setSelectedSnapIdx(prev => prev === snapIdx ? null : snapIdx)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="p-6 border-b flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Baseline &amp; Drift</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Is the model behaving the same way it did when you last set a baseline?
          </p>
        </div>
        <Button
          className="text-white mt-1"
          style={{ backgroundColor: '#0D9488' }}
          onClick={() => runMutation.mutate()}
          disabled={isRunning}
        >
          {isRunning ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Running...</>
          ) : (
            <><RefreshCw className="h-4 w-4 mr-1.5" />Run Now</>
          )}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Section 1: Current vs. Baseline ─────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Current vs. Baseline
            <InfoTooltip text="Baseline = the earliest snapshot in history. Current = most recent run. Delta shows how much each property has moved since you started tracking." />
          </p>
          {snapshotsLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
            </div>
          ) : !current ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No snapshots yet. Click <strong>Run Now</strong> to capture the first baseline.
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {PROPERTY_CONFIGS.map((prop) => {
                const curr = getScore(current, prop.id, activeCategory)
                const base = baseline ? getScore(baseline, prop.id, activeCategory) : curr
                const delta = curr - base
                const color = scoreColor(curr, prop.target, prop.alertThreshold)
                return (
                  <Card key={prop.id}>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                        {prop.displayName}
                        <InfoTooltip text={PROPERTY_DESCRIPTIONS[prop.id] ?? prop.displayName} side="top" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-2xl font-semibold font-mono" style={{ color }}>
                        {(curr * 100).toFixed(1)}%
                      </p>
                      <div className="mt-1">
                        <DeltaBadge delta={delta} />
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Section 2: Trend Charts ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-sm font-medium flex items-center">
                14-Day Behavioral Trend
                <InfoTooltip text="Each point is one full test suite run (36 scenarios). The dashed line is the target; the dotted line is the alert threshold. A drop below the amber line triggers an incident." />
              </CardTitle>
              {/* Category filter — single location */}
              <div className="flex gap-1.5 flex-wrap">
                {CATEGORY_TABS.map((cat) => (
                  <button
                    key={String(cat.id)}
                    onClick={() => setActiveCategory(cat.id)}
                    className={cn(
                      'text-xs px-3 py-1 rounded-full border transition-colors',
                      activeCategory === cat.id
                        ? 'text-white border-transparent'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    style={activeCategory === cat.id ? { backgroundColor: '#0D9488', borderColor: '#0D9488' } : undefined}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {snapshotsLoading ? (
              <div className="space-y-8">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i}>
                    <Skeleton className="h-3 w-36 mb-2" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ))}
              </div>
            ) : !hasHistory ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Need at least 2 snapshots to draw a trend. Run the test suite again to see history.
              </p>
            ) : (
              <div className="space-y-6">
                {PROPERTY_CONFIGS.map((prop) => {
                  const curr = current ? getScore(current, prop.id, activeCategory) : 0
                  const color = scoreColor(curr, prop.target, prop.alertThreshold)
                  return (
                    <div key={prop.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold" style={{ color: prop.color }}>
                          {prop.displayName}
                        </span>
                        <span className="text-xs font-mono font-semibold" style={{ color }}>
                          {(curr * 100).toFixed(1)}% now
                        </span>
                      </div>
                      <TrendChart
                        prop={prop}
                        snapshots={chronological}
                        activeCategory={activeCategory}
                        selectedIdx={selectedSnapIdx}
                        onPointClick={handlePointClick}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 3: Run Detail Panel ───────────────────────────────────── */}
        {selectedSnapshot && (
          <Card>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  Run Detail
                  <span className="text-xs font-normal text-muted-foreground font-mono">
                    {new Date(selectedSnapshot.created_at).toLocaleString()}
                  </span>
                </CardTitle>
                <button
                  className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedSnapIdx(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {diffLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}
              {!diffLoading && !diffData && (
                <p className="text-sm text-muted-foreground">
                  No comparison data available — this may be the earliest snapshot or predates per-example tracking.
                </p>
              )}
              {diffData && diffData.total_changed === 0 && (
                <div className="flex items-center gap-3 rounded-lg border p-4" style={{ borderColor: '#0D9488', backgroundColor: '#0D948811' }}>
                  <span className="text-lg">✓</span>
                  <p className="text-sm text-muted-foreground">
                    No meaningful changes vs the previous run — all 36 scenarios performed similarly.
                  </p>
                </div>
              )}
              {diffData && diffData.total_changed > 0 && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Comparing vs run from <span className="font-mono">{new Date(diffData.previous_snapshot_created_at).toLocaleString()}</span>
                    {' '}— <strong>{diffData.total_changed}</strong> scenario{diffData.total_changed !== 1 ? 's' : ''} changed.
                  </p>
                  <DiffSection title="Newly Failed" entries={diffData.newly_failed} color="#F43F5E" />
                  <DiffSection title="Newly Recovered" entries={diffData.newly_recovered} color="#0D9488" />
                  <DiffSection title="Degraded" entries={diffData.degraded} color="#F59E0B" />
                  <DiffSection title="Improved" entries={diffData.improved} color="#3B82F6" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  )
}
