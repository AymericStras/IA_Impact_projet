"""FastAPI application: CORS, database, guards, error handling (RFC 9457), routes."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import RateLimiter
from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.db.session import init_db, make_engine, session_factory
from app.domain import dialogue
from app.schemas.conversation import ProblemDetails
from app.services.conversation import (
    ConcurrentUpdateError,
    IdempotencyConflictError,
    InvalidStateError,
    NotFoundError,
    VersionConflictError,
)
from app.services.providers.base import ProviderError

log = logging.getLogger(__name__)

HTTP_TITLES = {
    400: "Requête invalide",
    404: "Introuvable",
    409: "Conflit",
    413: "Contenu trop volumineux",
    422: "Données invalides",
    429: "Trop de requêtes",
    500: "Erreur interne",
    502: "Fournisseur indisponible",
    504: "Délai dépassé",
}
# Multipart framing around the audio bytes.
BODY_OVERHEAD_BYTES = 64 * 1024


def problem(status_code: int, code: str, detail: str) -> JSONResponse:
    body = ProblemDetails(
        title=HTTP_TITLES.get(status_code, "Erreur"), status=status_code, code=code, detail=detail
    )
    return JSONResponse(
        status_code=status_code, content=body.model_dump(), media_type="application/problem+json"
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = make_engine(settings.resolved_database_url)
        init_db(engine)
        app.state.engine = engine
        app.state.session_factory = session_factory(engine)
        app.state.rate_limiter = RateLimiter(settings.rate_limit_per_minute)
        yield
        engine.dispose()

    app = FastAPI(
        title="SNCF liO — Teacher trip assistant",
        version="1.0.0",
        description="Collects and confirms four pieces of school-trip information from French messages.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Request-Id"],
    )
    app.include_router(router)
    # Routes read the configuration through Depends(get_settings): we inject this instance's settings
    # (required for the tests that create the application with explicit settings).
    app.dependency_overrides[get_settings] = lambda: settings

    @app.middleware("http")
    async def guards(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = uuid.uuid4().hex
        declared = request.headers.get("content-length")
        if declared and (
            not declared.isdigit() or int(declared) > settings.max_audio_bytes + BODY_OVERHEAD_BYTES
        ):
            response: Response = problem(413, "BODY_TOO_LARGE", "Requête trop volumineuse.")
        else:
            response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health", include_in_schema=False)
    def root_health() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return problem(exc.status, exc.code, exc.detail)

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return problem(404, "CONVERSATION_NOT_FOUND", "Conversation introuvable.")

    @app.exception_handler(VersionConflictError)
    async def _conflict(_: Request, exc: VersionConflictError) -> JSONResponse:
        return problem(
            409,
            "VERSION_CONFLICT",
            "Les informations ont changé entre-temps. Rechargez la conversation et réessayez.",
        )

    @app.exception_handler(ConcurrentUpdateError)
    async def _concurrent(_: Request, exc: ConcurrentUpdateError) -> JSONResponse:
        return problem(
            409,
            "CONCURRENT_UPDATE",
            "Un autre message était en cours de traitement. Votre saisie est conservée ; réessayez.",
        )

    @app.exception_handler(IdempotencyConflictError)
    async def _idempotency(_: Request, exc: IdempotencyConflictError) -> JSONResponse:
        return problem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Cet identifiant de message a déjà été utilisé pour un autre contenu.",
        )

    @app.exception_handler(InvalidStateError)
    async def _invalid_state(_: Request, exc: InvalidStateError) -> JSONResponse:
        return problem(409, "INVALID_STATE", str(exc))

    @app.exception_handler(ProviderError)
    async def _provider(_: Request, exc: ProviderError) -> JSONResponse:
        detail = dialogue.TRANSCRIPTION_ERROR if exc.code == "EMPTY_TRANSCRIPT" else dialogue.PROVIDER_ERROR
        return problem(504 if exc.timeout else 502, exc.code, detail)

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        return problem(exc.status_code, f"HTTP_{exc.status_code}", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return problem(422, "INVALID_BODY", "Les données envoyées sont invalides.")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Type only: no request body, no message text in logs.
        log.error("unhandled error: %s", type(exc).__name__)
        return problem(500, "INTERNAL_ERROR", "Erreur interne. Vos informations précédentes sont conservées.")

    return app


app = create_app()
