import { RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSnapshots, getIncidents, triggerSnapshot, type SnapshotResponse, type IncidentResponse } from '@/lib/api'

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

function scoreColor(score: number, target: number, alertThreshold: number): string {
  if (score >= target) return '#0D9488'
  if (score >= alertThreshold) return '#F59E0B'
  return '#F43F5E'
}

function formatPropertyName(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const MIN_VAL = 0.7
const MAX_VAL = 1.0
const RANGE = MAX_VAL - MIN_VAL

function SparklineRow({
  prop,
  snapshots,
}: {
  prop: PropertyConfig
  snapshots: SnapshotResponse[]
}) {
  const currentScore = snapshots.length > 0
    ? (snapshots[snapshots.length - 1].property_scores[prop.id] ?? 0)
    : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold" style={{ color: prop.color }}>
          {prop.displayName}
        </span>
        <span className="text-xs text-muted-foreground font-mono">
          {(currentScore * 100).toFixed(1)}% current
        </span>
      </div>
      {/* Sparkline bars */}
      <div className="flex items-end gap-0.5 h-12">
        {snapshots.map((snap, i) => {
          const val = snap.property_scores[prop.id] ?? 0
          const heightPct = Math.max(((val - MIN_VAL) / RANGE) * 100, 4)
          const barColor = scoreColor(val, prop.target, prop.alertThreshold)
          return (
            <div
              key={i}
              className="flex-1 rounded-sm transition-opacity"
              style={{
                height: `${heightPct}%`,
                backgroundColor: barColor,
                opacity: 0.85,
              }}
              title={`${new Date(snap.created_at).toLocaleDateString()}: ${(val * 100).toFixed(1)}%`}
            />
          )
        })}
      </div>
      {/* Date labels — show first and last */}
      {snapshots.length > 0 && (
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-muted-foreground">
            {new Date(snapshots[0].created_at).toLocaleDateString()}
          </span>
          {snapshots.length > 1 && (
            <span className="text-[9px] text-muted-foreground">
              {new Date(snapshots[snapshots.length - 1].created_at).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default function DriftPage() {
  const queryClient = useQueryClient()

  const { data: snapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: getSnapshots,
  })

  const { data: incidents, isLoading: incidentsLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: getIncidents,
  })

  const runMutation = useMutation({
    mutationFn: () => triggerSnapshot('claude-sonnet-4-5'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
    },
  })

  const isRunning = runMutation.isPending

  const recentSnapshots = snapshots ? snapshots.slice(-10).reverse() : []
  const hasEnoughHistory = (snapshots?.length ?? 0) >= 2

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="p-6 border-b flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Baseline &amp; Drift</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Behavioral history over time. See what moved, when, and by how much.
          </p>
        </div>
        <Button
          className="text-white mt-1"
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
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Run Now
            </>
          )}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Section A: Timeline chart */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">Conformance Rate Over Time</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {snapshotsLoading ? (
              <div className="space-y-5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i}>
                    <Skeleton className="h-3 w-40 mb-2" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ))}
              </div>
            ) : !hasEnoughHistory ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Not enough history yet. Run the test suite to build a timeline.
              </p>
            ) : (
              <div className="space-y-5">
                {PROPERTY_CONFIGS.map((prop) => (
                  <SparklineRow key={prop.id} prop={prop} snapshots={snapshots ?? []} />
                ))}
                <p className="text-xs text-muted-foreground mt-4">
                  Amber = near threshold. Rose = below threshold. Hover bars for exact values.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section B: Snapshot table */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">Recent Snapshots</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {snapshotsLoading ? (
              <div className="p-4 space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : recentSnapshots.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No snapshots yet. Run the test suite to see results.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {['Date', 'Overall', ...PROPERTY_CONFIGS.map((p) => p.displayName)].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentSnapshots.map((snap: SnapshotResponse, i: number) => (
                    <tr
                      key={snap.id ?? i}
                      className={cn('border-b last:border-0', i % 2 === 0 ? '' : 'bg-muted/30')}
                    >
                      <td className="px-4 py-2.5 text-sm font-medium">
                        {new Date(snap.created_at).toLocaleDateString()}
                      </td>
                      <td
                        className="px-4 py-2.5 font-mono text-xs font-semibold"
                        style={{ color: scoreColor(snap.overall_conformance, 0.88, 0.8) }}
                      >
                        {(snap.overall_conformance * 100).toFixed(1)}%
                      </td>
                      {PROPERTY_CONFIGS.map((prop) => {
                        const val = snap.property_scores[prop.id] ?? 0
                        return (
                          <td
                            key={prop.id}
                            className="px-4 py-2.5 font-mono text-xs"
                            style={{ color: scoreColor(val, prop.target, prop.alertThreshold) }}
                          >
                            {(val * 100).toFixed(1)}%
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Section C: Incident log */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">Incident Log</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {incidentsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : !incidents || incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">No incidents</p>
            ) : (
              incidents.map((incident: IncidentResponse, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border p-3"
                  style={{ borderColor: '#F43F5E', backgroundColor: '#F43F5E11' }}
                >
                  <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: '#F43F5E' }} />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">
                        {new Date(incident.created_at).toLocaleString()}
                      </span>
                      <Badge className="text-xs" style={{ backgroundColor: '#F43F5E', color: '#fff' }}>
                        INCIDENT
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      <span className="font-medium text-foreground">
                        {formatPropertyName(incident.property_id)}
                      </span>{' '}
                      dropped to{' '}
                      <strong className="text-foreground" style={{ color: '#F43F5E' }}>
                        {(incident.score * 100).toFixed(1)}%
                      </strong>{' '}
                      (threshold: {(incident.alert_threshold * 100).toFixed(0)}%).
                      {incident.delta_from_baseline !== null && (
                        <span className="text-muted-foreground ml-1">
                          Delta from baseline: {(incident.delta_from_baseline * 100).toFixed(1)}%
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
