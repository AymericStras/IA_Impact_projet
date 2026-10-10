"""HTTP interface. Every route except /healthz needs the shared key."""

from __future__ import annotations

import hmac
import threading
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import __version__
from .config import Config, ConfigurationError
from .models import RecapRequest
from .service import KeyReused, LimitReached, NotRetryable, RecapService
from .store import Recap, Store
from .view import attachment_filename


class RecapStatus(BaseModel):
    id: str
    status: str
    recipient: str
    provider: str | None
    provider_message_id: str | None
    attempts: int
    error: str | None
    pdf_sha256: str
    created_at: str
    updated_at: str

    @classmethod
    def of(cls, recap: Recap) -> RecapStatus:
        return cls(**{name: getattr(recap, name) for name in cls.model_fields})


def _problem(status: int, code: str, title: str, detail: str) -> HTTPException:
    return HTTPException(status, {"code": code, "title": title, "detail": detail})


def create_app(config: Config | None = None, *, service: RecapService | None = None) -> FastAPI:
    config = config or Config.from_env()
    if not config.api_key:
        raise ConfigurationError("BILAN_API_KEY or BILAN_API_KEY_FILE is required.")
    config.check_for_live_sending()
    for logo in (config.logo_svg, config.logo_png):
        if not logo.is_file():
            raise ConfigurationError(f"Logo file is missing: {logo}")
    config.data_dir.mkdir(parents=True, exist_ok=True)
    if service is None:
        service = RecapService(config, Store(config.data_dir))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        service.store.purge(older_than_days=config.retention_days)
        threading.Thread(target=service.resume, name="resume-queued", daemon=True).start()
        yield
        service.store.close()

    app = FastAPI(
        title="sncf_bilan",
        version=__version__,
        root_path=config.root_path,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )
    app.state.service = service

    def authorised(x_bilan_key: Annotated[str | None, Header()] = None) -> None:
        expected = (config.api_key or "").encode()
        if x_bilan_key is None or not hmac.compare_digest(x_bilan_key.encode(), expected):
            raise _problem(401, "UNAUTHORISED", "Unauthorised", "Missing or wrong X-Bilan-Key.")

    protected = [Depends(authorised)]

    @app.exception_handler(HTTPException)
    async def problem_details(_, exc: HTTPException) -> JSONResponse:
        body = exc.detail if isinstance(exc.detail, dict) else {"detail": str(exc.detail)}
        return JSONResponse({"status": exc.status_code, **body}, status_code=exc.status_code)

    def found(recap_id: str) -> Recap:
        recap = service.store.get(recap_id)
        if recap is None:
            raise _problem(404, "RECAP_NOT_FOUND", "Not found", "No recap has this id.")
        return recap

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "mail_mode": config.mail_mode}

    @app.post("/api/v1/recaps", dependencies=protected, status_code=202)
    def create_recap(
        request: RecapRequest, background: BackgroundTasks, response: Response
    ) -> RecapStatus:
        try:
            recap, created = service.submit(request)
        except KeyReused as exc:
            raise _problem(
                409,
                "IDEMPOTENCY_KEY_REUSED",
                "Conflict",
                "This idempotency_key was already used with different content.",
            ) from exc
        except LimitReached as exc:
            which = "this recipient" if str(exc) == "recipient" else "the service"
            raise _problem(
                429,
                "LIMIT_REACHED",
                "Too many requests",
                f"Daily sending limit reached for {which}.",
            ) from exc
        if created:
            background.add_task(service.send, recap.id)
        else:
            response.status_code = 200
        return RecapStatus.of(recap)

    @app.get("/api/v1/recaps/{recap_id}", dependencies=protected)
    def read_recap(recap_id: str) -> RecapStatus:
        return RecapStatus.of(found(recap_id))

    @app.get("/api/v1/recaps/{recap_id}/document.pdf", dependencies=protected)
    def read_document(recap_id: str) -> FileResponse:
        recap = found(recap_id)
        request = RecapRequest.model_validate_json(recap.request_json)
        return FileResponse(
            service.store.pdf_path(recap.id),
            media_type="application/pdf",
            filename=attachment_filename(request.trip),
        )

    @app.post("/api/v1/recaps/{recap_id}/retry", dependencies=protected, status_code=202)
    def retry_recap(recap_id: str, background: BackgroundTasks) -> RecapStatus:
        try:
            recap = service.retry(recap_id)
        except NotRetryable as exc:
            raise _problem(
                409, "NOT_RETRYABLE", "Conflict", "Only a failed recap can be sent again."
            ) from exc
        if recap is None:
            raise _problem(404, "RECAP_NOT_FOUND", "Not found", "No recap has this id.")
        background.add_task(service.send, recap.id)
        return RecapStatus.of(recap)

    @app.post("/api/v1/render", dependencies=protected)
    def render(request: RecapRequest) -> Response:
        """Return the PDF for the same body as /recaps, without recording or sending."""
        pdf = service.render(request.trip, request.fingerprint())
        name = attachment_filename(request.trip)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{name}"'},
        )

    return app


def app() -> FastAPI:
    """Factory for `uvicorn sncf_bilan.api:app --factory`."""
    return create_app()
