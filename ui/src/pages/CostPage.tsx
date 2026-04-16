import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useQuery } from '@tanstack/react-query'
import { getCostSummary, type CostSummary, type DailyCostStats } from '@/lib/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function shortDate(day: string): string {
  const d = new Date(day + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Daily bar chart (CSS/div based) ──────────────────────────────────────────

function DailyCostChart({ daily }: { daily: DailyCostStats[] }) {
  if (daily.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No daily data yet — runs will appear here once they are recorded.
      </p>
    )
  }

  const maxCost = Math.max(...daily.map((d) => d.estimated_cost_usd), 0.000001)

  return (
    <div className="flex items-end gap-1.5 h-40 pt-4 pb-0">
      {daily.map((d) => {
        const heightPct = (d.estimated_cost_usd / maxCost) * 100
        return (
          <div key={d.day} className="flex flex-col items-center flex-1 min-w-0 group relative">
            {/* Tooltip */}
            <div
              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 hidden group-hover:flex flex-col items-center pointer-events-none"
            >
              <div
                className="rounded px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-md"
                style={{ backgroundColor: '#0D9488' }}
              >
                <div className="font-semibold">{shortDate(d.day)}</div>
                <div>{formatCost(d.estimated_cost_usd)}</div>
                <div className="text-white/70">{d.runs} run{d.runs !== 1 ? 's' : ''}</div>
                <div className="text-white/70">{formatTokens(d.total_tokens)} tokens</div>
              </div>
              <div
                className="w-2 h-2 rotate-45 -mt-1"
                style={{ backgroundColor: '#0D9488' }}
              />
            </div>

            {/* Bar */}
            <div
              className="w-full rounded-t-sm transition-all"
              style={{
                height: `${Math.max(heightPct, 2)}%`,
                backgroundColor: '#0D9488',
                opacity: d.estimated_cost_usd > 0 ? 1 : 0.2,
              }}
            />

            {/* Date label */}
            <span className="text-[9px] text-muted-foreground mt-1 truncate w-full text-center select-none">
              {shortDate(d.day)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: CostSummary }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">Total Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{data.total_runs.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-0.5">all time</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">Avg Latency</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold" style={{ color: '#0D9488' }}>
            {formatMs(data.avg_latency_ms)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">mean response time</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">P95 Latency</CardTitle>
        </CardHeader>
        <CardContent>
          <p
            className="text-2xl font-semibold"
            style={{ color: data.p95_latency_ms > 10000 ? '#F59E0B' : '#0D9488' }}
          >
            {formatMs(data.p95_latency_ms)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">95th percentile</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">Estimated Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold" style={{ color: '#F59E0B' }}>
            {formatCost(data.estimated_cost_usd)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatTokens(data.total_tokens)} tokens
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── By model table ────────────────────────────────────────────────────────────

function ModelTable({ data }: { data: CostSummary }) {
  if (data.by_model.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground text-center">
        No runs recorded yet.
      </p>
    )
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          {['Model', 'Runs', 'Avg Latency', 'Total Tokens', 'Est. Cost'].map((h) => (
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
        {data.by_model.map((row, i) => (
          <tr
            key={row.model}
            className={i % 2 !== 0 ? 'bg-muted/10 border-b last:border-0' : 'border-b last:border-0'}
          >
            <td className="px-4 py-3 font-mono text-xs">{row.model}</td>
            <td className="px-4 py-3">{row.total_runs.toLocaleString()}</td>
            <td className="px-4 py-3 font-mono text-xs" style={{ color: '#0D9488' }}>
              {formatMs(row.avg_latency_ms)}
            </td>
            <td className="px-4 py-3 font-mono text-xs">
              {formatTokens(row.total_tokens)}
              <span className="text-muted-foreground ml-1 text-[10px]">
                ({formatTokens(row.total_input_tokens)} in / {formatTokens(row.total_output_tokens)} out)
              </span>
            </td>
            <td className="px-4 py-3 font-semibold" style={{ color: '#F59E0B' }}>
              {formatCost(row.estimated_cost_usd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CostPage() {
  const { data, isLoading, isError } = useQuery<CostSummary>({
    queryKey: ['cost-summary'],
    queryFn: getCostSummary,
    staleTime: 30_000,
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b">
        <h1 className="text-xl font-semibold">Cost &amp; Latency</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Token usage and response time across all runs
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader className="pb-1">
                    <Skeleton className="h-3 w-28" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-20 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader className="border-b pb-3">
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="p-4">
                <Skeleton className="h-40 w-full" />
              </CardContent>
            </Card>
          </>
        ) : isError ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            Failed to load cost data. Make sure the backend is running.
          </div>
        ) : data ? (
          <>
            {/* Summary cards */}
            <SummaryCards data={data} />

            {/* By model table */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-medium">By Model</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ModelTable data={data} />
              </CardContent>
            </Card>

            {/* Daily cost chart */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  Daily Estimated Cost
                  <span className="text-xs font-normal text-muted-foreground">last 14 days</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-2 pb-4">
                <DailyCostChart daily={data.daily} />
              </CardContent>
            </Card>

            {/* Token breakdown */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm font-medium">Token Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-semibold" style={{ color: '#0D9488' }}>
                      {formatTokens(data.total_input_tokens)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Input tokens</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold" style={{ color: '#F59E0B' }}>
                      {formatTokens(data.total_output_tokens)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Output tokens</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">
                      {formatTokens(data.total_tokens)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Total tokens</p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-4 text-center">
                  Prices: $0.000003 / input token · $0.000015 / output token (approximate Sonnet rates)
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  )
}
