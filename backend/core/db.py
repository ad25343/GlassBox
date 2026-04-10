import json
import random
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from backend.core.logging import get_logger

logger = get_logger(__name__)

DB_PATH = Path("glassbox.db")

CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    scenario_id TEXT NOT NULL DEFAULT '',
    context_json TEXT NOT NULL DEFAULT '{}'
)
"""

CREATE_RUNS = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    session_id TEXT REFERENCES sessions(id),
    turn_number INTEGER NOT NULL DEFAULT 1,
    model TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    customer_message TEXT NOT NULL,
    context TEXT NOT NULL,
    response TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    conversation_history_json TEXT NOT NULL DEFAULT '[]'
)
"""

MIGRATE_RUNS_ADD_HISTORY = """
ALTER TABLE runs ADD COLUMN conversation_history_json TEXT NOT NULL DEFAULT '[]'
"""

MIGRATE_RUNS_ADD_SESSION_ID = """
ALTER TABLE runs ADD COLUMN session_id TEXT REFERENCES sessions(id)
"""

MIGRATE_RUNS_ADD_TURN_NUMBER = """
ALTER TABLE runs ADD COLUMN turn_number INTEGER NOT NULL DEFAULT 1
"""

MIGRATE_SNAPSHOTS_ADD_CATEGORY_SCORES = """
ALTER TABLE baseline_snapshots ADD COLUMN category_scores_json TEXT NOT NULL DEFAULT '{}'
"""

MIGRATE_SNAPSHOTS_ADD_TOKEN_COUNTS = """
ALTER TABLE baseline_snapshots ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0
"""

MIGRATE_SNAPSHOTS_ADD_OUTPUT_TOKENS = """
ALTER TABLE baseline_snapshots ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0
"""

MIGRATE_SNAPSHOTS_ADD_RUN_TYPE = """
ALTER TABLE baseline_snapshots ADD COLUMN run_type TEXT NOT NULL DEFAULT 'baseline'
"""

CREATE_CONFORMANCE_RESULTS = """
CREATE TABLE IF NOT EXISTS conformance_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES runs(id),
    property_name TEXT NOT NULL,
    property_type TEXT NOT NULL CHECK(property_type IN ('negotiable', 'behavioral')),
    score REAL,
    passed INTEGER,
    verdict_json TEXT NOT NULL
)
"""

CREATE_BASELINE_SNAPSHOTS = """
CREATE TABLE IF NOT EXISTS baseline_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    corpus_version TEXT NOT NULL,
    overall_conformance REAL NOT NULL,
    property_scores_json TEXT NOT NULL,
    non_negotiable_results_json TEXT NOT NULL
)
"""

CREATE_SNAPSHOT_EXAMPLES = """
CREATE TABLE IF NOT EXISTS snapshot_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES baseline_snapshots(id) ON DELETE CASCADE,
    corpus_example_id TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    customer_message_truncated TEXT NOT NULL,
    overall_score REAL NOT NULL,
    property_scores_json TEXT NOT NULL,
    non_negotiables_passed INTEGER NOT NULL
)
"""

CREATE_PRODUCTION_VERDICTS = """
CREATE TABLE IF NOT EXISTS production_verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    overall_score REAL NOT NULL,
    property_scores_json TEXT NOT NULL,
    alert_triggered INTEGER NOT NULL DEFAULT 0
)
"""

# ── Support data tables (agent tool backing store) ─────────────────────────────

CREATE_CUSTOMERS = """
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    customer_since TEXT
)
"""

CREATE_ORDERS = """
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    status TEXT NOT NULL,
    carrier TEXT,
    tracking_number TEXT,
    item_description TEXT,
    total_amount REAL,
    ordered_at TEXT,
    shipped_at TEXT,
    delivered_at TEXT,
    last_scan_at TEXT,
    last_scan_location TEXT
)
"""

CREATE_ORDER_ITEMS = """
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id),
    name TEXT NOT NULL,
    sku TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL
)
"""

CREATE_BILLING_CHARGES = """
CREATE TABLE IF NOT EXISTS billing_charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    order_id TEXT REFERENCES orders(id),
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    charged_at TEXT NOT NULL,
    charge_type TEXT NOT NULL
)
"""

