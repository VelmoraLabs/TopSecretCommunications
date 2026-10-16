"""Protección y recuperación portables; la persistencia se añadirá por separado."""

import base64
import binascii
import json

from app.crypto.encryption import aes_gcm
from app.crypto.shamir import (
    IncompatibleSharesError,
    InsufficientSharesError,
    ShamirError,
    deserialize_share,
    reconstruct_secret,
    serialize_share,
    split_secret,
)
from app.modules.documents.schemas import (
    MAX_FILE_SIZE,
    NoteHeader,
    NotePackage,
    ProtectionResult,
    ProtectRequest,
    RecoverRequest,
    RecoveryResult,
)


class DocumentError(ValueError):
    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def decode_base64(value: str) -> bytes:
    try:
        result = base64.b64decode(value, validate=True)
        if base64.b64encode(result).decode("ascii") != value:
            raise ValueError("Base64 no canónico.")
        return result
    except (ValueError, binascii.Error) as exc:
        raise DocumentError(
            "invalid_base64", "El contenido Base64 es inválido."
        ) from exc


def associated_data(header: NoteHeader) -> bytes:
    # Los metadatos públicos quedan autenticados junto al contenido cifrado.
    values = header.model_dump(include=set(NoteHeader.model_fields))
    return json.dumps(
        values, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("ascii")


def protect_note(request: ProtectRequest) -> ProtectionResult:
    content = decode_base64(request.content_base64)
    if len(content) > MAX_FILE_SIZE:
        raise DocumentError(
            "file_too_large", "El archivo supera el límite de 5 MiB.", 413
        )
    key = aes_gcm.generate_key()
    shares = split_secret(key, request.threshold, request.share_count)
    header = NoteHeader(
        filename=request.filename,
        media_type=request.media_type,
        share_count=request.share_count,
        threshold=request.threshold,
        access_mode=request.access_mode,
        document_id=shares[0].set_id,
        size=len(content),
    )
    encrypted = aes_gcm.encrypt(content, key, associated_data(header))
    package = NotePackage(
        **header.model_dump(),
        nonce_base64=base64.b64encode(encrypted.nonce).decode("ascii"),
        ciphertext_base64=base64.b64encode(encrypted.ciphertext).decode("ascii"),
        tag_base64=base64.b64encode(encrypted.tag).decode("ascii"),
    )
    return ProtectionResult(
        package=package, shares=[serialize_share(s) for s in shares]
    )


def recover_note(request: RecoverRequest) -> RecoveryResult:
    package = request.package
    nonce = decode_base64(package.nonce_base64)
    ciphertext = decode_base64(package.ciphertext_base64)
    tag = decode_base64(package.tag_base64)
    if (
        len(nonce) != aes_gcm.NONCE_SIZE
        or len(tag) != aes_gcm.TAG_SIZE
        or len(ciphertext) != package.size
    ):
        raise DocumentError("invalid_package", "El tamaño del paquete es inválido.")
    try:
        shares = [deserialize_share(s) for s in request.shares]
        if any(
            (s.set_id, s.threshold, s.share_count)
            != (package.document_id, package.threshold, package.share_count)
            for s in shares
        ):
            raise IncompatibleSharesError("Los fragmentos no corresponden a esta nota.")
        key = reconstruct_secret(shares)
    except InsufficientSharesError as exc:
        raise DocumentError(
            "insufficient_shares",
            "No se alcanzó el número de fragmentos requerido.",
            409,
        ) from exc
    except IncompatibleSharesError as exc:
        raise DocumentError(
            "incompatible_shares", "Los fragmentos pertenecen a otro conjunto."
        ) from exc
    except ShamirError as exc:
        raise DocumentError("invalid_shares", str(exc)) from exc
    try:
        encrypted = aes_gcm.EncryptedData(nonce=nonce, ciphertext=ciphertext, tag=tag)
        content = aes_gcm.decrypt(encrypted, key, associated_data(package))
    except aes_gcm.AuthenticationError as exc:
        raise DocumentError(
            "integrity_failed",
            "La verificación de integridad falló: revisa el paquete y los fragmentos.",
        ) from exc
    return RecoveryResult(
        filename=package.filename,
        media_type=package.media_type,
        size=len(content),
        content_base64=base64.b64encode(content).decode("ascii"),
    )
