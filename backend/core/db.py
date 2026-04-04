import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.logging import get_logger

logger = get_logger(__name__)

DB_PATH = Path("glassbox.db")

CREATE_RUNS = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    model TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    customer_message TEXT NOT NULL,
    context TEXT NOT NULL,
    response TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL
)
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


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    logger.info("initializing database", db_path=str(DB_PATH))
    with get_db() as conn:
        conn.execute(CREATE_RUNS)
        conn.execute(CREATE_CONFORMANCE_RESULTS)
        conn.execute(CREATE_BASELINE_SNAPSHOTS)
        conn.execute(CREATE_PRODUCTION_VERDICTS)
        conn.commit()
    logger.info("database initialized")


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
) -> int:
    created_at = datetime.utcnow().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO runs
                (created_at, model, ticket_type, customer_message, context, response,
                 prompt_version, latency_ms, total_tokens)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                model,
                ticket_type,
                customer_message,
                json.dumps(context),
                response,
                prompt_version,
                latency_ms,
                total_tokens,
            ),
        )
        conn.commit()
        run_id = cursor.lastrowid
    logger.debug("inserted run", run_id=run_id, model=model, ticket_type=ticket_type)
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
) -> int:
    ts = created_at or datetime.utcnow().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO baseline_snapshots
                (created_at, model, prompt_version, corpus_version, overall_conformance,
                 property_scores_json, non_negotiable_results_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts,
                model,
                prompt_version,
                corpus_version,
                overall_conformance,
                json.dumps(property_scores),
                json.dumps(non_negotiable_results),
            ),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]


def get_snapshots() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM baseline_snapshots ORDER BY created_at ASC"
        ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        d["property_scores"] = json.loads(d.pop("property_scores_json"))
        d["non_negotiable_results"] = json.loads(d.pop("non_negotiable_results_json"))
        results.append(d)
    return results


def get_recent_runs(limit: int = 50) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        d["context"] = json.loads(d["context"])
        results.append(d)
    return results


def get_run_by_id(run_id: int) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["context"] = json.loads(d["context"])
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
    created_at = datetime.utcnow().isoformat()
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
