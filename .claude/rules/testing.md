# Testing

- Use `pytest` + `pytest-asyncio` for async tests.
- Tests live in `tests/` mirroring the `backend/` structure.
- Mock external LLM API calls — never hit real APIs in tests.
- Every new service method needs at least one happy-path and one error-path test.
- Run `pytest` before marking any task complete.
