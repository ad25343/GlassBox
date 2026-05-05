/**
 * CorpusPage — view, add, edit, and delete ground-truth corpus examples.
 *
 * The corpus (corpus.json) is the labeled dataset that drives test suite runs.
 * Each example has a ticket type, customer message, context, resolution path,
 * and a conforming / non_conforming ground-truth label.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getCorpusExamples,
  createCorpusExample,
  updateCorpusExample,
  deleteCorpusExample,
  type CorpusExample,
  type CorpusExampleCreate,
} from '@/lib/api'

// ── Constants ─────────────────────────────────────────────────────────────────

const TICKET_TYPES = ['order_status', 'refund_request', 'billing_dispute', 'escalation']

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  conforming:     { bg: 'rgba(13,148,136,0.12)', text: '#0D9488' },
  non_conforming: { bg: 'rgba(244,63,94,0.12)',  text: '#F43F5E' },
}

const EMPTY_FORM: CorpusExampleCreate = {
  ticket_type: 'order_status',
  customer_message: '',
  context: {},
  resolution_path: '',
  label: 'conforming',
  notes: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseContext(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface LabelBadgeProps { label: string }
function LabelBadge({ label }: LabelBadgeProps) {
  const colors = LABEL_COLORS[label] ?? { bg: 'rgba(100,100,100,0.12)', text: '#888' }
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {label.replace('_', ' ')}
    </span>
  )
}

interface ExampleRowProps {
  example: CorpusExample
  onEdit: (ex: CorpusExample) => void
  onDelete: (id: string) => void
  isDeleting: boolean
}
function ExampleRow({ example, onEdit, onDelete, isDeleting }: ExampleRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card">
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="toggle details"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        <span className="text-xs font-mono text-muted-foreground w-14 shrink-0">{example.id}</span>

        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded border border-border text-muted-foreground shrink-0"
        >
          {example.ticket_type}
        </span>

        <p className="flex-1 text-sm text-foreground truncate">{example.customer_message}</p>

        <LabelBadge label={example.label} />

        <button
          onClick={() => onEdit(example)}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Edit"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={() => onDelete(example.id)}
          disabled={isDeleting}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Delete"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-background border-t border-border space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Resolution path</p>
            <p className="text-foreground leading-relaxed">{example.resolution_path}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Context</p>
            <pre className="text-xs font-mono text-muted-foreground bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(example.context, null, 2)}
            </pre>
          </div>
          {example.notes && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted-foreground">{example.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Example Form (add / edit) ─────────────────────────────────────────────────

interface ExampleFormProps {
  initial: CorpusExampleCreate & { id?: string }
  onSave: (data: CorpusExampleCreate) => void
  onCancel: () => void
  isSaving: boolean
}
function ExampleForm({ initial, onSave, onCancel, isSaving }: ExampleFormProps) {
  const [form, setForm] = useState<CorpusExampleCreate>({
    ticket_type: initial.ticket_type,
    customer_message: initial.customer_message,
    context: initial.context,
    resolution_path: initial.resolution_path,
    label: initial.label,
    notes: initial.notes,
  })
  const [contextRaw, setContextRaw] = useState(JSON.stringify(initial.context, null, 2))
  const [contextError, setContextError] = useState('')

  function set<K extends keyof CorpusExampleCreate>(key: K, value: CorpusExampleCreate[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleContextChange(val: string) {
    setContextRaw(val)
    const parsed = parseContext(val)
    if (parsed) {
      setContextError('')
      set('context', parsed)
    } else {
      setContextError('Invalid JSON')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (contextError) return
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
            Ticket Type
          </label>
          <select
            value={form.ticket_type}
            onChange={e => set('ticket_type', e.target.value)}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
          >
            {TICKET_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
            Label
          </label>
          <select
            value={form.label}
            onChange={e => set('label', e.target.value as 'conforming' | 'non_conforming')}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
          >
            <option value="conforming">conforming</option>
            <option value="non_conforming">non_conforming</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
          Customer Message
        </label>
        <textarea
          value={form.customer_message}
          onChange={e => set('customer_message', e.target.value)}
          rows={3}
          required
          className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground resize-none"
          placeholder="What the customer wrote…"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
          Resolution Path
        </label>
        <textarea
          value={form.resolution_path}
          onChange={e => set('resolution_path', e.target.value)}
          rows={2}
          required
          className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground resize-none"
          placeholder="What the model should do to resolve this ticket…"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
          Context (JSON)
        </label>
        <textarea
          value={contextRaw}
          onChange={e => handleContextChange(e.target.value)}
          rows={5}
          className={cn(
            'w-full bg-background border rounded px-3 py-2 text-xs font-mono text-foreground resize-none',
            contextError ? 'border-red-500' : 'border-border',
          )}
          placeholder='{"customer_name": "Alex", "order_id": "ORD-001", ...}'
        />
        {contextError && <p className="text-xs text-red-500 mt-1">{contextError}</p>}
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
          Notes <span className="normal-case font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
          placeholder="Why is this a conforming / non-conforming example?"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSaving || !!contextError}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: '#0D9488' }}
        >
          <Check className="size-4" />
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold border border-border text-foreground hover:bg-accent transition-colors"
        >
          <X className="size-4" />
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CorpusPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'conforming' | 'non_conforming'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [editTarget, setEditTarget] = useState<CorpusExample | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const { data: examples = [], isLoading, error } = useQuery({
    queryKey: ['corpus'],
    queryFn: getCorpusExamples,
  })

  const createMutation = useMutation({
    mutationFn: createCorpusExample,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['corpus'] })
      setShowAddForm(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CorpusExampleCreate> }) =>
      updateCorpusExample(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['corpus'] })
      setEditTarget(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCorpusExample,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['corpus'] }),
  })

  const filtered = examples.filter(ex => {
    if (filter !== 'all' && ex.label !== filter) return false
    if (typeFilter !== 'all' && ex.ticket_type !== typeFilter) return false
    return true
  })

  const conformingCount   = examples.filter(e => e.label === 'conforming').length
  const nonConformingCount = examples.filter(e => e.label === 'non_conforming').length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Corpus Editor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the ground-truth labeled examples that power test suite runs and drift detection.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total',         value: examples.length,    color: 'text-foreground' },
          { label: 'Conforming',    value: conformingCount,    color: '#0D9488' },
          { label: 'Non-conforming', value: nonConformingCount, color: '#F43F5E' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card rounded-lg border border-border px-4 py-3 text-center">
            <p className="text-2xl font-bold" style={typeof color === 'string' && color.startsWith('#') ? { color } : undefined}>
              <span className={typeof color === 'string' && !color.startsWith('#') ? color : undefined}>
                {value}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters + Add button */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Label filter */}
          <div className="flex rounded border border-border overflow-hidden text-xs font-semibold">
            {(['all', 'conforming', 'non_conforming'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  filter === f
                    ? 'text-white'
                    : 'text-muted-foreground hover:text-foreground bg-background',
                )}
                style={filter === f ? { backgroundColor: '#0D9488' } : {}}
              >
                {f === 'all' ? 'All' : f.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Ticket type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground"
          >
            <option value="all">All ticket types</option>
            {TICKET_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => { setShowAddForm(true); setEditTarget(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#0D9488' }}
        >
          <Plus className="size-4" />
          Add example
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-bold text-foreground mb-4">New Corpus Example</h2>
          <ExampleForm
            initial={EMPTY_FORM}
            onSave={data => createMutation.mutate(data)}
            onCancel={() => setShowAddForm(false)}
            isSaving={createMutation.isPending}
          />
          {createMutation.isError && (
            <p className="text-xs text-red-500 mt-2">
              Save failed: {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-bold text-foreground mb-4">Edit {editTarget.id}</h2>
          <ExampleForm
            initial={editTarget}
            onSave={data => updateMutation.mutate({ id: editTarget.id, data })}
            onCancel={() => setEditTarget(null)}
            isSaving={updateMutation.isPending}
          />
          {updateMutation.isError && (
            <p className="text-xs text-red-500 mt-2">
              Save failed: {(updateMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* List */}
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading corpus…</p>
      )}
      {error && (
        <p className="text-sm" style={{ color: '#F43F5E' }}>
          Failed to load corpus: {(error as Error).message}
        </p>
      )}

      {!isLoading && !error && (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {examples.length} examples
          </p>
          <div className="space-y-2">
            {filtered.map(ex => (
              <ExampleRow
                key={ex.id}
                example={ex}
                onEdit={setEditTarget}
                onDelete={id => deleteMutation.mutate(id)}
                isDeleting={deleteMutation.isPending && deleteMutation.variables === ex.id}
              />
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No examples match the current filters.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
