"""Runtime configuration, read from the environment once at start-up."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
ASSETS_DIR = REPO_ROOT / "assets"
# No parentheses in the display name: in an address header they open a comment
# (RFC 5322) and mail software drops them.
DEFAULT_MAIL_FROM = "Sorties scolaires liO – démo <sorties@zhaoyang.fr>"
MAIL_MODES = ("dry-run", "live")


class ConfigurationError(RuntimeError):
    """The environment does not describe a usable configuration."""


def read_credentials_file(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE lines. Values are literal: no shell expansion, no code."""
    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        name = name.removeprefix("export ").strip()
        if not separator or not name.replace("_", "").isalnum():
            raise ConfigurationError(f"{path.name} line {number}: expected NAME=value.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[name] = value
    return values


def _environment() -> dict[str, str]:
    """The process environment, completed by the credentials file when there is one.

    The file is `credentials.env` at the project root, or the file named by
    RAPPORT_CREDENTIALS_FILE. A variable set in the process wins over the file.
    """
    explicit = os.environ.get("RAPPORT_CREDENTIALS_FILE")
    path = Path(explicit) if explicit else REPO_ROOT / "credentials.env"
    if not path.is_file():
        if explicit:
            raise ConfigurationError(f"RAPPORT_CREDENTIALS_FILE does not exist: {path}")
        return dict(os.environ)
    return {**read_credentials_file(path), **os.environ}


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


def _addresses(env: Mapping[str, str], name: str) -> tuple[str, ...]:
    """Comma-separated email addresses, each kept once, in the given order."""
    seen: dict[str, str] = {}
    for item in env.get(name, "").split(","):
        address = item.strip()
        if not address:
            continue
        local, at, domain = address.rpartition("@")
        if not at or not local or "." not in domain or any(c.isspace() for c in address):
            raise ConfigurationError(f"{name}: '{address}' is not an email address.")
        seen.setdefault(address.lower(), address)
    return tuple(seen.values())


def _integer(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer.") from exc
    if value < 0:
        raise ConfigurationError(f"{name} must not be negative.")
    return value


@dataclass(frozen=True)
class Config:
    api_key: str | None = field(default=None, repr=False)
    logo_svg: Path = ASSETS_DIR / "brand" / "logo.svg"
    logo_png: Path = ASSETS_DIR / "brand" / "logo.png"  # inline picture of the email
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
    # Sending (service.py, mail/). Jobs, PDFs and the dry-run outbox live under data_dir.
    data_dir: Path = REPO_ROOT / "var"
    mail_mode: str = "dry-run"  # "dry-run": .eml files in var/outbox; "live": Resend
    mail_from: str = DEFAULT_MAIL_FROM
    reply_to: str | None = None
    sender_name: str = "L'équipe Sorties scolaires liO"
    resend_api_key: str | None = field(default=None, repr=False)
    allowed_domains: tuple[str, ...] = ()  # empty: any recipient domain
    # Blind copy of every email (RAPPORT_COPY_TO): the team follows what is sent
    # without appearing on the message. The recipient is never copied to itself.
    copy_to: tuple[str, ...] = ()
    daily_limit: int = 80
    recipient_daily_limit: int = 5
    retention_days: int = 30

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Config:
        env = _environment() if env is None else env
        defaults = cls()
        domains = tuple(
            item.strip().lower()
            for item in env.get("RAPPORT_ALLOWED_DOMAINS", "").split(",")
            if item.strip()
        )
        return cls(
            api_key=_secret(env, "RAPPORT_API_KEY"),
            logo_svg=Path(env.get("RAPPORT_LOGO_SVG") or defaults.logo_svg),
            logo_png=Path(env.get("RAPPORT_LOGO_PNG") or defaults.logo_png),
            stations_csv=Path(env.get("RAPPORT_STATIONS_CSV") or defaults.stations_csv),
            connections_csv=Path(env.get("RAPPORT_CONNECTIONS_CSV") or defaults.connections_csv),
            emission_factors=Path(env.get("RAPPORT_EMISSION_FACTORS") or defaults.emission_factors),
            root_path=(env.get("RAPPORT_ROOT_PATH") or "").rstrip("/"),
            openai_api_key=_secret(env, "OPENAI_API_KEY"),
            openai_model=env.get("RAPPORT_OPENAI_MODEL") or defaults.openai_model,
            openai_base_url=(env.get("OPENAI_BASE_URL") or defaults.openai_base_url).rstrip("/"),
            enrich_mode=_choice(env, "RAPPORT_ENRICH", ("auto", "off"), defaults.enrich_mode),
            cache_dir=Path(env.get("RAPPORT_CACHE_DIR") or defaults.cache_dir),
            data_dir=Path(env.get("RAPPORT_DATA_DIR") or defaults.data_dir),
            mail_mode=_choice(env, "RAPPORT_MAIL_MODE", MAIL_MODES, defaults.mail_mode),
            mail_from=env.get("RAPPORT_MAIL_FROM") or defaults.mail_from,
            reply_to=env.get("RAPPORT_REPLY_TO") or None,
            sender_name=env.get("RAPPORT_SENDER_NAME") or defaults.sender_name,
            resend_api_key=_secret(env, "RESEND_API_KEY"),
            allowed_domains=domains,
            copy_to=_addresses(env, "RAPPORT_COPY_TO"),
            daily_limit=_integer(env, "RAPPORT_DAILY_LIMIT", defaults.daily_limit),
            recipient_daily_limit=_integer(
                env, "RAPPORT_RECIPIENT_DAILY_LIMIT", defaults.recipient_daily_limit
            ),
            retention_days=_integer(env, "RAPPORT_RETENTION_DAYS", defaults.retention_days),
        )

    def check_for_live_sending(self) -> None:
        """Live mode needs a provider key and a shared API key (an open sender is a spam relay)."""
        if self.mail_mode != "live":
            return
        if not self.resend_api_key:
            raise ConfigurationError(
                "RAPPORT_MAIL_MODE=live needs RESEND_API_KEY or RESEND_API_KEY_FILE."
            )
        if not self.api_key:
            raise ConfigurationError(
                "RAPPORT_MAIL_MODE=live needs RAPPORT_API_KEY or RAPPORT_API_KEY_FILE."
            )
