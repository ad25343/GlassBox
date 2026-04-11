import { useState } from 'react'
import { Play, TrendingUp, TrendingDown, Minus, Loader2, Terminal, History, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InfoTooltip, ScoreTooltip } from '@/components/ui/score-tooltip'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { compareModels, getSnapshots, deleteSnapshot, type CompareResponse, type SnapshotResponse } from '@/lib/api'

interface PropertyConfig {
  id: string
  displayName: string
  description: string
  target: number
  alertThreshold: number
}

const PROPERTY_CONFIGS: PropertyConfig[] = [
  {
    id: 'issue_acknowledged',
    displayName: 'Issue Acknowledged',
    description: 'Did the model explicitly acknowledge the customer\'s issue before jumping to a resolution? A score of 95% means 34 of 36 test cases passed. Target ≥ 95%, alert below 85%.',
    target: 0.95,
    alertThreshold: 0.85,
  },
  {
    id: 'resolution_matching',
    displayName: 'Resolution Matching',
    description: 'Did the proposed resolution match the recommended path for this ticket type — correct policy, correct action, no hallucinated steps? Target ≥ 90%, alert below 80%.',
    target: 0.90,
    alertThreshold: 0.80,
  },
  {
    id: 'professional_tone',
    displayName: 'Professional Tone',
    description: 'Was the response professional and empathetic throughout — not robotic, not dismissive, not overly casual? Target ≥ 90%, alert below 80%.',
    target: 0.90,
    alertThreshold: 0.80,
  },
  {
    id: 'concise_response',
    displayName: 'Concise Response',
    description: 'Was the response appropriately brief — no filler phrases, unnecessary repetition, or over-explanation? Verbosity is a real cost in production. Target ≥ 85%, alert below 75%.',
    target: 0.85,
    alertThreshold: 0.75,
  },
]

function scoreColor(score: number, target: number, alertThreshold: number): string {
  if (score >= target) return '#0D9488'
  if (score >= alertThreshold) return '#F59E0B'
  return '#F43F5E'
}

