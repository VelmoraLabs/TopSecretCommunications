"""Snapshot, Storage privado y sobres individuales; conserva notas portables."""

import base64
from uuid import UUID

from pydantic import Field
from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.crypto.key_wrapping.share_envelope import (
    EnvelopeContext,
    ShareEnvelope,
    open_share,
    seal_share,
)
from app.crypto.shamir import deserialize_share
from app.crypto.signatures import key_files
from app.crypto.signatures.rsa_pss import sha256
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal
from app.modules.documents.schemas import NotePackage, ProtectRequest
from app.modules.documents.service import protect_note
from app.modules.encryption_keys.schemas import EncryptionKey, PrivateKeyInput
from app.modules.encryption_keys.service import get_key, matching_private
from app.modules.group_notes.schemas import (
    ConfirmBackup,
    CreateGroupNote,
    NoteDetail,
    ShareCheck,
)
from app.modules.memoranda.schemas import Contract
from app.modules.memoranda.service import content, read


class Reservation(Contract):
    detail: NoteDetail
    keys: list[EncryptionKey] = Field(min_length=2, max_length=20)


def storage_path(note_id: UUID) -> str:
    return f"/storage/v1/object/stc-documents/special-notes/{note_id}/ciphertext"


async def detail(
    gateway: SupabaseGateway, principal: Principal, note_id: UUID
) -> NoteDetail:
    return await read(
        gateway, principal, "get_group_note", {"p_note_id": str(note_id)}, NoteDetail
    )


async def cancel(
    gateway: SupabaseGateway, actor: str, note_id: UUID, *, staging_only: bool = False
) -> None:
    result = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_cancel_group_note",
        body={
            "p_actor": actor,
            "p_note_id": str(note_id),
            "p_staging_only": staging_only,
        },
    )
    if result.json() is True:
        try:
            await gateway.server_request("DELETE", storage_path(note_id))
        except ServiceError:
            # Nunca visible tras cancelarse. Conciliación de objetos privados en docs.
            pass


def encrypt_for_participants(
    body: CreateGroupNote, reserved: Reservation
) -> tuple[NotePackage, list[ShareEnvelope]]:
    n = reserved.detail.note.participant_count
    if (
        reserved.detail.note.id != body.request_id
        or reserved.detail.note.custody_mode != "individual-v1"
        or len(reserved.detail.participants) != n
        or len(reserved.keys) != n
        or sorted(p.share_index for p in reserved.detail.participants)
        != list(range(1, n + 1))
    ):
        raise ValueError("Snapshot inválido.")
    protected = protect_note(
        ProtectRequest(
            filename=body.filename,
            media_type=body.media_type,
            content_base64=body.content_base64,
            share_count=n,
            threshold=n,
        )
    )
    envelopes = []
    keys = {key.id: key for key in reserved.keys}
    if len(keys) != n:
        raise ValueError("Claves repetidas.")
    for participant in reserved.detail.participants:
        key = (
            keys.get(participant.encryption_key_id)
            if participant.encryption_key_id
            else None
        )
        if (
            key is None
            or key.profile_id != participant.profile_id
            or key.state != "active"
            or key.fingerprint != participant.encryption_fingerprint
        ):
            raise ValueError("Asignación de clave inválida.")
        public = key_files.load_public(key.public_base64)
        if sha256(key_files.public_bytes(public)).hex() != key.fingerprint:
            raise ValueError("Huella de clave inválida.")
        envelopes.append(
            seal_share(
                deserialize_share(protected.shares[participant.share_index - 1]),
                public,
                EnvelopeContext(
                    note_id=body.request_id,
                    set_id=protected.package.document_id,
                    recipient_id=participant.profile_id,
                    key_id=key.id,
                    fingerprint=key.fingerprint,
                    share_index=participant.share_index,
                    share_count=n,
                    threshold=n,
                ),
            )
        )
    # El servicio HTTP recibe únicamente sobres, cabecera y ciphertext; no comparte
    # los fragmentos serializados ni la clave del documento con el creador.
    return protected.package, envelopes


