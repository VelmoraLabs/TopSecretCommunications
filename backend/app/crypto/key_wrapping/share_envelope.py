"""Sobre híbrido v1: AES-GCM protege el fragmento y RSA-OAEP protege su clave.

No modifica las primitivas existentes. El contexto público queda autenticado por
GCM y vincula nota, conjunto Shamir, destinatario, clave e índice del fragmento.
"""

import base64
import hashlib
import json
from typing import Literal
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.crypto.encryption import aes_gcm
from app.crypto.key_wrapping import rsa_oaep
from app.crypto.shamir import Share, deserialize_share, serialize_share


class EnvelopeContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    format: Literal["stc-share-envelope"] = "stc-share-envelope"
    version: Literal[1] = 1
    algorithm: Literal["RSA-OAEP-256+A256GCM"] = "RSA-OAEP-256+A256GCM"
    note_id: UUID
    set_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    recipient_id: UUID
    key_id: UUID
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    share_index: int = Field(ge=1, le=20, strict=True)
    share_count: int = Field(ge=2, le=20, strict=True)
    threshold: int = Field(ge=2, le=20, strict=True)

    def aad(self) -> bytes:
        return json.dumps(
            self.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        ).encode("ascii")

    def check_share(self, share: Share) -> None:
        if (
            share.set_id != self.set_id
            or share.x != self.share_index
            or share.share_count != self.share_count
            or share.threshold != self.threshold
            or self.threshold != self.share_count
        ):
            raise ValueError("El fragmento no corresponde al destinatario y la nota.")


class ShareEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    context: EnvelopeContext
    wrapped_key_base64: str = Field(min_length=344, max_length=344, repr=False)
    nonce_base64: str = Field(min_length=16, max_length=16)
    ciphertext_base64: str = Field(min_length=4, max_length=4096, repr=False)
    tag_base64: str = Field(min_length=24, max_length=24, repr=False)

    @field_validator(
        "wrapped_key_base64", "nonce_base64", "ciphertext_base64", "tag_base64"
    )
    @classmethod
    def canonical_base64(cls, value: str, info: ValidationInfo) -> str:
        data = base64.b64decode(value, validate=True)
        if base64.b64encode(data).decode("ascii") != value:
            raise ValueError("Base64 no canónico.")
        expected = {
            "wrapped_key_base64": 256,
            "nonce_base64": 12,
            "tag_base64": 16,
        }.get(info.field_name or "")
        if expected is not None and len(data) != expected:
            raise ValueError("Longitud binaria inválida.")
        return value


def public_fingerprint(public: rsa.RSAPublicKey) -> str:
    der = public.public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return hashlib.sha256(der).hexdigest()


def seal_share(
    share: Share, public: rsa.RSAPublicKey, context: EnvelopeContext
) -> ShareEnvelope:
    context.check_share(share)
    if public.key_size != 2048 or public_fingerprint(public) != context.fingerprint:
        raise ValueError("Se requiere la clave RSA-2048 indicada en el contexto.")
    key = aes_gcm.generate_key()
    encrypted = aes_gcm.encrypt(
        serialize_share(share).encode("utf8"), key, context.aad()
    )
    return ShareEnvelope(
        context=context,
        wrapped_key_base64=base64.b64encode(rsa_oaep.wrap_key(key, public)).decode(),
        nonce_base64=base64.b64encode(encrypted.nonce).decode(),
        ciphertext_base64=base64.b64encode(encrypted.ciphertext).decode(),
        tag_base64=base64.b64encode(encrypted.tag).decode(),
    )


def open_share(
    envelope: ShareEnvelope, private: rsa.RSAPrivateKey, expected: EnvelopeContext
) -> Share:
    if (
        envelope.context != expected
        or public_fingerprint(private.public_key()) != expected.fingerprint
    ):
        raise ValueError("El sobre pertenece a otro destinatario o documento.")
    key = rsa_oaep.unwrap_key(base64.b64decode(envelope.wrapped_key_base64), private)
    encrypted = aes_gcm.EncryptedData(
        nonce=base64.b64decode(envelope.nonce_base64),
        ciphertext=base64.b64decode(envelope.ciphertext_base64),
        tag=base64.b64decode(envelope.tag_base64),
    )
    share = deserialize_share(aes_gcm.decrypt(encrypted, key, expected.aad()).decode())
    expected.check_share(share)
    return share