CREATE_CHAT_LOGS = """
CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    session_id TEXT,
    run_id INTEGER,
    turn_number INTEGER,
    ticket_type TEXT,
    customer_message TEXT,
    tool_calls_json TEXT,
    response TEXT,
    verdict_summary_json TEXT
)
"""


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    logger.info("initializing database", db_path=str(DB_PATH))
    with get_db() as conn:
        conn.execute(CREATE_SESSIONS)
        conn.execute(CREATE_RUNS)
        conn.execute(CREATE_CONFORMANCE_RESULTS)
        conn.execute(CREATE_BASELINE_SNAPSHOTS)
        conn.execute(CREATE_SNAPSHOT_EXAMPLES)
        conn.execute(CREATE_PRODUCTION_VERDICTS)
        # Agent tool backing store
        conn.execute(CREATE_CUSTOMERS)
        conn.execute(CREATE_ORDERS)
        conn.execute(CREATE_ORDER_ITEMS)
        conn.execute(CREATE_BILLING_CHARGES)
        conn.execute(CREATE_CHAT_LOGS)
        conn.commit()
    with get_db() as conn:
        _migrate(conn)
        _backfill_synthetic_category_scores(conn)
    _seed_support_data()
    logger.info("database initialized")


def _backfill_synthetic_category_scores(conn: sqlite3.Connection) -> None:
    """Backfill category_scores_json for any snapshots that have an empty value."""
    TICKET_TYPES = ["order_status", "refund_request", "billing_dispute", "escalation"]
    rows = conn.execute(
        "SELECT id, property_scores_json FROM baseline_snapshots WHERE category_scores_json = '{}'"
    ).fetchall()
    if not rows:
        return
    logger.info("backfilling category_scores_json", count=len(rows))
    for row in rows:
        property_scores: dict[str, float] = json.loads(row[1])
        category_scores: dict[str, dict[str, float]] = {}
        for ticket_type in TICKET_TYPES:
            category_scores[ticket_type] = {
                prop: round(min(1.0, max(0.0, score + random.uniform(-0.03, 0.03))), 4)
                for prop, score in property_scores.items()
            }
        conn.execute(
            "UPDATE baseline_snapshots SET category_scores_json = ? WHERE id = ?",
            (json.dumps(category_scores), row[0]),
        )
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply additive migrations — safe to re-run on every startup."""
    run_cols = {row[1] for row in conn.execute("PRAGMA table_info(runs)").fetchall()}
    if "conversation_history_json" not in run_cols:
        logger.info("migrating runs — adding conversation_history_json")
        conn.execute(MIGRATE_RUNS_ADD_HISTORY)
    if "session_id" not in run_cols:
        logger.info("migrating runs — adding session_id")
        conn.execute(MIGRATE_RUNS_ADD_SESSION_ID)
    if "turn_number" not in run_cols:
        logger.info("migrating runs — adding turn_number")
        conn.execute(MIGRATE_RUNS_ADD_TURN_NUMBER)
    snap_cols = {row[1] for row in conn.execute("PRAGMA table_info(baseline_snapshots)").fetchall()}
    if "category_scores_json" not in snap_cols:
        logger.info("migrating baseline_snapshots — adding category_scores_json")
        conn.execute(MIGRATE_SNAPSHOTS_ADD_CATEGORY_SCORES)
    if "input_tokens" not in snap_cols:
        logger.info("migrating baseline_snapshots — adding input_tokens")
        conn.execute(MIGRATE_SNAPSHOTS_ADD_TOKEN_COUNTS)
    if "output_tokens" not in snap_cols:
        logger.info("migrating baseline_snapshots — adding output_tokens")
        conn.execute(MIGRATE_SNAPSHOTS_ADD_OUTPUT_TOKENS)
    if "run_type" not in snap_cols:
        logger.info("migrating baseline_snapshots — adding run_type")
        conn.execute(MIGRATE_SNAPSHOTS_ADD_RUN_TYPE)
    existing_tables = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    if "snapshot_examples" not in existing_tables:
        logger.info("migrating — creating snapshot_examples table")
        conn.execute(CREATE_SNAPSHOT_EXAMPLES)
    conn.commit()


def _seed_support_data() -> None:
    """
    Seed demo customer/order/billing data for the three core personas.
    Uses INSERT OR REPLACE so dates refresh on every startup — demo data is always current.
    """
    today = datetime.now()

    # ── Customers ─────────────────────────────────────────────────────────────
    customers = [
        ("CUST-1001", "Sarah",   "Chen",       "sarah.chen@email.com",      "+1-555-0101", "2023-06-15"),
        ("CUST-1002", "James",   "Rodriguez",  "james.r@email.com",         "+1-555-0102", "2022-11-20"),
        ("CUST-1003", "Priya",   "Patel",      "priya.patel@email.com",     "+1-555-0103", "2024-01-08"),
        ("CUST-1004", "Michael", "Thompson",   "m.thompson@email.com",      "+1-555-0104", "2023-03-30"),
        ("CUST-1005", "Emily",   "Davis",      "emily.d@email.com",         "+1-555-0105", "2024-02-14"),
    ]

    # ── Order dates (relative to today so scenarios are always fresh) ─────────
    # Sarah Chen — order in transit, last scan 4 days ago — escalation risk
    sarah_ordered_at   = (today - timedelta(days=14)).isoformat()
    sarah_shipped_at   = (today - timedelta(days=12)).isoformat()
    sarah_last_scan_at = (today - timedelta(days=4)).isoformat()

    # James Rodriguez — delivered 18 days ago, within 30-day return window (12 days left)
    james_ordered_at    = (today - timedelta(days=22)).isoformat()
    james_shipped_at    = (today - timedelta(days=20)).isoformat()
    james_delivered_at  = (today - timedelta(days=18)).isoformat()

    # Priya Patel — delivered 8 days ago, billing dispute
    priya_ordered_at    = (today - timedelta(days=12)).isoformat()
    priya_shipped_at    = (today - timedelta(days=10)).isoformat()
    priya_delivered_at  = (today - timedelta(days=8)).isoformat()

    # Michael Thompson — delivered 5 days ago, no issues
    michael_ordered_at   = (today - timedelta(days=10)).isoformat()
    michael_shipped_at   = (today - timedelta(days=8)).isoformat()
    michael_delivered_at = (today - timedelta(days=5)).isoformat()

    # Emily Davis — order cancelled before shipment
    emily_ordered_at = (today - timedelta(days=3)).isoformat()

    # ── Orders ────────────────────────────────────────────────────────────────
    orders = [
        # id, customer_id, status, carrier, tracking, item_description, total_amount,
        # ordered_at, shipped_at, delivered_at, last_scan_at, last_scan_location
        (
            "7823", "CUST-1001", "in_transit",
            "FedEx", "FX-784523698",
            "Wireless Bluetooth Headphones", 89.99,
            sarah_ordered_at, sarah_shipped_at, None,
            sarah_last_scan_at, "Memphis Distribution Hub",
        ),
        (
            "4521", "CUST-1002", "delivered",
            "UPS", "1Z-999-AA1-01-2345-6789",
            "Bluetooth Speaker", 64.99,
            james_ordered_at, james_shipped_at, james_delivered_at,
            james_delivered_at, "Delivered — Front Door",
        ),
        (
            "6634", "CUST-1003", "delivered",
            "FedEx", "FX-661245789",
            "Wireless Headphones", 89.00,
            priya_ordered_at, priya_shipped_at, priya_delivered_at,
            priya_delivered_at, "Delivered — Front Door",
        ),
        (
            "9012", "CUST-1004", "delivered",
            "USPS", "9400111899223456789012",
            "Smart Watch", 199.99,
            michael_ordered_at, michael_shipped_at, michael_delivered_at,
            michael_delivered_at, "Delivered — Mailbox",
        ),
        (
            "3345", "CUST-1005", "cancelled",
            None, None,
            "Running Shoes", 129.99,
            emily_ordered_at, None, None, None, None,
        ),
    ]

    # ── Order items ───────────────────────────────────────────────────────────
    # (order_id, name, sku, quantity, unit_price)
    order_items = [
        ("7823", "Wireless Bluetooth Headphones",  "SKU-WBH-2024", 1, 89.99),
        ("4521", "Bluetooth Speaker",              "SKU-BTS-2024", 1, 64.99),
        ("6634", "Wireless Headphones",            "SKU-WH-2024",  1, 89.00),
        ("9012", "Smart Watch",                    "SKU-SW-2024",  1, 199.99),
        ("3345", "Running Shoes (Size 10)",        "SKU-RS-2024",  1, 129.99),
    ]

    # ── Billing charges ───────────────────────────────────────────────────────
    # (customer_id, order_id, amount, description, charged_at, charge_type)
    billing_charges = [
        (
            "CUST-1001", "7823", 89.99,
            "Wireless Bluetooth Headphones — Order #7823",
            sarah_ordered_at, "purchase",
        ),
        (
            "CUST-1002", "4521", 64.99,
            "Bluetooth Speaker — Order #4521",
            james_ordered_at, "purchase",
        ),
        (
            "CUST-1003", "6634", 89.00,
            "Wireless Headphones — Order #6634",
            priya_ordered_at, "purchase",
        ),
        (
            "CUST-1004", "9012", 199.99,
            "Smart Watch — Order #9012",
            michael_ordered_at, "purchase",
        ),
    ]

    with get_db() as conn:
        for c in customers:
            conn.execute(
                "INSERT OR REPLACE INTO customers (id, first_name, last_name, email, phone, customer_since) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                c,
            )

        for o in orders:
            conn.execute(
                "INSERT OR REPLACE INTO orders "
                "(id, customer_id, status, carrier, tracking_number, item_description, total_amount, "
                " ordered_at, shipped_at, delivered_at, last_scan_at, last_scan_location) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                o,
            )

        # Delete and re-insert order items so they don't accumulate
        conn.execute("DELETE FROM order_items WHERE order_id IN ('7823','4521','6634','9012','3345')")
        for item in order_items:
            conn.execute(
                "INSERT INTO order_items (order_id, name, sku, quantity, unit_price) "
                "VALUES (?, ?, ?, ?, ?)",
                item,
            )

        # Delete and re-insert billing charges
        conn.execute(
            "DELETE FROM billing_charges WHERE customer_id IN "
            "('CUST-1001','CUST-1002','CUST-1003','CUST-1004','CUST-1005')"
        )
        for charge in billing_charges:
            conn.execute(
                "INSERT INTO billing_charges (customer_id, order_id, amount, description, charged_at, charge_type) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                charge,
            )

        conn.commit()

    logger.info("support seed data written — 5 customers, 5 orders, 4 billing charges")


# ── Sessions ──────────────────────────────────────────────────────────────────

def create_session(
    *,
    ticket_type: str,
    scenario_id: str = "",
    context: dict[str, Any] | None = None,
) -> str:
    session_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sessions (id, created_at, ticket_type, scenario_id, context_json) VALUES (?, ?, ?, ?, ?)",
            (session_id, created_at, ticket_type, scenario_id, json.dumps(context or {})),
        )
        conn.commit()
    logger.debug("created session", session_id=session_id, ticket_type=ticket_type)
    return session_id


def get_session(session_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["context"] = json.loads(d.pop("context_json"))
        run_rows = conn.execute(
            "SELECT * FROM runs WHERE session_id = ? ORDER BY turn_number ASC",
            (session_id,),
        ).fetchall()
        d["turns"] = [_deserialize_run(dict(r)) for r in run_rows]
        d["turn_count"] = len(d["turns"])
    return d


def get_session_turn_count(session_id: str) -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM runs WHERE session_id = ?", (session_id,)
        ).fetchone()
        return row[0] if row else 0


def insert_run(
    *,
    model: str,
    ticket_type: str,
    customer_message: str,
    context: dict[str, Any],
    response: str,
    prompt_version: str,
    latency_ms: int,
    total_tokens: int,
    conversation_history: list[dict[str, str]] | None = None,
    session_id: str | None = None,
    turn_number: int = 1,
) -> int:
    created_at = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO runs
                (created_at, session_id, turn_number, model, ticket_type, customer_message,
                 context, response, prompt_version, latency_ms, total_tokens,
                 conversation_history_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                session_id,
                turn_number,
                model,
                ticket_type,
                customer_message,
                json.dumps(context),
                response,
                prompt_version,
                latency_ms,
                total_tokens,
                json.dumps(conversation_history or []),
            ),
        )
        conn.commit()
        run_id = cursor.lastrowid
    logger.debug("inserted run", run_id=run_id, session_id=session_id, turn_number=turn_number)
    return run_id  # type: ignore[return-value]


def insert_conformance_results(
    run_id: int,
    results: list[dict[str, Any]],
) -> None:
    with get_db() as conn:
        for result in results:
            conn.execute(
                """
                INSERT INTO conformance_results
                    (run_id, property_name, property_type, score, passed, verdict_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    result["property_name"],
                    result["property_type"],
                    result.get("score"),
                    int(result["passed"]) if result.get("passed") is not None else None,
                    json.dumps(result.get("verdict_json", {})),
                ),
            )
        conn.commit()


