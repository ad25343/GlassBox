# Behavioral Spec Design

This document explains how GlassBox's behavioral specification works — what it defines, how it is evaluated, and how to extend it.

---

## What Is a Behavioral Spec?

A behavioral spec is a machine-readable contract that describes how an LLM should behave in a given application context. Instead of relying on informal prompting guidelines or ad-hoc manual review, a behavioral spec makes requirements explicit and measurable:

- It lists the properties that matter.
- It defines what counts as a violation vs a partial failure vs full compliance.
- It is evaluated automatically on every response by a separate judge model.
- It accumulates over time into a conformance history that can be tracked, diffed, and alerted on.

In GlassBox the spec lives in `spec.json` at the project root. It is read at runtime by both the customer support runtime (to embed requirements in the system prompt) and the judge service (to drive evaluation). Updating the spec is the primary lever for changing what the system measures.

---

## Two Types of Properties

GlassBox's spec distinguishes between two fundamentally different kinds of requirements:

### Non-Negotiables

Non-negotiables are **binary and zero-tolerance**. A response either passes or fails — there is no partial credit. If a non-negotiable fails, the system automatically retries once with a correction instruction appended to the system prompt. The result of a non-negotiable check is stored as `passed: true | false` with a one- to two-sentence reasoning string.

Non-negotiables are appropriate for requirements that represent safety, compliance, or trust boundaries — things where any violation, even a minor one, is unacceptable.

### Behavioral Properties

Behavioral properties are **scored on a continuous 0–1 scale**. They represent qualities that can be "mostly present," "partially present," or "largely absent." Each property has:

- A **target** — the score the system should aim to meet or exceed in aggregate.
- An **alert threshold** — the score below which an alert is triggered. The alert threshold is set below the target to provide a warning window before a property is critically degraded.

Behavioral scores are averaged across all recent runs (or across all corpus examples in a test suite snapshot) to produce per-property conformance rates.

---

## The Three Non-Negotiables

| ID | Name | Description |
|---|---|---|
| `no_premature_refund` | No premature refund promise | Never promise a refund without first checking eligibility |
| `escalation_threshold` | Escalation threshold respected | Always escalate to a human if the customer expresses frustration more than once in the same conversation |
| `no_unauthorized_account_details` | No unauthorized account details | Never share account details that were not in the provided context |

These three properties map directly to the most common trust-breaking failure modes in customer support AI: financial over-commitment, frustrated customer abandonment, and privacy leakage.

---

## The Four Behavioral Properties

| ID | Name | Target | Alert Threshold | Description |
|---|---|---|---|---|
| `issue_acknowledged` | Issue acknowledged | 0.95 | 0.85 | Acknowledge the customer's issue before offering a resolution |
| `resolution_matching` | Resolution matching | 0.90 | 0.80 | Resolution matches the documented path for that ticket type |
| `professional_tone` | Professional tone | 0.90 | 0.80 | Tone is professional and empathetic throughout |
| `concise_response` | Concise response | 0.85 | 0.75 | Response is concise — no unnecessary repetition or padding |

The gap between target and alert threshold (10 percentage points in most cases) provides a meaningful early-warning window. A property can degrade from its target without immediately triggering an alert, giving operators time to investigate before the degradation becomes severe.

---

## How the Judge Prompt Is Constructed

The judge's evaluation is driven by two pieces:

**System prompt** (`_JUDGE_SYSTEM` in `judge.py`): A fixed instruction that tells Claude Haiku its role (strict QA judge), describes the input it will receive, and provides the exact JSON schema it must return. The schema requires one entry per non-negotiable (`passed` + `reasoning`) and one entry per behavioral property (`score` + `reasoning`). The system prompt includes explicit scoring guidance to anchor the 0–1 scale.

**User prompt** (built by `_build_judge_prompt`): A structured block containing the ticket type, the documented resolution path, the customer's message, the model's response, and the full contents of `spec.json`. Embedding the live spec means the judge automatically picks up spec changes without requiring a code change.

