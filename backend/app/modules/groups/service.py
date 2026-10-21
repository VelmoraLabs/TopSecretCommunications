"""RPC transaccionales con el JWT del usuario, sin service_role ni roles del cliente."""

from typing import Any

from pydantic import BaseModel

from app.core.errors import ServiceError
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal


async def call[Result: BaseModel](
    gateway: SupabaseGateway,
    principal: Principal,
    operation: str,
    body: dict[str, Any],
    result: type[Result],
) -> Result:
    response = await gateway.request(
        "POST", "/rest/v1/rpc/" + operation, principal.token, body=body
    )
    try:
        return result.model_validate(response.json())
    except ValueError as exc:
        raise ServiceError(
            503,
            "invalid_group_response",
            "No se pudo consultar la información del grupo.",
        ) from exc


async def mutate(
    gateway: SupabaseGateway,
    principal: Principal,
    operation: str,
    body: dict[str, Any],
) -> None:
    await gateway.request(
        "POST", "/rest/v1/rpc/" + operation, principal.token, body=body
    )
