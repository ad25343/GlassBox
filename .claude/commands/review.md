Review the current changes for correctness, security, and adherence to GlassBox conventions:
1. Check that all LLM calls go through `backend/services/` (not directly in routes)
2. Verify every LLM call logs to the tracking store
3. Confirm no API keys or secrets are hardcoded
4. Run `ruff check .` and report any issues
5. Check for missing type hints or bare `except` blocks
