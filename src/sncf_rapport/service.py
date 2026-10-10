"""The sending workflow: render the PDF, record the job, email it, retry a failure."""

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
from .mail.compose import NoRecipient, compose
from .mail.deliver import Delivery, deliver
from .models import TripReportRequest
from .pdf import render_pdf
from .store import Report, Store

logger = logging.getLogger("sncf_rapport")


class KeyReused(Exception):
    """The idempotency key was already used for a different request."""


class LimitReached(Exception):
    """A sending quota is exhausted."""


class NotRetryable(Exception):
    """Only a failed report can be sent again."""


class ReportService:
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

    def submit(self, request: TripReportRequest) -> tuple[Report, bool]:
        """Record a report to send. Returns (report, created); created is False for a repeat.

        Raises `NoRecipient` when the request has no `recipient.email`: the caller must
        collect the address, there is nothing to queue.
        """
        recipient = request.recipient.email if request.recipient else None
        if not recipient:
            raise NoRecipient("recipient.email is missing")
        key = request.resolved_idempotency_key()
        fingerprint = request.fingerprint()
        existing = self.store.by_idempotency_key(key)
        if existing is not None:
            return self._repeat(existing, fingerprint), False

        self._check_limits(recipient)
        pdf = render_pdf(request, config=self.config, issued_at=datetime.now().astimezone())
        try:
            report = self.store.create(
                report_id=str(uuid.uuid4()),
                idempotency_key=key,
                fingerprint=fingerprint,
                request_json=request.model_dump_json(by_alias=True, exclude_none=True),
                recipient=recipient,
                pdf=pdf,
                pdf_sha256=hashlib.sha256(pdf).hexdigest(),
            )
        except sqlite3.IntegrityError:
            # Two identical requests raced; the other one owns the job.
            existing = self.store.by_idempotency_key(key)
            if existing is None:
                raise
            return self._repeat(existing, fingerprint), False
        return report, True

    @staticmethod
    def _repeat(existing: Report, fingerprint: str) -> Report:
        if existing.fingerprint != fingerprint:
            raise KeyReused(existing.idempotency_key)
        return existing

    def _check_limits(self, recipient: str) -> None:
        since = datetime.now(UTC) - timedelta(hours=24)
        if self.store.count_since(since) >= self.config.daily_limit:
            raise LimitReached("daily")
        if self.store.count_since(since, recipient=recipient) >= self.config.recipient_daily_limit:
            raise LimitReached("recipient")

    def send(self, report_id: str) -> None:
        """Send a queued report and record the outcome. Never raises: runs in the background."""
        report = self.store.get(report_id)
        if report is None or report.status != states.QUEUED:
            return
        try:
            request = TripReportRequest.model_validate_json(report.request_json)
            pdf = self.store.pdf_path(report_id).read_bytes()
            message = compose(request, pdf, self.config)
            delivery = self._deliver(message, self.config, report_id=report_id)
        except mailato.SendError as exc:
            self._failed(report_id, str(exc), attempts=getattr(exc, "attempts", 1))
        except mailato.ConfigError as exc:
            self._failed(report_id, f"Not sent: {exc}", attempts=0)
        except Exception as exc:  # noqa: BLE001 - the job must end in a recorded state
            logger.exception("report %s failed unexpectedly", report_id)
            self._failed(report_id, f"Internal error: {type(exc).__name__}", attempts=0)
        else:
            self.store.mark(
                report_id,
                states.SENT,
                provider=delivery.provider,
                provider_message_id=delivery.message_id,
                attempts=delivery.attempts,
            )
            logger.info("report %s sent via %s", report_id, delivery.provider)

    def _failed(self, report_id: str, error: str, *, attempts: int) -> None:
        self.store.mark(report_id, states.FAILED, attempts=attempts, error=error[:500])
        logger.warning("report %s failed: %s", report_id, error.splitlines()[0][:200])

    def retry(self, report_id: str) -> Report | None:
        """Queue a failed report again. Returns None when the id is unknown."""
        if self.store.get(report_id) is None:
            return None
        if not self.store.requeue(report_id):
            raise NotRetryable(report_id)
        return self.store.get(report_id)

    def resume(self) -> int:
        """Send what was still queued when the process last stopped."""
        pending = self.store.queued_ids()
        for report_id in pending:
            self.send(report_id)
        return len(pending)
