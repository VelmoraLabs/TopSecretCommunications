"""Orquesta identidad, Storage y primitivas puras; no confía en firmas del cliente."""

import base64
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.crypto.signatures import key_files, rsa_pss
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal
from app.modules.documents.schemas import MAX_FILE_SIZE
from app.modules.documents.service import DocumentError, decode_base64
from app.modules.memoranda.schemas import (
    CreateMemo,
    DocumentAction,
    DocumentDetail,
    Download,
    GeneratedKey,
    KeyCreate,
    KeyPage,
    SignatureCheck,
    SignInput,
    Verification,
)


async def read[Result: BaseModel](
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
            "invalid_document_response",
            "No se pudo consultar la información documental.",
        ) from exc


async def detail(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID
) -> DocumentDetail:
    return await read(
        gateway,
        principal,
        "get_stc_document",
        {"p_document_id": str(document_id)},
        DocumentDetail,
    )


def content(value: str) -> bytes:
    try:
        data = decode_base64(value)
    except DocumentError as exc:
        raise ServiceError(422, exc.code, str(exc)) from exc
    if len(data) > MAX_FILE_SIZE:
        raise ServiceError(
            413, "file_too_large", "El archivo supera el límite de 5 MiB."
        )
    return data


def storage_path(document: DocumentDetail) -> str:
    return (
        f"/storage/v1/object/stc-documents/{document.document.id}/{document.version.id}"
    )


async def stored_bytes(gateway: SupabaseGateway, document: DocumentDetail) -> bytes:
    response = await gateway.server_request("GET", storage_path(document))
    data = response.content
    if len(data) > MAX_FILE_SIZE:
        raise ServiceError(
            503,
            "invalid_stored_file",
            "El archivo almacenado supera el límite permitido.",
        )
    return data


def intact(document: DocumentDetail, data: bytes) -> bool:
    return (
        len(data) == document.version.size
        and rsa_pss.sha256(data).hex() == document.version.sha256
    )


async def create_key(
    gateway: SupabaseGateway, principal: Principal, body: KeyCreate
) -> GeneratedKey:
    if gateway.settings.secret_key is None:
        raise ServiceError(
            503,
            "documents_not_configured",
            "Configura SUPABASE_SECRET_KEY en el backend.",
        )
    files = await run_in_threadpool(
        key_files.generate, body.password.get_secret_value().encode("utf-8")
    )
    key_id = uuid4()
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_register_signing_key",
        body={
            "p_actor": str(principal.access.profile.id),
            "p_key_id": str(key_id),
            "p_label": body.label,
            "p_public_base64": files.public_base64,
            "p_fingerprint": files.fingerprint,
        },
    )
    page = await read(gateway, principal, "list_own_signing_keys", {}, KeyPage)
    key = next((key for key in page.items if key.id == key_id), None)
    if key is None:
        raise ServiceError(
            503, "invalid_document_response", "No se pudo confirmar la clave de firma."
        )
    return GeneratedKey(
        key=key,
        private_filename=body.private_filename,
        public_filename=body.public_filename,
        private_base64=files.private_base64,
    )


async def create_document(
    gateway: SupabaseGateway, principal: Principal, body: CreateMemo
) -> DocumentDetail:
    data = content(body.content_base64)
    document_id, version_id = uuid4(), uuid4()
    actor = str(principal.access.profile.id)
    identity = {
        "p_actor": actor,
        "p_document_id": str(document_id),
        "p_version_id": str(version_id),
    }
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_begin_memorandum",
        body={
            **identity,
            "p_title": body.title,
            "p_filename": body.filename,
            "p_media_type": body.media_type,
            "p_size": len(data),
            "p_sha256": rsa_pss.sha256(data).hex(),
            "p_recipients": [r.model_dump(mode="json") for r in body.recipients],
            "p_approver": str(body.approver_id) if body.approver_id else None,
        },
    )
    path = f"/storage/v1/object/stc-documents/{document_id}/{version_id}"
    try:
        await gateway.server_request("POST", path, content=data)
        await gateway.server_request(
            "POST", "/rest/v1/rpc/server_complete_memorandum", body=identity
        )
    except ServiceError:
        # Abort solo cambia staging->failed. Nunca borrar una carga ya confirmada
        # si la respuesta de confirmación se perdió en la red.
        try:
            aborted = await gateway.server_request(
                "POST", "/rest/v1/rpc/server_abort_memorandum", body=identity
            )
            if aborted.json() is True:
                await gateway.server_request("DELETE", path)
        except (ServiceError, ValueError) as _cleanup_error:
            # El objeto sigue privado y no publicado; ver procedimiento de conciliación.
            pass
        raise
    return await detail(gateway, principal, document_id)


async def download(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID
) -> Download:
    document = await detail(gateway, principal, document_id)
    data = await stored_bytes(gateway, document)
    if not intact(document, data):
        raise ServiceError(
            422,
            "document_integrity_failed",
            "El archivo almacenado no coincide con la versión registrada.",
        )
    return Download(
        filename=document.version.filename,
        media_type=document.version.media_type,
        content_base64=base64.b64encode(data).decode("ascii"),
    )


