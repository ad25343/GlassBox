"""GlassBox FastAPI application entry point."""
from __future__ import annotations

import base64
import secrets
from contextlib import asynccontextmanager
from typing import AsyncIterator, Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.api.routes import chatlogs, compare, corpus, cost, demo, monitor, runs, sessions, spec, traces
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
    if config.SEED_SYNTHETIC_HISTORY:
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


@app.middleware("http")
async def basic_auth_middleware(request: Request, call_next: Callable) -> Response:
    """Optional HTTP Basic Auth — active only when both GLASSBOX_USERNAME and
    GLASSBOX_PASSWORD are set. The /health endpoint is always exempt."""
    settings = get_settings()

    # Skip auth when credentials are not configured (dev mode) or for health checks
    if not settings.GLASSBOX_USERNAME or not settings.GLASSBOX_PASSWORD:
        return await call_next(request)
    if request.url.path == "/health":
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
            supplied_username, supplied_password = decoded.split(":", 1)
        except Exception:
            supplied_username = ""
            supplied_password = ""

        username_ok = secrets.compare_digest(
            supplied_username.encode(), settings.GLASSBOX_USERNAME.encode()
        )
        password_ok = secrets.compare_digest(
            supplied_password.encode(), settings.GLASSBOX_PASSWORD.encode()
        )
        if username_ok and password_ok:
            return await call_next(request)

    return Response(
        content="Unauthorized",
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="GlassBox"'},
    )

app.include_router(traces.router)
app.include_router(runs.router)
app.include_router(sessions.router)
app.include_router(compare.router)
app.include_router(monitor.router)
app.include_router(spec.router)
app.include_router(chatlogs.router)
app.include_router(cost.router)
app.include_router(demo.router)
app.include_router(corpus.router)


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
