"""Contrato v1 del paquete portable y de las operaciones de notas especiales."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_PARTICIPANTS = 20
MAX_CONTENT_BASE64 = 4 * ((MAX_FILE_SIZE + 2) // 3)
MAX_CIPHERTEXT_BASE64 = MAX_CONTENT_BASE64
AccessMode = Literal["all-members"]
ParticipantCount = Annotated[int, Field(ge=2, le=MAX_PARTICIPANTS)]
ShareText = Annotated[str, Field(min_length=1, max_length=2048)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class FileInfo(Contract):
    filename: str = Field(min_length=1, max_length=180)
    media_type: str = Field(default="application/octet-stream", max_length=120)

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        if (
            value != value.strip()
            or value in {".", ".."}
            or any(c in value for c in "/\\")
            or any(
                ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF
                for c in value
            )
        ):
            raise ValueError("Usa un nombre de archivo sin rutas ni controles.")
        return value

    @field_validator("media_type")
    @classmethod
    def safe_media_type(cls, value: str) -> str:
        if not value or any(ord(c) < 32 or ord(c) > 126 for c in value):
            raise ValueError("Tipo de archivo inválido.")
        return value


class ProtectionPolicy(Contract):
    share_count: ParticipantCount
    threshold: ParticipantCount
    access_mode: AccessMode = "all-members"

    @model_validator(mode="after")
    def validate_policy(self) -> Self:
        if self.threshold > self.share_count:
            raise ValueError("El umbral no puede superar el número de participantes.")
        if self.access_mode == "all-members" and self.threshold != self.share_count:
            raise ValueError("Las notas especiales requieren a todo el grupo.")
        return self


class ProtectRequest(FileInfo, ProtectionPolicy):
    content_base64: str = Field(max_length=MAX_CONTENT_BASE64)


class NoteHeader(FileInfo, ProtectionPolicy):
    format: Literal["stc-special-note"] = "stc-special-note"
    version: Literal[1] = 1
    algorithm: Literal["AES-256-GCM+Shamir"] = "AES-256-GCM+Shamir"
    document_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    size: int = Field(ge=0, le=MAX_FILE_SIZE)

    @field_validator("version", mode="before")
    @classmethod
    def strict_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("La versión debe ser un entero.")
        return value


class NotePackage(NoteHeader):
    nonce_base64: str = Field(min_length=16, max_length=16)
    ciphertext_base64: str = Field(max_length=MAX_CIPHERTEXT_BASE64)
    tag_base64: str = Field(min_length=24, max_length=24)


class ProtectionResult(Contract):
    package: NotePackage
    shares: list[ShareText] = Field(min_length=2, max_length=MAX_PARTICIPANTS)


class RecoverRequest(Contract):
    package: NotePackage
    shares: list[ShareText] = Field(min_length=1, max_length=MAX_PARTICIPANTS)


class RecoveryResult(FileInfo):
    size: int
    content_base64: str