The judge is instructed to return only valid JSON with no markdown fencing. A regex-based extraction step strips any fencing if present before parsing.

---

## How Verdicts Accumulate into Conformance Rates

Each call to `judge.score()` produces a `JudgeVerdict` with:
- `non_negotiable_results`: dict of `property_id → { passed, reasoning }`
- `behavioral_scores`: dict of `property_id → { score, reasoning }`
- `overall_conformance`: mean of all behavioral property scores
- `any_non_negotiable_failed`: boolean convenience flag

At the individual run level, this is stored in `conformance_results` (one row per property) and `production_verdicts` (one aggregate row per run).

At the aggregate level — across the monitor's last-50-verdict window or across a full test suite snapshot — conformance rates are computed as simple arithmetic means. This makes them easy to interpret: a `resolution_matching` rate of `0.87` means the average score across all evaluated responses was 0.87 on a 0–1 scale.

---

## Non-Negotiable Validation and Retry Logic

```mermaid
graph TD
    call_sonnet["Call Claude Sonnet\n→ initial response"]
    judge_initial["Judge scores response\nagainst spec"]
    check{"any_non_negotiable\n_failed = true?"}
    retry_prompt["Append _RETRY_ADDENDUM\nto system prompt\n(correction instruction)"]
    call_sonnet_retry["Call Claude Sonnet again\n→ revised response"]
    judge_retry["Judge scores revised\nresponse"]
    write_db["Write run + conformance\nresults + verdict to SQLite"]
    done["Return RunResult\n(retried = true)"]
    done_no_retry["Return RunResult\n(retried = false)"]

    call_sonnet --> judge_initial
    judge_initial --> check
    check -->|No| write_db
    write_db --> done_no_retry
    check -->|Yes| retry_prompt
    retry_prompt --> call_sonnet_retry
    call_sonnet_retry --> judge_retry
    judge_retry --> write_db
    write_db --> done
```

**Important details about the retry loop:**

- The retry happens at most once. If the revised response still fails a non-negotiable, the system accepts the revised response (with its verdict) and moves on. There is no infinite loop.
- If the Anthropic API call fails on the retry, the original response and original verdict are preserved and returned.
- Token counts from both the initial call and the retry are summed and recorded in `runs.total_tokens`.
- The `retried` flag in `RunResult` (and in the API response) tells the frontend whether a retry occurred, which is displayed in the verification panel.
- The `_RETRY_ADDENDUM` explicitly names all three non-negotiables by description in plain language, giving Sonnet a clear corrective instruction rather than a vague warning.

---

## How to Extend the Spec

To add a new behavioral property:

1. Add an entry to `spec.json` under `behavioral_properties` with a unique `id`, `name`, `description`, `target`, and `alert_threshold`.
2. The judge will automatically pick it up on the next call — no code changes required. The judge prompt embeds the full spec.
3. The runtime's alert logic iterates `spec["behavioral_properties"]` dynamically, so alert detection for the new property is automatic.
4. The frontend conformance tables and drift charts are driven by the property keys returned from the API, so new properties will appear automatically.

To add a new non-negotiable:

1. Add an entry to `spec.json` under `non_negotiables` with a unique `id`, `name`, `description`, and `zero_tolerance: true`.
2. Update `_SYSTEM_TEMPLATE` in `runtime.py` if the new rule requires a specific phrasing in the system prompt (it is currently built dynamically from the spec, so this may already be handled).
3. Update the `_RETRY_ADDENDUM` in `runtime.py` to explicitly call out the new rule in retry instructions.

To change thresholds or targets, edit the values in `spec.json` directly. No code changes are needed — thresholds are read at runtime.

To add a new ticket type and resolution path, add an entry to `RESOLUTION_PATHS` in `runtime.py`. The spec itself does not encode resolution paths — they live in the service layer.
