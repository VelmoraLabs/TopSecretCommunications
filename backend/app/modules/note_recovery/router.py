from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, require_permission
from app.modules.documents.schemas import RecoveryResult
from app.modules.encryption_keys.schemas import PrivateKeyInput
from app.modules.memoranda.service import read
from app.modules.note_recovery import service
from app.modules.note_recovery.schemas import (
    ContributionInput,
    CreateRecovery,
    RecoveryDetail,
    RecoveryPage,
)

router = APIRouter(prefix="/api/v1", tags=["Recuperación colaborativa de notas"])
Reader = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Requester = Annotated[Principal, Depends(require_permission("recovery.request"))]
Contributor = Annotated[Principal, Depends(require_permission("recovery.contribute"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("/group-notes/{note_id}/recoveries", response_model=RecoveryPage)
async def requests(
    note_id: UUID,
    principal: Reader,
    gateway: Gateway,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> RecoveryPage:
    return await read(
        gateway,
        principal,
        "list_note_recoveries",
        {"p_note_id": str(note_id), "p_limit": limit, "p_offset": offset},
        RecoveryPage,
    )


@router.post(
    "/group-notes/{note_id}/recoveries", response_model=RecoveryDetail, status_code=201
)
async def create(
    note_id: UUID, body: CreateRecovery, principal: Requester, gateway: Gateway
) -> RecoveryDetail:
    return await read(
        gateway,
        principal,
        "create_note_recovery",
        {
            "p_note_id": str(note_id),
            "p_request_id": str(body.request_id),
            "p_reason": body.reason,
            "p_duration_minutes": body.duration_minutes,
        },
        RecoveryDetail,
    )


@router.get("/note-recoveries/{request_id}", response_model=RecoveryDetail)
async def detail(
    request_id: UUID, principal: Reader, gateway: Gateway
) -> RecoveryDetail:
    return await service.detail(gateway, principal, request_id)


@router.post("/note-recoveries/{request_id}/contribute", response_model=RecoveryDetail)
async def contribute(
    request_id: UUID, body: ContributionInput, principal: Contributor, gateway: Gateway
) -> RecoveryDetail:
    return await service.contribute(gateway, principal, request_id, body)


@router.post("/note-recoveries/{request_id}/recover", response_model=RecoveryResult)
async def recover(
    request_id: UUID, body: PrivateKeyInput, principal: Requester, gateway: Gateway
) -> RecoveryResult:
    return await service.recover(gateway, principal, request_id, body)


@router.post("/note-recoveries/{request_id}/{action}", response_model=RecoveryDetail)
async def close(
    request_id: UUID,
    action: Literal["cancel", "reject"],
    principal: Reader,
    gateway: Gateway,
) -> RecoveryDetail:
    return await read(
        gateway,
        principal,
        "close_note_recovery",
        {
            "p_request_id": str(request_id),
            "p_action": "cancelled" if action == "cancel" else "rejected",
        },
        RecoveryDetail,
    )
