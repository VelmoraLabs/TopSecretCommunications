"""Rutas de documentos reales; se registran independientemente del flujo portable."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import (
    Principal,
    get_gateway,
    get_principal,
    require_permission,
)
from app.modules.memoranda import service
from app.modules.memoranda.schemas import (
    CandidatePage,
    Category,
    CreateMemo,
    DocumentAction,
    DocumentDetail,
    DocumentPage,
    Download,
    GeneratedKey,
    KeyCreate,
    KeyPage,
    SignInput,
    Verification,
    VerificationFile,
)

router = APIRouter(prefix="/api/v1", tags=["Documentos y firmas"])
User = Annotated[Principal, Depends(get_principal)]
Reader = Annotated[Principal, Depends(require_permission("documents.read_assigned"))]
Creator = Annotated[Principal, Depends(require_permission("documents.create"))]
Signer = Annotated[Principal, Depends(require_permission("documents.sign"))]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]


@router.get("/signing/keys", response_model=KeyPage)
async def keys(principal: User, gateway: Gateway) -> KeyPage:
    return await service.read(gateway, principal, "list_own_signing_keys", {}, KeyPage)


@router.post("/signing/keys", response_model=GeneratedKey, status_code=201)
async def generate_key(
    body: KeyCreate, principal: Signer, gateway: Gateway
) -> GeneratedKey:
    return await service.create_key(gateway, principal, body)


@router.post("/signing/keys/{key_id}/retire", status_code=204)
async def retire_key(key_id: UUID, principal: User, gateway: Gateway) -> Response:
    await gateway.request(
        "POST",
        "/rest/v1/rpc/retire_signing_key",
        principal.token,
        body={"p_key_id": str(key_id)},
    )
    return Response(status_code=204)


@router.get("/documents", response_model=DocumentPage)
async def documents(
    principal: Reader,
    gateway: Gateway,
    search: Annotated[str, Query(max_length=80)] = "",
    category: Category | None = None,
    state: Annotated[str, Query(pattern="^(all|pending|signed)$")] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> DocumentPage:
    return await service.read(
        gateway,
        principal,
        "list_stc_documents",
        {
            "p_search": search.strip(),
            "p_category": category or "all",
            "p_state": state,
            "p_limit": limit,
            "p_offset": offset,
        },
        DocumentPage,
    )


@router.get("/documents/recipients", response_model=CandidatePage)
async def candidates(
    principal: Creator,
    gateway: Gateway,
    search: Annotated[str, Query(max_length=80)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> CandidatePage:
    return await service.read(
        gateway,
        principal,
        "list_document_candidates",
        {
            "p_search": search.strip(),
            "p_limit": limit,
            "p_offset": offset,
        },
        CandidatePage,
    )


@router.get("/documents/approvers", response_model=CandidatePage)
async def approvers(
    principal: Creator,
    gateway: Gateway,
    search: Annotated[str, Query(max_length=80)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> CandidatePage:
    return await service.read(
        gateway,
        principal,
        "list_document_approvers",
        {
            "p_search": search.strip(),
            "p_limit": limit,
            "p_offset": offset,
        },
        CandidatePage,
    )


@router.post("/documents/memoranda", response_model=DocumentDetail, status_code=201)
async def create_memorandum(
    body: CreateMemo, principal: Creator, gateway: Gateway
) -> DocumentDetail:
    return await service.create_document(gateway, principal, body)


@router.get("/documents/{document_id}", response_model=DocumentDetail)
async def document(
    document_id: UUID, principal: Reader, gateway: Gateway
) -> DocumentDetail:
    return await service.detail(gateway, principal, document_id)


@router.get("/documents/{document_id}/file", response_model=Download)
async def download(document_id: UUID, principal: Reader, gateway: Gateway) -> Download:
    return await service.download(gateway, principal, document_id)


@router.post("/documents/{document_id}/signatures", response_model=DocumentDetail)
async def sign(
    document_id: UUID, body: SignInput, principal: Signer, gateway: Gateway
) -> DocumentDetail:
    return await service.sign_document(gateway, principal, document_id, body)


@router.get("/documents/{document_id}/verification", response_model=Verification)
async def verify_stored(
    document_id: UUID, principal: Reader, gateway: Gateway
) -> Verification:
    current = await service.detail(gateway, principal, document_id)
    data = await service.stored_bytes(gateway, current)
    return await run_in_threadpool(service.verify_bytes, current, data, "stored")


@router.post("/documents/{document_id}/verification", response_model=Verification)
async def verify_uploaded(
    document_id: UUID, body: VerificationFile, principal: Reader, gateway: Gateway
) -> Verification:
    current = await service.detail(gateway, principal, document_id)
    if body.version_id != current.version.id:
        raise ServiceError(409, "document_conflict", "La versión del documento cambió.")
    return await run_in_threadpool(
        service.verify_bytes, current, service.content(body.content_base64), "uploaded"
    )


@router.post("/documents/{document_id}/request-approval", response_model=DocumentDetail)
async def request_approval(
    document_id: UUID,
    body: DocumentAction,
    principal: Creator,
    gateway: Gateway,
) -> DocumentDetail:
    return await service.transition(gateway, principal, document_id, body, review=True)


@router.post("/documents/{document_id}/send", response_model=DocumentDetail)
async def send(
    document_id: UUID,
    body: DocumentAction,
    principal: Creator,
    gateway: Gateway,
) -> DocumentDetail:
    return await service.transition(gateway, principal, document_id, body, review=False)
