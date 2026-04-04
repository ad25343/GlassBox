Add a new LLM provider to GlassBox. Steps:
1. Create `backend/services/providers/<provider_name>.py` with an async client class
2. Implement `complete(prompt, model, **kwargs) -> TraceResult` method
3. Register the provider in `backend/services/providers/__init__.py`
4. Add the provider's API key to `.env.example` with a comment
5. Write tests in `tests/services/providers/test_<provider_name>.py`
6. Update `CLAUDE.md` Stack section if needed

Arguments: $ARGUMENTS (provider name, e.g. "mistral", "cohere")
