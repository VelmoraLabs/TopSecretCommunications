"""Persistencia de notas de grupo, disponible también sin el demo portable."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.crypto.key_wrapping.share_envelope import ShareEnvelope
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import (
    Principal,
    get_gateway,
    get_principal,
    require_permission,
)
from app.modules.documents.schemas import NotePackage
from app.modules.encryption_keys.schemas import PrivateKeyInput
from app.modules.group_notes import service
from app.modules.group_notes.schemas import (
    ConfirmBackup,
    CreateGroupNote,
    GroupPage,
    NoteDetail,
    NotePage,
    ShareCheck,
)
from app.modules.memoranda.service import read

router = APIRouter(prefix="/api/v1/group-notes", tags=["Notas especiales de grupo"])
Reader = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Creator = Annotated[Principal, Depends(require_permission("documents.create"))]
User = Annotated[Principal, Depends(get_principal)]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]
Search = Annotated[str, Query(max_length=80)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("/groups", response_model=GroupPage)
async def groups(
    principal: Creator,
    gateway: Gateway,
    search: Search = "",
    limit: Limit = 20,
    offset: Offset = 0,
) -> GroupPage:
    return await read(
        gateway,
        principal,
        "list_note_groups",
        {"p_search": search.strip(), "p_limit": limit, "p_offset": offset},
        GroupPage,
    )


@router.get("", response_model=NotePage)
async def notes(
    principal: Reader,
    gateway: Gateway,
    search: Search = "",
    limit: Limit = 20,
    offset: Offset = 0,
) -> NotePage:
    return await read(
        gateway,
        principal,
        "list_group_notes",
        {"p_search": search.strip(), "p_limit": limit, "p_offset": offset},
        NotePage,
    )


@router.post("", response_model=NoteDetail, status_code=201)
async def create(
    body: CreateGroupNote, principal: Creator, gateway: Gateway
) -> NoteDetail:
    return await service.create(gateway, principal, body)


@router.get("/{note_id}", response_model=NoteDetail)
async def note(note_id: UUID, principal: Reader, gateway: Gateway) -> NoteDetail:
    return await service.detail(gateway, principal, note_id)


@router.get("/{note_id}/package", response_model=NotePackage)
async def package(note_id: UUID, principal: Reader, gateway: Gateway) -> NotePackage:
    return await service.package(gateway, principal, note_id)


@router.post("/{note_id}/confirm-backup", response_model=NoteDetail)
async def confirm(
    note_id: UUID, body: ConfirmBackup, principal: Creator, gateway: Gateway
) -> NoteDetail:
    return await service.confirm(gateway, principal, note_id, body)


@router.post("/{note_id}/cancel", status_code=204)
async def cancel(note_id: UUID, principal: User, gateway: Gateway) -> Response:
    await service.cancel(gateway, str(principal.access.profile.id), note_id)
    return Response(status_code=204)


@router.get("/{note_id}/my-share", response_model=ShareEnvelope)
async def own_share(
    note_id: UUID, principal: Reader, gateway: Gateway
) -> ShareEnvelope:
    return await service.own_share(gateway, principal, note_id)


@router.post("/{note_id}/my-share/check", response_model=ShareCheck)
async def check_share(
    note_id: UUID, body: PrivateKeyInput, principal: Reader, gateway: Gateway
) -> ShareCheck:
    return await service.check_share(gateway, principal, note_id, body)
