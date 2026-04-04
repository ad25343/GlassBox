import { useState } from 'react'
import { Play, TrendingUp, TrendingDown, Minus, Loader2, Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { compareModels, type CompareResponse, type ModelCompareResult } from '@/lib/api'

interface PropertyConfig {
  id: string
  displayName: string
  target: number
  alertThreshold: number
}

const PROPERTY_CONFIGS: PropertyConfig[] = [
  { id: 'issue_acknowledged', displayName: 'Issue Acknowledged', target: 0.95, alertThreshold: 0.85 },
  { id: 'resolution_matching', displayName: 'Resolution Matching', target: 0.90, alertThreshold: 0.80 },
  { id: 'professional_tone', displayName: 'Professional Tone', target: 0.90, alertThreshold: 0.80 },
  { id: 'concise_response', displayName: 'Concise Response', target: 0.85, alertThreshold: 0.75 },
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

export default function ComparePage() {
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null)
  const [showInternals, setShowInternals] = useState(false)

  const runMutation = useMutation({
    mutationFn: () => compareModels(),
    onSuccess: (data) => {
      setCompareResult(data)
    },
  })

  const isRunning = runMutation.isPending

  const model1: ModelCompareResult | null = compareResult?.models[0] ?? null
  const model2: ModelCompareResult | null = compareResult?.models[1] ?? null

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
            onClick={() => runMutation.mutate()}
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

        {isRunning && (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground flex items-center gap-3" style={{ borderColor: '#0D9488', backgroundColor: '#0D944811' }}>
            <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" style={{ color: '#0D9488' }} />
            Running test suite on both models... this may take a minute.
          </div>
        )}

        {!compareResult && !isRunning && (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            Click Run Comparison to compare Claude Sonnet vs Claude Haiku on identical behavioral criteria.
          </div>
        )}

        {compareResult && model1 && model2 && (
          <>
            {/* Model header row */}
            <div className={`grid grid-cols-${compareResult.models.length} gap-4`} style={{ display: 'grid', gridTemplateColumns: `repeat(${compareResult.models.length}, minmax(0, 1fr))` }}>
              {compareResult.models.map((m, i) => (
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

            {/* Winner banner */}
            {compareResult.winner && (
              <div
                className="rounded-lg border p-4"
                style={{ borderColor: '#0D9488', backgroundColor: '#0D944811' }}
              >
                <p className="text-sm font-semibold" style={{ color: '#0D9488' }}>
                  {compareResult.winner} wins overall
                </p>
                {compareResult.winner_reason && (
                  <p className="text-sm text-muted-foreground mt-1">{compareResult.winner_reason}</p>
                )}
              </div>
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
                      {compareResult.models.map((m) => (
                        <th
                          key={m.model}
                          className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                        >
                          {modelShortName(m.model)}
                        </th>
                      ))}
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Delta
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Winner
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Property rows */}
                    {PROPERTY_CONFIGS.map((prop, i) => {
                      const score1 = model1.property_scores[prop.id] ?? 0
                      const score2 = model2.property_scores[prop.id] ?? 0
                      const d = score2 - score1
                      return (
                        <tr
                          key={prop.id}
                          className={cn('border-b last:border-0', i % 2 === 0 ? '' : 'bg-muted/20')}
                        >
                          <td className="px-4 py-3 text-sm">{prop.displayName}</td>
                          <td className="px-4 py-3">
                            <ScoreBar
                              value={score1}
                              color={scoreColor(score1, prop.target, prop.alertThreshold)}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <ScoreBar
                              value={score2}
                              color={scoreColor(score2, prop.target, prop.alertThreshold)}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <DeltaCell d={d} />
                          </td>
                          <td className="px-4 py-3">
                            {score1 > score2 ? (
                              <span className="text-xs font-medium" style={{ color: '#0D9488' }}>
                                {modelShortName(model1.model)} ✓
                              </span>
                            ) : score2 > score1 ? (
                              <span className="text-xs font-medium" style={{ color: '#3B82F6' }}>
                                {modelShortName(model2.model)} ✓
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Tie</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Overall row */}
                    {(() => {
                      const o1 = model1.overall_conformance
                      const o2 = model2.overall_conformance
                      const d = o2 - o1
                      return (
                        <tr className="bg-muted/50 font-semibold border-t">
                          <td className="px-4 py-3 text-sm">Overall</td>
                          <td className="px-4 py-3">
                            <ScoreBar value={o1} color={scoreColor(o1, 0.9, 0.8)} />
                          </td>
                          <td className="px-4 py-3">
                            <ScoreBar value={o2} color={scoreColor(o2, 0.9, 0.8)} />
                          </td>
                          <td className="px-4 py-3">
                            <DeltaCell d={d} />
                          </td>
                          <td className="px-4 py-3">
                            {o1 > o2 ? (
                              <span className="text-xs font-medium" style={{ color: '#0D9488' }}>
                                {modelShortName(model1.model)} ✓
                              </span>
                            ) : o2 > o1 ? (
                              <span className="text-xs font-medium" style={{ color: '#3B82F6' }}>
                                {modelShortName(model2.model)} ✓
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Tie</span>
                            )}
                          </td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Cost comparison */}
            <div>
              <h2 className="text-sm font-semibold mb-3">Cost Comparison</h2>
              <div
                style={{ display: 'grid', gridTemplateColumns: `repeat(${compareResult.models.length}, minmax(0, 1fr))` }}
                className="gap-4"
              >
                {compareResult.models.map((m, i) => {
                  const color = MODEL_COLORS[i] ?? '#0D9488'
                  const costPer1K = (m.cost_estimate.estimated_cost_usd * 1000) / 36
                  return (
                    <Card key={m.model} style={{ borderColor: color }} className="border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Badge style={{ backgroundColor: color, color: '#fff' }} className="text-xs">
                            {modelShortName(m.model)}
                          </Badge>
                          <span className="font-mono text-xs">{m.model}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Total tokens (36 examples)</p>
                          <p className="text-lg font-semibold mt-0.5">
                            {m.cost_estimate.total_tokens.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Estimated cost (36 examples)</p>
                          <p className="text-2xl font-semibold mt-0.5">
                            ${m.cost_estimate.estimated_cost_usd.toFixed(4)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Cost per 1K calls</p>
                          <p className="text-lg font-semibold mt-0.5">
                            ${costPer1K.toFixed(2)}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground border-t pt-2">
                          {(m.overall_conformance * 100).toFixed(1)}% conformance rate
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>

            {/* Value verdict */}
            {compareResult.winner_reason && (
              <Card className="border" style={{ borderColor: '#3B82F6', backgroundColor: '#3B82F611' }}>
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Value Verdict
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">{compareResult.winner_reason}</p>
                </CardContent>
              </Card>
            )}
          </>
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
