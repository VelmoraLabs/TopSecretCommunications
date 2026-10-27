"""Cada perfil administra exclusivamente sus claves de cifrado."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, require_permission
from app.modules.encryption_keys import service
from app.modules.encryption_keys.schemas import (
    EncryptionKey,
    GeneratedKey,
    KeyCreate,
    KeyPage,
    PrivateKeyInput,
)

router = APIRouter(prefix="/api/v1/encryption-keys", tags=["Claves de cifrado"])
User = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("", response_model=KeyPage)
async def keys(principal: User, gateway: Gateway) -> KeyPage:
    return await service.list_keys(gateway, principal)


@router.post("", response_model=GeneratedKey, status_code=201)
async def generate(body: KeyCreate, principal: User, gateway: Gateway) -> GeneratedKey:
    return await service.generate(gateway, principal, body)


@router.post("/{key_id}/activate", response_model=EncryptionKey)
async def activate(
    key_id: UUID, body: PrivateKeyInput, principal: User, gateway: Gateway
) -> EncryptionKey:
    return await service.activate(gateway, principal, key_id, body)


@router.post("/{key_id}/retire", status_code=204)
async def retire(key_id: UUID, principal: User, gateway: Gateway) -> Response:
    await gateway.request(
        "POST",
        "/rest/v1/rpc/retire_encryption_key",
        principal.token,
        body={"p_key_id": str(key_id)},
    )
    return Response(status_code=204)
