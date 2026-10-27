from typing import Annotated

from fastapi import APIRouter, Depends

from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal, get_gateway, require_permission
from app.modules.dashboard.schemas import Dashboard
from app.modules.memoranda.service import read

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])
Reader = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("", response_model=Dashboard)
async def summary(principal: Reader, gateway: Gateway) -> Dashboard:
    return await read(gateway, principal, "stc_dashboard", {}, Dashboard)
