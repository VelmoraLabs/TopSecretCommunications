"""Verificación con Auth y autorización con los permisos actuales de PostgreSQL."""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import TypeAdapter, ValidationError

from app.core.errors import ServiceError
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.schemas import Access, AuthIdentity, Profile, ProfilePage, Role

bearer = HTTPBearer(auto_error=False)
PROFILE_COLUMNS = (
    "id,auth_user_id,email,display_name,role_code,is_active,"
    "created_by,created_at,updated_at"
)


@dataclass(frozen=True)
class Principal:
    access: Access
    token: str = field(repr=False)


def get_gateway(request: Request) -> SupabaseGateway:
    gateway: SupabaseGateway | None = request.app.state.supabase
    if gateway is None:
        raise ServiceError(
            503, "auth_not_configured", "El servicio de acceso no está configurado."
        )
    return gateway


async def get_principal(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Principal:
    if (
        credentials is None
        or len(credentials.credentials) > 8192
        or re.fullmatch(
            r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", credentials.credentials
        )
        is None
    ):
        raise ServiceError(
            401, "authentication_required", "Inicia sesión para continuar."
        )
    gateway = get_gateway(request)
    token = credentials.credentials
    # Auth comprueba la firma, expiración y validez del token del proyecto.
    # Funciona con claves asimétricas y con proyectos que aún usan HS256.
    user_response = await gateway.request("GET", "/auth/v1/user", token)
    access_response = await gateway.request(
        "POST", "/rest/v1/rpc/current_access", token, body={}
    )
    try:
        identity = AuthIdentity.model_validate(gateway.json(user_response))
        access = Access.model_validate(gateway.json(access_response))
    except ValidationError as exc:
        raise ServiceError(
            503, "invalid_identity_response", "No se pudo verificar el acceso."
        ) from exc
    if (
        identity.is_anonymous
        or identity.app_metadata.get("provider") != "google"
        or access.profile.auth_user_id != identity.id
        or not access.profile.is_active
    ):
        raise ServiceError(403, "access_denied", "Tu perfil no está autorizado.")
    return Principal(access=access, token=token)


def require_permission(permission: str) -> Callable[[Principal], Awaitable[Principal]]:
    async def check(
        principal: Annotated[Principal, Depends(get_principal)],
    ) -> Principal:
        if permission not in principal.access.permissions:
            raise ServiceError(
                403, "permission_denied", "No tienes permiso para esta operación."
            )
        return principal

    return check


async def list_profiles(
    gateway: SupabaseGateway,
    principal: Principal,
    *,
    email: str,
    active: bool | None,
    limit: int,
    offset: int,
) -> ProfilePage:
    params = {
        "select": PROFILE_COLUMNS,
        "order": "created_at.desc,id.desc",
        "limit": str(limit),
        "offset": str(offset),
    }
    if email:
        # Un filtro de una sola columna, sin construir expresiones or() del cliente.
        params["email"] = "ilike.*" + email + "*"
    if active is not None:
        params["is_active"] = "eq." + str(active).lower()
    response = await gateway.request(
        "GET", "/rest/v1/profiles", principal.token, params=params, count=True
    )
    try:
        items = TypeAdapter(list[Profile]).validate_python(gateway.json(response))
        total = int(response.headers["Content-Range"].rsplit("/", 1)[1])
        if total < 0:
            raise ValueError("Conteo inválido.")
    except (ValidationError, ValueError, KeyError) as exc:
        raise ServiceError(
            503, "invalid_identity_response", "No se pudo consultar los perfiles."
        ) from exc
    return ProfilePage(items=items, total=total, limit=limit, offset=offset)


async def list_roles(gateway: SupabaseGateway, principal: Principal) -> list[Role]:
    response = await gateway.request(
        "GET",
        "/rest/v1/roles",
        principal.token,
        params={
            "select": "code,name,permissions:role_permissions(permission_code)",
            "order": "name.asc",
        },
    )
    try:
        return TypeAdapter(list[Role]).validate_python(gateway.json(response))
    except (ValidationError, KeyError, TypeError) as exc:
        raise ServiceError(
            503, "invalid_identity_response", "No se pudo consultar los roles."
        ) from exc


async def authorize_profile(
    gateway: SupabaseGateway, principal: Principal, body: dict[str, str]
) -> UUID:
    response = await gateway.request(
        "POST", "/rest/v1/rpc/authorize_profile", principal.token, body=body
    )
    try:
        return TypeAdapter(UUID).validate_python(gateway.json(response))
    except ValidationError as exc:
        raise ServiceError(
            503, "invalid_identity_response", "No se pudo confirmar el alta."
        ) from exc
