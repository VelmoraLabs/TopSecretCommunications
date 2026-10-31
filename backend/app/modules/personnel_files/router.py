"""API de expedientes individuales; autenticación y permisos de la sesión actual."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, require_permission
from app.modules.personnel_files import persistence
from app.modules.personnel_files.schemas import (
    CreatePersonnelFile,
    OpenPersonnelFile,
    PersonnelDetail,
    PersonnelDownload,
    PersonnelPage,
)

router = APIRouter(prefix="/api/v1/personnel-files", tags=["Expedientes de personal"])
Reader = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Creator = Annotated[Principal, Depends(require_permission("documents.create"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("", response_model=PersonnelPage)
async def files(
    principal: Reader,
    gateway: Gateway,
    search: Annotated[str, Query(max_length=80)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> PersonnelPage:
    return await persistence.list_files(
        gateway, principal, search=search.strip(), limit=limit, offset=offset
    )


@router.post("", response_model=PersonnelDetail, status_code=201)
async def create(
    body: CreatePersonnelFile, principal: Creator, gateway: Gateway
) -> PersonnelDetail:
    return await persistence.create(gateway, principal, body)


@router.get("/{document_id}", response_model=PersonnelDetail)
async def detail(
    document_id: UUID, principal: Reader, gateway: Gateway
) -> PersonnelDetail:
    return await persistence.detail(gateway, principal, document_id)


@router.post("/{document_id}/file", response_model=PersonnelDownload)
async def download(
    document_id: UUID,
    body: OpenPersonnelFile,
    principal: Reader,
    gateway: Gateway,
) -> PersonnelDownload:
    # Las credenciales privadas viajan en el cuerpo, nunca en la URL.
    return await persistence.download(gateway, principal, document_id, body)


@router.post("/{document_id}/cancel", response_model=PersonnelDetail)
async def cancel(
    document_id: UUID, principal: Creator, gateway: Gateway
) -> PersonnelDetail:
    return await persistence.cancel(gateway, principal, document_id)
