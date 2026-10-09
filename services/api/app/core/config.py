"""Configuration de l'API (variables d'environnement / .env racine).

La clé OpenAI n'est jamais lue depuis un fichier versionné : sur le Mac de développement elle est
injectée par `tools/with-api-env`, ailleurs par l'environnement (CI, hébergeur).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    openai_api_key: str | None = None
    transcription_model: str = "gpt-transcribe"
    extraction_model: str = "gpt-5.4-mini"
    # Effort de raisonnement envoyé uniquement aux modèles gpt-5* (ignoré sinon).
    extraction_reasoning_effort: str = "low"
    app_timezone: str = "Europe/Paris"
    database_url: str = "sqlite:///./.local/dev.db"
    cors_origins: str = "http://localhost:3000"
    max_audio_bytes: int = 10 * 1024 * 1024
    max_audio_seconds: int = 120
    llm_timeout_seconds: float = 30.0
    rate_limit_per_minute: int = 30
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_database_url(self) -> str:
        """Les chemins SQLite relatifs sont résolus depuis la racine du dépôt, quel que soit le cwd."""
        prefix = "sqlite:///./"
        if self.database_url.startswith(prefix):
            target = REPO_ROOT / self.database_url[len(prefix) :]
            target.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{target}"
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
