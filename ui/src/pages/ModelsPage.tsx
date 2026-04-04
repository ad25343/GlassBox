import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const providers = [
  { name: 'Anthropic', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'], color: 'bg-orange-500' },
  { name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'o3'], color: 'bg-green-500' },
  { name: 'Google', models: ['gemini-2.0-flash', 'gemini-1.5-pro'], color: 'bg-blue-500' },
]

export default function ModelsPage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Models</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {providers.map((p) => (
          <Card key={p.name}>
            <CardHeader className="pb-2 flex-row items-center gap-2">
              <span className={`size-2.5 rounded-full ${p.color}`} />
              <CardTitle className="text-sm font-medium">{p.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {p.models.map((m) => (
                <Badge key={m} variant="secondary" className="block w-fit font-mono text-xs">
                  {m}
                </Badge>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
