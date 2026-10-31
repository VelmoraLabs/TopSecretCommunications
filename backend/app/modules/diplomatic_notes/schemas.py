"""Contratos en memoria; snapshots de claves solo desde el servidor."""

from typing import Literal, Self
from uuid import UUID

from pydantic import Field, StrictBool, field_validator, model_validator

from app.modules.documents.schemas import (
    MAX_CONTENT_BASE64,
    MAX_FILE_SIZE,
    Contract,
    FileInfo,
)
from app.modules.documents.service import decode_base64
from app.modules.encryption_keys.schemas import PrivateKeyInput
from app.modules.memoranda.schemas import CreateMemo
from app.modules.personnel_files.schemas import (
    MAX_RECIPIENTS,
    CreatePersonnelFile,
    RecipientEnvelope,
)

NoteKind = Literal["diplomatic_note", "communique"]


class CreateDiplomaticNote(CreatePersonnelFile, PrivateKeyInput):
    """Credenciales de firma; no recibe identidad ni material público del cliente."""

    model_config = Contract.model_config

    kind: NoteKind
    signing_key_id: UUID = Field(strict=False)


class RegisteredSigningKey(Contract):
    """Snapshot interno de stc_signing_keys; no se acepta como petición HTTP."""

    id: UUID = Field(strict=False)
    profile_id: UUID = Field(strict=False)
    public_base64: str = Field(min_length=1, max_length=16384)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    is_active: StrictBool


class DiplomaticHeader(FileInfo):
    format: Literal["stc-diplomatic-note"] = "stc-diplomatic-note"
    format_version: Literal[1] = 1
    algorithm: Literal["A256GCM+RSA-OAEP-256+RSA-PSS-256"] = (
        "A256GCM+RSA-OAEP-256+RSA-PSS-256"
    )
    kind: NoteKind
    document_id: UUID = Field(strict=False)
    version_id: UUID = Field(strict=False)
    created_by: UUID = Field(strict=False)
    title: str = Field(min_length=1, max_length=160)
    size: int = Field(ge=0, le=MAX_FILE_SIZE)
    signing_key_id: UUID = Field(strict=False)
    signing_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    envelopes: tuple[RecipientEnvelope, ...] = Field(
        min_length=1, max_length=MAX_RECIPIENTS + 1, strict=False
    )

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        return CreateMemo.clean_title(value)

    @field_validator("format_version", mode="before")
    @classmethod
    def strict_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("La versión del formato debe ser un entero.")
        return value

    @model_validator(mode="after")
    def consistent_assignments(self) -> Self:
        for values in (
            [item.profile_id for item in self.envelopes],
            [item.key_id for item in self.envelopes],
            [item.fingerprint for item in self.envelopes],
        ):
            if len(set(values)) != len(values):
                raise ValueError("La nota contiene asignaciones repetidas.")
        if self.created_by not in {item.profile_id for item in self.envelopes}:
            raise ValueError("El emisor debe conservar acceso a la nota.")
        if self.signing_key_id in {item.key_id for item in self.envelopes} or (
            self.signing_fingerprint in {item.fingerprint for item in self.envelopes}
        ):
            raise ValueError("Las claves de firma y cifrado deben ser distintas.")
        return self


class ProtectedDiplomaticNote(Contract):
    """Material interno futuro de persistencia; nunca una respuesta pública."""

    header: DiplomaticHeader
    signature_base64: str = Field(min_length=344, max_length=344, repr=False)
    nonce_base64: str = Field(min_length=16, max_length=16)
    ciphertext_base64: str = Field(max_length=MAX_CONTENT_BASE64, repr=False)
    tag_base64: str = Field(min_length=24, max_length=24, repr=False)

    @model_validator(mode="after")
    def valid_binary_fields(self) -> Self:
        if (
            len(decode_base64(self.signature_base64)) != 256
            or len(decode_base64(self.nonce_base64)) != 12
            or len(decode_base64(self.tag_base64)) != 16
            or len(decode_base64(self.ciphertext_base64)) != self.header.size
        ):
            raise ValueError("Los tamaños de la nota protegida no coinciden.")
        return self


class OpenDiplomaticNote(PrivateKeyInput):
    model_config = Contract.model_config

    version_id: UUID = Field(strict=False)
    key_id: UUID = Field(strict=False)
