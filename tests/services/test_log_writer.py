"""Tests for the async chat log hydration layer (backend/services/log_writer.py)."""
from __future__ import annotations

import asyncio
import json


from backend.services.log_writer import ChatLogWriter


SAMPLE_PAYLOAD = dict(
    session_id="sess-test-001",
    run_id=42,
    turn_number=1,
    ticket_type="order_status",
    customer_message="Where is my order?",
    tool_calls=[
        {
            "name": "lookup_customer",
            "input": {"last_name": "Chen", "order_id": "7823"},
            "result": {"found": True, "first_name": "Sarah"},
            "tool_use_id": "tu_001",
        }
    ],
    response="Your order is in transit.",
    verdict_summary={
        "overall_conformance": 0.92,
        "any_non_negotiable_failed": False,
        "property_scores": {"issue_acknowledged": 0.95, "resolution_matching": 0.90},
    },
)


# ── Sync write path ────────────────────────────────────────────────────────────

class TestSyncWrite:
    def test_writes_to_sqlite(self, tmp_db, tmp_path, monkeypatch):
        import backend.services.log_writer as lw_module
        monkeypatch.setattr(lw_module, "CHAT_LOG_PATH", tmp_path / "chat_logs.jsonl")

        writer = ChatLogWriter()
        writer._write_sync(SAMPLE_PAYLOAD)

        import backend.core.db as db
        with db.get_db() as conn:
            row = conn.execute(
                "SELECT * FROM chat_logs WHERE session_id = ?",
                (SAMPLE_PAYLOAD["session_id"],),
            ).fetchone()

        assert row is not None
        assert row["session_id"] == "sess-test-001"
        assert row["run_id"] == 42
        assert row["turn_number"] == 1
        assert row["ticket_type"] == "order_status"
        assert row["customer_message"] == "Where is my order?"
        assert row["response"] == "Your order is in transit."

        # tool_calls_json is valid JSON
        calls = json.loads(row["tool_calls_json"])
        assert len(calls) == 1
        assert calls[0]["name"] == "lookup_customer"

        # verdict_summary_json round-trips
        verdict = json.loads(row["verdict_summary_json"])
        assert verdict["overall_conformance"] == 0.92

    def test_writes_to_jsonl(self, tmp_db, tmp_path, monkeypatch):
        import backend.services.log_writer as lw_module
        jsonl_path = tmp_path / "chat_logs.jsonl"
        monkeypatch.setattr(lw_module, "CHAT_LOG_PATH", jsonl_path)

        writer = ChatLogWriter()
        writer._write_sync(SAMPLE_PAYLOAD)

        assert jsonl_path.exists()
        lines = jsonl_path.read_text().strip().splitlines()
        assert len(lines) == 1

        entry = json.loads(lines[0])
        assert entry["session_id"] == "sess-test-001"
        assert entry["run_id"] == 42
        assert "created_at" in entry
        assert entry["tool_calls"][0]["name"] == "lookup_customer"

    def test_multiple_writes_append_to_jsonl(self, tmp_db, tmp_path, monkeypatch):
        import backend.services.log_writer as lw_module
        jsonl_path = tmp_path / "chat_logs.jsonl"
        monkeypatch.setattr(lw_module, "CHAT_LOG_PATH", jsonl_path)

        writer = ChatLogWriter()
        for i in range(3):
            payload = {**SAMPLE_PAYLOAD, "run_id": i, "turn_number": i + 1}
            writer._write_sync(payload)

        lines = jsonl_path.read_text().strip().splitlines()
        assert len(lines) == 3

        run_ids = [json.loads(line)["run_id"] for line in lines]
        assert run_ids == [0, 1, 2]

    def test_empty_tool_calls_ok(self, tmp_db, tmp_path, monkeypatch):
        import backend.services.log_writer as lw_module
        monkeypatch.setattr(lw_module, "CHAT_LOG_PATH", tmp_path / "chat_logs.jsonl")

        writer = ChatLogWriter()
        payload = {**SAMPLE_PAYLOAD, "tool_calls": []}
        writer._write_sync(payload)

        import backend.core.db as db
        with db.get_db() as conn:
            row = conn.execute("SELECT tool_calls_json FROM chat_logs WHERE run_id = 42").fetchone()

        assert json.loads(row["tool_calls_json"]) == []


# ── Async schedule path ────────────────────────────────────────────────────────

class TestScheduleWrite:
    async def test_schedule_write_completes(self, tmp_db, tmp_path, monkeypatch):
        """schedule_write fires an async task that eventually writes to both stores."""
        import backend.services.log_writer as lw_module
        monkeypatch.setattr(lw_module, "CHAT_LOG_PATH", tmp_path / "chat_logs.jsonl")

        writer = ChatLogWriter()
        writer.schedule_write(**SAMPLE_PAYLOAD)

        # Let the event loop drain pending tasks
        await asyncio.sleep(0.05)

        import backend.core.db as db
        with db.get_db() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM chat_logs WHERE session_id = ?",
                (SAMPLE_PAYLOAD["session_id"],),
            ).fetchone()[0]

        assert count == 1

    async def test_schedule_write_returns_immediately(self, tmp_db, tmp_path, monkeypatch):
        """schedule_write should return before the write completes (non-blocking contract)."""
        import backend.services.log_writer as lw_module
        monkeypatch.setattr(lw_module, "CHAT_LOG_PATH", tmp_path / "chat_logs.jsonl")

        import time
        writer = ChatLogWriter()
        start = time.monotonic()
        writer.schedule_write(**SAMPLE_PAYLOAD)
        elapsed = time.monotonic() - start

        # Should return in well under 100ms — the actual write is offloaded
        assert elapsed < 0.1
