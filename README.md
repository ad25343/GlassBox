# Glass Box

**Spec-driven development for GenAI applications.**

Spec-driven development means defining exactly what the system should do — independently of how it does it — then continuously verifying that actual behavior conforms to that definition. Not as a one-time audit. As living infrastructure.

A working reference implementation showing what a production GenAI application looks like when behavioral transparency is built in from the start — not bolted on after.

The behavioral specification is the source of truth for everything: the system prompt, the judge's evaluation, the retry logic, the alert thresholds, and the drift history. Swapping models or adapting to a new domain means replacing two files. Nothing else changes.

Built as a companion to the [Locked In Without Knowing It](https://aravinddoma.substack.com/p/locked-in-without-knowing-it-why) article series.

---

## What it shows

- **Behavioral spec** — a machine-readable contract defining what the application must do, with non-negotiables and scored properties
- **Multi-turn agent** — the model calls deterministic tools (order lookup, return eligibility, billing history) before generating a response, not a single-shot prompt
- **Conformance scoring** — every response is scored against the spec by an independent judge model, including whether the right tools were called in the right order
- **Drift detection** — behavioral history over 14 days, with per-property trend lines and threshold alerts
- **Model comparison** — Sonnet vs Haiku on identical behavioral criteria, with cost-per-conforming-output
- **Production monitoring** — live conformance monitoring with a running verdict log and alert feed
- **Production monitoring** — live conformance monitoring with alert log showing the full ticket context (customer message, model response, per-property scores) for every flagged interaction
- **Chat log analytics** — tool call frequency, session patterns, and turn log — the operator's view of what the agent is doing across every conversation

---

## Quickstart

### Requirements

- Python 3.11+
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) — the only required credential

### 1. Clone and install

