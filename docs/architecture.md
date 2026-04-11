# GlassBox Architecture

> Diagrams rendered with Mermaid — view on GitHub or in a Mermaid-compatible viewer.

---

## 1. System Overview

GlassBox is a full-stack LLM observability application. A React frontend communicates with a FastAPI backend, which drives all LLM calls through the Anthropic SDK and persists every result to a local SQLite database. Two static data files — `spec.json` and `corpus.json` — act as the behavioral contract and test fixture set respectively; the backend reads them at startup.

```mermaid
graph TD
    User["User (Browser)"]
    FE["Frontend\nReact + Vite\nlocalhost:5173"]
    API["Backend API\nFastAPI\nlocalhost:8888"]
    Sonnet["Anthropic API\nClaude Sonnet 4.5\n(production model)"]
    Haiku["Anthropic API\nClaude Haiku 4.5\n(judge + candidate model)"]
    DB["SQLite\nglassbox.db"]
    Spec["spec.json\nbehavioral contract"]
    Corpus["corpus.json\n36 labeled examples"]

    User -->|HTTP| FE
    FE -->|REST /api/v1/| API
    API -->|messages.create| Sonnet
    API -->|messages.create| Haiku
    API -->|reads / writes| DB
    API -->|reads at startup| Spec
    API -->|reads at startup| Corpus
```

---

## 2. Request Flow — Live Ticket (Try It page)

This sequence covers the full lifecycle from a user submitting a support ticket on `/try-it` to the frontend rendering the response and verification panel.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API as API (FastAPI)
    participant Runtime as runtime.py
    participant Sonnet as Anthropic (Sonnet)
    participant Judge as judge.py
    participant Haiku as Anthropic (Haiku)
    participant SQLite

    User->>Frontend: Submit ticket (customer_message, ticket_type, context)
    Frontend->>API: POST /api/v1/traces/
    API->>Runtime: handle_ticket(customer_message, ticket_type, context)

    Runtime->>Runtime: Load spec.json, look up resolution_path for ticket_type
    Runtime->>Runtime: Build system prompt (non-negotiables + resolution_path + context)

    Runtime->>Sonnet: messages.create(system_prompt, customer_message)
    Sonnet-->>Runtime: response text + token counts

    Runtime->>Judge: score(customer_message, resolution_path, response, ticket_type)
    Judge->>Judge: Build judge prompt (ticket + response + spec)
    Judge->>Haiku: messages.create(judge_system, judge_prompt)
    Haiku-->>Judge: structured JSON verdict
    Judge-->>Runtime: JudgeVerdict (non_negotiable_results, behavioral_scores, overall_conformance)

    alt any_non_negotiable_failed
        Runtime->>Runtime: Append retry_addendum from spec.json to system prompt
        Runtime->>Sonnet: messages.create(retry_system_prompt, customer_message)
        Sonnet-->>Runtime: revised response + token counts
        Runtime->>Judge: score(revised response)
        Judge->>Haiku: messages.create(judge_system, retry_judge_prompt)
        Haiku-->>Judge: updated JSON verdict
        Judge-->>Runtime: updated JudgeVerdict
    end

    Runtime->>SQLite: insert_run(...) → run_id
    Runtime->>SQLite: insert_conformance_results(run_id, rows)
    Runtime->>SQLite: insert_production_verdict(run_id, overall_score, alert_triggered)
    Runtime->>SQLite: insert_chat_log(session_id, run_id, verdict_summary_json)\nNote over SQLite: verdict_summary includes full reasoning\nper property (non-negotiables + behavioral scores)
    Runtime-->>API: RunResult (response, verdict, latency_ms, total_tokens, retried)
    API-->>Frontend: Envelope { data: RunResponse }
    Frontend->>User: Render response in chat panel + verification panel side-by-side