def make_signature(body: SignInput, public_base64: str, data: bytes) -> bytes:
    try:
        private = key_files.load_private(
            body.private_key_base64.get_secret_value(),
            body.password.get_secret_value().encode("utf-8"),
        )
        public = key_files.load_public(public_base64)
        if private.public_key().public_numbers() != public.public_numbers():
            raise rsa_pss.InvalidSignatureInput(
                "La clave privada no corresponde a la clave pública seleccionada."
            )
        signature = rsa_pss.sign(data, private)
        if not rsa_pss.verify(data, signature, public):
            raise rsa_pss.InvalidSignatureInput(
                "No se pudo comprobar la firma generada."
            )
        return signature
    except rsa_pss.SignatureError as exc:
        raise ServiceError(422, "invalid_signing_key", str(exc)) from exc


async def sign_document(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID, body: SignInput
) -> DocumentDetail:
    document = await detail(gateway, principal, document_id)
    if body.version_id != document.version.id:
        raise ServiceError(409, "document_conflict", "La versión del documento cambió.")
    if document.document.workflow_state in ("sent", "legacy_shared"):
        raise ServiceError(
            409, "document_conflict", "Esta versión ya no admite firmas."
        )
    if not document.document.can_sign:
        raise ServiceError(
            403,
            "document_permission_denied",
            "No estás habilitado para firmar esta versión.",
        )
    page = await read(gateway, principal, "list_own_signing_keys", {}, KeyPage)
    key = next(
        (key for key in page.items if key.id == body.key_id and key.is_active), None
    )
    if key is None:
        raise ServiceError(
            422,
            "invalid_signing_key",
            "Selecciona una clave activa de tu propio perfil.",
        )
    data = await stored_bytes(gateway, document)
    if not intact(document, data):
        raise ServiceError(
            422,
            "document_integrity_failed",
            "El archivo almacenado fue modificado. No se firmó.",
        )
    if document.document.signing_purpose == "approval":
        await check_signatures(document, data)
    signature = await run_in_threadpool(make_signature, body, key.public_base64, data)
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_commit_document_signature",
        body={
            "p_actor": str(principal.access.profile.id),
            "p_document_id": str(document_id),
            "p_version_id": str(body.version_id),
            "p_key_id": str(key.id),
            "p_signature_id": str(uuid4()),
            "p_sha256": document.version.sha256,
            "p_signature_base64": base64.b64encode(signature).decode("ascii"),
        },
    )
    return await detail(gateway, principal, document_id)


def verify_bytes(document: DocumentDetail, data: bytes, source: str) -> Verification:
    matches = intact(document, data)
    checks = []
    for signature in document.signatures:
        try:
            public = key_files.load_public(signature.public_base64)
            valid = rsa_pss.verify(
                data, key_files.decode_key(signature.signature_base64), public
            )
            fingerprint_matches = (
                rsa_pss.sha256(key_files.public_bytes(public)).hex()
                == signature.fingerprint
            )
        except rsa_pss.SignatureError:
            valid, fingerprint_matches = False, False
        checks.append(
            SignatureCheck(
                signature_id=signature.id,
                signer_name=signature.signer_name,
                valid=valid and matches and fingerprint_matches,
                key_is_active=signature.key_is_active,
            )
        )
    return Verification(
        document_id=document.document.id,
        version_id=document.version.id,
        source="stored" if source == "stored" else "uploaded",
        content_matches=matches,
        signatures=checks,
        all_valid=matches and bool(checks) and all(check.valid for check in checks),
    )


async def check_signatures(document: DocumentDetail, data: bytes) -> None:
    verification = await run_in_threadpool(verify_bytes, document, data, "stored")
    if not verification.all_valid:
        raise ServiceError(
            422,
            "document_integrity_failed",
            "La versión o sus firmas no son válidas. No se completó la operación.",
        )


async def transition(
    gateway: SupabaseGateway,
    principal: Principal,
    document_id: UUID,
    body: DocumentAction,
    *,
    review: bool,
) -> DocumentDetail:
    document = await detail(gateway, principal, document_id)
    if document.document.workflow_state == "legacy_shared":
        raise ServiceError(
            409,
            "document_conflict",
            "Este documento pertenece al flujo anterior. "
            "Conserva su historial y crea uno nuevo para enviarlo.",
        )
    if document.document.issuer_id != principal.access.profile.id:
        raise ServiceError(
            403,
            "document_permission_denied",
            "Solo el emisor puede realizar esta acción.",
        )
    if document.version.id != body.version_id:
        raise ServiceError(409, "document_conflict", "La versión del documento cambió.")
    allowed = (
        document.document.can_request_approval if review else document.document.can_send
    )
    # Repetir una confirmación tras una respuesta perdida es seguro e idempotente.
    retry = document.document.workflow_state == (
        "pending_approval" if review else "sent"
    )
    if not allowed and not retry:
        raise ServiceError(
            409,
            "document_conflict",
            "Faltan firmas o la acción no corresponde a esta etapa.",
        )
    data = await stored_bytes(gateway, document)
    await check_signatures(document, data)
    operation = (
        "server_request_memorandum_review" if review else "server_send_memorandum"
    )
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/" + operation,
        body={
            "p_actor": str(principal.access.profile.id),
            "p_document_id": str(document_id),
            "p_version_id": str(body.version_id),
        },
    )
    return await detail(gateway, principal, document_id)
