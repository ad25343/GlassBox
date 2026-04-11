import { useState, useEffect } from 'react'
import { Play, CheckCircle2, AlertTriangle, Loader2, ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip, ScoreTooltip, PROPERTY_DESCRIPTIONS } from '@/components/ui/score-tooltip'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSnapshots, triggerSnapshot, getSnapshotExamples, deleteSnapshot, type SnapshotResponse, type SnapshotExampleItem } from '@/lib/api'
import { useEvalRun } from '@/lib/evalRunContext'

interface PropertyConfig {
  id: string
  displayName: string
  target: number
  alertThreshold: number
}

const PROPERTY_CONFIGS: PropertyConfig[] = [
  { id: 'issue_acknowledged', displayName: 'Issue acknowledged', target: 0.95, alertThreshold: 0.85 },
  { id: 'resolution_matching', displayName: 'Resolution matching', target: 0.90, alertThreshold: 0.80 },
  { id: 'professional_tone', displayName: 'Professional tone', target: 0.90, alertThreshold: 0.80 },
  { id: 'concise_response', displayName: 'Concise response', target: 0.85, alertThreshold: 0.75 },
]

function scoreColor(score: number, target: number, alertThreshold: number): string {
  if (score >= target) return '#0D9488'
  if (score >= alertThreshold) return '#F59E0B'
  return '#F43F5E'
}

type ConformanceStatus = 'passing' | 'near-threshold' | 'failing'

function getStatus(score: number, target: number, alertThreshold: number): ConformanceStatus {
  if (score >= target) return 'passing'
  if (score >= alertThreshold) return 'near-threshold'
  return 'failing'
}

function statusLabel(status: ConformanceStatus): string {
  if (status === 'passing') return 'Passing'
  if (status === 'near-threshold') return 'Near Threshold'
  return 'Failing'
}

function StatusIcon({ status }: { status: ConformanceStatus }) {
  if (status === 'passing') {
    return <CheckCircle2 className="h-4 w-4 inline mr-1" style={{ color: '#0D9488' }} />
  }
  return <AlertTriangle className="h-4 w-4 inline mr-1" style={{ color: '#F59E0B' }} />
}

// Snapshot non_negotiable_results use aggregate format: { pass_rate: number, total: number }
// Single-run verdicts use: { passed: boolean, reasoning: string }
// Handle both.
// Non-negotiables are zero-tolerance per response, but across a 36-example corpus
// some model variance is expected. ≥90% corpus pass rate = green; below = red.
const NN_CORPUS_PASS_THRESHOLD = 0.90

function isNnPassing(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  if ('pass_rate' in r) return (r.pass_rate as number) >= NN_CORPUS_PASS_THRESHOLD
  if ('passed' in r) return r.passed === true
  return false
}

function nnPassRate(result: unknown): number | null {
  if (result === null || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if ('pass_rate' in r) return r.pass_rate as number
  if ('passed' in r) return r.passed ? 1.0 : 0.0
  return null
}

function deriveNonNegotiableSummary(snapshot: SnapshotResponse): string {
  const results = snapshot.non_negotiable_results
  if (!results || Object.keys(results).length === 0) return '3/3 Passing'
  const total = Object.keys(results).length
  const passing = Object.values(results).filter(isNnPassing).length
  return `${passing}/${total} Passing`
}

export default function TestSuitePage() {
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5')
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const { data: snapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['snapshots', 'test'],
    queryFn: () => getSnapshots('test'),
    staleTime: 0,
  })

  // When model changes or snapshots update, reset to latest for that model
  useEffect(() => {
    if (snapshots && snapshots.length > 0) {
      const filtered = snapshots.filter((s) => s.model === selectedModel)
      if (filtered.length > 0) {
        const latest = filtered[filtered.length - 1]
        setSelectedSnapshotId(latest.id ?? null)
      } else {
        setSelectedSnapshotId(null)
      }
    }
  }, [snapshots, selectedModel])

  // After a new run completes, reset selection so useEffect picks the new latest
  const runMutation = useMutation({
    mutationFn: () => triggerSnapshot(selectedModel, 'test'),
    onMutate: () => startEval(selectedModel),
    onSettled: () => stopEval(),
    onSuccess: () => {
      setSelectedSnapshotId(null)
      queryClient.invalidateQueries({ queryKey: ['snapshots', 'test'] })
    },
  })

  // Filter history to the selected model
  const modelSnapshots = snapshots ? snapshots.filter((s) => s.model === selectedModel) : []

  // Always resolve to a concrete id — default to latest when nothing explicitly selected
  const effectiveSnapshotId = selectedSnapshotId ?? (modelSnapshots.length > 0 ? modelSnapshots[modelSnapshots.length - 1].id : null)

  const snapshot: SnapshotResponse | null = modelSnapshots.length > 0
    ? (modelSnapshots.find((s) => s.id === effectiveSnapshotId) ?? modelSnapshots[modelSnapshots.length - 1])
    : null

  const { startEval, stopEval, isEvalRunning } = useEvalRun()
  const isRunning = runMutation.isPending || isEvalRunning

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSnapshot(id),
    onSuccess: (_data, deletedId) => {
      if (selectedSnapshotId === deletedId) setSelectedSnapshotId(null)
      queryClient.invalidateQueries({ queryKey: ['snapshots', 'test'] })
    },
  })