def insert_snapshot(
    *,
    model: str,
    prompt_version: str,
    corpus_version: str,
    overall_conformance: float,
    property_scores: dict[str, float],
    non_negotiable_results: dict[str, Any],
    created_at: str | None = None,
    category_scores: dict[str, dict[str, float]] | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    run_type: str = "baseline",
) -> int:
    ts = created_at or datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO baseline_snapshots
                (created_at, model, prompt_version, corpus_version, overall_conformance,
                 property_scores_json, non_negotiable_results_json, category_scores_json,
                 input_tokens, output_tokens, run_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts,
                model,
                prompt_version,
                corpus_version,
                overall_conformance,
                json.dumps(property_scores),
                json.dumps(non_negotiable_results),
                json.dumps(category_scores or {}),
                input_tokens,
                output_tokens,
                run_type,
            ),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]


def insert_snapshot_example(
    *,
    snapshot_id: int,
    corpus_example_id: str,
    ticket_type: str,
    customer_message: str,
    overall_score: float,
    property_scores: dict[str, float],
    non_negotiables_passed: bool,
) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO snapshot_examples
                (snapshot_id, corpus_example_id, ticket_type, customer_message_truncated,
                 overall_score, property_scores_json, non_negotiables_passed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot_id,
                corpus_example_id,
                ticket_type,
                customer_message[:120],
                round(overall_score, 4),
                json.dumps(property_scores),
                int(non_negotiables_passed),
            ),
        )
        conn.commit()


