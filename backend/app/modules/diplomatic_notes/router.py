"""API de notas y comunicados: firma, cifrado y autorización de la sesión actual."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, require_permission
from app.modules.diplomatic_notes import persistence
from app.modules.diplomatic_notes.schemas import (
    CreateDiplomaticNote,
    DiplomaticDetail,
    DiplomaticDownload,
    DiplomaticPage,
    OpenDiplomaticNote,
)

router = APIRouter(
    prefix="/api/v1/diplomatic-notes", tags=["Notas diplomáticas y comunicados"]
)
Reader = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Creator = Annotated[Principal, Depends(require_permission("documents.create"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("", response_model=DiplomaticPage)
async def notes(
    principal: Reader,
    gateway: Gateway,
    search: Annotated[str, Query(max_length=80)] = "",
    kind: Literal["all", "diplomatic_note", "communique"] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> DiplomaticPage:
    return await persistence.list_notes(
        gateway, principal, search=search.strip(), kind=kind, limit=limit, offset=offset
    )


@router.post("", response_model=DiplomaticDetail, status_code=201)
async def create(
    body: CreateDiplomaticNote, principal: Creator, gateway: Gateway
) -> DiplomaticDetail:
    return await persistence.create(gateway, principal, body)


@router.get("/{document_id}", response_model=DiplomaticDetail)
async def detail(
    document_id: UUID, principal: Reader, gateway: Gateway
) -> DiplomaticDetail:
    return await persistence.detail(gateway, principal, document_id)


@router.post("/{document_id}/file", response_model=DiplomaticDownload)
async def download(
    document_id: UUID,
    body: OpenDiplomaticNote,
    principal: Reader,
    gateway: Gateway,
) -> DiplomaticDownload:
    # Las credenciales privadas viajan en el cuerpo, nunca en la URL.
    return await persistence.download(gateway, principal, document_id, body)


@router.post("/{document_id}/cancel", response_model=DiplomaticDetail)
async def cancel(
    document_id: UUID, principal: Creator, gateway: Gateway
) -> DiplomaticDetail:
    return await persistence.cancel(gateway, principal, document_id)
