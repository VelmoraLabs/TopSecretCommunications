import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from app.api.router import router
from app.core.config import SupabaseSettings
from app.core.errors import ServiceError
from app.core.request_limits import RequestBodyLimit
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.router import router as auth_router
from app.modules.documents.router import router as documents_router


def create_app(
    *,
    enable_local_workflow: bool | None = None,
    supabase: SupabaseGateway | None = None,
) -> FastAPI:
    settings = SupabaseSettings.from_env() if supabase is None else None
    gateway = supabase or (SupabaseGateway(settings) if settings else None)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        yield
        if gateway is not None:
            await gateway.close()

    application = FastAPI(
        title="Top Secret Communications API", version="0.3.0", lifespan=lifespan
    )
    application.state.supabase = gateway
    application.include_router(router)
    application.include_router(auth_router)
    if enable_local_workflow is None:
        enable_local_workflow = os.getenv("STC_ENABLE_LOCAL_WORKFLOW", "0") == "1"
    if enable_local_workflow:
        application.include_router(documents_router)
    application.add_middleware(RequestBodyLimit)

    @application.middleware("http")
    async def private_responses(
        request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Vary"] = "Authorization"
        return response

    @application.exception_handler(ServiceError)
    async def service_error(request: Request, exc: ServiceError) -> JSONResponse:
        headers = {"Cache-Control": "no-store"}
        if exc.status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(
            status_code=exc.status,
            content={"detail": {"code": exc.code, "message": str(exc)}},
            headers=headers,
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # No devolver contenido del archivo ni coordenadas de fragmentos en errores.
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": "invalid_request",
                    "message": "Revisa el formato y los parámetros de la solicitud.",
                }
            },
        )

    return application


app = create_app()
