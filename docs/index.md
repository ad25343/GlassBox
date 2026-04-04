# GlassBox Documentation

GlassBox is a full-stack LLM observability UI for customer support AI — tracking requests, responses, conformance verdicts, and behavioral drift across models.

---

## Documents

| Document | Description |
|---|---|
| [architecture.md](architecture.md) | Full system architecture: C4-style overview, request flow sequence diagram, behavioral verification loop, drift detection architecture, database schema ER diagram, model comparison flow, and a frontend-to-API mapping table |
| [data-flow.md](data-flow.md) | Focused data flow document: how a ticket moves from user input through processing, verification, and storage; how static inputs (spec, corpus) relate to dynamic run data; how verdicts accumulate into conformance rates; how snapshots version behavior over time |
| [behavioral-spec.md](behavioral-spec.md) | Behavioral spec design: what a spec is and why it matters, the two property types (non-negotiables vs behavioral), how the judge prompt is constructed, retry logic, conformance rate calculation, and how to extend the spec |

---

## Quick Links

- [README](../README.md) — project overview and setup instructions
- [spec.json](../spec.json) — behavioral contract (3 non-negotiables, 4 behavioral properties)
- [corpus.json](../corpus.json) — 36 labeled test examples used for test suite runs and model comparison
