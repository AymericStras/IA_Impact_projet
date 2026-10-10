"""Hand a composed message to Mailato, or write it to the outbox in dry-run mode."""

from __future__ import annotations

from dataclasses import dataclass
from email import policy
from pathlib import Path

from mailato import api as mailato

from ..config import Config


@dataclass(frozen=True)
class Delivery:
    provider: str
    message_id: str | None
    attempts: int


def _mailato_settings(config: Config) -> mailato.Settings:
    return mailato.Settings(
        mail_from=config.mail_from,
        provider="resend",
        resend_api_key=config.resend_api_key,
        allowed_domains=config.allowed_domains,
        max_recipients=1,
    )


def deliver(message: mailato.Message, config: Config, *, recap_id: str) -> Delivery:
    """Send one message. Raises mailato.ConfigError or mailato.SendError on failure.

    The idempotency key is derived from the recap id, so a retry of the same
    recap can never produce a second email through Resend.
    """
    settings = _mailato_settings(config)
    if config.mail_mode == "live":
        result = mailato.send(
            message, settings, idempotency_key=f"sncf-bilan-{recap_id}", audit_id=recap_id
        )
        return Delivery(result.provider, result.message_id, result.attempts)

    path = write_eml(message, config, config.data_dir / "outbox" / f"{recap_id}.eml")
    return Delivery("dry-run", path.name, 1)


def write_eml(message: mailato.Message, config: Config, path: Path) -> Path:
    """Write the message exactly as SMTP would carry it; any mail client opens it."""
    settings = mailato.Settings(mail_from=config.mail_from, provider="smtp")
    mime = mailato.build_mime_message(message, settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(mime.as_bytes(policy=policy.SMTP))
    return path
