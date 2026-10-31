"""Preparación y apertura en memoria; todavía sin rutas ni escritura en Supabase.

Principal, claves y paquete deben proceder del servidor, no de un JSON público.
La integración SQL deberá resolver destinatarios activos y autorizados, reservar
la versión y volver a comprobar acceso antes de publicar o entregar el archivo.
Estas funciones síncronas se ejecutarán en un threadpool desde esa integración.
"""

import base64
import json
from collections.abc import Sequence
from uuid import UUID

from app.core.errors import ServiceError
from app.crypto.encryption import aes_gcm
from app.crypto.key_wrapping import rsa_oaep
from app.crypto.signatures import key_files
from app.crypto.signatures.rsa_pss import sha256
from app.modules.auth.service import Principal
from app.modules.documents.service import decode_base64
from app.modules.encryption_keys.schemas import EncryptionKey
from app.modules.encryption_keys.service import matching_private
from app.modules.memoranda.service import content
from app.modules.personnel_files.schemas import (
    CreatePersonnelFile,
    OpenPersonnelFile,
    PersonnelFileHeader,
    ProtectedPersonnelFile,
    RecipientEnvelope,
)


def require_access(principal: Principal, permission: str) -> None:
    if not principal.access.profile.is_active:
        raise ServiceError(403, "access_denied", "Tu perfil no está activo.")
    if permission not in principal.access.permissions:
        raise ServiceError(
            403, "permission_denied", "No tienes permiso para esta operación."
        )


def associated_data(header: PersonnelFileHeader) -> bytes:
    """Vincula documento, versión, metadatos y sobres al mismo tag de GCM."""
    return json.dumps(
        header.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")


def protect_file(
    principal: Principal,
    body: CreatePersonnelFile,
    recipient_keys: Sequence[EncryptionKey],
    *,
    document_id: UUID,
    version_id: UUID,
) -> ProtectedPersonnelFile:
    """Cifra una vez y protege la misma AES para cada destinatario y el creador.

    recipient_keys será el snapshot de claves de cifrado resuelto por PostgreSQL.
    No registra claves, no acepta públicas en CreatePersonnelFile y no persiste
    el contenido original ni la clave AES en el resultado.
    """
    require_access(principal, "documents.create")
    require_access(principal, "documents.read_assigned")
    creator = principal.access.profile.id
    expected = {item.profile_id for item in body.recipients} | {creator}
    by_profile = {key.profile_id: key for key in recipient_keys}
    if len(by_profile) != len(recipient_keys) or set(by_profile) != expected:
        raise ServiceError(
            409,
            "personnel_keys_incomplete",
            "Se requiere una clave de protección por destinatario y para el creador.",
        )
    if any(key.state != "active" for key in recipient_keys):
        raise ServiceError(
            409,
            "personnel_key_not_active",
            "Todos los participantes necesitan una clave de protección activa.",
        )
    if len({key.id for key in recipient_keys}) != len(recipient_keys) or len(
        {key.fingerprint for key in recipient_keys}
    ) != len(recipient_keys):
        raise ServiceError(
            409,
            "personnel_keys_repeated",
            "Las claves registradas deben ser distintas.",
        )
    # Primero se valida todo el snapshot, antes de cifrar el documento.
    public_keys = {}
    try:
        for key in recipient_keys:
            public = key_files.load_public(key.public_base64)
            if (
                public.key_size != 2048
                or sha256(key_files.public_bytes(public)).hex() != key.fingerprint
            ):
                raise ValueError("Clave registrada inconsistente.")
            public_keys[key.profile_id] = public
    except ValueError as exc:
        raise ServiceError(
            503,
            "invalid_personnel_key",
            "No se pudo validar una clave de protección registrada.",
        ) from exc
    data = content(body.content_base64)
    aes_key = aes_gcm.generate_key()
    envelopes = tuple(
        RecipientEnvelope(
            profile_id=profile_id,
            key_id=by_profile[profile_id].id,
            fingerprint=by_profile[profile_id].fingerprint,
            wrapped_key_base64=base64.b64encode(
                rsa_oaep.wrap_key(aes_key, public_keys[profile_id])
            ).decode("ascii"),
        )
        for profile_id in sorted(expected)
    )
    header = PersonnelFileHeader(
        document_id=document_id,
        version_id=version_id,
        created_by=creator,
        title=body.title,
        filename=body.filename,
        media_type=body.media_type,
        size=len(data),
        envelopes=envelopes,
    )
    encrypted = aes_gcm.encrypt(data, aes_key, associated_data(header))
    return ProtectedPersonnelFile(
        header=header,
        nonce_base64=base64.b64encode(encrypted.nonce).decode("ascii"),
        ciphertext_base64=base64.b64encode(encrypted.ciphertext).decode("ascii"),
        tag_base64=base64.b64encode(encrypted.tag).decode("ascii"),
    )


def open_file(
    principal: Principal,
    protected: ProtectedPersonnelFile,
    registered_key: EncryptionKey,
    body: OpenPersonnelFile,
) -> bytes:
    """Devuelve plaintext autenticado solo a un perfil asignado a esta versión.

    protected y registered_key se cargarán desde persistencia autorizada. No
    basta con subir un paquete: esta función no es un endpoint portable.
    Una clave retirada sí puede abrir versiones históricas que la usaron.
    """
    require_access(principal, "documents.read_assigned")
    actor = principal.access.profile.id
    assigned = next(
        (item for item in protected.header.envelopes if item.profile_id == actor), None
    )
    if assigned is None:
        raise ServiceError(
            404, "personnel_file_not_found", "El expediente no está disponible."
        )
    if body.version_id != protected.header.version_id:
        raise ServiceError(
            409, "personnel_version_changed", "Actualiza el expediente y reintenta."
        )
    if (
        body.key_id != assigned.key_id
        or registered_key.id != assigned.key_id
        or registered_key.profile_id != actor
        or registered_key.fingerprint != assigned.fingerprint
        or registered_key.state not in {"active", "retired"}
    ):
        raise ServiceError(
            422,
            "personnel_key_mismatch",
            "Selecciona la clave original asignada a esta versión del expediente.",
        )
    private = matching_private(
        registered_key.public_base64, registered_key.fingerprint, body
    )
    try:
        aes_key = rsa_oaep.unwrap_key(
            decode_base64(assigned.wrapped_key_base64), private
        )
        encrypted = aes_gcm.EncryptedData(
            nonce=decode_base64(protected.nonce_base64),
            ciphertext=decode_base64(protected.ciphertext_base64),
            tag=decode_base64(protected.tag_base64),
        )
        return aes_gcm.decrypt(encrypted, aes_key, associated_data(protected.header))
    except ValueError as exc:
        raise ServiceError(
            422,
            "personnel_integrity_failed",
            "No se pudo autenticar el expediente y su clave protegida.",
        ) from exc
