"""HTTP surface: one request in, one PDF out, or one PDF emailed.

    POST /api/v1/render                  TripReportRequest JSON -> application/pdf, no trace
    POST /api/v1/reports                 same JSON -> PDF rendered, recorded, emailed
    GET  /api/v1/reports/{id}            queued | sent | failed
    GET  /api/v1/reports/{id}/document.pdf
    POST /api/v1/reports/{id}/retry      send a failed report again
    POST /api/v1/enrich                  JSON -> the same request with education.insights
    POST /api/v1/check                   JSON -> the list of missing fields, no PDF
    GET  /healthz

Missing fields never fail a request. They come back in `X-Rapport-Missing-*`
response headers on /render and /reports, in the body of /check, and in a WARNING
log line. The one exception is `recipient.email` on /reports: with no address there
is nobody to send to, and the answer is 422.
"""

from __future__ import annotations

import hmac
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
)
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import __version__
from .config import Config
from .enrich import EnrichOutcome, enrich_request
from .gaps import Gap, summarize
from .mail.compose import NoRecipient
from .models import TripReportRequest
from .pdf import render_pdf
from .service import KeyReused, LimitReached, NotRetryable, ReportService
from .store import Report, Store
from .view import attachment_filename, build_report_view

log = logging.getLogger("sncf_rapport")
_HEADER_LIMIT = 1800  # stay well under common 8 kB header limits


def _gap_headers(gaps: tuple[Gap, ...] | list[Gap]) -> dict[str, str]:
    major = [gap.field for gap in gaps if gap.severity == "major"]
    minor = [gap.field for gap in gaps if gap.severity == "minor"]

    def joined(fields: list[str]) -> str:
        text = ",".join(fields).encode("ascii", "replace").decode("ascii")
        return text if len(text) <= _HEADER_LIMIT else text[:_HEADER_LIMIT] + ",..."

    return {
        "X-Rapport-Missing-Major-Count": str(len(major)),
        "X-Rapport-Missing-Minor-Count": str(len(minor)),
        "X-Rapport-Missing-Major": joined(major),
        "X-Rapport-Missing-Minor": joined(minor),
    }


class ReportStatus(BaseModel):
    id: str
    status: str  # queued | sent | failed
    recipient: str
    provider: str | None
    provider_message_id: str | None
    attempts: int
    error: str | None
    pdf_sha256: str
    created_at: str
    updated_at: str

    @classmethod
    def of(cls, report: Report) -> ReportStatus:
        return cls(**{name: getattr(report, name) for name in cls.model_fields})


def _problem(status: int, code: str, detail: str) -> HTTPException:
    return HTTPException(status, {"code": code, "detail": detail})


def _without_photo_paths(request: TripReportRequest) -> TripReportRequest:
    """Over HTTP a photo must come as data: a `path` would name a file on the server."""
    if not request.media or not any(photo.path for photo in request.media.photos):
        return request
    data = request.model_dump(mode="json", by_alias=True)
    for photo in data["media"]["photos"]:
        photo["path"] = None
    return TripReportRequest.model_validate(data)


