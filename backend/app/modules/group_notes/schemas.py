"""Contratos de persistencia; conservan el paquete portable v1 existente."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StrictBool,
    field_validator,
)

from app.modules.documents.schemas import (
    MAX_CONTENT_BASE64,
    FileInfo,
    NoteHeader,
)
from app.modules.memoranda.schemas import CreateMemo


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateGroupNote(FileInfo):
    request_id: UUID = Field(strict=False)
    group_id: UUID = Field(strict=False)
    group_version: int = Field(ge=1, strict=True)
    title: str = Field(min_length=1, max_length=160, strict=True)
    content_base64: str = Field(max_length=MAX_CONTENT_BASE64, repr=False)

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        return CreateMemo.clean_title(value)


class Participant(Contract):
    profile_id: UUID
    display_name: str
    email: str
    group_role: Literal["manager", "member"]
    share_index: int = Field(ge=1, le=20)
    encryption_key_id: UUID | None = None
    encryption_fingerprint: str | None = None


class GroupMember(Contract):
    profile_id: UUID
    display_name: str
    email: str
    group_role: Literal["manager", "member"]
    is_active: StrictBool
    encryption_ready: StrictBool = False


class NoteGroup(Contract):
    id: UUID
    name: str
    version: int
    members: list[GroupMember]


class GroupPage(Contract):
    items: list[NoteGroup]
    total: int
    limit: int
    offset: int


class GroupNote(Contract):
    id: UUID
    group_id: UUID
    group_name: str
    group_version: int
    title: str
    created_by: UUID
    creator_name: str
    filename: str
    media_type: str
    size: int
    participant_count: int = Field(ge=2, le=20)
    threshold: int = Field(ge=2, le=20)
    custody_mode: Literal["portable", "individual-v1"]
    state: Literal["staging", "awaiting_backup", "ready", "cancelled"]
    created_at: datetime
    ready_at: datetime | None


class PackageHeader(NoteHeader):
    nonce_base64: str = Field(min_length=16, max_length=16)
    tag_base64: str = Field(min_length=24, max_length=24)


class NoteDetail(Contract):
    note: GroupNote
    participants: list[Participant]
    package_header: PackageHeader | None
    ciphertext_sha256: str | None


class NotePage(Contract):
    items: list[GroupNote]
    total: int
    limit: int
    offset: int


class ConfirmBackup(Contract):
    backup_receipt: SecretStr = Field(min_length=43, max_length=43)

    @field_validator("backup_receipt")
    @classmethod
    def valid_receipt(cls, value: SecretStr) -> SecretStr:
        import re

        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", value.get_secret_value()):
            raise ValueError("Selecciona el resguardo de esta nota.")
        return value


class ShareCheck(Contract):
    note_id: UUID
    key_id: UUID
    share_index: int
    valid: Literal[True] = True
