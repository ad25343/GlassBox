# GlassBox — Claude Instructions

## What is GlassBox?
GlassBox is a full-stack observability UI for LLM model behavior — tracking requests, responses, latency, cost, token usage, and behavioral patterns across Claude, OpenAI, and Google Gemini.

## Stack
- **Backend**: Python / FastAPI
- **Frontend**: (TBD — specify React/Next.js/etc.)
- **DB**: SQLite (dev) → PostgreSQL (prod)
- **SDKs**: `anthropic`, `openai`, `google-generativeai`

## Project layout
```
GlassBox/
├── backend/          # FastAPI app
│   ├── api/          # Route handlers
│   ├── core/         # Config, logging, DB session
│   ├── models/       # SQLAlchemy models
│   ├── services/     # LLM clients + tracking logic
│   └── main.py
├── frontend/         # UI (TBD)
├── .claude/          # Claude Code config (committed)
├── .env              # Local secrets (gitignored)
├── .env.example      # Template (committed)
├── requirements.txt
└── CLAUDE.md
```

## Environment
- Copy `.env.example` → `.env` and fill in real API keys before running.
- Never commit `.env`.

## Dev commands
```bash
# Backend
uvicorn backend.main:app --reload

# Tests
pytest

# Lint
ruff check . && ruff format --check .
```

## Code conventions
- See `.claude/rules/` for detailed style, testing, and API conventions.
- Pydantic v2 models for all request/response schemas.
- All LLM calls go through `backend/services/` — never call SDKs directly from routes.
- Every LLM call must be logged to the tracking store (latency, tokens, cost, model, provider).
