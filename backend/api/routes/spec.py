"""Serve and update the behavioral spec."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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


class ThresholdUpdate(BaseModel):
    """One property threshold update."""
    id: str
    target: float
    alert_threshold: float


class UpdateThresholdsRequest(BaseModel):
    behavioral_properties: list[ThresholdUpdate]


@router.patch("/spec/thresholds", response_model=Envelope[dict])
async def update_thresholds(body: UpdateThresholdsRequest) -> Envelope[dict]:
    """Update per-property target and alert thresholds in spec.json."""
    try:
        with open(_SPEC_PATH) as fh:
            spec: dict[str, Any] = json.load(fh)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="spec.json not found")

    update_map = {u.id: u for u in body.behavioral_properties}
    for prop in spec.get("behavioral_properties", []):
        if prop["id"] in update_map:
            u = update_map[prop["id"]]
            prop["target"] = round(u.target, 4)
            prop["alert_threshold"] = round(u.alert_threshold, 4)

    with open(_SPEC_PATH, "w") as fh:
        json.dump(spec, fh, indent=2)
        fh.write("\n")

    return Envelope(data=spec, meta={"updated": list(update_map.keys())})
