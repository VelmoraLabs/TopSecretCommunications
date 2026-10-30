"""SQL autoriza y fija snapshots; Storage conserva únicamente el ciphertext.

La transacción SQL no abarca Storage. Una carga incompleta se cancela y se
intenta retirar su objeto; un resultado de publicación perdido nunca autoriza
a borrar un expediente listo. La API HTTP se incorporará en el siguiente paso.
"""

import base64
import logging
from uuid import UUID, uuid4

from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.crypto.signatures.rsa_pss import sha256
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal
from app.modules.encryption_keys.service import get_key
from app.modules.memoranda.service import content, read
from app.modules.personnel_files.schemas import (
    CreatePersonnelFile,
    OpenPersonnelFile,
    PersonnelDetail,
    PersonnelDownload,
    PersonnelMaterial,
    PersonnelPage,
    PersonnelReservation,
    ProtectedPersonnelFile,
)
from app.modules.personnel_files.service import open_file, protect_file, require_access

logger = logging.getLogger(__name__)


def storage_path(document_id: UUID, version_id: UUID) -> str:
    return (
        "/storage/v1/object/stc-documents/personnel-files/"
        f"{document_id}/{version_id}/ciphertext"
    )


async def detail(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID
) -> PersonnelDetail:
    require_access(principal, "documents.read_assigned")
    result = await read(
        gateway,
        principal,
        "get_personnel_file",
        {"p_document_id": str(document_id)},
        PersonnelDetail,
    )
    if result.file.id != document_id:
        raise ServiceError(
            503, "invalid_personnel_response", "No se pudo consultar el expediente."
        )
    return result


async def list_files(
    gateway: SupabaseGateway,
    principal: Principal,
    *,
    search: str = "",
    limit: int = 20,
    offset: int = 0,
) -> PersonnelPage:
    require_access(principal, "documents.read_assigned")
    return await read(
        gateway,
        principal,
        "list_personnel_files",
        {"p_search": search, "p_limit": limit, "p_offset": offset},
        PersonnelPage,
    )


async def _abort(
    gateway: SupabaseGateway, actor: UUID, document_id: UUID, version_id: UUID
) -> None:
    result = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_cancel_personnel_file",
        body={
            "p_actor": str(actor),
            "p_document_id": str(document_id),
            "p_version_id": str(version_id),
        },
    )
    # Solo una confirmación explícita permite borrar el objeto. False significa
    # que podría haberse publicado antes de perderse la respuesta HTTP.
    if result.json() is True:
        await gateway.server_request("DELETE", storage_path(document_id, version_id))


async def cancel(
    gateway: SupabaseGateway, principal: Principal, document_id: UUID
) -> PersonnelDetail:
    require_access(principal, "documents.create")
    current = await detail(gateway, principal, document_id)
    if current.file.created_by != principal.access.profile.id:
        raise ServiceError(
            403, "personnel_permission_denied", "Solo cancela su creador."
        )
    if current.file.state == "ready":
        raise ServiceError(
            409, "personnel_conflict", "El expediente ya está publicado."
        )
    try:
        await _abort(
            gateway, principal.access.profile.id, document_id, current.file.version_id
        )
    except ServiceError:
        # El estado de la base es la autoridad. Un objeto huérfano sigue privado;
        # puede conciliarse después sin volver a habilitar un expediente cancelado.
        logger.warning("No se pudo completar la limpieza de una carga de expediente.")
        raise
    return await detail(gateway, principal, document_id)


def _check_reservation(
    reserved: PersonnelReservation,
    principal: Principal,
    body: CreatePersonnelFile,
    document_id: UUID,
    version_id: UUID,
    size: int,
) -> None:
    record = reserved.detail.file
    actor = principal.access.profile.id
    expected = {item.profile_id for item in body.recipients} | {actor}
    assigned = {item.profile_id: item for item in reserved.detail.participants}
    if (
        record.id != document_id
        or record.version_id != version_id
        or record.created_by != actor
        or record.state != "staging"
        or (record.title, record.filename, record.media_type, record.size)
        != (body.title, body.filename, body.media_type, size)
        or set(assigned) != expected
        or len(assigned) != len(reserved.detail.participants)
        or len(reserved.keys) != len(assigned)
    ):
        raise ValueError("Reserva incompatible.")
    for key in reserved.keys:
        person = assigned.get(key.profile_id)
        if (
            person is None
            or not person.is_active
            or person.key_id != key.id
            or person.fingerprint != key.fingerprint
        ):
            raise ValueError("Asignación de clave inconsistente.")


