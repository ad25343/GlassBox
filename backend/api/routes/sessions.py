"""Sessions routes — retrieve full conversation threads by session ID."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.api.schemas import Envelope
from backend.core import db
from backend.core.logging import get_logger

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])
logger = get_logger(__name__)


@router.get("/{session_id}", response_model=Envelope[dict[str, Any]])
async def get_session(session_id: str) -> Envelope[dict[str, Any]]:
    session = db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return Envelope(data=session, meta={"turn_count": session.get("turn_count", 0)})
