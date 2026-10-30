"""Contratos del expediente v1; no reciben claves públicas ni identidades libres."""

from typing import Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.modules.documents.schemas import (
    MAX_CONTENT_BASE64,
    MAX_FILE_SIZE,
    Contract,
    FileInfo,
)
from app.modules.documents.service import decode_base64
from app.modules.encryption_keys.schemas import PrivateKeyInput
from app.modules.memoranda.schemas import CreateMemo

MAX_RECIPIENTS = 255


class Recipient(Contract):
    profile_id: UUID = Field(strict=False)


class CreatePersonnelFile(FileInfo):
    title: str = Field(min_length=1, max_length=160)
    content_base64: str = Field(max_length=MAX_CONTENT_BASE64, repr=False)
    recipients: tuple[Recipient, ...] = Field(
        min_length=1, max_length=MAX_RECIPIENTS, strict=False
    )

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        return CreateMemo.clean_title(value)

    @model_validator(mode="after")
    def distinct_recipients(self) -> Self:
        if len({r.profile_id for r in self.recipients}) != len(self.recipients):
            raise ValueError("Selecciona destinatarios distintos.")
        return self


class RecipientEnvelope(Recipient):
    key_id: UUID = Field(strict=False)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    wrapped_key_base64: str = Field(min_length=344, max_length=344, repr=False)

    @field_validator("wrapped_key_base64")
    @classmethod
    def valid_wrapped_key(cls, value: str) -> str:
        if len(decode_base64(value)) != 256:
            raise ValueError("La clave protegida debe tener 256 bytes.")
        return value


class PersonnelFileHeader(FileInfo):
    format: Literal["stc-personnel-file"] = "stc-personnel-file"
    format_version: Literal[1] = 1
    algorithm: Literal["A256GCM+RSA-OAEP-256"] = "A256GCM+RSA-OAEP-256"
    document_id: UUID = Field(strict=False)
    version_id: UUID = Field(strict=False)
    created_by: UUID = Field(strict=False)
    title: str = Field(min_length=1, max_length=160)
    size: int = Field(ge=0, le=MAX_FILE_SIZE)
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
    def consistent_access(self) -> Self:
        for values in (
            [item.profile_id for item in self.envelopes],
            [item.key_id for item in self.envelopes],
            [item.fingerprint for item in self.envelopes],
        ):
            if len(set(values)) != len(values):
                raise ValueError("El expediente contiene asignaciones repetidas.")
        if self.created_by not in {item.profile_id for item in self.envelopes}:
            raise ValueError("El creador debe conservar acceso al expediente.")
        return self


class ProtectedPersonnelFile(Contract):
    """Resultado interno para persistir; no es una respuesta pública de la API."""

    header: PersonnelFileHeader
    nonce_base64: str = Field(min_length=16, max_length=16)
    ciphertext_base64: str = Field(max_length=MAX_CONTENT_BASE64, repr=False)
    tag_base64: str = Field(min_length=24, max_length=24, repr=False)

    @model_validator(mode="after")
    def valid_binary_fields(self) -> Self:
        if (
            len(decode_base64(self.nonce_base64)) != 12
            or len(decode_base64(self.tag_base64)) != 16
            or len(decode_base64(self.ciphertext_base64)) != self.header.size
        ):
            raise ValueError("Los tamaños del expediente cifrado no coinciden.")
        return self


class OpenPersonnelFile(PrivateKeyInput):
    version_id: UUID
    key_id: UUID
