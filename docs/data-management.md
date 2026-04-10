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

### 1. Run a baseline snapshot

On the **Baseline & Drift** page, click **Run Baseline**. This runs all 36 corpus examples against the production model (`claude-sonnet-4-5` by default), scores each one with the judge, and stores the result as a `baseline` snapshot.

The first snapshot becomes your baseline. Subsequent runs are compared against it to compute drift.

### 2. Run test suite snapshots

On the **Test Suite** page, click **Run Test Suite**. These are stored as `test` snapshots and are tracked separately from baseline snapshots — useful for exploratory runs against different models or prompt versions without affecting your drift history.

### 3. Run model comparisons

On the **Model Comparison** page, click **Compare Models**. Results are stored as `compare` snapshots and appear only in the comparison view.

### Recommended cadence for a real deployment

| When | Action | Page |
|---|---|---|
| Initial setup | Run one baseline snapshot | Baseline & Drift |
| After any prompt change | Run a new baseline snapshot, review drift | Baseline & Drift |
| Evaluating a new model | Run model comparison | Model Comparison |
| Ongoing regression checks | Run test suite snapshots periodically | Test Suite |

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
