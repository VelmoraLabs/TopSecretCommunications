"""Firma, cifrado y apertura en memoria; todavía sin HTTP, SQL ni Storage.

El servidor debe obtener Principal y snapshots de claves desde autorización y
persistencia. Este servicio no convierte un paquete aportado por el cliente en
un documento confiable. La entrega futura revalidará permisos y versión en SQL.
"""

import base64
import json
from collections.abc import Sequence
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.errors import ServiceError
from app.crypto.encryption import aes_gcm
from app.crypto.key_wrapping import rsa_oaep
from app.crypto.signatures import key_files, rsa_pss
from app.modules.auth.service import Principal
from app.modules.diplomatic_notes.schemas import (
    CreateDiplomaticNote,
    DiplomaticHeader,
    OpenDiplomaticNote,
    ProtectedDiplomaticNote,
    RegisteredSigningKey,
)
from app.modules.documents.service import decode_base64
from app.modules.encryption_keys.schemas import EncryptionKey
from app.modules.encryption_keys.service import matching_private
from app.modules.memoranda.schemas import SignInput
from app.modules.memoranda.service import content, make_signature
from app.modules.personnel_files.schemas import RecipientEnvelope
from app.modules.personnel_files.service import require_access

SIGNING_DOMAIN = b"STC:DIPLOMATIC:SIGNED-CONTENT:v1\x00"