function DeltaCell({ d }: { d: number }) {
  const formatted = Math.abs(d * 100).toFixed(1)
  if (d > 0) {
    return (
      <span className="flex items-center gap-1 font-mono text-xs" style={{ color: '#0D9488' }}>
        <TrendingUp className="h-3 w-3" />+{formatted}%
      </span>
    )
  }
  if (d < 0) {
    return (
      <span className="flex items-center gap-1 font-mono text-xs" style={{ color: '#F43F5E' }}>
        <TrendingDown className="h-3 w-3" />-{formatted}%
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />0%
    </span>
  )
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${value * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-xs font-semibold" style={{ color }}>
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}


function modelShortName(model: string): string {
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  if (model.includes('opus')) return 'Opus'
  return model
}

const MODEL_COLORS = ['#0D9488', '#3B82F6', '#8B5CF6', '#F59E0B']

const PROP_LABELS: Record<string, string> = {
  issue_acknowledged: 'Issue Acknowledged',
  resolution_matching: 'Resolution Matching',
  professional_tone: 'Professional Tone',
  concise_response: 'Concise Response',
}

interface NarrativeSection {
  heading: string
  body: string
}

function buildSummary(result: CompareResponse): string {
  if (result.models.length < 2) return ''
  const [m1, m2] = result.models
  const n1 = modelShortName(m1.model)
  const n2 = modelShortName(m2.model)
  const o1 = m1.overall_conformance
  const o2 = m2.overall_conformance
  const winner = o1 >= o2 ? n1 : n2
  const loser = o1 >= o2 ? n2 : n1
  const winnerM = o1 >= o2 ? m1 : m2
  const loserM = o1 >= o2 ? m2 : m1
  const delta = Math.abs(o1 - o2) * 100
  const score = (m: typeof m1, p: string) => (m.property_scores[p] ?? 0) * 100
  const gap = (p: string) => score(winnerM, p) - score(loserM, p)
  const biggestProp = Object.keys(PROP_LABELS).sort((a, b) => Math.abs(gap(b)) - Math.abs(gap(a)))[0]

  let summary = `${winner} leads by ${delta.toFixed(1)}pp overall (${(winnerM.overall_conformance * 100).toFixed(1)}% vs ${(loserM.overall_conformance * 100).toFixed(1)}%), with the sharpest gap in ${PROP_LABELS[biggestProp]} (${score(winnerM, biggestProp).toFixed(1)}% vs ${score(loserM, biggestProp).toFixed(1)}%). `

  if (delta < 2) {
    summary += `The models are behaviorally near-identical — the decision should be driven by cost. ${n2} is significantly cheaper per call.`
  } else if (delta < 6) {
    summary += `${winner} is the stronger performer, but ${loser} remains viable for lower-stakes ticket types where the cost difference outweighs the behavioural gap.`
  } else {
    summary += `The gap is significant enough that ${winner} is the clear production choice where accuracy matters.`
  }
  return summary
}

function buildNarrativeSections(result: CompareResponse): NarrativeSection[] {
  if (result.models.length < 2) return []
  const [m1, m2] = result.models
  const n1 = modelShortName(m1.model)
  const n2 = modelShortName(m2.model)
  const o1 = m1.overall_conformance
  const o2 = m2.overall_conformance
  const winner = o1 >= o2 ? n1 : n2
  const loser = o1 >= o2 ? n2 : n1
  const winnerM = o1 >= o2 ? m1 : m2
  const loserM = o1 >= o2 ? m2 : m1
  const delta = Math.abs(o1 - o2) * 100

  const score = (m: typeof m1, p: string) => (m.property_scores[p] ?? 0) * 100
  const gap = (p: string) => score(winnerM, p) - score(loserM, p)

  const sections: NarrativeSection[] = []

  // Issue Acknowledged
  const iaGap = gap('issue_acknowledged')
  const ia1 = score(winnerM, 'issue_acknowledged')
  const ia2 = score(loserM, 'issue_acknowledged')
  sections.push({
    heading: 'Issue Acknowledged',
    body: Math.abs(iaGap) < 2
      ? `Both models score similarly here (${n1}: ${score(m1, 'issue_acknowledged').toFixed(1)}%, ${n2}: ${score(m2, 'issue_acknowledged').toFixed(1)}%). Empathy and acknowledgement are consistent across both — neither model skips past the customer's concern to jump straight to resolution.`
      : `${winner} scores ${ia1.toFixed(1)}% vs ${loser}'s ${ia2.toFixed(1)}% (${Math.abs(iaGap).toFixed(1)}pp gap). This measures whether the model opens by acknowledging the customer's issue before offering a solution. A lower score means the model is more likely to skip straight to resolution without first validating the customer's concern.`,
  })

  // Resolution Matching
  const rmGap = gap('resolution_matching')
  const rm1 = score(winnerM, 'resolution_matching')
  const rm2 = score(loserM, 'resolution_matching')
  sections.push({
    heading: 'Resolution Matching',
    body: Math.abs(rmGap) < 2
      ? `Both models follow the resolution path consistently (${n1}: ${score(m1, 'resolution_matching').toFixed(1)}%, ${n2}: ${score(m2, 'resolution_matching').toFixed(1)}%). Tool call sequencing — lookup, eligibility check, label generation — is reliably followed by both.`
      : `This is the widest gap in the comparison: ${winner} at ${rm1.toFixed(1)}% vs ${loser} at ${rm2.toFixed(1)}% (${Math.abs(rmGap).toFixed(1)}pp). Resolution Matching measures whether the model calls tools in the correct sequence — for example, checking return eligibility before mentioning a refund. A lower score means the model is more likely to skip steps or answer out of order, which can lead to incorrect or premature commitments to customers.`,
  })

  // Professional Tone
  const ptGap = gap('professional_tone')
  const pt1 = score(winnerM, 'professional_tone')
  const pt2 = score(loserM, 'professional_tone')
  sections.push({
    heading: 'Professional Tone',
    body: Math.abs(ptGap) < 2
      ? `Tone is consistent across both models (${n1}: ${score(m1, 'professional_tone').toFixed(1)}%, ${n2}: ${score(m2, 'professional_tone').toFixed(1)}%). Both maintain appropriate customer service language without being overly formal or too casual.`
      : `${winner} scores ${pt1.toFixed(1)}% vs ${loser}'s ${pt2.toFixed(1)}% (${Math.abs(ptGap).toFixed(1)}pp). Professional Tone captures whether the response maintains appropriate register — empathetic but not sycophantic, direct but not curt. The gap here suggests ${loser} has more variance in how it handles frustrated or edge-case customers.`,
  })

  // Concise Response
  const crGap = gap('concise_response')
  const cr1 = score(winnerM, 'concise_response')
  const cr2 = score(loserM, 'concise_response')
  sections.push({
    heading: 'Concise Response',
    body: Math.abs(crGap) < 2
      ? `Both models produce similarly concise responses (${n1}: ${score(m1, 'concise_response').toFixed(1)}%, ${n2}: ${score(m2, 'concise_response').toFixed(1)}%). Neither tends to pad responses or repeat information already provided.`
      : `${winner} scores ${cr1.toFixed(1)}% vs ${loser}'s ${cr2.toFixed(1)}% (${Math.abs(crGap).toFixed(1)}pp). This measures whether the model stays focused — addressing the issue without unnecessary repetition or filler. A lower score typically means longer, padded responses that reduce the quality of the customer experience.`,
  })

  return sections
}

interface ComparePair {
  runAt: string
  sonnet: SnapshotResponse
  haiku: SnapshotResponse
}

function pairSnapshots(snapshots: SnapshotResponse[]): ComparePair[] {
  // Only real runs have haiku entries — synthetic history is sonnet-only
  const haikus = snapshots.filter(s => s.model.includes('haiku'))
  const sonnets = snapshots.filter(s => s.model.includes('sonnet'))
  const pairs: ComparePair[] = []
  for (const haiku of haikus) {
    const haikusMs = new Date(haiku.created_at).getTime()
    // Find the closest sonnet run within 120 seconds
    const match = sonnets.find(s => Math.abs(new Date(s.created_at).getTime() - haikusMs) < 120_000)
    if (match) pairs.push({ runAt: haiku.created_at, sonnet: match, haiku })
  }
  return pairs.sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime())
}

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
}

