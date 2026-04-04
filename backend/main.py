"""GlassBox FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import compare, monitor, runs, traces
from backend.core import db
from backend.core.config import get_settings
from backend.core.logging import configure_logging, get_logger
from backend.services.drift import DriftEngine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    logger = get_logger(__name__)
    logger.info("starting GlassBox")

    db.init_db()
    logger.info("database ready")

    config = get_settings()
    drift = DriftEngine(config)
    drift.seed_synthetic_history()
    logger.info("drift engine ready")

    yield

    logger.info("shutting down GlassBox")


app = FastAPI(
    title="GlassBox",
    description="LLM observability UI for customer support AI",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8888", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(traces.router)
app.include_router(runs.router)
app.include_router(compare.router)
app.include_router(monitor.router)


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