def canonical_header(header: DiplomaticHeader) -> bytes:
    return json.dumps(
        header.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")


def signing_message(header: DiplomaticHeader, data: bytes) -> bytes:
    """RSA-PSS recibe este mensaje, no su digest; SHA-256 se aplica una vez.

    El dominio y la longitud separan cabecera y archivo sin ambigüedad. La firma
    vincula emisor, tipo, documento, versión, metadatos y sobres al contenido.
    """
    encoded = canonical_header(header)
    return SIGNING_DOMAIN + len(encoded).to_bytes(8, "big") + encoded + data


def associated_data(header: DiplomaticHeader, signature_base64: str) -> bytes:
    """GCM autentica tanto la cabecera firmada como su firma separada."""
    return canonical_header(header) + b"\x00" + signature_base64.encode("ascii")


def signing_public(key: RegisteredSigningKey) -> rsa.RSAPublicKey:
    try:
        public = key_files.load_public(key.public_base64)
        if rsa_pss.sha256(key_files.public_bytes(public)).hex() != key.fingerprint:
            raise ValueError("Huella inconsistente.")
        return public
    except ValueError as exc:
        raise ServiceError(
            503,
            "invalid_diplomatic_signing_key",
            "No se pudo validar la clave de firma registrada.",
        ) from exc


def recipient_public_keys(
    principal: Principal,
    body: CreateDiplomaticNote,
    keys: Sequence[EncryptionKey],
    signing_key: RegisteredSigningKey,
) -> dict[UUID, rsa.RSAPublicKey]:
    expected = {r.profile_id for r in body.recipients} | {principal.access.profile.id}
    if (
        len({key.profile_id for key in keys}) != len(keys)
        or {key.profile_id for key in keys} != expected
    ):
        raise ServiceError(
            409,
            "diplomatic_keys_incomplete",
            "Se requiere una clave de cifrado por destinatario y para el emisor.",
        )
    if any(key.state != "active" for key in keys):
        raise ServiceError(
            409,
            "diplomatic_key_not_active",
            "Todos los participantes necesitan una clave de cifrado activa.",
        )
    if (
        len({key.id for key in keys}) != len(keys)
        or len({key.fingerprint for key in keys}) != len(keys)
        or signing_key.id in {key.id for key in keys}
        or signing_key.fingerprint in {key.fingerprint for key in keys}
    ):
        raise ServiceError(
            409,
            "diplomatic_keys_repeated",
            "Usa claves distintas por perfil y separa firma de cifrado.",
        )
    result: dict[UUID, rsa.RSAPublicKey] = {}
    try:
        for key in keys:
            public = key_files.load_public(key.public_base64)
            if rsa_pss.sha256(key_files.public_bytes(public)).hex() != key.fingerprint:
                raise ValueError("Clave registrada inconsistente.")
            result[key.profile_id] = public
    except ValueError as exc:
        raise ServiceError(
            503,
            "invalid_diplomatic_encryption_key",
            "No se pudo validar una clave de cifrado registrada.",
        ) from exc
    return result


def protect_note(
    principal: Principal,
    body: CreateDiplomaticNote,
    recipient_keys: Sequence[EncryptionKey],
    signing_key: RegisteredSigningKey,
    *,
    document_id: UUID,
    version_id: UUID,
) -> ProtectedDiplomaticNote:
    """Firma del emisor y una AES nueva; no conserva privadas ni contraseñas."""
    for permission in ("documents.create", "documents.read_assigned", "documents.sign"):
        require_access(principal, permission)
    actor = principal.access.profile.id
    if (
        signing_key.id != body.signing_key_id
        or signing_key.profile_id != actor
        or not signing_key.is_active
    ):
        raise ServiceError(
            422,
            "diplomatic_signing_key_mismatch",
            "Selecciona una clave de firma activa de tu propio perfil.",
        )
    signing_public(signing_key)
    public_keys = recipient_public_keys(principal, body, recipient_keys, signing_key)
    data = content(body.content_base64)
    aes_key = aes_gcm.generate_key()
    by_profile = {key.profile_id: key for key in recipient_keys}
    envelopes = tuple(
        RecipientEnvelope(
            profile_id=profile_id,
            key_id=by_profile[profile_id].id,
            fingerprint=by_profile[profile_id].fingerprint,
            wrapped_key_base64=base64.b64encode(
                rsa_oaep.wrap_key(aes_key, public_keys[profile_id])
            ).decode("ascii"),
        )
        for profile_id in sorted(by_profile)
    )
    header = DiplomaticHeader(
        kind=body.kind,
        document_id=document_id,
        version_id=version_id,
        created_by=actor,
        title=body.title,
        filename=body.filename,
        media_type=body.media_type,
        size=len(data),
        signing_key_id=signing_key.id,
        signing_fingerprint=signing_key.fingerprint,
        envelopes=envelopes,
    )
    credentials = SignInput(
        key_id=signing_key.id,
        version_id=header.version_id,
        private_key_base64=body.private_key_base64,
        password=body.password,
    )
    signature = base64.b64encode(
        make_signature(
            credentials, signing_key.public_base64, signing_message(header, data)
        )
    ).decode("ascii")
    encrypted = aes_gcm.encrypt(data, aes_key, associated_data(header, signature))
    return ProtectedDiplomaticNote(
        header=header,
        signature_base64=signature,
        nonce_base64=base64.b64encode(encrypted.nonce).decode("ascii"),
        ciphertext_base64=base64.b64encode(encrypted.ciphertext).decode("ascii"),
        tag_base64=base64.b64encode(encrypted.tag).decode("ascii"),
    )


def open_note(
    principal: Principal,
    protected: ProtectedDiplomaticNote,
    encryption_key: EncryptionKey,
    signing_key: RegisteredSigningKey,
    body: OpenDiplomaticNote,
) -> bytes:
    """Solo entrega bytes si GCM y RSA-PSS validan; acepta claves históricas."""
    require_access(principal, "documents.read_assigned")
    header = protected.header
    actor = principal.access.profile.id
    assigned = next(
        (item for item in header.envelopes if item.profile_id == actor), None
    )
    if assigned is None:
        raise ServiceError(
            404, "diplomatic_note_not_found", "La nota no está disponible."
        )
    if body.version_id != header.version_id:
        raise ServiceError(
            409, "diplomatic_version_changed", "Actualiza la nota y reintenta."
        )
    if (
        body.key_id != assigned.key_id
        or encryption_key.id != assigned.key_id
        or encryption_key.profile_id != actor
        or encryption_key.fingerprint != assigned.fingerprint
        or encryption_key.state not in {"active", "retired"}
    ):
        raise ServiceError(
            422,
            "diplomatic_encryption_key_mismatch",
            "Selecciona la clave original asignada a esta versión de la nota.",
        )
    if (
        signing_key.id != header.signing_key_id
        or signing_key.profile_id != header.created_by
        or signing_key.fingerprint != header.signing_fingerprint
    ):
        raise ServiceError(
            422,
            "diplomatic_signing_key_mismatch",
            "La firma no corresponde al emisor y la clave originales.",
        )
    public = signing_public(signing_key)
    private = matching_private(
        encryption_key.public_base64, encryption_key.fingerprint, body
    )
    try:
        aes_key = rsa_oaep.unwrap_key(
            decode_base64(assigned.wrapped_key_base64), private
        )
        data = aes_gcm.decrypt(
            aes_gcm.EncryptedData(
                nonce=decode_base64(protected.nonce_base64),
                ciphertext=decode_base64(protected.ciphertext_base64),
                tag=decode_base64(protected.tag_base64),
            ),
            aes_key,
            associated_data(header, protected.signature_base64),
        )
        if not rsa_pss.verify(
            signing_message(header, data),
            decode_base64(protected.signature_base64),
            public,
        ):
            raise ValueError("Firma inválida.")
    except ValueError as exc:
        raise ServiceError(
            422,
            "diplomatic_integrity_failed",
            "No se pudo autenticar la nota y comprobar su firma. "
            "No se entregó el archivo.",
        ) from exc
    return data