function computeCost(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICING[model] ?? { input: 0.25, output: 1.25 }
  const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
  }
}

function compareResponseFromPair(pair: ComparePair): CompareResponse {
  const toModelResult = (s: SnapshotResponse) => ({
    model: s.model,
    overall_conformance: s.overall_conformance,
    property_scores: s.property_scores,
    non_negotiable_pass_rates: {},
    cost_estimate: computeCost(s.model, s.input_tokens, s.output_tokens),
    snapshot: s,
  })
  const models = [toModelResult(pair.sonnet), toModelResult(pair.haiku)]
  const winner = pair.sonnet.overall_conformance >= pair.haiku.overall_conformance
    ? pair.sonnet.model : pair.haiku.model
  return { models, winner, winner_reason: null }
}

function NarrativePanel({ summary, sections, result }: { summary: string; sections: NarrativeSection[]; result: CompareResponse }) {
  const [open, setOpen] = useState(false)
  const runAt = result.models[0]?.snapshot?.created_at
  const models = result.models.map(m => modelShortName(m.model)).join(' vs ')
  const snapshotIds = result.models
    .map(m => m.snapshot?.id)
    .filter((id): id is number => id != null)
  const runId = snapshotIds.length > 0 ? snapshotIds.map(id => `#${id}`).join(' · ') : null
  return (
    <div className="rounded-lg border">
      {/* Summary — always visible */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            {runId && <span className="opacity-50">{runId}</span>}
            <span>{models}</span>
            {runAt && <span>{new Date(runAt).toLocaleString()}</span>}
          </div>
        </div>
        <p className="text-sm leading-relaxed">{summary}</p>
      </div>
      {/* Analysis — collapsible */}
      <div className="border-t">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors"
          onClick={() => setOpen(v => !v)}
        >
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Analysis</span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && (
          <div className="border-t px-5 py-4 space-y-4">
            {sections.map(s => (
              <div key={s.heading}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{s.heading}</p>
                <p className="text-sm leading-relaxed text-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ComparePage() {
  const [showInternals, setShowInternals] = useState(false)
  const [selectedPairIdx, setSelectedPairIdx] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const snapshotsQuery = useQuery({
    queryKey: ['snapshots', 'compare'],
    queryFn: () => getSnapshots('compare'),
    staleTime: 0,
  })
  const comparePairs = snapshotsQuery.data ? pairSnapshots(snapshotsQuery.data) : []

  // Always default to showing the latest pair; selectedPairIdx overrides
  const activePair = selectedPairIdx !== null ? comparePairs[selectedPairIdx] : comparePairs[0] ?? null
  const displayResult: CompareResponse | null = activePair ? compareResponseFromPair(activePair) : null

  const handleRun = async () => {
    setIsRunning(true)
    setRunError(null)
    try {
      await compareModels()
      await queryClient.invalidateQueries({ queryKey: ['snapshots', 'compare'] })
      setSelectedPairIdx(null) // reset to latest
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Unknown error — check server logs.')
    } finally {
      setIsRunning(false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async (pair: ComparePair) => {
      await Promise.all([
        pair.sonnet.id != null ? deleteSnapshot(pair.sonnet.id) : Promise.resolve(),
        pair.haiku.id != null ? deleteSnapshot(pair.haiku.id) : Promise.resolve(),
      ])
    },
    onSuccess: () => {
      setSelectedPairIdx(null)
      queryClient.invalidateQueries({ queryKey: ['snapshots', 'compare'] })
    },
  })

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="p-6 border-b flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Model Comparison</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Same spec. Same test suite. Different models. Compare on behavioral criteria, not benchmarks.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Button
            className="text-white"
            style={{ backgroundColor: '#0D9488' }}
            onClick={handleRun}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1.5" />
                Run Comparison
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInternals((v) => !v)}
          >
            <Terminal className="h-4 w-4 mr-1.5" />
            {showInternals ? 'Hide Internals' : 'Show Internals'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {!isRunning && !displayResult && comparePairs.length === 0 && !snapshotsQuery.isLoading && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">No comparison runs yet</p>
            <p>Click <strong>Run Comparison</strong> to evaluate Sonnet vs Haiku on the same 36-example corpus.</p>
          </div>
        )}

        {isRunning && (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground flex items-center gap-3" style={{ borderColor: '#0D9488', backgroundColor: '#0D944811' }}>
            <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" style={{ color: '#0D9488' }} />
            Running test suite on both models... this may take a minute.
          </div>
        )}

        {runError !== null && (
          <div className="rounded-lg border p-4 text-sm" style={{ borderColor: '#F43F5E', backgroundColor: '#F43F5E11' }}>
            <p className="font-semibold mb-1" style={{ color: '#F43F5E' }}>Comparison failed</p>
            <p className="text-muted-foreground font-mono text-xs">
              {runError ?? 'Unknown error — check server logs.'}
            </p>
          </div>
        )}

        {displayResult && (
          <>
            {/* Results header with close button */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Results</p>
              <button
                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedPairIdx(null)}
                title="Clear results"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Empty guard */}
            {displayResult.models.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Comparison completed but returned no model results. Check server logs.
              </div>
            )}

            {displayResult.models.length > 0 && (
            <>
            {/* Model header row */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${displayResult.models.length}, minmax(0, 1fr))` }} className="gap-4">
              {displayResult.models.map((m, i) => (
                <div
                  key={m.model}
                  className="flex items-center gap-2 rounded-lg border px-4 py-3"
                  style={{ borderColor: MODEL_COLORS[i] ?? '#0D9488' }}
                >
                  <Badge style={{ backgroundColor: MODEL_COLORS[i] ?? '#0D9488', color: '#fff' }} className="text-xs">
                    Model {String.fromCharCode(65 + i)}
                  </Badge>
                  <span className="font-mono text-sm font-semibold">{m.model}</span>
                </div>
              ))}
            </div>

            {/* Narrative summary + collapsible analysis */}
            {displayResult.models.length >= 2 && (
              <NarrativePanel
                summary={buildSummary(displayResult)}
                sections={buildNarrativeSections(displayResult)}
                result={displayResult}
              />
            )}

            {/* Comparison table */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-medium">Behavioral Properties</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Property
                      </th>
                      {displayResult.models.map((m) => (
                        <th
                          key={m.model}
                          className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                        >
                          {modelShortName(m.model)}
                        </th>
                      ))}
                      {displayResult.models.length >= 2 && (
                        <>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Delta
                            <InfoTooltip text="Score difference between Model B and Model A. Green = Model B leads, red = Model A leads." side="top" />
                          </th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Winner</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Property rows */}
                    {PROPERTY_CONFIGS.map((prop, i) => {
                      const scores = displayResult.models.map(m => m.property_scores[prop.id] ?? 0)
                      const score0 = scores[0] ?? 0
                      const score1 = scores[1] ?? 0
                      const d = score1 - score0
                      const winnerIdx = scores.indexOf(Math.max(...scores))
                      return (
                        <tr
                          key={prop.id}
                          className={cn('border-b last:border-0', i % 2 === 0 ? '' : 'bg-muted/20')}
                        >
                          <td className="px-4 py-3 text-sm">
                            <span className="flex items-center">
                              {prop.displayName}
                              <InfoTooltip text={prop.description} />
                            </span>
                          </td>
                          {displayResult.models.map((m, mi) => (
                            <td key={m.model} className="px-4 py-3">
                              <ScoreTooltip value={scores[mi] ?? 0} target={prop.target} alertThreshold={prop.alertThreshold}>
                                <ScoreBar
                                  value={scores[mi] ?? 0}
                                  color={scoreColor(scores[mi] ?? 0, prop.target, prop.alertThreshold)}
                                />
                              </ScoreTooltip>
                            </td>
                          ))}
                          {displayResult.models.length >= 2 && (
                            <>
                              <td className="px-4 py-3"><DeltaCell d={d} /></td>
                              <td className="px-4 py-3">
                                {score0 === score1 ? (
                                  <span className="text-xs text-muted-foreground">Tie</span>
                                ) : (
                                  <span className="text-xs font-medium" style={{ color: MODEL_COLORS[winnerIdx] ?? '#0D9488' }}>
                                    {modelShortName(displayResult.models[winnerIdx].model)} ✓
                                  </span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                    {/* Overall row */}
                    {(() => {
                      const overalls = displayResult.models.map(m => m.overall_conformance)
                      const o0 = overalls[0] ?? 0
                      const o1 = overalls[1] ?? 0
                      const d = o1 - o0
                      const winnerIdx = overalls.indexOf(Math.max(...overalls))
                      return (
                        <tr className="bg-muted/50 font-semibold border-t">
                          <td className="px-4 py-3 text-sm">
                            <span className="flex items-center">
                              Overall
                              <InfoTooltip text="Weighted average across all 4 behavioral properties. The primary signal for comparing models on this spec." side="right" />
                            </span>
                          </td>
                          {displayResult.models.map((m, mi) => (
                            <td key={m.model} className="px-4 py-3">
                              <ScoreTooltip value={overalls[mi] ?? 0} target={0.9} alertThreshold={0.8}>
                                <ScoreBar value={overalls[mi] ?? 0} color={scoreColor(overalls[mi] ?? 0, 0.9, 0.8)} />
                              </ScoreTooltip>
                            </td>
                          ))}
                          {displayResult.models.length >= 2 && (
                            <>
                              <td className="px-4 py-3"><DeltaCell d={d} /></td>
                              <td className="px-4 py-3">
                                {o0 === o1 ? (
                                  <span className="text-xs text-muted-foreground">Tie</span>
                                ) : (
                                  <span className="text-xs font-medium" style={{ color: MODEL_COLORS[winnerIdx] ?? '#0D9488' }}>
                                    {modelShortName(displayResult.models[winnerIdx].model)} ✓
                                  </span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Cost comparison — only shown when real token data is available */}
            {displayResult.models.some(m => m.cost_estimate.total_tokens > 0) && (
              <div>
                <h2 className="text-sm font-semibold mb-3">Cost Comparison <span className="text-xs font-normal text-muted-foreground">(model inference only, 36 examples)</span></h2>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${displayResult.models.length}, minmax(0, 1fr))` }} className="gap-4">
                  {displayResult.models.map((m, i) => {
                    const color = MODEL_COLORS[i] ?? '#0D9488'
                    const c = m.cost_estimate
                    const costPer1K = c.total_tokens > 0 ? (c.estimated_cost_usd / 36) * 1000 : null
                    return (
                      <Card key={m.model} style={{ borderColor: color }} className="border">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Badge style={{ backgroundColor: color, color: '#fff' }} className="text-xs">{modelShortName(m.model)}</Badge>
                            <span className="font-mono text-xs">{m.model}</span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Input / Output tokens</p>
                            <p className="text-sm font-semibold mt-0.5 font-mono">
                              {c.input_tokens.toLocaleString()} / {c.output_tokens.toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Cost for 36 examples</p>
                            <p className="text-2xl font-semibold mt-0.5">${c.estimated_cost_usd.toFixed(4)}</p>
                          </div>
                          {costPer1K != null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Estimated cost per 1K calls</p>
                              <p className="text-lg font-semibold mt-0.5">${costPer1K.toFixed(2)}</p>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground border-t pt-2">
                            {(m.overall_conformance * 100).toFixed(1)}% conformance rate
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}
            </>
            )}
          </>
        )}

        {/* Comparison History */}
        {comparePairs.length > 0 && (
          <div className="rounded-lg border">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors"
              onClick={() => setShowHistory(v => !v)}
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                Comparison History
                <Badge variant="outline" className="text-xs font-mono">{comparePairs.length}</Badge>
              </span>
              {showHistory ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showHistory && (
              <div className="border-t divide-y">
                {comparePairs.map((pair, i) => {
                  const sonnetScore = pair.sonnet.overall_conformance
                  const haikuScore = pair.haiku.overall_conformance
                  const winnerModel = sonnetScore >= haikuScore ? pair.sonnet.model : pair.haiku.model
                  const delta = Math.abs(sonnetScore - haikuScore)
                  return (
                    <div key={i} className="flex items-center group">
                      <button
                        className="flex-1 flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setSelectedPairIdx(i)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground font-mono text-xs">
                            {new Date(pair.runAt).toLocaleString()}
                          </span>
                          <Badge className="text-xs" style={{ backgroundColor: '#0D9488', color: '#fff' }}>
                            {modelShortName(winnerModel)} wins
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
                          <span>Sonnet <span className="font-semibold text-foreground">{(sonnetScore * 100).toFixed(1)}%</span></span>
                          <span>Haiku <span className="font-semibold text-foreground">{(haikuScore * 100).toFixed(1)}%</span></span>
                          <span className="text-muted-foreground">Δ {(delta * 100).toFixed(1)}%</span>
                        </div>
                      </button>
                      <button
                        className="px-3 py-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title="Delete this comparison run"
                        onClick={() => deleteMutation.mutate(pair)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Internals panel */}
        {showInternals && (
          <div className="bg-card rounded-lg border border-border p-4 space-y-6">
            <h2 className="text-sm font-semibold">How the Comparison Works</h2>

            {/* Section A */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                A — Same Spec, Same Corpus, Different Models
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Both models receive identical system prompts, the same 36 corpus examples, and are
                evaluated by the same judge (Claude Haiku). The only variable is the model itself.
              </p>
            </div>

            {/* Section B — Parallel Execution */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                B — Parallel Execution
              </p>
              <div className="flex flex-col items-center gap-1 text-xs font-mono text-muted-foreground select-none">
                {/* corpus */}
                <div className="rounded border border-border px-4 py-2 text-foreground font-semibold text-center">
                  corpus.json (36 examples)
                </div>
                {/* vertical line */}
                <div className="w-px h-4 bg-border" />
                {/* split */}
                <div className="flex items-start gap-12">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-px h-4 bg-border" />
                    <div className="rounded border border-border px-4 py-2 text-foreground font-semibold" style={{ borderColor: '#0D9488' }}>
                      Sonnet
                    </div>
                    <div className="w-px h-4 bg-border" />
                    <div className="rounded border border-border px-4 py-2 text-center" style={{ borderColor: '#0D9488' }}>
                      Judge<br /><span className="text-muted-foreground">(Haiku)</span>
                    </div>
                    <div className="w-px h-4 bg-border" />
                    <div className="rounded border border-border px-3 py-1.5 text-center text-muted-foreground">
                      scores
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-px h-4 bg-border" />
                    <div className="rounded border border-border px-4 py-2 text-foreground font-semibold" style={{ borderColor: '#3B82F6' }}>
                      Haiku
                    </div>
                    <div className="w-px h-4 bg-border" />
                    <div className="rounded border border-border px-4 py-2 text-center" style={{ borderColor: '#3B82F6' }}>
                      Judge<br /><span className="text-muted-foreground">(Haiku)</span>
                    </div>
                    <div className="w-px h-4 bg-border" />
                    <div className="rounded border border-border px-3 py-1.5 text-center text-muted-foreground">
                      scores
                    </div>
                  </div>
                </div>
                {/* merge */}
                <div className="w-px h-4 bg-border" />
                <div className="rounded border border-border px-4 py-2 text-foreground font-semibold text-center">
                  side-by-side
                </div>
              </div>
            </div>

            {/* Section C — Cost Calculation */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                C — Cost Calculation
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground mb-3">
                <li><span className="font-medium text-foreground">Sonnet:</span> $3.00 / 1M input tokens + $15.00 / 1M output tokens</li>
                <li><span className="font-medium text-foreground">Haiku:</span> $0.25 / 1M input tokens + $1.25 / 1M output tokens</li>
                <li>Estimated per corpus run: 36 examples × ~300 input tokens × ~200 output tokens</li>
              </ul>
              <pre className="bg-muted rounded-md p-3 text-xs font-mono text-foreground whitespace-pre overflow-x-auto">
{`cost = (input_tokens / 1_000_000) × input_price
      + (output_tokens / 1_000_000) × output_price`}
              </pre>
            </div>

            {/* Section D — What the Winner Means */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                D — What the Winner Means
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The winner is determined by overall conformance rate only. A model with lower overall
                conformance but better performance on critical properties may still be the right choice
                for specific use cases. Use the per-property breakdown to make the real decision.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
