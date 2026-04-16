# Changelog

All notable changes to GlassBox are documented here.

---

## [0.2.0] — 2026-04-16

### New Features

- **Cost & Latency Dashboard** (`/cost`) — summary cards (total runs, avg latency, P95 latency, estimated cost), per-model breakdown table, 14-day daily bar chart. Backed by `GET /api/v1/cost/summary`.
- **Slack Alerts** — `backend/services/alerts.py` dispatches alerts to a Slack incoming webhook when a non-negotiable fails or a behavioral score falls below threshold. Set `SLACK_WEBHOOK_URL` in `.env` to enable. Silent when blank.
- **Email Alerts (stub)** — set `ALERT_EMAIL` in `.env` to log structured alert output. Wire in SendGrid/SES to activate delivery.
- **HTTP Basic Auth** — optional middleware on all API routes. Set `GLASSBOX_USERNAME` + `GLASSBOX_PASSWORD` in `.env` to enable. Blank = open dev mode. `/health` always exempt.
- **GitHub Actions CI** — `.github/workflows/test-suite.yml` runs `pytest` + `ruff` on every push and PR to `main`.
- **Judge Reasoning Viewer** — reasoning strings from the judge are now displayed in the TestSuite drill-down below each property score.
- **Corpus Coverage Panel** — collapsible panel in TestSuite showing total/conforming/non-conforming example counts, per-ticket-type breakdown, and which non-negotiables are covered. Backed by `GET /api/v1/runs/corpus-coverage`.
- **Retry Indicator** — amber "Retried" badge in Production Monitor and TestSuite when a response triggered a non-negotiable retry.

### Improvements

- **Concurrent corpus execution** — test suite runs all 36 corpus examples via `asyncio.gather`, cutting runtime from ~15 min to ~1–2 min.
- **Deterministic evaluation** — `temperature=0` set on all LLM calls (agent, judge, both sides of model comparison). Score changes now mean something changed.
- **Escalation reliability** — explicit parameterized escalation warning injected into system prompt when `previous_contacts >= 1`. Fixes inconsistent escalation compliance.
- **Tighter resolution paths** — `spec.json` resolution paths for `refund_request` and `billing_dispute` now include explicit "do NOT" steps to prevent premature tool calls.
- **Non-negotiable corpus threshold** — corrected from 100% to 90%. Per-response zero-tolerance remains; 90% is the corpus-level pass rate.
- **Alert log enriched** — Production Monitor alert rows now expand to show full customer message, model response, property score bars, latency, and run ID.

### Schema Changes

- `runs` table: added `input_tokens`, `output_tokens`, `retried` columns (auto-migrated on startup).
- `snapshot_examples` table: added `property_reasoning_json`, `non_negotiable_reasoning_json`, `retried` columns (auto-migrated on startup).

### Config Changes

New optional environment variables (all default to blank/disabled):

| Variable | Purpose |
|---|---|
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL for alert dispatch |
| `ALERT_EMAIL` | Email address for alert notification stub |
| `GLASSBOX_USERNAME` | HTTP Basic Auth username |
| `GLASSBOX_PASSWORD` | HTTP Basic Auth password |

### Docs

- `architecture.md` — updated DB schema, page→API mapping, new sections for Alerts, Auth, CI/CD, Cost & Latency.
- `data-flow.md` — updated runs table description, added Alerts Flow section with Mermaid diagram.
- `getting-started.md` — new optional env vars documented, first 10 minutes walkthrough updated with new pages and panels.

---

## [0.1.0] — 2026-04-15

### Initial Release

- **Live Runtime** (`/try-it`) — submit a customer support ticket, see agent tool calls, judge verdict, and retry logic in real time.
- **Model Evaluation** (`/test-suite`) — run the full 36-example corpus against the live model, get per-property conformance scores, diff against previous runs.
- **Baseline & Drift** (`/drift`) — 14-day behavioral history, property-level score trends, incident log for threshold breaches.
- **Model Comparison** (`/compare`) — run Sonnet vs Haiku on the same corpus concurrently, side-by-side behavioral scores and cost estimates.
- **Production Monitor** (`/monitor`) — simulated live conformance monitoring with per-property breakdown and alert feed.
- **Chat Log Analytics** (`/chatlogs`) — conversation history with session-level analytics.
- **Spec Editor** (`/spec`) — view and edit behavioral spec targets and alert thresholds from the UI.
- **Behavioral spec** (`spec.json`) — source of truth for non-negotiables, behavioral properties, resolution paths, targets, and alert thresholds.
- **Labeled corpus** (`corpus.json`) — 36 labeled examples covering conforming and non-conforming cases across all ticket types.
- **Independent judge** — Claude Haiku evaluating every response against the spec without seeing the system prompt.
- **Retry logic** — automatic single retry with correction addendum when any non-negotiable fails.
