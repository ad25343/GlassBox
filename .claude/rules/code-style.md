# Code Style

- Python 3.11+, type hints everywhere.
- Ruff for linting and formatting (line length 100).
- Pydantic v2 for all data models — use `model_config` not inner `Config` class.
- Async-first: use `async def` for all route handlers and service methods.
- No bare `except` — always catch specific exceptions.
- Use `structlog` for logging, not `print` or stdlib `logging` directly.
