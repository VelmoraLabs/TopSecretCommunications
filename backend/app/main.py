import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

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
from app.modules.dashboard.router import router as dashboard_router
from app.modules.diplomatic_notes.router import router as diplomatic_notes_router
from app.modules.documents.router import router as documents_router
from app.modules.encryption_keys.router import router as encryption_keys_router
from app.modules.group_notes.router import router as group_notes_router
from app.modules.groups.router import router as groups_router
from app.modules.memoranda.router import router as memoranda_router
from app.modules.note_recovery.router import router as note_recovery_router
from app.modules.note_recovery.service import cleanup_loop
from app.modules.notifications.router import router as notifications_router
from app.modules.personnel_files.router import router as personnel_files_router


def create_app(
    *,
    enable_local_workflow: bool | None = None,
    supabase: SupabaseGateway | None = None,
) -> FastAPI:
    settings = SupabaseSettings.from_env() if supabase is None else None
    gateway = supabase or (SupabaseGateway(settings) if settings else None)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        cleanup = (
            asyncio.create_task(cleanup_loop(gateway))
            if gateway is not None and gateway.settings.secret_key is not None
            else None
        )
        try:
            yield
        finally:
            if cleanup is not None:
                cleanup.cancel()
                with suppress(asyncio.CancelledError):
                    await cleanup
            if gateway is not None:
                await gateway.close()

    application = FastAPI(
        title="Top Secret Communications API", version="0.3.0", lifespan=lifespan
    )
    application.state.supabase = gateway
    application.include_router(router)
    application.include_router(auth_router)
    application.include_router(dashboard_router)
    application.include_router(groups_router)
    application.include_router(group_notes_router)
    application.include_router(encryption_keys_router)
    application.include_router(note_recovery_router)
    application.include_router(notifications_router)
    application.include_router(personnel_files_router)
    application.include_router(diplomatic_notes_router)
    if enable_local_workflow is None:
        enable_local_workflow = os.getenv("STC_ENABLE_LOCAL_WORKFLOW", "0") == "1"
    if enable_local_workflow:
        application.include_router(documents_router)
    application.include_router(memoranda_router)
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
