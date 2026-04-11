# Getting Started with GlassBox

A step-by-step guide for getting GlassBox running, understanding what you're seeing, and adapting it to your own domain.

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) — the only required credential

---

## 1. Clone and install

```bash
git clone https://github.com/ad25343/GlassBox.git
cd GlassBox
make install
```

`make install` installs Python dependencies (`pip install -r requirements.txt`) and Node dependencies (`cd ui && npm install`).

---

## 2. Configure your API key

```bash
cp .env.example .env
```

Open `.env` and set:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else in `.env.example` is optional. Leave it as-is for the demo.

---

## 3. Start the app

```bash
make dev
```

This starts both servers concurrently:

| | URL |
|---|---|
| **UI** | http://localhost:5173 |
| **API** | http://localhost:8888 |
| **API docs** | http://localhost:8888/docs |

The database is created and seeded automatically on first run — 5 customer personas, order history, billing records, and 14 days of synthetic behavioral history. No migration step needed.

---

## 4. First 10 minutes

### Step 1 — Try a live ticket

Go to **Live Runtime** (`/try-it`). Select a ticket type and one of the pre-seeded personas, then submit a message. You'll see:

- The agent calling tools (lookup_customer, check_return_eligibility, etc.)
- The judge's verdict: per-property scores and pass/fail for each non-negotiable
- Whether a retry was triggered (non-negotiable violated → system retried once with a correction)

This is the core loop: runtime → judge → retry if needed.

### Step 2 — Read the behavioral spec

Go to **Behavioral Spec** (`/spec` or read `spec.json` directly). This is the source of truth for everything:

- **Non-negotiables** — binary rules with zero tolerance (e.g. never promise a refund without checking eligibility)
- **Behavioral properties** — scored 0–1 (e.g. issue_acknowledged, resolution_matching)
- **Resolution paths** — per-ticket-type process the model must follow
- **Targets and alert thresholds** — what "passing" looks like for each property

### Step 3 — Run the test suite

Go to **Model Evaluation** (`/test-suite`). Select a model (Sonnet is default) and click **Run Test Suite**.

All 36 corpus examples run concurrently — this takes about 1–2 minutes. When complete, you'll see:

- Overall conformance score
- Per-property breakdown vs targets
- Non-negotiable pass rates
- Per-example drill-down: which specific examples failed and on which properties

### Step 4 — Check drift

Go to **Baseline & Drift** (`/drift`). The delta cards show current scores vs spec targets. The timeline shows all your test runs over time.

On first run, you'll see 14 days of pre-seeded synthetic history — showing a realistic pattern of stable performance, a mid-run drop, partial recovery, and stabilisation. Your real run will appear alongside it.

You can edit the passing threshold for each property on this page — click the edit icon on the Passing Thresholds card.

### Step 5 — Compare models

Go to **Model Comparison** (`/compare`). Click **Run Comparison**. This runs the full corpus against both Sonnet and Haiku concurrently and produces:

- Side-by-side per-property scores
- Cost estimate per model
- A written summary of which model leads and by how much

Results persist in the database — all previous comparison runs are selectable in the history panel.

---

## 5. Adapting GlassBox to your own domain

GlassBox is domain-agnostic. Swapping domains means replacing two files and implementing the tools that match your new spec.

### Step 1 — Replace `spec.json`

This file defines everything domain-specific. Replace it with your own:

```json
{
  "agent": {
    "role": "...",
    "task": "...",
    "conversation_style": ["..."]
  },
  "non_negotiables": [
    {
      "id": "my_rule",
      "name": "My Rule",
      "description": "What the model must never do",
      "zero_tolerance": true
    }
  ],
  "behavioral_properties": [
    {
      "id": "my_property",
      "name": "My Property",
      "description": "What good looks like",
      "target": 0.90,
      "alert_threshold": 0.80
    }
  ],
  "resolution_paths": {
    "my_ticket_type": "Step-by-step instructions for this ticket type..."
  },
  "tools": [
    {
      "name": "my_tool",
      "signature": "my_tool(param: str) -> dict",
      "description": "What this tool does"
    }
  ],
  "retry_addendum": "The previous response violated a non-negotiable rule. Correct this: ..."
}
```

