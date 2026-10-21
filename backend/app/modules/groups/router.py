"""Identidad en FastAPI; alcance por grupo y concurrencia en las RPC de Supabase."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import TypeAdapter

from app.core.errors import ServiceError
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, require_permission
from app.modules.groups import service
from app.modules.groups.schemas import (
    CandidatePage,
    CreatedGroup,
    GroupCreate,
    GroupDetail,
    GroupPage,
    GroupUpdate,
    MemberUpdate,
)

router = APIRouter(prefix="/api/v1/groups", tags=["Grupos"])
Reader = Annotated[Principal, Depends(require_permission("groups.read"))]
Administrator = Annotated[Principal, Depends(require_permission("groups.manage"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]
Search = Annotated[str, Query(max_length=80)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("", response_model=GroupPage)
async def groups(
    principal: Reader,
    gateway: Gateway,
    search: Search = "",
    state: Annotated[str, Query(pattern="^(all|active|archived)$")] = "active",
    limit: Limit = 20,
    offset: Offset = 0,
) -> GroupPage:
    return await service.call(
        gateway,
        principal,
        "list_stc_groups",
        {
            "p_search": search.strip(),
            "p_state": state,
            "p_limit": limit,
            "p_offset": offset,
        },
        GroupPage,
    )


@router.get("/candidates", response_model=CandidatePage)
async def candidates(
    principal: Reader,
    gateway: Gateway,
    group_id: UUID | None = None,
    search: Search = "",
    limit: Limit = 20,
    offset: Offset = 0,
) -> CandidatePage:
    return await service.call(
        gateway,
        principal,
        "list_group_candidates",
        {
            "p_group_id": str(group_id) if group_id else None,
            "p_search": search.strip(),
            "p_limit": limit,
            "p_offset": offset,
        },
        CandidatePage,
    )


@router.post("", response_model=CreatedGroup, status_code=201)
async def create(
    body: GroupCreate, principal: Administrator, gateway: Gateway
) -> CreatedGroup:
    response = await gateway.request(
        "POST",
        "/rest/v1/rpc/create_stc_group",
        principal.token,
        body={
            "p_name": body.name,
            "p_description": body.description,
            "p_members": [member.model_dump(mode="json") for member in body.members],
        },
    )
    try:
        return CreatedGroup(id=TypeAdapter(UUID).validate_python(response.json()))
    except ValueError as exc:
        raise ServiceError(
            503, "invalid_group_response", "No se pudo confirmar el grupo."
        ) from exc


@router.get("/{group_id}", response_model=GroupDetail)
async def detail(group_id: UUID, principal: Reader, gateway: Gateway) -> GroupDetail:
    return await service.call(
        gateway, principal, "get_stc_group", {"p_group_id": str(group_id)}, GroupDetail
    )


@router.patch("/{group_id}", status_code=204)
async def update(
    group_id: UUID, body: GroupUpdate, principal: Reader, gateway: Gateway
) -> Response:
    await service.mutate(
        gateway,
        principal,
        "update_stc_group",
        {
            "p_group_id": str(group_id),
            "p_name": body.name,
            "p_description": body.description,
            "p_is_active": body.is_active,
            "p_expected_version": body.expected_version,
        },
    )
    return Response(status_code=204)


@router.put("/{group_id}/members", status_code=204)
async def put_member(
    group_id: UUID, body: MemberUpdate, principal: Reader, gateway: Gateway
) -> Response:
    await service.mutate(
        gateway,
        principal,
        "set_stc_group_member",
        {
            "p_group_id": str(group_id),
            "p_profile_id": str(body.profile_id),
            "p_group_role": body.group_role,
            "p_expected_version": body.expected_version,
        },
    )
    return Response(status_code=204)


@router.delete("/{group_id}/members/{profile_id}", status_code=204)
async def remove_member(
    group_id: UUID,
    profile_id: UUID,
    principal: Reader,
    gateway: Gateway,
    expected_version: Annotated[int, Query(ge=1, le=2147483646)],
) -> Response:
    await service.mutate(
        gateway,
        principal,
        "remove_stc_group_member",
        {
            "p_group_id": str(group_id),
            "p_profile_id": str(profile_id),
            "p_expected_version": expected_version,
        },
    )
    return Response(status_code=204)
