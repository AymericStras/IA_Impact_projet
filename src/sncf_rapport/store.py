"""SQLite record of report jobs: status, delivery result, where the PDF is."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

QUEUED, SENT, FAILED = "queued", "sent", "failed"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    request_json TEXT NOT NULL,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    provider TEXT,
    provider_message_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_created_at ON reports (created_at);
CREATE INDEX IF NOT EXISTS reports_recipient ON reports (recipient, created_at);
"""


@dataclass(frozen=True)
class Report:
    id: str
    idempotency_key: str
    fingerprint: str
    request_json: str
    recipient: str
    status: str
    pdf_sha256: str
    provider: str | None
    provider_message_id: str | None
    attempts: int
    error: str | None
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Store:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.documents = data_dir / "documents"
        self.documents.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(data_dir / "rapport.sqlite3", check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock, self._db:
            self._db.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def pdf_path(self, report_id: str) -> Path:
        return self.documents / f"{report_id}.pdf"

    def _one(self, query: str, *params: object) -> Report | None:
        with self._lock:
            row = self._db.execute(query, params).fetchone()
        return Report(**dict(row)) if row else None

    def get(self, report_id: str) -> Report | None:
        return self._one("SELECT * FROM reports WHERE id = ?", report_id)

    def by_idempotency_key(self, key: str) -> Report | None:
        return self._one("SELECT * FROM reports WHERE idempotency_key = ?", key)

    def create(
        self,
        *,
        report_id: str,
        idempotency_key: str,
        fingerprint: str,
        request_json: str,
        recipient: str,
        pdf: bytes,
        pdf_sha256: str,
    ) -> Report:
        """Store the PDF and the queued job. Raises sqlite3.IntegrityError on a duplicate key."""
        now = _now()
        self.pdf_path(report_id).write_bytes(pdf)
        try:
            with self._lock, self._db:
                self._db.execute(
                    "INSERT INTO reports (id, idempotency_key, fingerprint, request_json,"
                    " recipient, status, pdf_sha256, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        report_id,
                        idempotency_key,
                        fingerprint,
                        request_json,
                        recipient.lower(),
                        QUEUED,
                        pdf_sha256,
                        now,
                        now,
                    ),
                )
        except sqlite3.IntegrityError:
            self.pdf_path(report_id).unlink(missing_ok=True)
            raise
        report = self.get(report_id)
        assert report is not None
        return report

    def mark(
        self,
        report_id: str,
        status: str,
        *,
        provider: str | None = None,
        provider_message_id: str | None = None,
        attempts: int = 0,
        error: str | None = None,
    ) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE reports SET status = ?, provider = ?, provider_message_id = ?,"
                " attempts = attempts + ?, error = ?, updated_at = ? WHERE id = ?",
                (status, provider, provider_message_id, attempts, error, _now(), report_id),
            )

    def requeue(self, report_id: str) -> bool:
        """Move a failed job back to queued. False if it was not failed (no double send)."""
        with self._lock, self._db:
            cursor = self._db.execute(
                "UPDATE reports SET status = ?, error = NULL, updated_at = ?"
                " WHERE id = ? AND status = ?",
                (QUEUED, _now(), report_id, FAILED),
            )
        return cursor.rowcount == 1

    def queued_ids(self) -> list[str]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id FROM reports WHERE status = ? ORDER BY created_at", (QUEUED,)
            ).fetchall()
        return [row["id"] for row in rows]

    def count_since(self, since: datetime, *, recipient: str | None = None) -> int:
        """Jobs accepted since a moment; failed ones count too, they used the provider."""
        query = "SELECT COUNT(*) FROM reports WHERE created_at >= ?"
        params: list[object] = [since.isoformat(timespec="seconds")]
        if recipient is not None:
            query += " AND recipient = ?"
            params.append(recipient.lower())
        with self._lock:
            return int(self._db.execute(query, params).fetchone()[0])

    def purge(self, *, older_than_days: int) -> int:
        """Delete jobs and PDFs past the retention period. Returns how many were removed."""
        cutoff = (datetime.now(UTC) - timedelta(days=older_than_days)).isoformat(timespec="seconds")
        with self._lock, self._db:
            rows = self._db.execute(
                "SELECT id FROM reports WHERE created_at < ?", (cutoff,)
            ).fetchall()
            self._db.execute("DELETE FROM reports WHERE created_at < ?", (cutoff,))
        for row in rows:
            self.pdf_path(row["id"]).unlink(missing_ok=True)
            (self.data_dir / "outbox" / f"{row['id']}.eml").unlink(missing_ok=True)
        return len(rows)
