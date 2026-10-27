from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, get_principal
from app.modules.memoranda.service import read
from app.modules.notifications.schemas import NotificationPage, ReadAll

router = APIRouter(prefix="/api/v1/notifications", tags=["Notificaciones"])
User = Annotated[Principal, Depends(get_principal)]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("", response_model=NotificationPage)
async def inbox(
    principal: User,
    gateway: Gateway,
    state: Literal["all", "unread"] = "all",
    category: Literal["all", "groups", "documents", "recovery", "account"] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> NotificationPage:
    return await read(
        gateway,
        principal,
        "list_stc_notifications",
        {
            "p_state": state,
            "p_category": category,
            "p_limit": limit,
            "p_offset": offset,
        },
        NotificationPage,
    )


@router.post("/read-all", status_code=204)
async def read_all(body: ReadAll, principal: User, gateway: Gateway) -> Response:
    await gateway.request(
        "POST",
        "/rest/v1/rpc/read_all_stc_notifications",
        principal.token,
        body={"p_before": body.before.isoformat()},
    )
    return Response(status_code=204)


@router.post("/{notification_id}/read", status_code=204)
async def mark_read(
    notification_id: UUID, principal: User, gateway: Gateway
) -> Response:
    await gateway.request(
        "POST",
        "/rest/v1/rpc/read_stc_notification",
        principal.token,
        body={"p_notification_id": str(notification_id)},
    )
    return Response(status_code=204)
