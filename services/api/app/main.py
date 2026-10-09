"""Application FastAPI : CORS, base de données, gestion des erreurs (RFC 9457), routes."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import RateLimiter
from app.api.routes import router
from app.core.config import Settings, get_settings
from app.db.session import init_db, make_engine, session_factory
from app.domain import dialogue
from app.schemas.conversation import ProblemDetails
from app.services.conversation import InvalidStateError, NotFoundError, VersionConflictError
from app.services.providers.base import ProviderError

HTTP_TITLES = {
    400: "Requête invalide",
    404: "Introuvable",
    409: "Conflit",
    413: "Contenu trop volumineux",
    422: "Données invalides",
    429: "Trop de requêtes",
    502: "Fournisseur indisponible",
    504: "Délai dépassé",
}


def problem(status_code: int, detail: str) -> JSONResponse:
    body = ProblemDetails(title=HTTP_TITLES.get(status_code, "Erreur"), status=status_code, detail=detail)
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
        title="SNCF liO — Assistant de voyage pédagogique",
        version="1.0.0",
        description="Collecte et confirme quatre informations de sortie pédagogique à partir de messages en français.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    # Les routes lisent la configuration via Depends(get_settings) : on injecte celle de cette instance
    # (indispensable pour les tests qui créent l'application avec des paramètres explicites).
    app.dependency_overrides[get_settings] = lambda: settings

    @app.get("/health", include_in_schema=False)
    def root_health() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return problem(404, "Conversation introuvable.")

    @app.exception_handler(VersionConflictError)
    async def _conflict(_: Request, exc: VersionConflictError) -> JSONResponse:
        return problem(
            409, "Les informations ont changé entre-temps. Rechargez la conversation et réessayez."
        )

    @app.exception_handler(InvalidStateError)
    async def _invalid_state(_: Request, exc: InvalidStateError) -> JSONResponse:
        return problem(409, str(exc))

    @app.exception_handler(ProviderError)
    async def _provider(_: Request, exc: ProviderError) -> JSONResponse:
        return problem(504 if exc.timeout else 502, dialogue.PROVIDER_ERROR)

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        return problem(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return problem(422, "Les données envoyées sont invalides.")

    return app


app = create_app()
