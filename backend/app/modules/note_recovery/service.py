"""Aportaciones cifradas al solicitante y reconstrucción n de n bajo autorización."""

import asyncio
import logging
from uuid import UUID

from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.crypto.key_wrapping.recovery_envelope import (
    ContributionContext,
    open_contribution,
    seal_contribution,
)
from app.crypto.key_wrapping.share_envelope import EnvelopeContext, open_share
from app.crypto.shamir import serialize_share
from app.crypto.signatures import key_files
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal
from app.modules.documents.schemas import NotePackage, RecoverRequest, RecoveryResult
from app.modules.documents.service import recover_note
from app.modules.encryption_keys.schemas import PrivateKeyInput
from app.modules.encryption_keys.service import get_key, matching_private
from app.modules.group_notes import service as notes
from app.modules.memoranda.service import read
from app.modules.note_recovery.schemas import RecoveryDetail, RecoveryMaterial

logger = logging.getLogger(__name__)


async def detail(
    gateway: SupabaseGateway, principal: Principal, request_id: UUID
) -> RecoveryDetail:
    return await read(
        gateway,
        principal,
        "get_note_recovery",
        {"p_request_id": str(request_id)},
        RecoveryDetail,
    )


def contribution_context(
    current: RecoveryDetail, set_id: str, contributor: UUID, index: int
) -> ContributionContext:
    return ContributionContext(
        request_id=current.recovery.id,
        note_id=current.recovery.note_id,
        contributor_id=contributor,
        recipient_id=current.recovery.requester_id,
        key_id=current.requester_key.id,
        fingerprint=current.requester_key.fingerprint,
        set_id=set_id,
        share_index=index,
        share_count=current.recovery.participant_count,
        threshold=current.recovery.participant_count,
    )


async def contribute(
    gateway: SupabaseGateway,
    principal: Principal,
    request_id: UUID,
    body: PrivateKeyInput,
) -> RecoveryDetail:
    current = await detail(gateway, principal, request_id)
    actor = principal.access.profile.id
    if current.recovery.state not in ("pending", "ready"):
        raise ServiceError(409, "recovery_closed", "La solicitud ya está cerrada.")
    note = await notes.detail(gateway, principal, current.recovery.note_id)
    assigned = next((p for p in note.participants if p.profile_id == actor), None)
    if (
        assigned is None
        or assigned.encryption_key_id is None
        or note.package_header is None
    ):
        raise ServiceError(
            404, "recovery_not_found", "No tienes un fragmento asignado."
        )
    sealed = await notes.own_share(gateway, principal, note.note.id)
    key = await get_key(gateway, principal, assigned.encryption_key_id)
    private = await run_in_threadpool(
        matching_private, key.public_base64, key.fingerprint, body
    )
    try:
        expected = EnvelopeContext(
            note_id=note.note.id,
            set_id=note.package_header.document_id,
            recipient_id=actor,
            key_id=key.id,
            fingerprint=key.fingerprint,
            share_index=assigned.share_index,
            threshold=note.note.threshold,
            share_count=note.note.participant_count,
        )
        share = await run_in_threadpool(open_share, sealed, private, expected)
        envelope = await run_in_threadpool(
            seal_contribution,
            share,
            key_files.load_public(current.requester_key.public_base64),
            contribution_context(
                current, note.package_header.document_id, actor, assigned.share_index
            ),
        )
    except ValueError as exc:
        raise ServiceError(
            422,
            "recovery_integrity_failed",
            "No se pudo autenticar tu fragmento para esta solicitud.",
        ) from exc
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_contribute_note_recovery",
        body={
            "p_actor": str(actor),
            "p_request_id": str(request_id),
            "p_envelope": envelope.model_dump(mode="json"),
        },
    )
    return await detail(gateway, principal, request_id)


def reconstruct(
    material: RecoveryMaterial, package: NotePackage, body: PrivateKeyInput
) -> RecoveryResult:
    current = material.detail
    private = matching_private(
        current.requester_key.public_base64, current.requester_key.fingerprint, body
    )
    expected = {p.profile_id: p for p in current.participants}
    if len(material.envelopes) != current.recovery.participant_count or len(
        expected
    ) != len(material.envelopes):
        raise ValueError("Aportaciones incompletas.")
    shares = []
    seen: set[UUID] = set()
    for envelope in material.envelopes:
        contributor = envelope.context.contributor_id
        participant = expected.get(contributor)
        if participant is None or contributor in seen:
            raise ValueError("Aportación repetida o ajena.")
        seen.add(contributor)
        context = contribution_context(
            current, package.document_id, contributor, participant.share_index
        )
        shares.append(serialize_share(open_contribution(envelope, private, context)))
    return recover_note(RecoverRequest(package=package, shares=shares))


async def recover(
    gateway: SupabaseGateway,
    principal: Principal,
    request_id: UUID,
    body: PrivateKeyInput,
) -> RecoveryResult:
    response = await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_note_recovery_material",
        body={
            "p_actor": str(principal.access.profile.id),
            "p_request_id": str(request_id),
        },
    )
    try:
        material = RecoveryMaterial.model_validate(response.json())
    except ValueError as exc:
        raise ServiceError(
            503, "invalid_recovery_response", "No se pudo consultar la recuperación."
        ) from exc
    if (
        material.detail.recovery.id != request_id
        or material.detail.recovery.requester_id != principal.access.profile.id
    ):
        raise ServiceError(
            403,
            "recovery_permission_denied",
            "Solo el solicitante puede recuperar esta nota.",
        )
    package = await notes.package(gateway, principal, material.detail.recovery.note_id)
    try:
        result = await run_in_threadpool(reconstruct, material, package, body)
    except ServiceError:
        raise
    except ValueError as exc:
        raise ServiceError(
            422,
            "recovery_integrity_failed",
            "No se pudo autenticar el documento y sus aportaciones. "
            "No se entregó el archivo.",
        ) from exc
    # Si alguien rechaza/cancela, vence el plazo o se desactiva un perfil mientras
    # desciframos, esta última comprobación impide entregar el resultado.
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_complete_note_recovery",
        body={
            "p_actor": str(principal.access.profile.id),
            "p_request_id": str(request_id),
            "p_expected_version": material.detail.recovery.version,
        },
    )
    return result


async def cleanup_loop(gateway: SupabaseGateway) -> None:
    while True:
        await asyncio.sleep(60)
        try:
            await gateway.server_request(
                "POST", "/rest/v1/rpc/server_cleanup_note_recoveries", body={}
            )
        except ServiceError:
            # Solo un mensaje fijo; no registrar credenciales, cuerpos ni fragmentos.
            logger.warning(
                "No se pudo completar la limpieza temporal de recuperaciones."
            )
