import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus, X, ChevronDown, ChevronUp, Settings2, Check, Loader2 } from 'lucide-react'
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
  getSpec,
  updateThresholds,
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

// Static display config (colors + display names) — targets come from spec
const PROPERTY_META: Record<string, { displayName: string; color: string }> = {
  issue_acknowledged: { displayName: 'Issue Acknowledged', color: '#0D9488' },
  resolution_matching: { displayName: 'Resolution Matching', color: '#3B82F6' },
  professional_tone:   { displayName: 'Professional Tone',  color: '#8B5CF6' },
  concise_response:    { displayName: 'Concise Response',   color: '#F59E0B' },
}

// Fallback if spec hasn't loaded yet
const DEFAULT_PROPERTY_CONFIGS: PropertyConfig[] = [
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
      <TrendingUp className="h-3 w-3" />+{pp}pp vs target
    </span>
  )
  if (delta < -0.005) return (
    <span className="flex items-center gap-0.5 text-xs font-mono" style={{ color: '#F43F5E' }}>
      <TrendingDown className="h-3 w-3" />−{pp}pp vs target
    </span>
  )
  return (
    <span className="flex items-center gap-0.5 text-xs font-mono text-muted-foreground">
      <Minus className="h-3 w-3" />On target
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
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5')
  const [editingThresholds, setEditingThresholds] = useState(false)
  const [draftThresholds, setDraftThresholds] = useState<Record<string, { target: number; alert_threshold: number }>>({})

  const { data: allSnapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['snapshots', 'test'],
    queryFn: () => getSnapshots('test'),
  })

  // Filter to the selected model
  const snapshots = allSnapshots?.filter((s) => s.model === selectedModel)

  const { data: spec } = useQuery({
    queryKey: ['spec'],
    queryFn: getSpec,
  })

  // Derive live property configs from spec, falling back to defaults
  const PROPERTY_CONFIGS: PropertyConfig[] = spec?.behavioral_properties
    ? spec.behavioral_properties.map((p) => ({
        id: p.id,
        displayName: PROPERTY_META[p.id]?.displayName ?? p.name,
        target: p.target,
        alertThreshold: p.alert_threshold,
        color: PROPERTY_META[p.id]?.color ?? '#9ca3af',
      }))
    : DEFAULT_PROPERTY_CONFIGS

  const saveMutation = useMutation({
    mutationFn: () =>
      updateThresholds(
        PROPERTY_CONFIGS.map((p) => ({
          id: p.id,
          target: draftThresholds[p.id]?.target ?? p.target,
          alert_threshold: draftThresholds[p.id]?.alert_threshold ?? p.alertThreshold,
        }))
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spec'] })
      setEditingThresholds(false)
      setDraftThresholds({})
    },
  })

  // Sync draft from spec when opening editor
  useEffect(() => {
    if (editingThresholds) {
      const draft: Record<string, { target: number; alert_threshold: number }> = {}
      for (const p of PROPERTY_CONFIGS) {
        draft[p.id] = { target: p.target, alert_threshold: p.alertThreshold }
      }
      setDraftThresholds(draft)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingThresholds])

  const chronological = snapshots ? [...snapshots].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ) : []
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
      <div className="p-6 border-b">
        <h1 className="text-xl font-semibold">Baseline &amp; Drift</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Is the model hitting its targets? How has it trended over time?
        </p>
        <div className="flex items-center gap-3 mt-3">
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); setSelectedSnapIdx(null) }}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 hover:border-foreground/30 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Runs triggered from{' '}
            <a href="/test-suite" className="underline underline-offset-2 hover:text-foreground transition-colors">
              Model Evaluation
            </a>
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Passing Thresholds ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Passing Thresholds
                <InfoTooltip text="The score each property must reach to be considered passing. Edit these to match your quality bar — they're saved to the behavioral spec." />
              </CardTitle>
              {!editingThresholds ? (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditingThresholds(true)}>
                  <Settings2 className="h-3.5 w-3.5" />Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setEditingThresholds(false); setDraftThresholds({}) }}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-7 gap-1.5 text-xs text-white" style={{ backgroundColor: '#0D9488' }}
                    onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Property</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target (A grade)</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Alert threshold</th>
                </tr>
              </thead>
              <tbody>
                {PROPERTY_CONFIGS.map((prop) => {
                  const draft = draftThresholds[prop.id]
                  const targetVal = draft?.target ?? prop.target
                  const alertVal = draft?.alert_threshold ?? prop.alertThreshold
                  return (
                    <tr key={prop.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-xs" style={{ color: prop.color }}>{prop.displayName}</span>
                      </td>
                      <td className="px-4 py-3">
                        {editingThresholds ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min={0} max={100} step={1}
                              value={Math.round(targetVal * 100)}
                              onChange={(e) => setDraftThresholds((d) => ({
                                ...d,
                                [prop.id]: { target: Number(e.target.value) / 100, alert_threshold: d[prop.id]?.alert_threshold ?? prop.alertThreshold }
                              }))}
                              className="w-16 rounded border border-border bg-background px-2 py-1 text-xs font-mono text-center focus:outline-none focus:ring-1"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        ) : (
                          <span className="font-mono text-xs font-semibold" style={{ color: '#0D9488' }}>{(prop.target * 100).toFixed(0)}%</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingThresholds ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min={0} max={100} step={1}
                              value={Math.round(alertVal * 100)}
                              onChange={(e) => setDraftThresholds((d) => ({
                                ...d,
                                [prop.id]: { target: d[prop.id]?.target ?? prop.target, alert_threshold: Number(e.target.value) / 100 }
                              }))}
                              className="w-16 rounded border border-border bg-background px-2 py-1 text-xs font-mono text-center focus:outline-none focus:ring-1"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        ) : (
                          <span className="font-mono text-xs" style={{ color: '#F59E0B' }}>{(prop.alertThreshold * 100).toFixed(0)}%</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* ── Section 1: Current vs. Target ───────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Current vs. Target
            <InfoTooltip text="Target = the passing threshold for each property (defined in the behavioral spec). Delta shows how much the latest run is above or below the target." />
          </p>
          {snapshotsLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
            </div>
          ) : !current ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No runs yet for this model. Go to <a href="/test-suite" className="underline underline-offset-2 hover:text-foreground">Model Evaluation</a> to run the test suite.
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {PROPERTY_CONFIGS.map((prop) => {
                const curr = getScore(current, prop.id, activeCategory)
                const delta = curr - prop.target
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
                      <p className="text-xs text-muted-foreground mt-0.5">target: {(prop.target * 100).toFixed(0)}%</p>
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
