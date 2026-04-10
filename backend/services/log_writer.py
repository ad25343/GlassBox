"""
Async chat log hydration.
Writes each completed support turn to:
  - SQLite  chat_logs table   (queryable, in-app analytics)
  - chat_logs.jsonl           (portable, external processing — Pandas, Spark, etc.)

Hydration is non-blocking. Call schedule_write() after every turn — it fires an
asyncio task and returns immediately. The actual I/O runs in a thread pool.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core import db
from backend.core.logging import get_logger

logger = get_logger(__name__)

CHAT_LOG_PATH = Path("chat_logs.jsonl")


class ChatLogWriter:
    def schedule_write(
        self,
        *,
        session_id: str,
        run_id: int,
        turn_number: int,
        ticket_type: str,
        customer_message: str,
        tool_calls: list[dict[str, Any]],
        response: str,
        verdict_summary: dict[str, Any],
    ) -> None:
        """
        Schedule a fire-and-forget log write.

        Safe to call from any async context. Returns immediately — the write
        happens in the background via asyncio.create_task.
        """
        payload: dict[str, Any] = {
            "session_id": session_id,
            "run_id": run_id,
            "turn_number": turn_number,
            "ticket_type": ticket_type,
            "customer_message": customer_message,
            "tool_calls": tool_calls,
            "response": response,
            "verdict_summary": verdict_summary,
        }
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._write_async(payload))
        except RuntimeError:
            # No running event loop (e.g. test context) — fall back to sync
            self._write_sync(payload)

    async def _write_async(self, payload: dict[str, Any]) -> None:
        """Run the synchronous write in a thread pool to avoid blocking the event loop."""
        try:
            await asyncio.to_thread(self._write_sync, payload)
        except Exception as exc:
            logger.warning("chat log write failed", error=str(exc))

    def _write_sync(self, payload: dict[str, Any]) -> None:
        created_at = datetime.now().isoformat()

        # ── SQLite ────────────────────────────────────────────────────────────
        with db.get_db() as conn:
            conn.execute(
                """
                INSERT INTO chat_logs
                    (created_at, session_id, run_id, turn_number, ticket_type,
                     customer_message, tool_calls_json, response, verdict_summary_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at,
                    payload["session_id"],
                    payload["run_id"],
                    payload["turn_number"],
                    payload["ticket_type"],
                    payload["customer_message"],
                    json.dumps(payload["tool_calls"]),
                    payload["response"],
                    json.dumps(payload["verdict_summary"]),
                ),
            )
            conn.commit()

        # ── JSONL ─────────────────────────────────────────────────────────────
        entry = {"created_at": created_at, **payload}
        with CHAT_LOG_PATH.open("a") as fh:
            fh.write(json.dumps(entry) + "\n")

        logger.debug(
            "chat log written",
            run_id=payload["run_id"],
            session_id=payload["session_id"],
            turn_number=payload["turn_number"],
        )
