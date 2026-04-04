# GlassBox — Claude Instructions

## What is GlassBox?
GlassBox is a customer support AI with full behavioral visibility — a demonstration of what a GenAI application looks like when transparency and verifiability are built in from the start, not bolted on after.

It shows: what the model is supposed to do (behavioral spec), whether it's doing it (conformance scoring), where it drifted (drift detection over time), and what changed when you swapped models (pre/post comparison).

## Stack
- **Backend**: Python / FastAPI
- **UI**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui (folder: `ui/`)
- **DB**: SQLite (dev) → PostgreSQL (prod)
- **SDKs**: `anthropic` (primary — Claude Sonnet production, Claude Haiku judge/candidate)
- **Routing**: React Router v6
- **Data fetching**: TanStack Query
- **Charts**: CSS/div-based (no external chart lib)

## Project layout
```
GlassBox/
├── backend/
│   ├── api/
│   │   └── routes/         # traces.py, runs.py, compare.py, monitor.py
│   ├── core/               # config.py, db.py, logging.py
│   ├── services/           # judge.py, runtime.py, drift.py
│   └── main.py
├── ui/                     # Glass Box UI (React/Vite)
│   └── src/
│       ├── components/
│       │   ├── layout/     # Layout.tsx (sidebar + theme toggle)
│       │   └── ui/         # shadcn components
│       ├── lib/            # utils.ts, theme.tsx, api.ts
│       └── pages/          # HomePage, TryItPage, TestSuitePage, DriftPage, ComparePage, MonitorPage
├── spec.json               # Behavioral spec (non-negotiables + behavioral properties)
├── corpus.json             # 36 labeled ground-truth examples
├── Makefile                # dev / install commands
├── docs/                   # Architecture, interaction diagrams, behavioral spec docs
├── .claude/                # Claude Code config (committed)
├── .env                    # Local secrets (gitignored)
├── .env.example            # Template (committed)
├── requirements.txt
└── CLAUDE.md
```

## Environment setup
1. Copy `.env.example` → `.env` and fill in your Anthropic API key
2. **Never commit `.env`**

```bash
# .env required keys
ANTHROPIC_API_KEY=sk-ant-...   # required
OPENAI_API_KEY=sk-...          # optional
GOOGLE_API_KEY=AIza...         # optional
```

## Dev commands

```bash
# One command — starts both backend (port 8000) and UI (port 5173)
make dev

# First-time setup — install all Python + Node deps
make install

# Backend only
uvicorn backend.main:app --reload --port 8000

# UI only
cd ui && npm run dev

# Tests
pytest

# Lint
ruff check . && ruff format --check .
```

Glass Box UI: http://localhost:5173
Backend API: http://localhost:8888
API docs (auto): http://localhost:8888/docs

## How it works

### The behavioral spec (`spec.json`)
The source of truth for what the application is supposed to do. Two types of properties:

**Non-negotiables** — binary pass/fail, zero tolerance. Enforced at the runtime level (included in the system prompt) AND verified by the judge. If the judge flags a failure, the runtime retries ONCE with a correction addendum.
- `no_premature_refund` — never promise a refund without checking eligibility
- `escalation_threshold` — escalate to human if customer frustrated more than once
- `no_unauthorized_account_details` — never share account details not in provided context

**Behavioral properties** — scored 0–1 by the judge, with a target and an alert threshold.
- `issue_acknowledged` — target 0.95, alert below 0.85
- `resolution_matching` — target 0.90, alert below 0.80
- `professional_tone` — target 0.90, alert below 0.80
- `concise_response` — target 0.85, alert below 0.75

### The judge (`services/judge.py`)
Claude Haiku, running as an independent evaluator. Receives: customer message + resolution path + model response + spec. Returns structured JSON with per-property pass/fail and scores. Operates separately from the runtime — it doesn't know whether the runtime thought the response was good.

### The runtime (`services/runtime.py`)
Constructs the system prompt from spec non-negotiables + resolution path for the ticket type + customer context. Calls Claude Sonnet. Sends response to the judge. Retries once if any non-negotiable fails. Logs everything to SQLite (3 tables per ticket).

### Drift detection (`services/drift.py`)
At startup, seeds 14 days of synthetic history (showing realistic drift patterns — stable → drops → partial recovery → stabilizes). On demand, re-runs the full 36-example corpus against the live model, stores a snapshot, and computes per-property deltas vs the baseline.

## Pages
| Route | Page | What it does |
|---|---|---|
| `/` | Home | Splash — explains the Glass Box concept |
| `/try-it` | Try It | Submit a live ticket, see response + verification |
| `/test-suite` | Test Suite | Run full corpus, get per-property conformance report |
| `/drift` | Baseline & Drift | 14-day behavioral history, incident log |
| `/compare` | Model Comparison | Sonnet vs Haiku side-by-side on behavioral criteria |
| `/monitor` | Production Monitor | Simulated live conformance monitoring |

## API routes
All under `/api/v1/`. All responses: `{ "data": ..., "meta": ... }`.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/traces/` | Submit ticket → RunResult with verdict |
| GET | `/api/v1/traces/` | List recent runs |
| GET | `/api/v1/runs/snapshots` | All baseline snapshots |
| POST | `/api/v1/runs/snapshot` | Trigger fresh test suite run |
| GET | `/api/v1/runs/incidents` | Threshold breaches + non-negotiable failures |
| POST | `/api/v1/compare/` | Run both models, get side-by-side results |
| GET | `/api/v1/monitor/status` | Live conformance summary |
| GET | `/api/v1/monitor/alerts` | Alerts only |

## Code conventions
- See `.claude/rules/` for detailed style, testing, and API conventions.
- Pydantic v2 for all request/response schemas.
- All LLM calls go through `backend/services/` — never call SDKs directly from routes.
- Every LLM call must log latency, tokens, model, provider to SQLite.
- UI brand colors: teal `#0D9488` (passing), amber `#F59E0B` (warning), rose `#F43F5E` (alert).
- Use inline `style={{}}` for brand hex colors not in Tailwind. Use `cn()` from `@/lib/utils` for conditional classes.
