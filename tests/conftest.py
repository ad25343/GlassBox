"""Shared test fixtures."""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def tmp_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """
    Redirect db.DB_PATH to a fresh temp SQLite file, run init_db() to create
    the schema, and seed minimal customer/order/billing data for tool tests.
    Returns the path to the temp DB (rarely needed directly by tests).
    """
    db_file = tmp_path / "test.db"
    import backend.core.db as db_module

    monkeypatch.setattr(db_module, "DB_PATH", db_file)

    # Init schema + seed support data
    db_module.init_db()

    return db_file
