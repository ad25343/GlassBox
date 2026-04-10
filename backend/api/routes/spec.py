"""Serve the behavioral spec."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from backend.api.schemas import Envelope

router = APIRouter(prefix="/api/v1", tags=["spec"])

_SPEC_PATH = Path(__file__).resolve().parents[3] / "spec.json"


@router.get("/spec", response_model=Envelope[dict])
async def get_spec() -> Envelope[dict]:
    try:
        with open(_SPEC_PATH) as fh:
            spec = json.load(fh)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="spec.json not found")
    return Envelope(data=spec)
