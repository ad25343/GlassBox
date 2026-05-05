import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/lib/ThemeToggle'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { resetDemo } from '@/lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CapabilityCard {
  accent: string
  emoji: string
  title: string
  oneLiner: string
  why: string
  link: string
}

interface ArticleCard {
  num: string
  title: string
  oneLiner: string
  href: string
  isCurrent?: boolean
}

// ─── Data ────────────────────────────────────────────────────────────────────

const CAPABILITIES: CapabilityCard[] = [
  {
    accent: '#0D9488',
    emoji: '💬',
    title: 'Live Runtime',
    oneLiner: 'Submit a real customer support ticket. Watch the application respond — and verify itself.',
    why: 'Every response is validated against the behavioral spec before it reaches the user. Non-negotiable rules are enforced with zero tolerance. You can see exactly which properties passed and which triggered a correction.',
    link: '/runtime',
  },
  {
    accent: '#3B82F6',
    emoji: '🧪',
    title: 'Model Evaluation — Ground Truth',
    oneLiner: 'Run the ground truth corpus through the model. Get a per-property conformance report.',
    why: 'A behavioral test suite is the equivalent of a regression suite for probabilistic outputs. It tells you not just whether the model is good — but whether it follows your rules. Run it before any deployment decision.',
    link: '/test-suite',
  },
  {
    accent: '#8B5CF6',
    emoji: '📊',
    title: 'Drift Detection',
    oneLiner: 'Compare today\'s behavior against a versioned baseline. See exactly what moved and by how much.',
    why: 'Model providers update silently. Prompts degrade. Distributions shift. Drift detection re-runs the same test suite on a schedule and shows you which behavioral properties have moved outside their acceptable range — before a user notices.',
    link: '/drift',
  },
  {
    accent: '#F59E0B',
    emoji: '⚖️',
    title: 'Model Comparison',
    oneLiner: 'Run the same spec and test suite against Claude Sonnet and Claude Haiku. Compare on behavioral criteria, not benchmarks.',
    why: 'Benchmark numbers tell you what a model can do. Behavioral comparison tells you whether your application will still work the same way. See per-property conformance, cost per call, and cost per conforming output — side by side.',
    link: '/compare',
  },
  {
    accent: '#F43F5E',
    emoji: '🔍',
    title: 'Production Conformance Monitor',
    oneLiner: 'See what monitoring looks like in production. Live conformance rate, category breakdown, alert log.',
    why: 'Drift detection catches known failures. Production monitoring catches unknown ones. A judge model scores a sample of live outputs asynchronously and accumulates verdicts into a running conformance rate. When a category drops, you know where and why.',
    link: '/monitor',
  },
]

const ARTICLES: ArticleCard[] = [
  {
    num: '01',
    title: 'Locked In Without Knowing It',
    oneLiner: 'Why swapping GenAI models breaks more than you think',
    href: 'https://aravinddoma.substack.com/p/locked-in-without-knowing-it-why',
  },
  {
    num: '02',
    title: 'Consistent by Design',
    oneLiner: 'Engineering behavioral consistency into GenAI applications',
    href: 'https://aravinddoma.substack.com/p/consistent-by-design-engineering',
  },
  {
    num: '03',
    title: 'Verified by Design',
    oneLiner: 'Behavioral consistency in GenAI — the verification layer',
    href: 'https://aravinddoma.substack.com/p/verified-by-design-behavioral-consistency',
  },
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-widest mb-6"
      style={{ color: '#0D9488' }}
    >
      {children}
    </p>
  )
}

function ThinRule() {
  return <hr className="border-0 border-t" style={{ borderColor: '#0D9488', opacity: 0.4 }} />
}

