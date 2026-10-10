"""Application errors carrying a machine-readable code and a French, user-facing detail."""

from __future__ import annotations


class AppError(Exception):
    """Raised by routes and services; rendered as RFC 9457 problem details by `main.py`."""

    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
