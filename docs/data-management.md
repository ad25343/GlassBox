# Data Management

How to load synthetic data, reset the database, and populate GlassBox with your own real snapshots.

---

## How data is stored

GlassBox uses a local SQLite file (`glassbox.db` in the project root). It is created automatically on first startup and contains:

| Table | What it holds |
|---|---|
| `baseline_snapshots` | One row per drift/test-suite/compare run — overall scores, property scores |
| `snapshot_examples` | Per-example results for every snapshot run (36 rows per snapshot) |
| `runs` | Every live ticket submitted via Try It |
| `production_verdicts` | Judge verdict per live run, used by the Production Monitor |
| `sessions` | Multi-turn conversation threads |
| `customers / orders / billing_charges` | The 5 deterministic support personas used by the agent tools |

The DB file is gitignored. It is never committed.

---

## Loading synthetic data

Synthetic data is a pre-scripted 14-day behavioral history that shows realistic drift patterns — stable performance, a mid-run drop (simulated prompt change), partial recovery, and stabilisation. It gives the Baseline & Drift page something meaningful to display before you have any real snapshots.

**To enable:**

```bash
# In .env, set:
SEED_SYNTHETIC_HISTORY=true
```

Then start (or restart) the backend:

```bash
make dev
```

On startup, GlassBox checks whether any `baseline` snapshots exist. If the table is empty **and** `SEED_SYNTHETIC_HISTORY=true`, it seeds 14 synthetic snapshots. If snapshots already exist, seeding is skipped — so restarting with the flag on won't duplicate data.

**To disable (for production or a clean deployment):**

```bash
# In .env, set:
SEED_SYNTHETIC_HISTORY=false
```

No synthetic data will be seeded on the next startup.

---

## Cleaning up data

### Wipe everything and start fresh

Stop the backend, delete the DB file, and restart:

```bash
# 1. Stop the backend (Ctrl+C)

# 2. Delete the database
rm glassbox.db

# 3. Restart — DB is recreated empty
make dev
```

The 5 customer personas and their orders/billing records are re-seeded from `backend/core/db.py` on every fresh init, so the Try It page works immediately.

### Delete individual snapshots

From the **Baseline & Drift** page, each snapshot row has a trash icon. Clicking it calls `DELETE /api/v1/runs/snapshot/{id}` and removes the snapshot and all its per-example results (cascade delete).

You can also call the API directly:

```bash
curl -X DELETE http://localhost:8888/api/v1/runs/snapshot/{id}
```

---

## Loading your own real data

Once synthetic data is removed (or after a fresh DB), populate GlassBox with real snapshots by running the corpus against your live model.

### 1. Run your first test suite

On the **Model Evaluation** page, select a model and click **Run Test Suite**. This runs all 36 corpus examples concurrently against the selected model, scores each one with the judge, and stores the result as a `test` snapshot.

The spec-defined targets in `spec.json` are the baseline — e.g. `resolution_matching` targets 90%. Each subsequent run is compared against these targets (not against the first run). You can edit targets per-property on the **Baseline & Drift** page.

### 2. View drift

The **Baseline & Drift** page reads all `test` snapshots for the selected model and shows per-property score trends over time, with delta cards showing `current score − spec target`. No separate "Run Baseline" step is needed.

### 3. Run model comparisons

On the **Model Comparison** page, click **Compare Models**. Results are stored as `compare` snapshots and appear only in the comparison view.

### Recommended cadence for a real deployment

| When | Action | Page |
|---|---|---|
| Initial setup | Run test suite, review scores vs spec targets | Model Evaluation |
| After any prompt or spec change | Run a new test suite, review Drift page for delta | Model Evaluation → Baseline & Drift |
| Evaluating a new model | Run model comparison | Model Comparison |
| Adjusting pass thresholds | Edit targets on Passing Thresholds card | Baseline & Drift |
| Ongoing regression checks | Run test suite periodically | Model Evaluation |

---

## Adapting GlassBox to a new domain

GlassBox is domain-agnostic. The only files you need to replace to use it for a different support domain are:

| File | What to change |
|---|---|
| `spec.json` | Agent persona, resolution paths per ticket type, tool list, non-negotiables, behavioral properties, retry message |
| `corpus.json` | Your own labeled test examples (same schema: `id`, `ticket_type`, `customer_message`, `context`, `resolution_path`, `label`, `notes`) |
| `backend/services/tools.py` | Implement the actual tool functions that match the tools listed in `spec.json` |

No changes are required to `runtime.py`, `judge.py`, `drift.py`, or any route files.

See [behavioral-spec.md](behavioral-spec.md) for details on the spec schema and how to write non-negotiables and behavioral properties for a new domain.
