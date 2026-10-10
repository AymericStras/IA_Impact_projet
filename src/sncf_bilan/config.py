"""Runtime configuration, read from the environment once at start-up."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
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
    BILAN_CREDENTIALS_FILE. A variable set in the process wins over the file.
    """
    explicit = os.environ.get("BILAN_CREDENTIALS_FILE")
    path = Path(explicit) if explicit else REPO_ROOT / "credentials.env"
    if not path.is_file():
        if explicit:
            raise ConfigurationError(f"BILAN_CREDENTIALS_FILE does not exist: {path}")
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


@dataclass(frozen=True)
class Config:
    data_dir: Path = REPO_ROOT / "var"
    api_key: str | None = field(default=None, repr=False)
    mail_mode: str = "dry-run"
    mail_from: str = DEFAULT_MAIL_FROM
    reply_to: str | None = None
    sender_name: str = "L'équipe Sorties scolaires liO"
    resend_api_key: str | None = field(default=None, repr=False)
    allowed_domains: tuple[str, ...] = ()
    # Blind copy of every email (BILAN_COPY_TO): the team follows what is sent
    # without appearing on the message. The recipient is never copied to itself.
    copy_to: tuple[str, ...] = ()
    logo_svg: Path = REPO_ROOT / "assets" / "brand" / "logo.svg"
    logo_png: Path = REPO_ROOT / "assets" / "brand" / "logo.png"
    daily_limit: int = 80
    recipient_daily_limit: int = 5
    retention_days: int = 30
    root_path: str = ""

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Config:
        env = _environment() if env is None else env
        mail_mode = (env.get("BILAN_MAIL_MODE") or "dry-run").strip().lower()
        if mail_mode not in MAIL_MODES:
            raise ConfigurationError(f"BILAN_MAIL_MODE must be one of: {', '.join(MAIL_MODES)}.")
        defaults = cls()
        domains = tuple(
            item.strip().lower()
            for item in env.get("BILAN_ALLOWED_DOMAINS", "").split(",")
            if item.strip()
        )
        copy_to = _addresses(env, "BILAN_COPY_TO")
        return cls(
            data_dir=Path(env.get("BILAN_DATA_DIR") or defaults.data_dir),
            api_key=_secret(env, "BILAN_API_KEY"),
            mail_mode=mail_mode,
            mail_from=env.get("BILAN_MAIL_FROM") or defaults.mail_from,
            reply_to=env.get("BILAN_REPLY_TO") or None,
            sender_name=env.get("BILAN_SENDER_NAME") or defaults.sender_name,
            resend_api_key=_secret(env, "RESEND_API_KEY"),
            allowed_domains=domains,
            copy_to=copy_to,
            logo_svg=Path(env.get("BILAN_LOGO_SVG") or defaults.logo_svg),
            logo_png=Path(env.get("BILAN_LOGO_PNG") or defaults.logo_png),
            daily_limit=_integer(env, "BILAN_DAILY_LIMIT", defaults.daily_limit),
            recipient_daily_limit=_integer(
                env, "BILAN_RECIPIENT_DAILY_LIMIT", defaults.recipient_daily_limit
            ),
            retention_days=_integer(env, "BILAN_RETENTION_DAYS", defaults.retention_days),
            root_path=(env.get("BILAN_ROOT_PATH") or "").rstrip("/"),
        )

    def check_for_live_sending(self) -> None:
        if self.mail_mode == "live" and not self.resend_api_key:
            raise ConfigurationError(
                "BILAN_MAIL_MODE=live needs RESEND_API_KEY or RESEND_API_KEY_FILE."
            )