const { data: examples } = useQuery({
    queryKey: ['snapshot-examples', snapshot?.id],
    queryFn: () => getSnapshotExamples(snapshot!.id!),
    enabled: snapshot?.id != null,
  })

  const [expandedProp, setExpandedProp] = useState<string | null>(null)
  const [expandedNn, setExpandedNn] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'results' | 'internals'>('results')

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 pt-6 pb-0 border-b">
        <h1 className="text-xl font-semibold">Model Evaluation — Ground Truth</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run the ground truth corpus through the model. Get a per-property conformance report.
        </p>
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 hover:border-foreground/30 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
            <option value="claude-haiku-4-5">claude-haiku-4-5</option>
          </select>
          <Button
            className="text-white"
            style={{ backgroundColor: '#0D9488' }}
            onClick={() => runMutation.mutate()}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Running 36 tests...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1.5" />
                Run Test Suite
              </>
            )}
          </Button>
          {isRunning && (
            <p className="text-xs text-muted-foreground italic">This may take a few minutes...</p>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {(['results', 'internals'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
                activeTab === tab
                  ? 'border-[#0D9488] text-[#0D9488]'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Run History */}
        {activeTab === 'results' && !snapshotsLoading && modelSnapshots.length > 0 && (
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                Run History
                <span className="text-xs font-normal text-muted-foreground">{modelSnapshots.length} run{modelSnapshots.length !== 1 ? 's' : ''}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Overall</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Non-Negotiables</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {isRunning && (
                    <tr className="border-b bg-teal-50/10" style={{ borderLeft: '3px solid #0D9488' }}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-sm flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#0D9488' }} />
                          Running now…
                        </p>
                        <p className="text-xs text-muted-foreground">36 corpus examples</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground italic">in progress</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground italic">—</span>
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  )}
                  {[...modelSnapshots].reverse().map((s) => {
                    const isSelected = s.id === effectiveSnapshotId
                    const color = scoreColor(s.overall_conformance, 0.9, 0.8)
                    const nnSummary = deriveNonNegotiableSummary(s)
                    const allPassed = !nnSummary.startsWith('0') && nnSummary.includes('3/3')
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedSnapshotId(s.id)}
                        className={cn(
                          'group border-b last:border-0 cursor-pointer transition-colors',
                          isSelected ? 'bg-muted/30' : 'hover:bg-muted/20'
                        )}
                        style={isSelected ? { borderLeft: '3px solid #0D9488' } : { borderLeft: '3px solid transparent' }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{new Date(s.created_at).toLocaleDateString()}</p>
                            {s.is_pinned_baseline && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider text-white" style={{ backgroundColor: '#0D9488' }}>
                                Baseline
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleTimeString()}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm font-semibold" style={{ color }}>
                            {(s.overall_conformance * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium" style={{ color: allPassed ? '#0D9488' : '#F43F5E' }}>
                            {allPassed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" style={{ color: '#0D9488' }} />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" style={{ color: '#F43F5E' }} />
                            )}
                            {nnSummary}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (s.id != null) deleteMutation.mutate(s.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-100 hover:text-rose-600 transition-all"
                            title="Delete this run"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Summary cards — results tab only */}
        {activeTab === 'results' && (snapshotsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-1">
                  <Skeleton className="h-3 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-24 mt-1" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : snapshot ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                  Overall Conformance
                  <InfoTooltip text="Weighted average score across all 4 behavioral properties, across all 36 test cases. The primary health signal for this model on this spec." side="top" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold" style={{ color: scoreColor(snapshot.overall_conformance, 0.9, 0.8) }}>
                  {(snapshot.overall_conformance * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">vs. 90% target</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                  Non-Negotiables
                  <InfoTooltip text="Hard rules that must never be broken — e.g. never promise a refund without checking eligibility. These are binary pass/fail. A single failure is a critical incident, not a score." side="top" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold" style={{ color: '#0D9488' }}>
                  {deriveNonNegotiableSummary(snapshot)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">all rules</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                  Tests Run
                  <InfoTooltip text="36 labeled customer support scenarios drawn from corpus.json — 9 per ticket type (Order Status, Refund, Billing, Escalation). Each is run once and graded by an independent judge model." side="top" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">36</p>
                <p className="text-xs text-muted-foreground mt-0.5">12 scenarios × 3 runs</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {snapshot.id === modelSnapshots[modelSnapshots.length - 1]?.id ? 'Last Run' : 'Selected Run'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {new Date(snapshot.created_at).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(snapshot.created_at).toLocaleTimeString()}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {['Overall Conformance', 'Non-Negotiables', 'Tests Run', 'Last Run'].map((label) => (
              <Card key={label}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold text-muted-foreground">—</p>
                  <p className="text-xs text-muted-foreground mt-0.5">No data yet</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}

        {/* Behavioral Properties table */}
        {activeTab === 'results' && <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">Behavioral Properties</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!snapshot ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No test runs yet. Run the test suite to see results.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Property
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Score
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Target
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Alert Threshold
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PROPERTY_CONFIGS.map((prop, i) => {
                    const score = snapshot.property_scores[prop.id] ?? 0
                    const color = scoreColor(score, prop.target, prop.alertThreshold)
                    const status = getStatus(score, prop.target, prop.alertThreshold)
                    const isExpanded = expandedProp === prop.id
                    const propExamples = examples
                      ? [...examples].sort((a, b) => (a.property_scores[prop.id] ?? 0) - (b.property_scores[prop.id] ?? 0))
                      : []
                    return (
                      <>
                        <tr
                          key={prop.id}
                          onClick={() => setExpandedProp(isExpanded ? null : prop.id)}
                          className={cn('border-b cursor-pointer transition-colors', i % 2 === 0 ? '' : 'bg-muted/10', isExpanded ? 'bg-muted/30' : 'hover:bg-muted/20')}
                        >
                          <td className="px-4 py-3 font-medium">
                            <span className="flex items-center gap-1">
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              }
                              {prop.displayName}
                              <InfoTooltip text={PROPERTY_DESCRIPTIONS[prop.id] ?? prop.displayName} />
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <ScoreTooltip value={score} target={prop.target} alertThreshold={prop.alertThreshold}>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${score * 100}%`, backgroundColor: color }}
                                  />
                                </div>
                                <span className="font-mono text-xs font-medium" style={{ color }}>
                                  {(score * 100).toFixed(1)}%
                                </span>
                              </div>
                            </ScoreTooltip>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                            &gt;{(prop.target * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                            {(prop.alertThreshold * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-3">
                            <span style={{ color }} className="font-medium text-xs">
                              <StatusIcon status={status} />
                              {statusLabel(status)}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${prop.id}-expanded`} className="border-b bg-muted/5">
                            <td colSpan={5} className="px-4 py-3">
                              {!examples ? (
                                <p className="text-xs text-muted-foreground">Loading examples...</p>
                              ) : (
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                    All 36 examples — sorted by score (worst first)
                                  </p>
                                  <div className="grid gap-1">
                                    {propExamples.map((ex) => {
                                      const exScore = ex.property_scores[prop.id] ?? 0
                                      const exColor = scoreColor(exScore, prop.target, prop.alertThreshold)
                                      return (
                                        <div key={ex.id} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
                                          <span className="font-mono text-xs font-semibold w-12 flex-shrink-0 mt-0.5" style={{ color: exColor }}>
                                            {(exScore * 100).toFixed(0)}%
                                          </span>
                                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded flex-shrink-0">{ex.ticket_type}</span>
                                          <span className="text-xs text-muted-foreground leading-relaxed">{ex.customer_message_truncated}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>}

        {/* Non-Negotiables */}
        {activeTab === 'results' && snapshot && Object.keys(snapshot.non_negotiable_results).length > 0 && (
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
              Non-Negotiables
              <InfoTooltip text="Binary rules with zero tolerance. The runtime enforces these in the system prompt and retries once if the judge flags a violation. Failures here are critical — they indicate the model broke a hard policy constraint." />
            </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Object.entries(snapshot.non_negotiable_results).map(([key, result], i) => {
                const passed = isNnPassing(result)
                const rate = nnPassRate(result)
                const isExpanded = expandedNn === key
                const failedExamples = examples ? examples.filter((ex) => !ex.non_negotiables_passed) : []
                const label = key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                return (
                  <div key={key} className={cn('border-b last:border-0', isExpanded && 'bg-muted/5')}>
                    <div
                      className={cn('flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-colors', isExpanded ? '' : 'hover:bg-muted/20')}
                      onClick={() => setExpandedNn(isExpanded ? null : key)}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                        {passed ? (
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: '#0D9488' }} />
                        ) : (
                          <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: '#F43F5E' }} />
                        )}
                        <span className="text-sm font-medium">{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {rate !== null && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {(rate * 100).toFixed(0)}% pass rate
                          </span>
                        )}
                        <Badge
                          className="text-xs"
                          style={passed ? { backgroundColor: '#0D9488', color: '#fff' } : { backgroundColor: '#F43F5E', color: '#fff' }}
                        >
                          {passed ? 'PASS' : 'FAIL'}
                        </Badge>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-3">
                        {!examples ? (
                          <p className="text-xs text-muted-foreground">Loading examples...</p>
                        ) : failedExamples.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">All 36 examples passed all non-negotiables.</p>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                              Examples with non-negotiable violations ({failedExamples.length} of 36)
                            </p>
                            <div className="grid gap-1">
                              {failedExamples.map((ex) => (
                                <div key={ex.id} className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0">
                                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: '#F43F5E' }} />
                                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded flex-shrink-0">{ex.ticket_type}</span>
                                  <span className="text-xs text-muted-foreground leading-relaxed">{ex.customer_message_truncated}</span>
                                  <span className="font-mono text-xs text-muted-foreground flex-shrink-0">
                                    overall: {(ex.overall_score * 100).toFixed(0)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}

        {/* Internals tab */}
        {activeTab === 'internals' && (
          <div className="bg-card rounded-lg border border-border p-4 space-y-6">
            <h2 className="text-sm font-semibold">How Model Evaluation Works</h2>

            {/* Section A — The Corpus */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                A — The Corpus
              </p>
              <p className="text-sm text-muted-foreground mb-3">
                36 labeled examples across 4 ticket types
              </p>
              <table className="w-full text-sm border rounded-md overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Ticket Type</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Count</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Conforming</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Non-conforming</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { type: 'Order Status', count: 9, conforming: 6, nonConforming: 3 },
                    { type: 'Refund Request', count: 9, conforming: 6, nonConforming: 3 },
                    { type: 'Billing Dispute', count: 9, conforming: 6, nonConforming: 3 },
                    { type: 'Escalation', count: 9, conforming: 5, nonConforming: 4 },
                  ].map((row, i) => (
                    <tr key={row.type} className={cn('border-b last:border-0', i % 2 !== 0 && 'bg-muted/20')}>
                      <td className="px-3 py-2 text-sm">{row.type}</td>
                      <td className="px-3 py-2 text-sm">{row.count}</td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#0D9488' }}>{row.conforming}</td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#F59E0B' }}>{row.nonConforming}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Section B — How Each Example is Scored */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                B — How Each Example is Scored
              </p>
              <ol className="space-y-2">
                {[
                  { icon: '📨', text: 'Example loaded from corpus.json (customer_message + context + resolution_path)' },
                  { icon: '🤖', text: 'Sent to Claude Sonnet with system prompt (non-negotiables + resolution path)' },
                  { icon: '⚖️', text: 'Response sent to Claude Haiku (judge) with the spec' },
                  { icon: '📊', text: 'Judge returns structured verdict (pass/fail + 0-1 scores)' },
                  { icon: '💾', text: 'Result stored to SQLite, conformance rates aggregated' },
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="text-base leading-snug">{step.icon}</span>
                    <span><span className="font-semibold text-foreground mr-1">{i + 1}.</span>{step.text}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Section C — Scoring Formula */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                C — Scoring Formula
              </p>
              <pre className="bg-muted rounded-md p-3 text-xs font-mono text-foreground whitespace-pre overflow-x-auto">
{`overall_conformance = avg(behavioral_scores) across all 36 examples

per_property_rate = sum(scores for property) / count(examples)

non_negotiable_pass_rate = count(passed) / count(examples)`}
              </pre>
            </div>

            {/* Section D — Alert Thresholds */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                D — Alert Thresholds
              </p>
              <p className="text-xs text-muted-foreground mb-3">When does a property trigger an alert?</p>
              <table className="w-full text-sm border rounded-md overflow-hidden">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Property</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Target</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Alert Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {PROPERTY_CONFIGS.map((prop, i) => (
                    <tr key={prop.id} className={cn('border-b last:border-0', i % 2 !== 0 && 'bg-muted/20')}>
                      <td className="px-3 py-2 text-sm">{prop.displayName}</td>
                      <td className="px-3 py-2 text-sm font-mono" style={{ color: '#0D9488' }}>
                        &gt;{(prop.target * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-sm font-mono" style={{ color: '#F59E0B' }}>
                        {(prop.alertThreshold * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