def create_app(config: Config | None = None, *, service: ReportService | None = None) -> FastAPI:
    config = config or Config.from_env()
    config.check_for_live_sending()
    if not config.logo_png.is_file():
        log.warning("logo file is missing, emails go out without it: %s", config.logo_png)
    if service is None:
        config.data_dir.mkdir(parents=True, exist_ok=True)
        service = ReportService(config, Store(config.data_dir))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        service.store.purge(older_than_days=config.retention_days)
        threading.Thread(target=service.resume, name="resume-queued", daemon=True).start()
        yield
        service.store.close()

    app = FastAPI(
        title="sncf_rapport",
        version=__version__,
        root_path=config.root_path,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url=None,
    )
    app.state.service = service

    @app.exception_handler(HTTPException)
    async def problem_details(_, exc: HTTPException) -> JSONResponse:
        body = exc.detail if isinstance(exc.detail, dict) else {"detail": str(exc.detail)}
        return JSONResponse({"status": exc.status_code, **body}, status_code=exc.status_code)

    if not config.api_key:
        log.warning("RAPPORT_API_KEY is not set: the API accepts unauthenticated requests.")

    def authorize(x_rapport_key: str | None = Header(default=None)) -> None:
        if not config.api_key:
            return
        supplied = (x_rapport_key or "").encode()
        if not hmac.compare_digest(supplied, config.api_key.encode()):
            raise HTTPException(status_code=401, detail="Missing or wrong X-Rapport-Key.")

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > config.max_body_bytes:
            return Response(status_code=413, content="Request body too large.")
        return await call_next(request)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "mail_mode": config.mail_mode}

    @app.post("/api/v1/check", dependencies=[Depends(authorize)])
    def check(request: TripReportRequest) -> dict[str, object]:
        request = _without_photo_paths(request)
        view = build_report_view(request, config=config)
        gaps = list(view.gaps)
        return {
            "summary": summarize(gaps),
            "major": sum(1 for gap in gaps if gap.severity == "major"),
            "minor": sum(1 for gap in gaps if gap.severity == "minor"),
            "gaps": [gap.as_dict() for gap in gaps],
        }

    def outcome_dict(outcome: EnrichOutcome) -> dict[str, object]:
        return {
            "status": outcome.status,
            "detail": outcome.detail,
            "model": outcome.model,
            "input_tokens": outcome.input_tokens,
            "output_tokens": outcome.output_tokens,
            "dropped": list(outcome.dropped),
        }

    @app.post("/api/v1/enrich", dependencies=[Depends(authorize)])
    def enrich(request: TripReportRequest, force: bool = Query(default=False)) -> dict[str, object]:
        """Add the generated texts so the teacher can read and edit them before rendering."""
        enriched, outcome = enrich_request(request, config, force=force)
        return {
            "outcome": outcome_dict(outcome),
            "request": enriched.model_dump(mode="json", by_alias=True, exclude_none=True),
        }

    @app.post(
        "/api/v1/render",
        dependencies=[Depends(authorize)],
        response_class=Response,
        responses={200: {"content": {"application/pdf": {}}}},
    )
    def render(
        request: TripReportRequest,
        enrich: str = Query(default="auto", pattern="^(auto|off)$"),
    ) -> Response:
        """`enrich=auto` adds the generated texts when a model key is configured and the
        request has none; any failure there leaves the report without them."""
        request = _without_photo_paths(request)
        issued_at = datetime.now().astimezone()
        outcome = EnrichOutcome("off", "enrich=off")
        if enrich == "auto":
            request, outcome = enrich_request(request, config)
        gaps = list(build_report_view(request, config=config, issued_at=issued_at).gaps)
        if gaps:
            log.warning("report rendered with %s", summarize(gaps))
        pdf = render_pdf(request, config=config, issued_at=issued_at)
        headers = _gap_headers(gaps)
        headers["X-Rapport-Enrich"] = outcome.status
        headers["Content-Disposition"] = f'inline; filename="{attachment_filename(request)}"'
        return Response(content=pdf, media_type="application/pdf", headers=headers)

    def found(report_id: str) -> Report:
        report = service.store.get(report_id)
        if report is None:
            raise _problem(404, "REPORT_NOT_FOUND", "No report has this id.")
        return report

    @app.post(
        "/api/v1/reports",
        dependencies=[Depends(authorize)],
        status_code=202,
        responses={
            200: {"description": "The same request was already accepted; nothing sent again."},
            422: {"description": "Invalid value, or no recipient.email to send to."},
        },
    )
    def create_report(
        request: TripReportRequest,
        background: BackgroundTasks,
        response: Response,
        enrich: str = Query(default="auto", pattern="^(auto|off)$"),
    ) -> ReportStatus:
        """Render the PDF, record the job and email it to `recipient.email`.

        `202` accepted and queued · `200` this content was already accepted (same job
        returned, no second email) · `409` `idempotency_key` reused with other content ·
        `422` invalid value or no recipient · `429` daily limit."""
        request = _without_photo_paths(request)
        outcome = EnrichOutcome("off", "enrich=off")
        if enrich == "auto":
            request, outcome = enrich_request(request, config)
        try:
            report, created = service.submit(request)
        except NoRecipient as exc:
            raise _problem(
                422,
                "NO_RECIPIENT",
                "recipient.email is missing: the report can be rendered (/render) but not "
                "sent. Ask the teacher for the address when they submit their feedback.",
            ) from exc
        except KeyReused as exc:
            raise _problem(
                409,
                "IDEMPOTENCY_KEY_REUSED",
                "This idempotency_key was already used with different content.",
            ) from exc
        except LimitReached as exc:
            which = "this recipient" if str(exc) == "recipient" else "the service"
            raise _problem(
                429, "LIMIT_REACHED", f"Daily sending limit reached for {which}."
            ) from exc
        gaps = list(build_report_view(request, config=config).gaps)
        if created:
            if gaps:
                log.warning("report %s queued with %s", report.id, summarize(gaps))
            background.add_task(service.send, report.id)
        else:
            response.status_code = 200
        response.headers.update(_gap_headers(gaps))
        response.headers["X-Rapport-Enrich"] = outcome.status
        return ReportStatus.of(report)

    @app.get("/api/v1/reports/{report_id}", dependencies=[Depends(authorize)])
    def read_report(report_id: str) -> ReportStatus:
        return ReportStatus.of(found(report_id))

    @app.get("/api/v1/reports/{report_id}/document.pdf", dependencies=[Depends(authorize)])
    def read_document(report_id: str) -> FileResponse:
        report = found(report_id)
        request = TripReportRequest.model_validate_json(report.request_json)
        return FileResponse(
            service.store.pdf_path(report.id),
            media_type="application/pdf",
            filename=attachment_filename(request),
        )

    @app.post(
        "/api/v1/reports/{report_id}/retry", dependencies=[Depends(authorize)], status_code=202
    )
    def retry_report(report_id: str, background: BackgroundTasks) -> ReportStatus:
        try:
            report = service.retry(report_id)
        except NotRetryable as exc:
            raise _problem(409, "NOT_RETRYABLE", "Only a failed report can be sent again.") from exc
        if report is None:
            raise _problem(404, "REPORT_NOT_FOUND", "No report has this id.")
        background.add_task(service.send, report.id)
        return ReportStatus.of(report)

    return app


def app() -> FastAPI:
    """Factory for `uvicorn sncf_rapport.api:app --factory`."""
    return create_app()