```bash
git clone https://github.com/ad25343/GlassBox.git
cd GlassBox
make install
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else in `.env.example` is optional.

### 3. Run

```bash
make dev
```

This starts both servers concurrently:

| | URL |
|---|---|
| **Frontend** | http://localhost:5173 |
| **Backend API** | http://localhost:8888 |
| **API docs** | http://localhost:8888/docs |

The database is created and seeded automatically on first run — no migration step needed.

---

## Pages

| Page | Route | What it does |
|---|---|---|
| **Home** | `/` | Overview of the Glass Box concept |
| **Live Runtime** | `/try-it` | Submit a ticket as one of the seeded personas. Watch the agent call tools, then see the judge's verdict with per-property scores. |
| **Model Evaluation** | `/test-suite` | Run the full 36-example corpus concurrently through the model. Per-property conformance report, per-example drill-down, run history. |
| **Baseline & Drift** | `/drift` | Behavioral history over time. Delta cards show current score vs spec-defined targets. Editable thresholds per property. Pre-seeded with 14 days of synthetic drift patterns. |
| **Model Comparison** | `/compare` | Run Sonnet and Haiku against the same spec and corpus. Compare on behavioral criteria, not benchmarks. Full run history persists across sessions. |
| **Production Monitor** | `/monitor` | Live conformance monitoring. Alert log shows full ticket context — customer message, model response, per-property scores — for every flagged interaction. |
| **Chat Log Analytics** | `/chatlogs` | Tool call frequency, session patterns, turn log — the operator's view of what the agent is doing across every conversation. |

---

## How it works

### The behavioral spec (`spec.json`)

The source of truth for everything domain-specific — this is what makes GlassBox spec-driven. The runtime reads it to build the system prompt. The judge reads it to score responses. The alert logic reads it for thresholds. The retry reads it for the correction instruction. To adapt to a new domain, replace this file and the corpus.

**Non-negotiables** — binary pass/fail, zero tolerance:
- Never promise a refund without first checking eligibility
- Always escalate to a human if the customer expresses frustration more than once in the same session
- Never reference account information that wasn't provided in the session context

**Behavioral properties** — scored 0–1, with targets and alert thresholds:
- Issue acknowledged before resolution (target 95%, alert below 85%)
- Resolution matches the documented path (target 90%, alert below 80%)
- Professional and empathetic tone (target 90%, alert below 80%)
- Concise — no unnecessary repetition (target 85%, alert below 75%)

### The agent loop (`backend/services/agent.py`)

The model doesn't generate a response from a pre-filled context. It runs as a multi-turn agent, calling tools to discover what it needs:

1. Customer message arrives
2. Model decides which tools to call — in order, as specified by the resolution path
3. Each tool returns a deterministic result (database lookup, no inference)
4. Model generates the final response from what it found

Maximum 5 tool calls per turn. If the cap is hit, the runtime forces a final response without tools.

### The tools (`backend/services/tools.py`)

Six deterministic tools — all direct database reads, no LLM involvement:

| Tool | What it does |
|---|---|
| `lookup_customer` | Finds customer record by last name and order ID |
| `get_order_details` | Returns order status, items, tracking, delivery date |
| `check_return_eligibility` | Computes days since delivery vs. 30-day return window |
| `get_return_label` | Returns a deterministic pre-paid label reference |
| `get_billing_charges` | Lists charges for an order |
| `get_order_history` | Lists all orders for a customer |

### Seed data

The database is pre-seeded with five customer personas and realistic support scenarios so the Live Runtime page works immediately:

| Persona | Scenario |
|---|---|
| Sarah Chen | Order in transit, last scan 4 days ago |
| James Rodriguez | Delivered 18 days ago, 12 days left in return window |
| Priya Patel | $89 charge dispute on a delivered order |
| Michael Thompson | Order delivered, checking status |
| Emily Davis | Order history lookup |

### The judge (`backend/services/judge.py`)

Claude Haiku, running as an independent evaluator. Receives the customer message, the documented resolution path, the full tool call trace, and the model's response. Returns a structured JSON verdict with per-property scores and reasoning. Crucially: it verifies that the right tools were called in the right order, not just that the response text is good.

If any non-negotiable fails, the runtime retries once with a correction instruction and re-scores.

### The log writer (`backend/services/log_writer.py`)

Every live session is written asynchronously to two places:
- **SQLite** (`glassbox.db`) — queryable, powers the Chat Log Analytics page
- **JSONL** (`chat_logs.jsonl`) — portable, one line per turn, easy to inspect

The write is fire-and-forget — it doesn't block the response.

### Drift detection (`backend/services/drift.py`)

Runs the full 36-example corpus against the live model on demand — all 36 examples fire concurrently via `asyncio.gather`, completing in roughly the time of the slowest single call (~30s for Sonnet). Stores a snapshot with model version and prompt version. The Baseline & Drift page reads these snapshots and computes per-property deltas against spec-defined targets (not a historical snapshot). The demo is pre-seeded with 14 days of synthetic history so the drift page has a story to tell immediately.

---

## Running tests

```bash
pytest
```

Tests live in `tests/`, mirroring the `backend/` structure. All LLM calls are mocked — no API key needed to run the test suite.

---

## Project structure

```
GlassBox/
├── backend/
│   ├── api/routes/         # traces, runs, compare, monitor, chatlogs, spec
│   ├── core/               # config, db (init + seed), logging
│   ├── services/           # agent, tools, judge, runtime, drift, log_writer
│   └── main.py
├── ui/src/
│   ├── pages/              # one file per page
│   ├── components/         # layout + shadcn ui
│   └── lib/                # api.ts, utils, theme
├── tests/                  # pytest — mirrors backend/
├── spec.json               # behavioral contract
├── corpus.json             # 36 labeled ground-truth examples
└── docs/                   # architecture, data flow, behavioral spec docs
```

---

## Tech stack

- **Backend**: Python / FastAPI / SQLite
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Models**: Claude Sonnet (production agent), Claude Haiku (judge + comparison candidate)
- **SDKs**: `anthropic` Python SDK with tool_use API

---

## Article series

Glass Box is a companion project to the *Locked In Without Knowing It* series:

1. [Locked In Without Knowing It](https://aravinddoma.substack.com/p/locked-in-without-knowing-it-why) — Why swapping GenAI models breaks more than you think
2. [Consistent by Design](https://aravinddoma.substack.com/p/consistent-by-design-engineering) — Engineering behavioral consistency into GenAI applications
3. [Verified by Design](https://aravinddoma.substack.com/p/verified-by-design-behavioral-consistency) — The verification layer
4. [Glass Box](https://aravinddoma.substack.com/p/the-glass-box) — Spec-driven development, the full working implementation

---

## License

MIT — see [LICENSE](LICENSE)
