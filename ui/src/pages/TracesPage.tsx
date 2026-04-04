import { Badge } from '@/components/ui/badge'

export default function TracesPage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Traces</h1>
      <div className="border rounded-md">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {['Time', 'Provider', 'Model', 'Tokens', 'Latency', 'Status'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                No traces yet. Configure a provider and make your first request.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        <Badge variant="outline">Tip</Badge>{' '}
        Traces are captured automatically for every LLM call routed through the GlassBox backend.
      </p>
    </div>
  )
}