async def create(
    gateway: SupabaseGateway, principal: Principal, body: CreateGroupNote
) -> NoteDetail:
    data = content(body.content_base64)
    actor = str(principal.access.profile.id)
    result = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_begin_distributed_note",
        body={
            "p_actor": actor,
            "p_note_id": str(body.request_id),
            "p_group_id": str(body.group_id),
            "p_expected_version": body.group_version,
            "p_title": body.title,
            "p_filename": body.filename,
            "p_media_type": body.media_type,
            "p_size": len(data),
        },
    )
    try:
        reserved = Reservation.model_validate(result.json())
        protected, envelopes = await run_in_threadpool(
            encrypt_for_participants, body, reserved
        )
        ciphertext = base64.b64decode(protected.ciphertext_base64, validate=True)
        await gateway.server_request(
            "POST", storage_path(body.request_id), content=ciphertext
        )
        await gateway.server_request(
            "POST",
            "/rest/v1/rpc/server_commit_distributed_note",
            body={
                "p_actor": actor,
                "p_note_id": str(body.request_id),
                "p_header": protected.model_dump(exclude={"ciphertext_base64"}),
                "p_ciphertext_sha256": sha256(ciphertext).hex(),
                "p_envelopes": [
                    envelope.model_dump(mode="json") for envelope in envelopes
                ],
            },
        )
    except (ServiceError, ValueError) as exc:
        try:
            # Si la publicación se confirmó y se perdió la respuesta, no borrarla.
            await cancel(gateway, actor, body.request_id, staging_only=True)
        except (ServiceError, ValueError) as _cleanup_error:
            pass
        if isinstance(exc, ServiceError):
            raise
        raise ServiceError(
            503,
            "invalid_note_response",
            "No se pudo preparar la nota. Actualiza la lista antes de reintentar.",
        ) from exc
    return await detail(gateway, principal, body.request_id)


async def own_share(
    gateway: SupabaseGateway, principal: Principal, note_id: UUID
) -> ShareEnvelope:
    return await read(
        gateway,
        principal,
        "get_own_note_share",
        {"p_note_id": str(note_id)},
        ShareEnvelope,
    )


async def check_share(
    gateway: SupabaseGateway, principal: Principal, note_id: UUID, body: PrivateKeyInput
) -> ShareCheck:
    current = await detail(gateway, principal, note_id)
    assigned = next(
        (
            p
            for p in current.participants
            if p.profile_id == principal.access.profile.id
        ),
        None,
    )
    if (
        assigned is None
        or assigned.encryption_key_id is None
        or current.package_header is None
    ):
        raise ServiceError(
            404, "share_not_found", "No tienes un fragmento individual en esta nota."
        )
    envelope = await own_share(gateway, principal, note_id)
    key = await get_key(gateway, principal, assigned.encryption_key_id)
    private = await run_in_threadpool(
        matching_private, key.public_base64, key.fingerprint, body
    )
    expected = EnvelopeContext(
        note_id=note_id,
        set_id=current.package_header.document_id,
        recipient_id=assigned.profile_id,
        key_id=key.id,
        fingerprint=key.fingerprint,
        share_index=assigned.share_index,
        threshold=current.note.threshold,
        share_count=current.note.participant_count,
    )
    try:
        await run_in_threadpool(open_share, envelope, private, expected)
    except ValueError as exc:
        raise ServiceError(
            422,
            "share_integrity_failed",
            "No se pudo autenticar tu fragmento. "
            "Revisa la clave o contacta al responsable.",
        ) from exc
    return ShareCheck(note_id=note_id, key_id=key.id, share_index=assigned.share_index)


async def confirm(
    gateway: SupabaseGateway, principal: Principal, note_id: UUID, body: ConfirmBackup
) -> NoteDetail:
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_confirm_group_note",
        body={
            "p_actor": str(principal.access.profile.id),
            "p_note_id": str(note_id),
            "p_receipt_sha256": sha256(
                body.backup_receipt.get_secret_value().encode("ascii")
            ).hex(),
        },
    )
    return await detail(gateway, principal, note_id)


async def package(
    gateway: SupabaseGateway, principal: Principal, note_id: UUID
) -> NotePackage:
    current = await detail(gateway, principal, note_id)
    if (
        current.note.state not in ("awaiting_backup", "ready")
        or current.package_header is None
    ):
        raise ServiceError(
            409, "note_not_ready", "La nota no tiene un paquete disponible."
        )
    response = await gateway.server_request("GET", storage_path(note_id))
    ciphertext = response.content
    if (
        len(ciphertext) != current.note.size
        or sha256(ciphertext).hex() != current.ciphertext_sha256
    ):
        raise ServiceError(
            422,
            "note_storage_integrity",
            "El paquete almacenado no coincide con el registrado. "
            "Contacta al responsable.",
        )
    return NotePackage(
        **current.package_header.model_dump(),
        ciphertext_base64=base64.b64encode(ciphertext).decode("ascii"),
    )
