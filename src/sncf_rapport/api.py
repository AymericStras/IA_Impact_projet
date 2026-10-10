"""HTTP surface: one request in, one PDF out. Nothing is stored.

    POST /api/v1/render   TripReportRequest JSON -> application/pdf
    POST /api/v1/enrich   TripReportRequest JSON -> the same request with education.insights
    POST /api/v1/check    TripReportRequest JSON -> the list of missing fields, no PDF
    GET  /healthz

Missing fields never fail a request. They come back in `X-Rapport-Missing-*`
response headers on /render, in the body of /check, and in a WARNING log line.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response

from . import __version__
from .config import Config
from .enrich import EnrichOutcome, enrich_request
from .gaps import Gap, summarize
from .models import TripReportRequest
from .pdf import render_pdf
from .view import build_report_view

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


def _without_photo_paths(request: TripReportRequest) -> TripReportRequest:
    """Over HTTP a photo must come as data: a `path` would name a file on the server."""
    if not request.media or not any(photo.path for photo in request.media.photos):
        return request
    data = request.model_dump(mode="json", by_alias=True)
    for photo in data["media"]["photos"]:
        photo["path"] = None
    return TripReportRequest.model_validate(data)


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config.from_env()
    app = FastAPI(
        title="sncf_rapport",
        version=__version__,
        root_path=config.root_path,
        docs_url="/docs",
        redoc_url=None,
    )
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
        return {"status": "ok", "version": __version__}

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
        reference = (request.trip.reference if request.trip else None) or "rapport"
        safe = "".join(ch for ch in reference if ch.isalnum() or ch in "-_")[:40] or "rapport"
        headers = _gap_headers(gaps)
        headers["X-Rapport-Enrich"] = outcome.status
        headers["Content-Disposition"] = f'inline; filename="rapport-{safe}.pdf"'
        return Response(content=pdf, media_type="application/pdf", headers=headers)

    return app


def app() -> FastAPI:
    """Factory for `uvicorn sncf_rapport.api:app --factory`."""
    return create_app()