```

---

## 3. Behavioral Verification Loop

The judge operates as an independent scoring layer that is always separate from the production model. It never influences the prompt given to Sonnet — it only evaluates the output after the fact.

```mermaid
graph LR
    subgraph Application Layer
        prompt["System Prompt\n(non-negotiables + resolution_path + context)"]
        sonnet["Claude Sonnet 4.5\n(production model)"]
        response["Model Response"]
        prompt --> sonnet --> response
    end

    subgraph Verification Layer
        judge_input["Judge Input\n(customer_message + resolution_path\n+ response + spec)"]
        haiku["Claude Haiku 4.5\n(judge model)"]
        verdict["Structured JSON Verdict"]
        judge_input --> haiku --> verdict
    end

    subgraph Spec Properties
        nn["Non-Negotiables (binary pass/fail)\n• no_premature_refund\n• escalation_threshold\n• no_unauthorized_account_details"]
        bp["Behavioral Properties (0–1 score)\n• issue_acknowledged  target 0.95\n• resolution_matching  target 0.90\n• professional_tone   target 0.90\n• concise_response    target 0.85"]
    end

    response --> judge_input
    verdict --> nn
    verdict --> bp

    subgraph Retry Logic
        check{"any_non_negotiable\n_failed?"}
        retry["Append retry_addendum (from spec.json)\nto system prompt\n→ call Sonnet again\n→ re-score with Haiku"]
        done["Accept response\nWrite to SQLite"]
    end

    verdict --> check
    check -->|Yes| retry
    check -->|No| done
    retry --> done
```

---

## 4. Drift Detection Architecture

Drift detection tracks how model conformance changes over time by maintaining a history of test suite snapshots. On first startup, synthetic history is seeded to give the UI something meaningful to display.

```mermaid
graph TD
    subgraph Startup
        env_flag{"SEED_SYNTHETIC_HISTORY\n= true in .env?"}
        seed["seed_synthetic_history()"]
        check_existing{"snapshots\nalready exist?"}
        insert_synthetic["Insert 14 days of\nsynthetic snapshots\n(pre-scripted scores\n+ small random jitter)"]
        skip["Skip — history\nalready present"]
        skip_seed["Skip — seeding\nnot enabled"]

        env_flag -->|Yes| seed
        env_flag -->|No| skip_seed
        seed --> check_existing
        check_existing -->|No| insert_synthetic
        check_existing -->|Yes| skip
    end

    subgraph Test Suite Run
        trigger["run_test_suite(model, run_type)\n— on-demand via POST /api/v1/runs/snapshot\n— or triggered by /compare"]
        corpus["Load corpus.json\n(36 labeled examples)"]
        loop["asyncio.gather(*[run_example(ex) for ex in corpus])\nAll 36 examples run concurrently\n→ judge.score() per example"]
        aggregate["Aggregate per-property\naverage scores"]
        store_examples["Insert per-example results\nto snapshot_examples\n(one row per corpus example)"]
        snapshot["INSERT baseline_snapshot\n(run_type: test|compare)"]

        trigger --> corpus --> loop --> aggregate --> snapshot
        loop --> store_examples
    end

    subgraph History & Analysis
        get_history["get_history()\nSELECT baseline_snapshots\nWHERE run_type = 'test'\nORDER BY created_at ASC"]
        compute_deltas["compute_deltas(snapshots)\nCompare score vs spec target\nfor each property"]
        detect_incidents["detect_incidents(snapshots)\nFlag any property score\nbelow alert_threshold"]
    end

    subgraph Frontend Drift Page
        timeline["Timeline chart\n(per-property scores over time)"]
        table["Snapshot table\n(one row per run)"]
        incident_log["Incident log\n(threshold violations)"]
    end

    snapshot --> get_history
    get_history --> compute_deltas
    get_history --> detect_incidents
    compute_deltas --> timeline
    get_history --> table
    detect_incidents --> incident_log
