"""Corpus editor routes — CRUD for corpus.json ground-truth examples."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.api.schemas import Envelope
from backend.core.logging import get_logger

router = APIRouter(prefix="/api/v1/corpus", tags=["corpus"])
logger = get_logger(__name__)

CORPUS_PATH = Path("corpus.json")


# ── Schemas ───────────────────────────────────────────────────────────────────

class CorpusExample(BaseModel):
    id: str
    ticket_type: str
    customer_message: str
    context: dict[str, Any]
    resolution_path: str
    label: str  # "conforming" | "non_conforming"
    notes: str = ""


class CorpusExampleCreate(BaseModel):
    ticket_type: str
    customer_message: str
    context: dict[str, Any]
    resolution_path: str
    label: str
    notes: str = ""


class CorpusExampleUpdate(BaseModel):
    ticket_type: str | None = None
    customer_message: str | None = None
    context: dict[str, Any] | None = None
    resolution_path: str | None = None
    label: str | None = None
    notes: str | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_corpus() -> list[dict[str, Any]]:
    if not CORPUS_PATH.exists():
        return []
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def _save_corpus(examples: list[dict[str, Any]]) -> None:
    CORPUS_PATH.write_text(json.dumps(examples, indent=2, ensure_ascii=False), encoding="utf-8")


def _next_id(examples: list[dict[str, Any]]) -> str:
    """Generate next sequential id like ex_037."""
    existing = [
        int(e["id"].split("_")[1])
        for e in examples
        if e.get("id", "").startswith("ex_") and e["id"].split("_")[1].isdigit()
    ]
    next_num = max(existing, default=0) + 1
    return f"ex_{next_num:03d}"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=Envelope[list[CorpusExample]])
async def list_corpus() -> Envelope[list[CorpusExample]]:
    """Return all corpus examples."""
    examples = _load_corpus()
    return Envelope(data=[CorpusExample(**e) for e in examples], meta={"total": len(examples)})


@router.post("", response_model=Envelope[CorpusExample], status_code=201)
async def create_corpus_example(body: CorpusExampleCreate) -> Envelope[CorpusExample]:
    """Add a new corpus example. ID is auto-assigned."""
    examples = _load_corpus()
    new_id = _next_id(examples)
    new_example = CorpusExample(id=new_id, **body.model_dump())
    examples.append(new_example.model_dump())
    _save_corpus(examples)
    logger.info("corpus example created", id=new_id)
    return Envelope(data=new_example, meta={})


@router.put("/{example_id}", response_model=Envelope[CorpusExample])
async def update_corpus_example(
    example_id: str, body: CorpusExampleUpdate
) -> Envelope[CorpusExample]:
    """Update an existing corpus example by id."""
    examples = _load_corpus()
    idx = next((i for i, e in enumerate(examples) if e["id"] == example_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Corpus example '{example_id}' not found")

    updated = {**examples[idx]}
    patch = body.model_dump(exclude_none=True)
    updated.update(patch)
    examples[idx] = updated
    _save_corpus(examples)
    logger.info("corpus example updated", id=example_id)
    return Envelope(data=CorpusExample(**updated), meta={})


@router.delete("/{example_id}", response_model=Envelope[dict[str, str]])
async def delete_corpus_example(example_id: str) -> Envelope[dict[str, str]]:
    """Delete a corpus example by id."""
    examples = _load_corpus()
    before = len(examples)
    examples = [e for e in examples if e["id"] != example_id]
    if len(examples) == before:
        raise HTTPException(status_code=404, detail=f"Corpus example '{example_id}' not found")
    _save_corpus(examples)
    logger.info("corpus example deleted", id=example_id)
    return Envelope(data={"status": "deleted", "id": example_id}, meta={})
