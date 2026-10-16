"""Sesión del usuario y administración. Todas las operaciones se autorizan en BD."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth import service
from app.modules.auth.schemas import (
    Access,
    CreatedProfile,
    ProfileCreate,
    ProfilePage,
    ProfileUpdate,
    Role,
)
from app.modules.auth.service import (
    Principal,
    get_gateway,
    get_principal,
    require_permission,
)

router = APIRouter(prefix="/api/v1")
Admin = Annotated[Principal, Depends(require_permission("profiles.manage"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("/auth/me", response_model=Access, tags=["Sesión"])
async def me(principal: Annotated[Principal, Depends(get_principal)]) -> Access:
    return principal.access


@router.get("/admin/profiles", response_model=ProfilePage, tags=["Administración"])
async def profiles(
    principal: Admin,
    gateway: Gateway,
    email: Annotated[str, Query(max_length=80)] = "",
    active: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProfilePage:
    return await service.list_profiles(
        gateway,
        principal,
        email=email.strip(),
        active=active,
        limit=limit,
        offset=offset,
    )


@router.get("/admin/roles", response_model=list[Role], tags=["Administración"])
async def roles(principal: Admin, gateway: Gateway) -> list[Role]:
    return await service.list_roles(gateway, principal)


@router.post(
    "/admin/profiles",
    response_model=CreatedProfile,
    status_code=201,
    tags=["Administración"],
)
async def create_profile(
    body: ProfileCreate, principal: Admin, gateway: Gateway
) -> CreatedProfile:
    profile_id = await service.authorize_profile(
        gateway,
        principal,
        {
            "p_email": body.email,
            "p_display_name": body.display_name,
            "p_role_code": body.role_code,
        },
    )
    return CreatedProfile(id=profile_id)


@router.patch("/admin/profiles/{profile_id}", status_code=204, tags=["Administración"])
async def update_profile(
    profile_id: UUID, body: ProfileUpdate, principal: Admin, gateway: Gateway
) -> Response:
    await gateway.request(
        "POST",
        "/rest/v1/rpc/update_profile",
        principal.token,
        body={
            "p_profile_id": str(profile_id),
            "p_display_name": body.display_name,
            "p_role_code": body.role_code,
            "p_is_active": body.is_active,
        },
    )
    return Response(status_code=204)
