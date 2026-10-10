"""The recap workflow: render the PDF, record the job, send the email."""

from __future__ import annotations

import hashlib
import logging
import sqlite3
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from mailato import api as mailato

from . import store as states
from .config import Config
from .mail.compose import compose
from .mail.deliver import Delivery, deliver
from .models import RecapRequest, Trip
from .pdf.render import render_pdf
from .store import Recap, Store

logger = logging.getLogger("sncf_bilan")


class KeyReused(Exception):
    """The idempotency key was already used for a different request."""


class LimitReached(Exception):
    """A sending quota is exhausted."""


class NotRetryable(Exception):
    """Only a failed recap can be sent again."""


class RecapService:
    def __init__(
        self,
        config: Config,
        store: Store,
        *,
        deliver: Callable[..., Delivery] = deliver,
    ) -> None:
        self.config = config
        self.store = store
        self._deliver = deliver

    def render(self, trip: Trip, fingerprint: str) -> bytes:
        return render_pdf(
            trip,
            fingerprint=fingerprint,
            logo=self.config.logo_svg,
            issued_at=datetime.now(UTC),
        )

    def submit(self, request: RecapRequest) -> tuple[Recap, bool]:
        """Record a recap to send. Returns (recap, created); created is False for a repeat."""
        fingerprint = request.fingerprint()
        existing = self.store.by_idempotency_key(request.idempotency_key)
        if existing is not None:
            return self._repeat(existing, fingerprint), False

        self._check_limits(request.recipient.email)
        pdf = self.render(request.trip, fingerprint)
        try:
            recap = self.store.create(
                recap_id=str(uuid.uuid4()),
                idempotency_key=request.idempotency_key,
                fingerprint=fingerprint,
                request_json=request.model_dump_json(),
                recipient=request.recipient.email,
                pdf=pdf,
                pdf_sha256=hashlib.sha256(pdf).hexdigest(),
            )
        except sqlite3.IntegrityError:
            # Two identical requests raced; the other one owns the job.
            existing = self.store.by_idempotency_key(request.idempotency_key)
            if existing is None:
                raise
            return self._repeat(existing, fingerprint), False
        return recap, True

    @staticmethod
    def _repeat(existing: Recap, fingerprint: str) -> Recap:
        if existing.fingerprint != fingerprint:
            raise KeyReused(existing.idempotency_key)
        return existing

    def _check_limits(self, recipient: str) -> None:
        since = datetime.now(UTC) - timedelta(hours=24)
        if self.store.count_since(since) >= self.config.daily_limit:
            raise LimitReached("daily")
        if self.store.count_since(since, recipient=recipient) >= self.config.recipient_daily_limit:
            raise LimitReached("recipient")

    def send(self, recap_id: str) -> None:
        """Send a queued recap and record the outcome. Never raises: runs in the background."""
        recap = self.store.get(recap_id)
        if recap is None or recap.status != states.QUEUED:
            return
        try:
            request = RecapRequest.model_validate_json(recap.request_json)
            pdf = self.store.pdf_path(recap_id).read_bytes()
            message = compose(request, pdf, self.config)
            delivery = self._deliver(message, self.config, recap_id=recap_id)
        except mailato.SendError as exc:
            self._failed(recap_id, str(exc), attempts=getattr(exc, "attempts", 1))
        except mailato.ConfigError as exc:
            self._failed(recap_id, f"Not sent: {exc}", attempts=0)
        except Exception as exc:  # noqa: BLE001 - the job must end in a recorded state
            logger.exception("recap %s failed unexpectedly", recap_id)
            self._failed(recap_id, f"Internal error: {type(exc).__name__}", attempts=0)
        else:
            self.store.mark(
                recap_id,
                states.SENT,
                provider=delivery.provider,
                provider_message_id=delivery.message_id,
                attempts=delivery.attempts,
            )
            logger.info("recap %s sent via %s", recap_id, delivery.provider)

    def _failed(self, recap_id: str, error: str, *, attempts: int) -> None:
        self.store.mark(recap_id, states.FAILED, attempts=attempts, error=error[:500])
        logger.warning("recap %s failed: %s", recap_id, error.splitlines()[0][:200])

    def retry(self, recap_id: str) -> Recap | None:
        """Queue a failed recap again. Returns None when the id is unknown."""
        if self.store.get(recap_id) is None:
            return None
        if not self.store.requeue(recap_id):
            raise NotRetryable(recap_id)
        return self.store.get(recap_id)

    def resume(self) -> int:
        """Send what was still queued when the process last stopped."""
        pending = self.store.queued_ids()
        for recap_id in pending:
            self.send(recap_id)
        return len(pending)
