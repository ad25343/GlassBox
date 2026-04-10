import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip, PROPERTY_DESCRIPTIONS } from '@/components/ui/score-tooltip'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getMonitorStatus,
  getVerdicts,
  getAlerts,
  type MonitorStatus,
  type VerdictResponse,
} from '@/lib/api'

interface PropertyConfig {
  id: string
  displayName: string
  threshold: number
}

const PROPERTY_CONFIGS: PropertyConfig[] = [
  { id: 'issue_acknowledged', displayName: 'Issue Acknowledged', threshold: 0.85 },
  { id: 'resolution_matching', displayName: 'Resolution Matching', threshold: 0.80 },
  { id: 'professional_tone', displayName: 'Professional Tone', threshold: 0.80 },
  { id: 'concise_response', displayName: 'Concise Response', threshold: 0.75 },
]

function scoreColor(score: number, threshold: number): string {
  if (score >= 0.9) return '#0D9488'
  if (score >= threshold) return '#F59E0B'
  return '#F43F5E'
}

function conformanceColor(rate: number): string {
  if (rate >= 0.9) return '#0D9488'
  if (rate >= 0.8) return '#F59E0B'
  return '#F43F5E'
}

function formatPropertyName(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function PropertyBreakdown({ propertyScores }: { propertyScores: Record<string, number> }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
      {PROPERTY_CONFIGS.map((prop) => {
        const score = propertyScores[prop.id] ?? 0
        const color = scoreColor(score, prop.threshold)
        return (
          <div key={prop.id} className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-36 flex-shrink-0">{prop.displayName}</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${score * 100}%`, backgroundColor: color }} />
            </div>
            <span className="text-[11px] font-semibold tabular-nums w-10 text-right flex-shrink-0" style={{ color }}>
              {(score * 100).toFixed(1)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AlertEntry({ alert }: { alert: VerdictResponse }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      className="rounded-lg border cursor-pointer transition-colors hover:bg-red-50/5"
      style={{ borderColor: '#F43F5E', backgroundColor: expanded ? '#F43F5E18' : '#F43F5E11' }}
      onClick={() => setExpanded(v => !v)}
    >
      <div className="flex items-start gap-3 p-3">
        <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: '#F43F5E' }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(alert.created_at).toLocaleString()}
            </span>
            <Badge className="text-xs" style={{ backgroundColor: '#F43F5E', color: '#fff' }}>
              Run #{alert.run_id}
            </Badge>
            <Badge className="text-xs" style={{ backgroundColor: '#F43F5E', color: '#fff' }}>
              ALERT
            </Badge>
            <span className="ml-auto text-sm font-semibold" style={{ color: '#F43F5E' }}>
              {(alert.overall_score * 100).toFixed(1)}%
            </span>
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          {expanded && <PropertyBreakdown propertyScores={alert.property_scores} />}
        </div>
      </div>
    </div>
  )
}

function VerdictEntry({ verdict, index }: { verdict: VerdictResponse; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const color = conformanceColor(verdict.overall_score)
  return (
    <div
      className={cn('cursor-pointer hover:bg-muted/20 transition-colors', index % 2 !== 0 && 'bg-muted/10')}
      onClick={() => setExpanded(v => !v)}
    >
      <div className="flex items-center gap-4 px-4 py-2.5">
        <span className="font-mono text-xs text-muted-foreground w-40 flex-shrink-0">
          {new Date(verdict.created_at).toLocaleString()}
        </span>
        <span className="font-mono text-xs w-16 flex-shrink-0">#{verdict.run_id}</span>
        <span className="font-mono text-xs font-semibold w-14 flex-shrink-0" style={{ color }}>
          {(verdict.overall_score * 100).toFixed(1)}%
        </span>
        {verdict.alert_triggered && (
          <Badge className="text-xs" style={{ backgroundColor: '#F43F5E', color: '#fff' }}>ALERT</Badge>
        )}
        <span className="ml-auto">
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </span>
      </div>
      {expanded && (
        <div className="px-4 pb-3">
          <PropertyBreakdown propertyScores={verdict.property_scores} />
        </div>
      )}
    </div>
  )
}

export default function MonitorPage() {
  const { data: status, isLoading: statusLoading } = useQuery<MonitorStatus>({
    queryKey: ['monitor-status'],
    queryFn: getMonitorStatus,
    refetchInterval: 10000,
  })

  const { data: verdicts, isLoading: verdictsLoading } = useQuery<VerdictResponse[]>({
    queryKey: ['monitor-verdicts'],
    queryFn: getVerdicts,
    refetchInterval: 10000,
  })

  const { data: alerts, isLoading: alertsLoading } = useQuery<VerdictResponse[]>({
    queryKey: ['monitor-alerts'],
    queryFn: getAlerts,
    refetchInterval: 10000,
  })

  const isEmpty = !statusLoading && status && status.total_verdicts === 0

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="p-6 border-b flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Production Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live conformance monitoring. A judge scores live outputs asynchronously and surfaces
            drift as it happens.
          </p>
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium mt-1 bg-card">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ backgroundColor: '#0D9488' }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: '#0D9488' }}
            />
          </span>
          Refreshing every 10s
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {isEmpty ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            No production verdicts yet. Submit tickets via the Try It page to see monitoring data.
          </div>
        ) : (
          <>
            {/* Top metrics row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Overall Conformance */}
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                    Overall Conformance
                    <InfoTooltip text="Average behavioral score across all live interactions judged so far. Scores below 90% trigger an alert. This is computed from real production traffic, not the test corpus." side="top" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statusLoading ? (
                    <Skeleton className="h-8 w-20" />
                  ) : status ? (
                    <>
                      <p
                        className="text-2xl font-semibold"
                        style={{ color: conformanceColor(status.overall_conformance_rate) }}
                      >
                        {(status.overall_conformance_rate * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {status.overall_conformance_rate >= 0.9
                          ? 'Above 90% target'
                          : 'Below 90% target'}
                      </p>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              {/* Verdicts Monitored */}
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                    Verdicts Monitored
                    <InfoTooltip text="A verdict is one live customer interaction that has been scored by the judge. The judge runs asynchronously after each response and scores it against the behavioral spec." side="top" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statusLoading ? (
                    <Skeleton className="h-8 w-16" />
                  ) : status ? (
                    <>
                      <p className="text-2xl font-semibold">{status.total_verdicts}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">total</p>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              {/* Active Alerts */}
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                    Active Alerts
                    <InfoTooltip text="Interactions where the overall behavioral score fell below the alert threshold (80%). Each alert means a real customer response failed to meet the spec in a meaningful way." side="top" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statusLoading ? (
                    <Skeleton className="h-8 w-16" />
                  ) : status ? (
                    <>
                      <p
                        className="text-2xl font-semibold"
                        style={{ color: status.alert_count > 0 ? '#F43F5E' : '#0D9488' }}
                      >
                        {status.alert_count}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {status.alert_count > 0 ? 'Needs attention' : 'All clear'}
                      </p>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              {/* Live refresh indicator */}
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Live</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                        style={{ backgroundColor: '#0D9488' }}
                      />
                      <span
                        className="relative inline-flex h-2 w-2 rounded-full"
                        style={{ backgroundColor: '#0D9488' }}
                      />
                    </span>
                    <p className="text-sm font-semibold" style={{ color: '#0D9488' }}>
                      Active
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Refreshing every 10s</p>
                </CardContent>
              </Card>
            </div>

            {/* Category breakdown */}
            {status && Object.keys(status.category_breakdown).length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-3">Category Breakdown</h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {Object.entries(status.category_breakdown).map(([propId, score]) => {
                    const propCfg = PROPERTY_CONFIGS.find((p) => p.id === propId)
                    const threshold = propCfg?.threshold ?? 0.8
                    const displayName = propCfg?.displayName ?? formatPropertyName(propId)
                    const color = scoreColor(score, threshold)
                    const isAlert = score < threshold
                    return (
                      <Card
                        key={propId}
                        className={cn('border', isAlert && 'border-opacity-60')}
                        style={isAlert ? { borderColor: color } : undefined}
                      >
                        <CardHeader className="pb-1">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center">
                              {displayName}
                              <InfoTooltip text={PROPERTY_DESCRIPTIONS[propId] ?? displayName} side="top" />
                            </CardTitle>
                            {isAlert && (
                              <AlertCircle className="h-3.5 w-3.5" style={{ color: '#F43F5E' }} />
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-semibold" style={{ color }}>
                            {(score * 100).toFixed(1)}%
                          </p>
                          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${score * 100}%`, backgroundColor: color }}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Alert log */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Alert Log
                  <span className="ml-auto text-[11px] font-normal text-muted-foreground">click to expand</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-2">
                {alertsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : !alerts || alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No alerts</p>
                ) : (
                  alerts.map((alert: VerdictResponse, i: number) => (
                    <AlertEntry key={alert.id ?? i} alert={alert} />
                  ))
                )}
              </CardContent>
            </Card>

            {/* Verdict log */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  Recent Verdicts
                  <span className="ml-auto text-[11px] font-normal text-muted-foreground">click to expand</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {verdictsLoading ? (
                  <div className="p-4 space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : !verdicts || verdicts.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No verdicts yet
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {verdicts.slice(0, 10).map((verdict: VerdictResponse, i: number) => (
                      <VerdictEntry key={verdict.id ?? i} verdict={verdict} index={i} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
