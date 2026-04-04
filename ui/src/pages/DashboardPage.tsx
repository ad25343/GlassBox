import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const stats = [
  { label: 'Total Requests', value: '—' },
  { label: 'Avg Latency', value: '—' },
  { label: 'Total Tokens', value: '—' },
  { label: 'Est. Cost', value: '—' },
]

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Request Volume</CardTitle>
        </CardHeader>
        <CardContent className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          Chart will render here once traces are flowing.
        </CardContent>
      </Card>
    </div>
  )
}
