# API Conventions

- REST endpoints under `/api/v1/`.
- Use FastAPI `APIRouter` — one router per resource (e.g. `traces`, `runs`, `models`).
- All responses wrapped in a consistent envelope: `{ "data": ..., "meta": ... }`.
- HTTP status codes: 200 success, 201 created, 422 validation error, 500 server error.
- Never expose raw provider error messages to the client — wrap and sanitize.
- Provider clients (Anthropic, OpenAI, Google) live in `backend/services/providers/`.
