# GlassBox Data Flow

This document traces how data moves through GlassBox from the moment a user submits a ticket to the point where the result is stored and displayed. It also covers how static inputs (spec, corpus) relate to dynamic run data, and how individual verdicts accumulate into the conformance metrics shown across the UI.

---

## Full Data Lifecycle

```mermaid
graph TD
    subgraph Static Inputs
        spec["spec.json\nBehavioral contract\n(non-negotiables + behavioral properties\n+ targets + alert thresholds)"]
        corpus["corpus.json\n36 labeled examples\n(customer_message, ticket_type, context)"]
    end

    subgraph User Input
        ticket["User submits ticket\ncustomer_message\nticket_type\ncontext (JSON)"]
    end

    subgraph Runtime Processing
        build_prompt["Build system prompt\nspec non-negotiables\n+ RESOLUTION_PATHS[ticket_type]\n+ context JSON"]
        call_sonnet["Call Claude Sonnet 4.5\nPOST Anthropic messages API\n→ response text + token counts"]
        retry_check{"Non-negotiable\nviolation?"}
        retry["Append _RETRY_ADDENDUM\n→ call Sonnet again\n(tokens accumulate)"]
    end

    subgraph Verification
        judge_prompt["Build judge prompt\ncustomer_message\n+ resolution_path\n+ model response\n+ full spec JSON"]
        call_haiku["Call Claude Haiku 4.5\nPOST Anthropic messages API\n→ raw JSON text"]
        parse_verdict["Parse + validate\nJSON verdict\nNonNegotiableResult × 3\nBehavioralScore × 4\noverall_conformance\nany_non_negotiable_failed"]
    end

    subgraph Storage
        insert_run["INSERT INTO runs\n(model, ticket_type, message, context,\nresponse, prompt_version,\nlatency_ms, total_tokens)"]
        insert_conformance["INSERT INTO conformance_results\none row per spec property (7 total)\n(property_name, property_type,\nscore, passed, verdict_json)"]
        insert_verdict["INSERT INTO production_verdicts\n(run_id, overall_score,\nproperty_scores_json, alert_triggered)"]
    end

    subgraph Accumulation
        conformance_rate["Conformance rate\n= avg overall_score\nacross recent production_verdicts"]
        property_avg["Per-property averages\n= avg score per property_id\nacross recent production_verdicts"]
        alert_count["Alert count\n= COUNT WHERE alert_triggered = 1"]
    end

    subgraph Drift Tracking
        run_suite["run_test_suite(model)\nIterates all 36 corpus examples\nthrough runtime + judge"]
        snapshot["INSERT INTO baseline_snapshots\n(overall_conformance,\nproperty_scores_json,\nnon_negotiable_results_json)"]
        history["get_history()\nAll snapshots ASC by created_at"]
        deltas["compute_deltas()\nlatest score − baseline score\nper property"]
        incidents["detect_incidents()\nAny snapshot where\nscore < alert_threshold"]
    end

    subgraph Display
        try_it["Try It page\nChat panel + Verification panel"]
        monitor_page["Production Monitor page\nConformance rate gauge\nProperty breakdown\nAlert feed"]
        drift_page["Baseline & Drift page\nTimeline chart\nSnapshot table\nIncident log"]
    end

    spec --> build_prompt
    spec --> judge_prompt
    corpus --> run_suite

    ticket --> build_prompt
    build_prompt --> call_sonnet
    call_sonnet --> retry_check
    retry_check -->|Yes| retry
    retry -->|re-score| judge_prompt
    retry_check -->|No| judge_prompt
    call_sonnet --> judge_prompt

    judge_prompt --> call_haiku
    call_haiku --> parse_verdict

    parse_verdict --> insert_run
    insert_run --> insert_conformance
    insert_run --> insert_verdict

    insert_verdict --> conformance_rate
    insert_verdict --> property_avg
    insert_verdict --> alert_count

    conformance_rate & property_avg & alert_count --> monitor_page

    parse_verdict --> try_it

    run_suite --> insert_run
    insert_run --> snapshot
    snapshot --> history
    history --> deltas
    history --> incidents
    deltas & incidents --> drift_page
```

---

## Static Inputs vs Dynamic Run Data

**`spec.json`** is the behavioral contract. It is read from disk on first use and cached in memory for the lifetime of the process. It defines:

- Which properties to evaluate (names, IDs, descriptions).
- Which are non-negotiables (zero-tolerance, binary) vs behavioral properties (scored 0–1).
- Target scores and alert thresholds for each behavioral property.

`spec.json` shapes every part of the system: the system prompt sent to Sonnet, the judge prompt sent to Haiku, and the alert logic that sets `alert_triggered` on each production verdict.

**`corpus.json`** is the test fixture set — 36 labeled customer support scenarios. It is only read when a test suite run is triggered (drift detection or model comparison). Each example provides `customer_message`, `ticket_type`, and `context`. The corpus is static; it does not grow as new live tickets come in.

**Run data** is fully dynamic. Every ticket submitted via the Try It page (or via a test suite run) creates a row in `runs`, one row per spec property in `conformance_results`, and one row in `production_verdicts`. This data accumulates indefinitely and drives the Monitor and Drift pages.

---

## How Verdicts Accumulate into Conformance Rates

Each call to `runtime.handle_ticket()` produces one `production_verdicts` row. The monitor endpoint reads the most recent 50 verdicts and computes:

- **Overall conformance rate**: mean of `overall_score` across all 50 rows.
- **Per-property breakdown**: for each `property_id` key in `property_scores_json`, compute the mean across all 50 rows.
- **Alert count**: count of rows where `alert_triggered = 1`.

An `alert_triggered` flag is set to `1` when either:
- Any behavioral property score falls below its `alert_threshold` from `spec.json`, or
- Any non-negotiable result returned `passed = false` from the judge.

---

## How Snapshots Version Behavior Over Time

A `baseline_snapshot` is a point-in-time summary produced by running the entire 36-example corpus through the runtime and judge and averaging the scores. Each snapshot records:

- The model used.
- `prompt_version` and `corpus_version` — so changes to the prompt or corpus can be tracked independently of model changes.
- `overall_conformance` — mean of all four behavioral property averages.
- `property_scores_json` — per-property averages across all 36 runs.
- `non_negotiable_results_json` — pass rate (not just pass/fail) per non-negotiable, since it's the aggregate of 36 individual verdicts.

The first snapshot in the database (oldest by `created_at`) is treated as the **baseline**. All subsequent snapshots are compared against it:

- `compute_deltas()` computes `current_score − baseline_score` for each property. A delta of `< -0.005` is flagged as `"down"`, `> 0.005` as `"up"`, and within that range as `"stable"`.
- `detect_incidents()` scans every snapshot in history and flags any property that fell below its `alert_threshold` — not just the latest snapshot.

On first startup with an empty database, `seed_synthetic_history()` inserts 14 pre-scripted snapshots dated back 14 days. Day 8 in the synthetic data deliberately shows a `resolution_matching` drop to `0.74` (below the `0.80` threshold), providing a realistic incident for the UI to display out of the box.
