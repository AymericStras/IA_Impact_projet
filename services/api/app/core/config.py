"""API configuration (environment variables / root .env).

The OpenAI key is never read from a versioned file: on the development Mac it is
injected by `tools/with-api-env`, elsewhere by the environment (CI, hosting provider).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    openai_api_key: str | None = None
    # Deployment: path of a file holding the key (mounted secret); takes effect when the variable is unset.
    openai_api_key_file: str | None = None
    transcription_model: str = "gpt-transcribe"
    extraction_model: str = "gpt-5.4-mini"
    # Reasoning effort sent only to gpt-5* models (ignored otherwise).
    extraction_reasoning_effort: str = "low"
    app_timezone: str = "Europe/Paris"
    database_url: str = "sqlite:///./.local/dev.db"
    cors_origins: str = "http://localhost:3000"
    max_audio_bytes: int = 10 * 1024 * 1024
    max_audio_seconds: int = 120
    llm_timeout_seconds: float = 30.0
    # Per-conversation limit on messages per minute; 0 disables it (the default: no rate limiting).
    rate_limit_per_minute: int = 0
    log_level: str = "INFO"

    @property
    def resolved_openai_api_key(self) -> str | None:
        if self.openai_api_key:
            return self.openai_api_key
        if self.openai_api_key_file:
            return Path(self.openai_api_key_file).read_text(encoding="utf-8").strip() or None
        return None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_database_url(self) -> str:
        """Relative SQLite paths are resolved from the repository root, whatever the cwd."""
        prefix = "sqlite:///./"
        if self.database_url.startswith(prefix):
            target = REPO_ROOT / self.database_url[len(prefix) :]
            target.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{target}"
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
