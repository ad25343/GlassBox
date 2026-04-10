# GlassBox Documentation

GlassBox is a reference implementation of a GenAI customer support application with full behavioral visibility — a multi-turn agent with deterministic tools, behavioral spec enforcement, conformance scoring, drift detection, and chat log analytics.

---

## Documents

| Document | Description |
|---|---|
| [architecture.md](architecture.md) | Full system architecture: C4-style overview, request flow sequence diagram, agent tool loop, behavioral verification loop, drift detection architecture, database schema, model comparison flow, and frontend-to-API mapping |
| [data-flow.md](data-flow.md) | How a ticket moves from user input through the agent tool loop, verification, and storage; how static inputs (spec, corpus) relate to dynamic run data; how verdicts accumulate into conformance rates; how snapshots version behavior over time |
| [behavioral-spec.md](behavioral-spec.md) | What a spec is and why it matters, the two property types (non-negotiables vs behavioral), how the judge prompt is constructed including the tool call trace, retry logic, conformance rate calculation, and how to extend the spec |
| [data-management.md](data-management.md) | How to load synthetic data, reset the database, delete individual snapshots, and populate GlassBox with real snapshots — including a recommended cadence for real deployments |

---

## Key files

| File | What it is |
|---|---|
| [`spec.json`](../spec.json) | The behavioral contract — 3 non-negotiables, 4 behavioral properties with targets and alert thresholds |
| [`corpus.json`](../corpus.json) | 36 labeled ground-truth examples used for the test suite, drift snapshots, and model comparison |
| [`backend/services/agent.py`](../backend/services/agent.py) | Multi-turn tool_use loop — calls tools, accumulates results, generates final response |
| [`backend/services/tools.py`](../backend/services/tools.py) | 6 deterministic tools (database lookups), tool definitions for the Anthropic API, and the execute dispatcher |
| [`backend/services/judge.py`](../backend/services/judge.py) | Independent judge — scores responses against the spec including tool call trace verification |
| [`backend/services/runtime.py`](../backend/services/runtime.py) | Orchestrates the full pipeline: system prompt construction, agent run, judge scoring, retry on failure |
| [`backend/services/drift.py`](../backend/services/drift.py) | Corpus runner, snapshot storage, and per-property delta computation |
| [`backend/services/log_writer.py`](../backend/services/log_writer.py) | Async fire-and-forget writer — hydrates SQLite and JSONL from live sessions |
| [`backend/core/db.py`](../backend/core/db.py) | Schema init and seed data — 5 customer personas, orders, and billing charges created on first run |

---

## Quick links

- [README](../README.md) — setup and quickstart
- [API docs](http://localhost:8888/docs) — auto-generated FastAPI docs (requires running server)