function DemoBar() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function handleReset() {
    setStatus('loading')
    try {
      await resetDemo()
      setStatus('done')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <div className="bg-muted/50 border-b border-border px-6 py-2 md:px-16 lg:px-24">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Demo mode.</span>{' '}
          All data is synthetic. Reset anytime to start fresh.
        </p>
        <button
          onClick={handleReset}
          disabled={status === 'loading'}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all border',
            status === 'done'
              ? 'border-transparent text-white'
              : status === 'error'
                ? 'border-transparent text-white'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
          )}
          style={
            status === 'done'
              ? { backgroundColor: '#0D9488' }
              : status === 'error'
                ? { backgroundColor: '#F43F5E' }
                : {}
          }
        >
          <RefreshCw className={cn('size-3', status === 'loading' && 'animate-spin')} />
          {status === 'loading'
            ? 'Resetting…'
            : status === 'done'
              ? 'Reset complete'
              : status === 'error'
                ? 'Reset failed'
                : 'Reset demo data'}
        </button>
      </div>
    </div>
  )
}

// ─── Sections ────────────────────────────────────────────────────────────────

function HeroSection() {
  const navigate = useNavigate()

  return (
    <section className="bg-card px-6 py-20 md:px-16 lg:px-24">
      <div className="max-w-3xl mx-auto text-center">
        {/* Eyebrow */}
        <p
          className="text-xs font-semibold uppercase tracking-widest mb-5"
          style={{ color: '#0D9488' }}
        >
          BEHAVIORAL PORTABILITY IN GENAI
        </p>

        {/* Headline */}
        <h1 className="text-3xl md:text-5xl font-bold text-foreground leading-tight mb-6">
          You built a GenAI application.
          <br />
          Do you know if it&apos;s working?
        </h1>

        {/* Subheadline */}
        <p className="text-muted-foreground text-base md:text-lg leading-relaxed mb-4 max-w-2xl mx-auto">
          Most GenAI applications are black boxes. A prompt goes in, a response comes out, and
          nobody has a systematic way to verify whether the application is behaving as designed —
          or whether it will keep behaving that way after the next model update.
        </p>
        <p className="text-foreground text-base md:text-lg font-medium mb-10">
          Glass Box is the same application. But you can see inside it.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/runtime')}
            className="px-6 py-3 rounded-md text-white font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#0D9488' }}
          >
            Enter the Glass Box →
          </button>
          <button
            onClick={() => document.getElementById('article-series')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-6 py-3 rounded-md font-semibold text-sm border border-border text-foreground transition-colors hover:bg-accent"
          >
            Read the Article Series
          </button>
        </div>
      </div>
    </section>
  )
}

function ProblemSection() {
  return (
    <section className="px-6 py-16 md:px-16 lg:px-24">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>THE PROBLEM</SectionLabel>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Black Box card */}
          <div
            className="bg-card rounded-lg p-6 border border-border border-l-4"
            style={{ borderLeftColor: '#F59E0B' }}
          >
            <h3 className="text-lg font-bold text-foreground mb-3">The Black Box</h3>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              The default state of every GenAI application. The model runs. Responses come out.
              But there is no documented behavioral contract, no mechanism to verify conformance,
              no way to know if a model update silently changed how your application behaves. When
              something breaks, a user tells you. When you swap models, you hold your breath.
            </p>
            <ul className="space-y-2">
              {[
                'No behavioral contract — just a prompt and hope',
                'No conformance measurement — just anecdotal quality checks',
                'No model swap safety net — just benchmark numbers and guesswork',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span
                    className="mt-1.5 size-2 rounded-full shrink-0"
                    style={{ backgroundColor: '#F59E0B' }}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Glass Box card */}
          <div
            className="bg-card rounded-lg p-6 border border-border border-l-4"
            style={{ borderLeftColor: '#0D9488' }}
          >
            <h3 className="text-lg font-bold text-foreground mb-3">The Glass Box</h3>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              The same application — with visibility at every layer. The behavioral contract is
              documented and machine-readable. Every output is scored against it. Drift is detected
              before users feel it. Model swaps are measurements, not bets. The conformance rate is
              a live number, not a gut feeling.
            </p>
            <ul className="space-y-2">
              {[
                'Behavioral spec defines what good looks like — precisely',
                'Every output scored by a judge against the spec',
                'Model changes compared on identical criteria, not marketing claims',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span
                    className="mt-1.5 size-2 rounded-full shrink-0"
                    style={{ backgroundColor: '#0D9488' }}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

function CapabilitiesSection() {
  const navigate = useNavigate()

  return (
    <section className="px-6 py-16 md:px-16 lg:px-24 bg-card/50">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>WHAT YOU CAN DO</SectionLabel>
        <p className="text-muted-foreground text-sm mb-10 max-w-2xl">
          Glass Box demonstrates five capabilities that every production GenAI application should
          have. Each one is live and interactive.
        </p>

        {/* 3-top, 2-centered-bottom grid */}
        <div className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            {CAPABILITIES.slice(0, 3).map((cap) => (
              <CapCard key={cap.title} cap={cap} onNavigate={() => navigate(cap.link)} />
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-6 md:w-2/3 mx-auto">
            {CAPABILITIES.slice(3).map((cap) => (
              <CapCard key={cap.title} cap={cap} onNavigate={() => navigate(cap.link)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function CapCard({ cap, onNavigate }: { cap: CapabilityCard; onNavigate: () => void }) {
  return (
    <div
      className="bg-card rounded-lg p-6 border border-border border-l-4 flex flex-col cursor-pointer transition-shadow hover:shadow-md"
      style={{ borderLeftColor: cap.accent }}
      onClick={onNavigate}
    >
      <div className="text-2xl mb-3">{cap.emoji}</div>
      <h3 className="text-base font-bold text-foreground mb-2">{cap.title}</h3>
      <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{cap.oneLiner}</p>
      <p className="text-xs text-muted-foreground leading-relaxed mt-auto">{cap.why}</p>
    </div>
  )
}

function HowItWorksSection() {
  const steps = [
    {
      num: '01',
      label: 'Define',
      body: 'The behavioral spec documents what the application is supposed to do — in precise, testable terms. Non-negotiable rules are binary: pass or fail. Behavioral properties are scored and tracked against acceptable ranges.',
    },
    {
      num: '02',
      label: 'Verify',
      body: 'A judge model scores every response against the spec. The judge receives the incoming ticket, the documented resolution path, and the model\'s response — and returns a structured verdict. Those verdicts accumulate into conformance rates, broken down by property and category.',
    },
    {
      num: '03',
      label: 'Own',
      body: 'Baseline snapshots version the application\'s behavior at a point in time. Drift detection compares against them. Model comparisons run on identical criteria. The decision to update, swap, or roll back is a measurement — not a bet.',
    },
  ]

  return (
    <section className="px-6 py-16 md:px-16 lg:px-24">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>HOW IT WORKS</SectionLabel>
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step) => (
            <div key={step.num}>
              <div
                className="text-4xl font-black mb-3 leading-none"
                style={{ color: '#0D9488', opacity: 0.3 }}
              >
                {step.num}
              </div>
              <h3 className="text-base font-bold text-foreground mb-3">{step.label}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const LOOP_STEPS = [
  { label: 'Spec',    desc: 'Non-negotiables + behavioral properties define what good looks like',                       color: '#0D9488' },
  { label: 'Runtime', desc: 'System prompt constructed from spec + resolution path + customer context',                 color: '#3B82F6' },
  { label: 'Model',   desc: 'Claude Sonnet generates a response',                                                       color: '#8B5CF6' },
  { label: 'Judge',   desc: 'Claude Haiku independently scores every response against the spec',                        color: '#F59E0B' },
  { label: 'Verdict', desc: 'Per-property scores + pass/fail on non-negotiables',                                       color: '#F59E0B' },
  { label: 'Pass',    desc: 'Log to database → return to customer',                                                     color: '#0D9488' },
  { label: 'Retry',   desc: 'Non-negotiable violated → retry once with correction instruction → re-score',              color: '#F43F5E' },
]

function FrameworkAnchorSection() {
  const navigate = useNavigate()

  return (
    <section className="px-6 py-16 md:px-16 lg:px-24 bg-card/50">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>THE FRAMEWORK LOOP</SectionLabel>
        <div className="grid md:grid-cols-2 gap-12 items-start">
          {/* Left: explanation */}
          <div>
            <h2 className="text-xl font-bold text-foreground mb-4">
              Every response goes through this cycle.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              The spec is the anchor — everything else is verification. The judge operates
              independently of the runtime. It doesn&apos;t know whether the model thought the
              response was good. It only knows what the spec says good looks like.
            </p>
            <div className="space-y-2 mb-8">
              {[
                'Non-negotiable violations trigger an automatic retry',
                'Every verdict is logged to the database',
                'Conformance rates accumulate over time for drift detection',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#0D9488' }} />
                  {item}
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate('/spec')}
              className="px-5 py-2.5 rounded-md text-white text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#0D9488' }}
            >
              View the Behavioral Spec →
            </button>
          </div>

          {/* Right: loop diagram */}
          <div className="flex flex-col gap-0">
            {LOOP_STEPS.map((step, i) => (
              <div key={step.label} className="flex gap-4 items-start">
                <div className="flex flex-col items-center shrink-0 w-10">
                  <div
                    className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: step.color }}
                  >
                    {i + 1}
                  </div>
                  {i < LOOP_STEPS.length - 1 && (
                    <div
                      className="w-px my-1"
                      style={{ backgroundColor: step.color, opacity: 0.25, minHeight: 16 }}
                    />
                  )}
                </div>
                <div className="pb-3">
                  <p className="text-sm font-semibold text-foreground">{step.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ArticleSeriesSection() {
  return (
    <section id="article-series" className="px-6 py-16 md:px-16 lg:px-24 bg-card/50">
      <div className="max-w-5xl mx-auto">
        <SectionLabel>PART OF THE LOCKED IN WITHOUT KNOWING IT SERIES</SectionLabel>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ARTICLES.map((article) => (
            <a
              key={article.num}
              href={article.href}
              target={article.isCurrent ? undefined : '_blank'}
              rel={article.isCurrent ? undefined : 'noopener noreferrer'}
              className={cn(
                'bg-card rounded-lg p-5 border flex flex-col transition-shadow hover:shadow-md',
                article.isCurrent ? 'border-2' : 'border-border',
              )}
              style={article.isCurrent ? { borderColor: '#0D9488' } : undefined}
            >
              <span
                className="text-2xl font-black mb-3 leading-none"
                style={{ color: '#0D9488', opacity: 0.5 }}
              >
                {article.num}
              </span>
              <h4 className={cn('text-sm font-bold text-foreground mb-1', article.isCurrent && 'font-extrabold')}>
                {article.title}
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{article.oneLiner}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

function QuoteSection() {
  return (
    <section className="px-6 py-20 md:px-16 lg:px-24">
      <div
        className="max-w-3xl mx-auto bg-card rounded-lg p-10 text-center border border-border border-t-4"
        style={{ borderTopColor: '#0D9488' }}
      >
        <blockquote className="text-xl md:text-2xl font-semibold text-foreground leading-relaxed mb-6">
          &ldquo;The black box is a choice you made by not making a choice. The Glass Box is what
          deliberate looks like.&rdquo;
        </blockquote>
        <p className="text-sm text-muted-foreground">
          — Aravind Doma, <a href="https://aravinddoma.substack.com" target="_blank" rel="noopener noreferrer" style={{ color: '#0D9488' }}>Locked In Without Knowing It</a>
        </p>
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Fixed top-right theme toggle — visible on home page since there's no sidebar */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle variant="pill" />
      </div>
      <HeroSection />
      <DemoBar />
      <ThinRule />
      <ProblemSection />
      <CapabilitiesSection />
      <HowItWorksSection />
      <ThinRule />
      <FrameworkAnchorSection />
      <ThinRule />
      <ArticleSeriesSection />
      <QuoteSection />
    </div>
  )
}