def get_snapshot_examples(snapshot_id: int) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM snapshot_examples WHERE snapshot_id = ? ORDER BY corpus_example_id ASC",
            (snapshot_id,),
        ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        d["property_scores"] = json.loads(d.pop("property_scores_json"))
        d["non_negotiables_passed"] = bool(d["non_negotiables_passed"])
        results.append(d)
    return results


def delete_snapshot(snapshot_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM baseline_snapshots WHERE id = ?", (snapshot_id,))
        conn.commit()


def get_snapshots(run_type: str | None = None) -> list[dict[str, Any]]:
    with get_db() as conn:
        if run_type:
            rows = conn.execute(
                "SELECT * FROM baseline_snapshots WHERE run_type = ? ORDER BY created_at ASC",
                (run_type,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM baseline_snapshots ORDER BY created_at ASC"
            ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        d["property_scores"] = json.loads(d.pop("property_scores_json"))
        d["non_negotiable_results"] = json.loads(d.pop("non_negotiable_results_json"))
        d["category_scores"] = json.loads(d.pop("category_scores_json", "{}"))
        d.setdefault("input_tokens", 0)
        d.setdefault("output_tokens", 0)
        d.setdefault("run_type", "baseline")
        results.append(d)
    return results


def _deserialize_run(d: dict[str, Any]) -> dict[str, Any]:
    d["context"] = json.loads(d["context"])
    d["conversation_history"] = json.loads(d.pop("conversation_history_json", "[]"))
    return d


def get_recent_runs(limit: int = 50) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_deserialize_run(dict(row)) for row in rows]


def get_run_by_id(run_id: int) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        d = _deserialize_run(dict(row))
        conf_rows = conn.execute(
            "SELECT * FROM conformance_results WHERE run_id = ?", (run_id,)
        ).fetchall()
        d["conformance_results"] = []
        for cr in conf_rows:
            crd = dict(cr)
            crd["verdict_json"] = json.loads(crd["verdict_json"])
            d["conformance_results"].append(crd)
    return d


def insert_production_verdict(
    *,
    run_id: int,
    overall_score: float,
    property_scores: dict[str, float],
    alert_triggered: bool,
) -> int:
    created_at = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO production_verdicts
                (created_at, run_id, overall_score, property_scores_json, alert_triggered)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                created_at,
                run_id,
                overall_score,
                json.dumps(property_scores),
                int(alert_triggered),
            ),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]


def get_recent_verdicts(limit: int = 50) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM production_verdicts ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        d["property_scores"] = json.loads(d.pop("property_scores_json"))
        d["alert_triggered"] = bool(d["alert_triggered"])
        results.append(d)
    return results
