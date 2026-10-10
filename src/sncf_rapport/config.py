"""Runtime configuration, read from the environment once at start-up."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
ASSETS_DIR = REPO_ROOT / "assets"


class ConfigurationError(RuntimeError):
    """The environment does not describe a usable configuration."""


def _secret(env: Mapping[str, str], name: str) -> str | None:
    """NAME, or the content of the file named by NAME_FILE (how the server passes secrets)."""
    file_name = env.get(f"{name}_FILE")
    if file_name:
        try:
            value = Path(file_name).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ConfigurationError(f"{name}_FILE cannot be read: {exc.strerror}") from exc
        return value or None
    return env.get(name) or None


def _choice(env: Mapping[str, str], name: str, allowed: tuple[str, ...], default: str) -> str:
    value = (env.get(name) or default).strip().lower()
    if value not in allowed:
        raise ConfigurationError(f"{name} must be one of: {', '.join(allowed)}.")
    return value


@dataclass(frozen=True)
class Config:
    api_key: str | None = field(default=None, repr=False)
    logo_svg: Path = ASSETS_DIR / "brand" / "logo.svg"
    stations_csv: Path = DATA_DIR / "stations.csv"
    connections_csv: Path = DATA_DIR / "connections.csv"
    emission_factors: Path = DATA_DIR / "emission_factors.json"
    root_path: str = ""
    max_body_bytes: int = 25 * 1024 * 1024
    # People per car for the "voiture" baseline when the request gives none. Full cars on
    # purpose: the source factor is per vehicle, and one person per car would flatter the train.
    default_car_occupancy: float = 4.0
    # Optional language-model step (enrich.py). Off whenever there is no key.
    openai_api_key: str | None = field(default=None, repr=False)
    openai_model: str = "gpt-5.4-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_timeout_seconds: float = 25.0
    enrich_mode: str = "auto"  # "auto": enrich when a key is present; "off": never
    cache_dir: Path = REPO_ROOT / "var" / "cache"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Config:
        env = dict(os.environ) if env is None else env
        defaults = cls()
        return cls(
            api_key=_secret(env, "RAPPORT_API_KEY"),
            logo_svg=Path(env.get("RAPPORT_LOGO_SVG") or defaults.logo_svg),
            stations_csv=Path(env.get("RAPPORT_STATIONS_CSV") or defaults.stations_csv),
            connections_csv=Path(env.get("RAPPORT_CONNECTIONS_CSV") or defaults.connections_csv),
            emission_factors=Path(env.get("RAPPORT_EMISSION_FACTORS") or defaults.emission_factors),
            root_path=(env.get("RAPPORT_ROOT_PATH") or "").rstrip("/"),
            openai_api_key=_secret(env, "OPENAI_API_KEY"),
            openai_model=env.get("RAPPORT_OPENAI_MODEL") or defaults.openai_model,
            openai_base_url=(env.get("OPENAI_BASE_URL") or defaults.openai_base_url).rstrip("/"),
            enrich_mode=_choice(env, "RAPPORT_ENRICH", ("auto", "off"), defaults.enrich_mode),
            cache_dir=Path(env.get("RAPPORT_CACHE_DIR") or defaults.cache_dir),
        )
