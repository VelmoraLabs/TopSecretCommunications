"""Flujo portable protegido por sesión y permisos; grupos colaborativos por separado."""

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse

from app.modules.auth.service import require_permission
from app.modules.documents.schemas import (
    ProtectionResult,
    ProtectRequest,
    RecoverRequest,
    RecoveryResult,
)
from app.modules.documents.service import DocumentError, protect_note, recover_note

router = APIRouter(prefix="/api/v1/documents/special-notes", tags=["Notas especiales"])


@router.post(
    "/protect",
    response_model=ProtectionResult,
    dependencies=[Depends(require_permission("documents.create"))],
)
def protect(
    request: ProtectRequest, response: Response
) -> ProtectionResult | JSONResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        return protect_note(request)
    except DocumentError as exc:
        return JSONResponse(
            status_code=exc.status,
            content={"detail": {"code": exc.code, "message": str(exc)}},
            headers={"Cache-Control": "no-store"},
        )


@router.post(
    "/recover",
    response_model=RecoveryResult,
    dependencies=[Depends(require_permission("recovery.request"))],
)
def recover(
    request: RecoverRequest, response: Response
) -> RecoveryResult | JSONResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        return recover_note(request)
    except DocumentError as exc:
        return JSONResponse(
            status_code=exc.status,
            content={"detail": {"code": exc.code, "message": str(exc)}},
            headers={"Cache-Control": "no-store"},
        )