async def create(
    gateway: SupabaseGateway, principal: Principal, body: CreatePersonnelFile
) -> PersonnelDetail:
    require_access(principal, "documents.create")
    require_access(principal, "documents.read_assigned")
    size = len(content(body.content_base64))
    actor = principal.access.profile.id
    document_id, version_id = uuid4(), uuid4()
    try:
        response = await gateway.server_request(
            "POST",
            "/rest/v1/rpc/server_begin_personnel_file",
            body={
                "p_actor": str(actor),
                "p_document_id": str(document_id),
                "p_version_id": str(version_id),
                "p_title": body.title,
                "p_filename": body.filename,
                "p_media_type": body.media_type,
                "p_size": size,
                "p_recipients": [
                    item.model_dump(mode="json") for item in body.recipients
                ],
            },
        )
        reserved = PersonnelReservation.model_validate(response.json())
        _check_reservation(reserved, principal, body, document_id, version_id, size)
        protected = await run_in_threadpool(
            protect_file,
            principal,
            body,
            reserved.keys,
            document_id=document_id,
            version_id=version_id,
        )
        ciphertext = base64.b64decode(protected.ciphertext_base64, validate=True)
        await gateway.server_request(
            "POST", storage_path(document_id, version_id), content=ciphertext
        )
        await gateway.server_request(
            "POST",
            "/rest/v1/rpc/server_commit_personnel_file",
            body={
                "p_actor": str(actor),
                "p_document_id": str(document_id),
                "p_version_id": str(version_id),
                "p_header": protected.header.model_dump(mode="json"),
                "p_nonce_base64": protected.nonce_base64,
                "p_tag_base64": protected.tag_base64,
                "p_ciphertext_sha256": sha256(ciphertext).hex(),
            },
        )
    except (ServiceError, ValueError) as exc:
        try:
            await _abort(gateway, actor, document_id, version_id)
        except (ServiceError, ValueError) as _cleanup_error:
            logger.warning("Quedó pendiente conciliar una carga privada de expediente.")
        if isinstance(exc, ServiceError):
            raise
        raise ServiceError(
            503,
            "invalid_personnel_response",
            "No se pudo preparar el expediente. "
            "Actualiza la lista antes de reintentar.",
        ) from exc
    return await detail(gateway, principal, document_id)


async def download(
    gateway: SupabaseGateway,
    principal: Principal,
    document_id: UUID,
    body: OpenPersonnelFile,
) -> PersonnelDownload:
    require_access(principal, "documents.read_assigned")
    actor = principal.access.profile.id
    response = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_personnel_file_material",
        body={"p_actor": str(actor), "p_document_id": str(document_id)},
    )
    try:
        material = PersonnelMaterial.model_validate(response.json())
        record = material.detail.file
        if (
            record.id != document_id
            or record.state != "ready"
            or material.header.document_id != document_id
            or material.header.version_id != record.version_id
            or material.header.created_by != record.created_by
            or (
                material.header.title,
                material.header.filename,
                material.header.media_type,
                material.header.size,
            )
            != (record.title, record.filename, record.media_type, record.size)
        ):
            raise ValueError("Material incompatible.")
    except ValueError as exc:
        raise ServiceError(
            503, "invalid_personnel_response", "No se pudo consultar el expediente."
        ) from exc
    key = await get_key(gateway, principal, body.key_id)
    stored = await gateway.server_request(
        "GET", storage_path(document_id, record.version_id)
    )
    if len(stored.content) != record.size or (
        sha256(stored.content).hex() != material.ciphertext_sha256
    ):
        raise ServiceError(
            422, "personnel_storage_integrity", "El archivo almacenado no coincide."
        )
    protected = ProtectedPersonnelFile(
        header=material.header,
        nonce_base64=material.nonce_base64,
        tag_base64=material.tag_base64,
        ciphertext_base64=base64.b64encode(stored.content).decode("ascii"),
    )
    data = await run_in_threadpool(open_file, principal, protected, key, body)
    # SQL vuelve a consultar permiso, estado, asignación y versión después del
    # descifrado. Si cambiaron durante la operación, no se entrega plaintext.
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_complete_personnel_download",
        body={
            "p_actor": str(actor),
            "p_document_id": str(document_id),
            "p_version_id": str(record.version_id),
            "p_ciphertext_sha256": material.ciphertext_sha256,
        },
    )
    return PersonnelDownload(
        filename=record.filename,
        media_type=record.media_type,
        size=len(data),
        content_base64=base64.b64encode(data).decode("ascii"),
    )
