# Glass Box

A customer support AI with full behavioral visibility. Built as a companion to the [Locked In Without Knowing It](https://aravinddoma.substack.com/p/locked-in-without-knowing-it-why) article series on [aravinddoma.substack.com](https://aravinddoma.substack.com).

Most GenAI applications are black boxes — a prompt goes in, a response comes out, and there's no systematic way to verify whether the application is behaving as designed. Glass Box is the same application, but you can see inside it.

## What it shows

- **Behavioral spec** — a machine-readable contract defining what the application is supposed to do
- **Conformance scoring** — every response is scored against the spec by a judge model
- **Drift detection** — behavioral history over time, with threshold alerts
- **Model comparison** — Sonnet vs Haiku on identical behavioral criteria, not benchmark numbers
- **Production monitoring** — simulated live conformance monitoring with a running verdict log

## Setup

### Requirements
- Python 3.11+
- Node.js 18+
- An Anthropic API key

### Install

```bash
# Clone the repo
git clone https://github.com/ad25343/GlassBox.git
cd GlassBox

# Install all dependencies (Python + Node)
make install
```

### Configure

```bash
cp .env.example .env
```

Open `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Run

```bash
make dev
```

This starts both servers:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8888
- **API docs**: http://localhost:8888/docs

## Pages

| Page | What it does |
|---|---|
| **Home** | Explains the Glass Box concept and links to all five capabilities |
| **Try It** | Submit a live customer support ticket. See the response and the judge's verification side-by-side. |
| **Test Suite** | Run the full 36-example ground truth corpus through the model. Get a per-property conformance report. Save as a baseline. |
| **Baseline & Drift** | 14-day behavioral history. Timeline chart, snapshot table, incident log. Pre-populated with synthetic history showing realistic drift patterns. |
| **Model Comparison** | Run the same spec and test suite against Claude Sonnet and Claude Haiku. Compare on behavioral criteria, with cost-per-conforming-output. |
| **Production Monitor** | Simulated production conformance monitoring. Running conformance rate by ticket category, alert log, individual verdict log. |

## How it works

### The behavioral spec (`spec.json`)

Defines what the application is supposed to do in precise, testable terms.

**Non-negotiables** (binary — zero tolerance):
- Never promise a refund without first checking eligibility
- Always escalate to a human if the customer expresses frustration more than once
- Never share account details that weren't in the provided context

**Behavioral properties** (scored, with targets and alert thresholds):
- Issue acknowledged before resolution (target: >95%, alert: <85%)
- Resolution matches documented path (target: >90%, alert: <80%)
- Professional and empathetic tone (target: >90%, alert: <80%)
- Concise — no unnecessary repetition (target: >85%, alert: <75%)

### The judge (`backend/services/judge.py`)

Claude Haiku, prompted to evaluate every response against the spec. Receives the customer message, the documented resolution path, and the model's response. Returns a structured JSON verdict with per-property scores and reasoning.

### The runtime (`backend/services/runtime.py`)

Constructs prompts from the spec and resolution paths. Calls Claude Sonnet. Validates against non-negotiables. If any non-negotiable fails, retries once with an explicit correction instruction. Logs everything to SQLite.

### Drift detection (`backend/services/drift.py`)

Runs the full corpus against the live model on a schedule, stores snapshots, and computes per-property deltas against the baseline. The demo is pre-seeded with 14 days of synthetic history so the drift page tells a story immediately.

## Tech stack

- **Backend**: Python / FastAPI / SQLite
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Models**: Claude Sonnet (production), Claude Haiku (judge + candidate comparison)

## Article series

Glass Box is a companion project to the *Locked In Without Knowing It* series on [aravinddoma.substack.com](https://aravinddoma.substack.com):

1. [Locked In Without Knowing It](https://aravinddoma.substack.com/p/locked-in-without-knowing-it-why) — Why swapping GenAI models breaks more than you think
2. [Beyond Chatbots](https://aravinddoma.substack.com/p/beyond-chatbots-the-architectural) — The architectural shift to AI agents
3. [Verified by Design](https://aravinddoma.substack.com/p/verified-by-design-behavioral-consistency) — Behavioral consistency in GenAI — the verification layer
4. **Glass Box** — coming soon

## License

MIT — see [LICENSE](LICENSE)
