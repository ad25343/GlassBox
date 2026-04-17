from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Always resolve .env relative to the project root (two levels up from this file)
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,  # shell empty-string vars don't override .env values
    )

    ANTHROPIC_API_KEY: str
    OPENAI_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    APP_ENV: str = "development"
    LOG_LEVEL: str = "DEBUG"
    DATABASE_URL: str = "sqlite:///./glassbox.db"
    PRODUCTION_MODEL: str = "claude-sonnet-4-5"
    JUDGE_MODEL: str = "claude-haiku-4-5"
    CANDIDATE_MODEL: str = "claude-haiku-4-5"
    SEED_SYNTHETIC_HISTORY: bool = False
    SLACK_WEBHOOK_URL: str = ""
    ALERT_EMAIL: str = ""
    GLASSBOX_USERNAME: str = ""
    GLASSBOX_PASSWORD: str = ""
    # Token pricing (USD per token) — update as model pricing changes
    INPUT_TOKEN_PRICE: float = 0.000003   # $3.00 / 1M input tokens (Sonnet)
    OUTPUT_TOKEN_PRICE: float = 0.000015  # $15.00 / 1M output tokens (Sonnet)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
