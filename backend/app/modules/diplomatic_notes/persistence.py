"""Publicación firmada y cifrada; SQL autoriza y Storage guarda solo ciphertext.

Una respuesta perdida nunca permite borrar un documento ya publicado. La
entrega revalida acceso en SQL después de comprobar GCM y firma en memoria.
Este bloque no expone todavía rutas HTTP.
"""

import base64
import logging
from uuid import UUID, uuid4

from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.crypto.signatures.rsa_pss import sha256
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal
from app.modules.diplomatic_notes.schemas import (
    CreateDiplomaticNote,
    DiplomaticDetail,
    DiplomaticDownload,
    DiplomaticMaterial,
    DiplomaticPage,
    DiplomaticReservation,
    OpenDiplomaticNote,
    ProtectedDiplomaticNote,
)
from app.modules.diplomatic_notes.service import open_note, protect_note
from app.modules.encryption_keys.service import get_key
from app.modules.memoranda.service import content, read
from app.modules.personnel_files.service import require_access

logger = logging.getLogger(__name__)


def storage_path(document_id: UUID, version_id: UUID) -> str:
    return (
        "/storage/v1/object/stc-documents/diplomatic-notes/"
        f"{document_id}/{version_id}/ciphertext"
    )


async def detail(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID
) -> DiplomaticDetail:
    require_access(principal, "documents.read_assigned")
    result = await read(
        gateway,
        principal,
        "get_diplomatic_note",
        {"p_document_id": str(document_id)},
        DiplomaticDetail,
    )
    if result.file.id != document_id:
        raise ServiceError(
            503, "invalid_diplomatic_response", "No se pudo consultar la nota."
        )
    return result


async def list_notes(
    gateway: SupabaseGateway,
    principal: Principal,
    *,
    search: str = "",
    kind: str = "all",
    limit: int = 20,
    offset: int = 0,
) -> DiplomaticPage:
    require_access(principal, "documents.read_assigned")
    return await read(
        gateway,
        principal,
        "list_diplomatic_notes",
        {"p_search": search, "p_kind": kind, "p_limit": limit, "p_offset": offset},
        DiplomaticPage,
    )


async def _abort(
    gateway: SupabaseGateway, actor: UUID, document_id: UUID, version_id: UUID
) -> None:
    response = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_cancel_diplomatic_note",
        body={
            "p_actor": str(actor),
            "p_document_id": str(document_id),
            "p_version_id": str(version_id),
        },
    )
    if response.json() is True:
        await gateway.server_request("DELETE", storage_path(document_id, version_id))


async def cancel(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID
) -> DiplomaticDetail:
    require_access(principal, "documents.create")
    current = await detail(gateway, principal, document_id)
    if current.file.created_by != principal.access.profile.id:
        raise ServiceError(
            403, "diplomatic_permission_denied", "Solo cancela su creador."
        )
    if current.file.state == "ready":
        raise ServiceError(409, "diplomatic_conflict", "La nota ya está publicada.")
    await _abort(
        gateway, principal.access.profile.id, document_id, current.file.version_id
    )
    return await detail(gateway, principal, document_id)


def _check_reservation(
    reserved: DiplomaticReservation,
    principal: Principal,
    body: CreateDiplomaticNote,
    document_id: UUID,
    version_id: UUID,
    size: int,
) -> None:
    record = reserved.detail.file
    actor = principal.access.profile.id
    expected = {item.profile_id for item in body.recipients} | {actor}
    assigned = {item.profile_id: item for item in reserved.detail.participants}
    signer = reserved.signing_key
    if (
        record.id != document_id
        or record.version_id != version_id
        or record.created_by != actor
        or record.state != "staging"
        or (record.title, record.filename, record.media_type, record.size, record.kind)
        != (body.title, body.filename, body.media_type, size, body.kind)
        or record.signing_key_id != body.signing_key_id
        or set(assigned) != expected
        or len(reserved.keys) != len(assigned)
        or signer.id != record.signing_key_id
        or signer.profile_id != actor
        or not signer.is_active
        or reserved.detail.signer.fingerprint != signer.fingerprint
        or reserved.detail.signer.is_active != signer.is_active
    ):
        raise ValueError("Reserva incompatible.")
    for key in reserved.keys:
        person = assigned.get(key.profile_id)
        if (
            person is None
            or not person.is_active
            or (person.key_id, person.fingerprint) != (key.id, key.fingerprint)
        ):
            raise ValueError("Asignación de clave inconsistente.")