```

---

## 5. Database Schema

```mermaid
erDiagram
    runs {
        INTEGER id PK
        TEXT created_at
        TEXT model
        TEXT ticket_type
        TEXT customer_message
        TEXT context
        TEXT response
        TEXT prompt_version
        INTEGER latency_ms
        INTEGER total_tokens
    }

    conformance_results {
        INTEGER id PK
        INTEGER run_id FK
        TEXT property_name
        TEXT property_type
        REAL score
        INTEGER passed
        TEXT verdict_json
    }

    baseline_snapshots {
        INTEGER id PK
        TEXT created_at
        TEXT model
        TEXT prompt_version
        TEXT corpus_version
        TEXT run_type
        REAL overall_conformance
        TEXT property_scores_json
        TEXT non_negotiable_results_json
    }

    snapshot_examples {
        INTEGER id PK
        INTEGER snapshot_id FK
        TEXT corpus_example_id
        TEXT ticket_type
        TEXT customer_message_truncated
        REAL overall_score
        TEXT property_scores_json
        INTEGER non_negotiables_passed
    }

    production_verdicts {
        INTEGER id PK
        TEXT created_at
        INTEGER run_id FK
        REAL overall_score
        TEXT property_scores_json
        INTEGER alert_triggered
    }

    runs ||--o{ conformance_results : "has"
    runs ||--o| production_verdicts : "has"
    baseline_snapshots ||--o{ snapshot_examples : "has"
```

**Notes on storage conventions:**

- `conformance_results.property_type` is constrained to `'negotiable'` or `'behavioral'` at the DB level.
- `conformance_results.score` is `NULL` for non-negotiable rows (they are binary pass/fail only).
- `context`, `verdict_json`, `property_scores_json`, and `non_negotiable_results_json` are stored as JSON text and deserialized in the `db.py` layer before being returned to callers.
- `baseline_snapshots` has no direct FK to `runs` — it is an aggregate summary produced by the drift engine, not tied to any individual run.
- `run_type` on `baseline_snapshots` separates data by page: `"baseline"` (Drift page), `"test"` (Test Suite page), `"compare"` (Model Comparison page). `snapshot_examples` stores per-example results with cascade delete tied to the parent snapshot.

---

## 6. Model Comparison Flow

The comparison endpoint runs both models against the full corpus simultaneously using `asyncio.gather`, then produces side-by-side conformance scores and cost estimates.

```mermaid
graph LR
    request["POST /api/v1/compare/\n{ models: [sonnet, haiku] }"]

    subgraph Parallel Execution via asyncio.gather
        suite_a["run_test_suite(claude-sonnet-4-5)\n36 corpus examples\n→ judge each → aggregate"]
        suite_b["run_test_suite(claude-haiku-4-5)\n36 corpus examples\n→ judge each → aggregate"]
    end

    subgraph Cost Estimation
        cost_a["Sonnet cost\n$3.00 / 1M input tokens\n$15.00 / 1M output tokens"]
        cost_b["Haiku cost\n$0.25 / 1M input tokens\n$1.25 / 1M output tokens"]
    end

    subgraph Results
        compare["CompareResponse\n• per-model overall_conformance\n• per-property scores\n• non-negotiable pass rates\n• cost estimate per model\n• winner (highest conformance)\n• winner_reason"]
    end

    request --> suite_a & suite_b
    suite_a --> cost_a
    suite_b --> cost_b
    cost_a & cost_b --> compare
```

---

## 7. Frontend Page → API Mapping

| Page | Route | API Endpoints Called |
|---|---|---|
| Home | `/` | None (static splash page) |
| Try It | `/try-it` | `POST /api/v1/traces/` |
| Model Evaluation | `/test-suite` | `GET /api/v1/runs/snapshots?run_type=test`, `POST /api/v1/runs/snapshot` |
| Baseline & Drift | `/drift` | `GET /api/v1/runs/snapshots?run_type=test`, `GET /api/v1/spec`, `PATCH /api/v1/spec/thresholds`, `GET /api/v1/runs/incidents` |
| Model Comparison | `/compare` | `GET /api/v1/runs/snapshots?run_type=compare`, `POST /api/v1/compare/` |
| Production Monitor | `/monitor` | `GET /api/v1/monitor/status`, `GET /api/v1/monitor/verdicts`, `GET /api/v1/monitor/alerts` |
| Chat Log Analytics | `/chatlogs` | `GET /api/v1/chatlogs/analytics`, `GET /api/v1/chatlogs/?session_id=&ticket_type=` |
| Traces (internal) | n/a | `GET /api/v1/traces/`, `GET /api/v1/traces/{run_id}` |

**Per-example detail:** `GET /api/v1/runs/snapshots/{id}/examples` returns the 36 per-example results for any snapshot. `GET /api/v1/runs/snapshots/{id}/diff` returns changed examples between a snapshot and its predecessor — used by the Drift page when a snapshot point is selected.

**Baseline & Drift** no longer has its own "Run Now" button. All test runs are triggered from the Model Evaluation page (`POST /api/v1/runs/snapshot`) and stored with `run_type=test`. The Drift page reads those same snapshots and computes deltas against spec-defined targets (not a historical baseline snapshot). Thresholds are editable in the UI via `PATCH /api/v1/spec/thresholds`, which writes directly to `spec.json`.
