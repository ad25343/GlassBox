"""Chat log analytics routes.

Queries the chat_logs table (written asynchronously after every live turn) to
surface tool call sequences, session patterns, and recurring issues.
"""
from __future__ import annotations

import json
from collections import Counter
from typing import Any

from fastapi import APIRouter, Query

from backend.api.schemas import Envelope
from backend.core import db
from backend.core.logging import get_logger

router = APIRouter(prefix="/api/v1/chatlogs", tags=["chatlogs"])
logger = get_logger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _parse_row(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["tool_calls"] = json.loads(d.pop("tool_calls_json", "[]"))
    d["verdict_summary"] = json.loads(d.pop("verdict_summary_json", "{}"))
    return d


# ── Routes ─────────────────────────────────────────────────────────────────────


@router.get("/", response_model=Envelope[list[dict[str, Any]]])
async def list_chat_logs(
    limit: int = Query(default=50, le=200),
    ticket_type: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> Envelope[list[dict[str, Any]]]:
    """
    Return recent chat log entries, newest first.
    Optionally filter by ticket_type (order_status, refund_request, etc.)
    and/or session_id to drill into a specific session.
    Each entry contains: session_id, turn_number, ticket_type, customer_message,
    tool call names, response snippet, and verdict summary.
    """
    with db.get_db() as conn:
        conditions: list[str] = []
        params: list[Any] = []
        if ticket_type:
            conditions.append("ticket_type = ?")
            params.append(ticket_type)
        if session_id:
            conditions.append("session_id = ?")
            params.append(session_id)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.append(limit)
        rows = conn.execute(
            f"""
            SELECT id, created_at, session_id, run_id, turn_number, ticket_type,
                   customer_message, tool_calls_json, response, verdict_summary_json
            FROM chat_logs
            {where}
            ORDER BY created_at ASC LIMIT ?
            """,
            params,
        ).fetchall()

    entries = []
    for row in rows:
        d = _parse_row(row)
        # Summarise tool calls to just names for the list view
        d["tool_names"] = [tc["name"] for tc in d["tool_calls"]]
        d.pop("tool_calls")
        # Truncate response to 200 chars for the list view
        if d.get("response") and len(d["response"]) > 200:
            d["response"] = d["response"][:200] + "…"
        entries.append(d)

    return Envelope(data=entries, meta={"count": len(entries), "ticket_type_filter": ticket_type, "session_id_filter": session_id})


@router.get("/analytics", response_model=Envelope[dict[str, Any]])
async def get_analytics() -> Envelope[dict[str, Any]]:
    """
    Aggregate analytics across all chat log entries:
    - Summary: total sessions, total turns, avg turns per session, avg conformance
    - Tool call frequency: how often each tool is called, broken down by ticket type
    - Most common tool sequences: top 10 ordered tool call chains per session turn
    - Ticket type breakdown: session and turn counts per type
    - Non-negotiable failure rate: fraction of turns with at least one violation
    - Recent sessions: last 10 sessions with turn count, ticket type, avg conformance
    """
    with db.get_db() as conn:
        rows = conn.execute(
            """
            SELECT session_id, run_id, turn_number, ticket_type,
                   tool_calls_json, verdict_summary_json, created_at
            FROM chat_logs
            ORDER BY created_at ASC
            """
        ).fetchall()

    if not rows:
        return Envelope(
            data={
                "summary": {
                    "total_sessions": 0,
                    "total_turns": 0,
                    "avg_turns_per_session": 0.0,
                    "avg_conformance": None,
                    "non_negotiable_failure_rate": 0.0,
                },
                "tool_call_frequency": {},
                "tool_sequences": [],
                "ticket_type_breakdown": {},
                "recent_sessions": [],
            },
            meta={"total_log_entries": 0},
        )

    # ── Parse all rows ────────────────────────────────────────────────────────
    sessions: dict[str, list[dict[str, Any]]] = {}
    tool_counts: Counter[str] = Counter()
    tool_counts_by_type: dict[str, Counter[str]] = {}
    sequence_counter: Counter[str] = Counter()
    conformance_values: list[float] = []
    nn_failures = 0
    total_turns = len(rows)
    type_sessions: dict[str, set[str]] = {}
    type_turns: dict[str, int] = {}

    for row in rows:
        d = _parse_row(row)
        sid = d["session_id"] or f"__run_{d['run_id']}"
        ttype = d["ticket_type"] or "unknown"

        sessions.setdefault(sid, []).append(d)

        # Tool call counts
        tool_names = [tc["name"] for tc in d["tool_calls"]]
        for name in tool_names:
            tool_counts[name] += 1
            tool_counts_by_type.setdefault(ttype, Counter())[name] += 1

        # Sequence: join tool names as a readable chain
        if tool_names:
            sequence_counter[" → ".join(tool_names)] += 1

        # Conformance
        vs = d.get("verdict_summary", {})
        if isinstance(vs, dict) and "overall_conformance" in vs:
            conformance_values.append(vs["overall_conformance"])
        if isinstance(vs, dict) and vs.get("any_non_negotiable_failed"):
            nn_failures += 1

        # Ticket type
        type_sessions.setdefault(ttype, set()).add(sid)
        type_turns[ttype] = type_turns.get(ttype, 0) + 1

    total_sessions = len(sessions)
    avg_turns = round(total_turns / total_sessions, 2) if total_sessions else 0.0
    avg_conformance = (
        round(sum(conformance_values) / len(conformance_values), 4)
        if conformance_values else None
    )
    nn_failure_rate = round(nn_failures / total_turns, 4) if total_turns else 0.0

    # ── Tool frequency ────────────────────────────────────────────────────────
    tool_frequency: dict[str, Any] = {
        "overall": dict(tool_counts.most_common()),
        "by_ticket_type": {
            ttype: dict(counter.most_common())
            for ttype, counter in tool_counts_by_type.items()
        },
    }

    # ── Top sequences ─────────────────────────────────────────────────────────
    top_sequences = [
        {"sequence": seq, "count": count}
        for seq, count in sequence_counter.most_common(10)
    ]

    # ── Ticket type breakdown ─────────────────────────────────────────────────
    ticket_type_breakdown = {
        ttype: {
            "sessions": len(sids),
            "turns": type_turns.get(ttype, 0),
            "avg_turns": round(type_turns.get(ttype, 0) / len(sids), 2) if sids else 0,
        }
        for ttype, sids in type_sessions.items()
    }

    # ── Recent sessions ───────────────────────────────────────────────────────
    session_list = []
    for sid, turns in sessions.items():
        session_conformance = [
            t["verdict_summary"]["overall_conformance"]
            for t in turns
            if isinstance(t.get("verdict_summary"), dict)
            and "overall_conformance" in t["verdict_summary"]
        ]
        all_tools = []
        for t in turns:
            all_tools.extend([tc["name"] for tc in t["tool_calls"]])
        session_list.append({
            "session_id": sid,
            "ticket_type": turns[0]["ticket_type"],
            "turn_count": len(turns),
            "avg_conformance": (
                round(sum(session_conformance) / len(session_conformance), 4)
                if session_conformance else None
            ),
            "tools_used": list(dict.fromkeys(all_tools)),  # ordered unique
            "created_at": turns[0]["created_at"],
            "last_turn_at": turns[-1]["created_at"],
        })

    # Sort by most recent first
    session_list.sort(key=lambda s: s["last_turn_at"], reverse=True)
    recent_sessions = session_list[:10]

    analytics = {
        "summary": {
            "total_sessions": total_sessions,
            "total_turns": total_turns,
            "avg_turns_per_session": avg_turns,
            "avg_conformance": avg_conformance,
            "non_negotiable_failure_rate": nn_failure_rate,
        },
        "tool_call_frequency": tool_frequency,
        "tool_sequences": top_sequences,
        "ticket_type_breakdown": ticket_type_breakdown,
        "recent_sessions": recent_sessions,
    }

    logger.info(
        "chat log analytics computed",
        total_sessions=total_sessions,
        total_turns=total_turns,
    )

    return Envelope(data=analytics, meta={"total_log_entries": total_turns})