**Key design principles for non-negotiables:**
- Write them as things the model must *never* do ("Never promise X without checking Y")
- Each one should be independently verifiable by the judge from the response text alone
- Zero tolerance means any single violation triggers a retry

**Key design principles for behavioral properties:**
- Score 0–1, not pass/fail
- Write descriptions that tell the judge *what good looks like* at each end of the scale
- Set targets and alert thresholds with a gap (e.g. target 0.90, alert 0.80) to create an early warning zone

### Step 2 — Replace `corpus.json`

36 labeled ground-truth examples across your ticket types. Each example:

```json
{
  "id": "ex_001",
  "ticket_type": "my_ticket_type",
  "customer_message": "The message the customer sends",
  "context": {
    "customer_name": "Alex Customer",
    "order_id": "ORD-10001"
  },
  "label": "conforming",
  "notes": "What correct behaviour looks like for this example"
}
```

**Tips for writing good corpus examples:**
- Cover every ticket type with 8–10 examples each
- Include edge cases: frustrated customers, incomplete context, ambiguous requests
- Mix `conforming` and `non_conforming` labels — non-conforming examples should trigger specific non-negotiable violations
- Always include `customer_name` in context so the model can greet the customer (prevents tool-call failures on first turn)
- Use realistic, varied customer messages — not the same phrasing repeated

### Step 3 — Implement `backend/services/tools.py`

Replace the tool functions with your domain's actual lookups. Each tool must:

1. Be registered in the `TOOL_DEFINITIONS` list (Anthropic tool_use format)
2. Have a corresponding handler in `execute_tool(name, params, context)` that returns a dict
3. Match the name and signature listed in `spec.json`

The tool executor in the corpus runner (`make_corpus_tool_executor` in `corpus_tools.py`) creates a mock version of your tools using the `context` field from each corpus example. For a new domain, implement a similar mock that returns plausible data from the corpus context — so the test suite can run without hitting a real database.

### Step 4 — Seed your database (optional)

If your domain has static reference data (personas, accounts, products), add seed statements to `backend/core/db.py` in the `_seed_data()` function. GlassBox re-seeds on every fresh database init.

### Step 5 — Run the test suite

```bash
make dev
# Then go to /test-suite → Run Test Suite
```

Your first run establishes your starting conformance scores. From here, any change to `spec.json`, the system prompt, or the model will produce a new snapshot you can compare against.

---

## 6. Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `PRODUCTION_MODEL` | No | Model for the runtime (default: `claude-sonnet-4-5`) |
| `JUDGE_MODEL` | No | Model for the judge (default: `claude-haiku-4-5`) |
| `SEED_SYNTHETIC_HISTORY` | No | Set `true` to seed 14 days of synthetic drift history on startup (default: `true`) |
| `DATABASE_URL` | No | SQLite path (default: `glassbox.db` in project root) |

---

## 7. Resetting the database

```bash
# Stop the backend (Ctrl+C)
rm glassbox.db
make dev   # recreates and reseeds automatically
```

This wipes all run history, snapshots, and verdicts. The 5 customer personas and their data are re-seeded from `db.py` automatically.

---

## 8. Common issues

**"No module named backend"** — run commands from the project root, not from a subdirectory.

**API key error on first run** — make sure `.env` exists (not just `.env.example`) and contains a valid `ANTHROPIC_API_KEY`.

**Test suite takes too long** — all 36 examples run concurrently, so total time is roughly the slowest single call (~30s for Sonnet). If it's taking much longer, check your network or API rate limits.

**Baseline & Drift shows no runs** — this page reads `run_type=test` snapshots. Trigger a run from the Model Evaluation page first.

**Model Comparison shows nothing** — results persist in the DB. If the page is empty, no comparison has been run yet. Click Run Comparison.
