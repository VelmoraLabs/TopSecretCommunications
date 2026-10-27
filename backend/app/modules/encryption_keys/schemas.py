"""Solo la generación devuelve la privada cifrada; nunca su contraseña."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, SecretStr, field_validator

from app.modules.memoranda.schemas import Contract, CreateMemo, PasswordInput


class KeyCreate(PasswordInput):
    label: str = Field(min_length=1, max_length=80, strict=True)

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str) -> str:
        return CreateMemo.clean_title(value)


class EncryptionKey(Contract):
    id: UUID
    profile_id: UUID
    label: str
    public_base64: str
    fingerprint: str
    state: Literal["pending", "active", "retired"]
    created_at: datetime
    activated_at: datetime | None
    retired_at: datetime | None


class KeyPage(Contract):
    items: list[EncryptionKey]


class GeneratedKey(Contract):
    key: EncryptionKey
    private_base64: str = Field(repr=False)


class PrivateKeyInput(PasswordInput):
    private_key_base64: SecretStr = Field(min_length=1, max_length=16384)