async def create(
    gateway: SupabaseGateway, principal: Principal, body: CreateDiplomaticNote
) -> DiplomaticDetail:
    for permission in ("documents.create", "documents.read_assigned", "documents.sign"):
        require_access(principal, permission)
    size = len(content(body.content_base64))
    actor = principal.access.profile.id
    document_id, version_id = uuid4(), uuid4()
    identity = {
        "p_actor": str(actor),
        "p_document_id": str(document_id),
        "p_version_id": str(version_id),
    }
    try:
        response = await gateway.server_request(
            "POST",
            "/rest/v1/rpc/server_begin_diplomatic_note",
            body={
                **identity,
                "p_kind": body.kind,
                "p_title": body.title,
                "p_filename": body.filename,
                "p_media_type": body.media_type,
                "p_size": size,
                "p_signing_key_id": str(body.signing_key_id),
                "p_recipients": [
                    item.model_dump(mode="json") for item in body.recipients
                ],
            },
        )
        reserved = DiplomaticReservation.model_validate(response.json())
        _check_reservation(reserved, principal, body, document_id, version_id, size)
        protected = await run_in_threadpool(
            protect_note,
            principal,
            body,
            reserved.keys,
            reserved.signing_key,
            document_id=document_id,
            version_id=version_id,
        )
        ciphertext = base64.b64decode(protected.ciphertext_base64, validate=True)
        await gateway.server_request(
            "POST", storage_path(document_id, version_id), content=ciphertext
        )
        await gateway.server_request(
            "POST",
            "/rest/v1/rpc/server_commit_diplomatic_note",
            body={
                **identity,
                "p_header": protected.header.model_dump(mode="json"),
                "p_signature_base64": protected.signature_base64,
                "p_nonce_base64": protected.nonce_base64,
                "p_tag_base64": protected.tag_base64,
                "p_ciphertext_sha256": sha256(ciphertext).hex(),
            },
        )
    except (ServiceError, ValueError) as exc:
        try:
            await _abort(gateway, actor, document_id, version_id)
        except (ServiceError, ValueError) as _cleanup_error:
            logger.warning("Quedó pendiente conciliar una carga privada de nota.")
        if isinstance(exc, ServiceError):
            raise
        raise ServiceError(
            503,
            "invalid_diplomatic_response",
            "No se pudo preparar la nota. Actualiza la lista antes de reintentar.",
        ) from exc
    return await detail(gateway, principal, document_id)


def _check_material(material: DiplomaticMaterial, document_id: UUID) -> None:
    record, header, signer = material.detail.file, material.header, material.signing_key
    people = material.detail.participants
    if (
        record.id != document_id
        or record.state != "ready"
        or header.document_id != document_id
        or header.version_id != record.version_id
        or header.created_by != record.created_by
        or (header.title, header.filename, header.media_type, header.size, header.kind)
        != (record.title, record.filename, record.media_type, record.size, record.kind)
        or header.signing_key_id != record.signing_key_id
        or signer.id != header.signing_key_id
        or signer.profile_id != header.created_by
        or signer.fingerprint != header.signing_fingerprint
        or material.detail.signer.fingerprint != signer.fingerprint
        or material.detail.signer.is_active != signer.is_active
        or {(p.profile_id, p.key_id, p.fingerprint) for p in people}
        != {(e.profile_id, e.key_id, e.fingerprint) for e in header.envelopes}
    ):
        raise ValueError("Material incompatible.")


async def download(
    gateway: SupabaseGateway,
    principal: Principal,
    document_id: UUID,
    body: OpenDiplomaticNote,
) -> DiplomaticDownload:
    require_access(principal, "documents.read_assigned")
    actor = principal.access.profile.id
    response = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_diplomatic_note_material",
        body={"p_actor": str(actor), "p_document_id": str(document_id)},
    )
    try:
        material = DiplomaticMaterial.model_validate(response.json())
        _check_material(material, document_id)
    except ValueError as exc:
        raise ServiceError(
            503, "invalid_diplomatic_response", "No se pudo consultar la nota."
        ) from exc
    record = material.detail.file
    if body.version_id != record.version_id:
        raise ServiceError(
            409, "diplomatic_version_changed", "Actualiza la nota y reintenta."
        )
    assigned = next(
        (p for p in material.detail.participants if p.profile_id == actor), None
    )
    if assigned is None:
        raise ServiceError(
            404, "diplomatic_note_not_found", "La nota no está disponible."
        )
    if assigned.key_id != body.key_id:
        raise ServiceError(
            422,
            "diplomatic_encryption_key_mismatch",
            "Selecciona la clave original de esta nota.",
        )
    key = await get_key(gateway, principal, body.key_id)
    stored = await gateway.server_request(
        "GET", storage_path(document_id, record.version_id)
    )
    if (
        len(stored.content) != record.size
        or sha256(stored.content).hex() != material.ciphertext_sha256
    ):
        raise ServiceError(
            422, "diplomatic_storage_integrity", "El archivo almacenado no coincide."
        )
    protected = ProtectedDiplomaticNote(
        header=material.header,
        signature_base64=material.signature_base64,
        nonce_base64=material.nonce_base64,
        tag_base64=material.tag_base64,
        ciphertext_base64=base64.b64encode(stored.content).decode("ascii"),
    )
    data = await run_in_threadpool(
        open_note, principal, protected, key, material.signing_key, body
    )
    # Revalida acceso y estado después del descifrado y de verificar la firma.
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_complete_diplomatic_download",
        body={
            "p_actor": str(actor),
            "p_document_id": str(document_id),
            "p_version_id": str(record.version_id),
            "p_ciphertext_sha256": material.ciphertext_sha256,
        },
    )
    return DiplomaticDownload(
        filename=record.filename,
        media_type=record.media_type,
        size=len(data),
        document_id=record.id,
        version_id=record.version_id,
        issuer_id=record.created_by,
        signing_key_id=record.signing_key_id,
        signing_fingerprint=material.signing_key.fingerprint,
        content_base64=base64.b64encode(data).decode("ascii"),
    )
