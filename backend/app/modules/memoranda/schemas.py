"""Documentos y destinatarios propios; no heredan políticas de Shamir ni grupos."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StrictBool,
    field_validator,
    model_validator,
)

from app.modules.documents.schemas import MAX_CONTENT_BASE64, FileInfo

Category = Literal["memorandum", "expediente", "nota", "especial", "acuerdo"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Recipient(Contract):
    profile_id: UUID


class CreateMemo(FileInfo):
    title: str = Field(min_length=1, max_length=160, strict=True)
    content_base64: str = Field(max_length=MAX_CONTENT_BASE64, repr=False)
    recipients: list[Recipient] = Field(min_length=1, max_length=255)
    approver_id: UUID | None = Field(default=None, strict=False)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        value = value.strip()
        if not value or any(
            ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value
        ):
            raise ValueError("Título inválido.")
        return value

    @model_validator(mode="after")
    def unique_recipients(self) -> Self:
        if len({r.profile_id for r in self.recipients}) != len(self.recipients):
            raise ValueError("Selecciona destinatarios distintos.")
        return self


class PasswordInput(Contract):
    password: SecretStr = Field(min_length=12, max_length=256)

    @field_validator("password")
    @classmethod
    def valid_password(cls, value: SecretStr) -> SecretStr:
        text = value.get_secret_value()
        if (
            any(0xD800 <= ord(c) <= 0xDFFF or c == "\x00" for c in text)
            or len(text.encode()) > 1024
        ):
            raise ValueError("Contraseña inválida.")
        return value


class KeyCreate(PasswordInput):
    label: str = Field(min_length=1, max_length=80, strict=True)
    private_filename: str = Field(min_length=1, max_length=180, strict=True)
    public_filename: str = Field(min_length=1, max_length=180, strict=True)

    @field_validator("private_filename", "public_filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        return FileInfo.safe_filename(value)

    @field_validator("label")
    @classmethod
    def safe_label(cls, value: str) -> str:
        return CreateMemo.clean_title(value)

    @model_validator(mode="after")
    def different_names(self) -> Self:
        if self.private_filename.casefold() == self.public_filename.casefold():
            raise ValueError("Las claves requieren nombres distintos.")
        return self


class SignInput(PasswordInput):
    key_id: UUID
    version_id: UUID
    private_key_base64: SecretStr = Field(min_length=1, max_length=16384)


class DocumentAction(Contract):
    version_id: UUID


class SigningKey(Contract):
    id: UUID
    label: str
    public_base64: str
    fingerprint: str
    is_active: StrictBool
    created_at: datetime


class KeyPage(Contract):
    items: list[SigningKey]


class GeneratedKey(Contract):
    key: SigningKey
    private_filename: str
    public_filename: str
    private_base64: str = Field(repr=False)


class Candidate(Contract):
    id: UUID
    display_name: str
    email: str
    role_code: str
    can_sign: StrictBool


class CandidatePage(Contract):
    items: list[Candidate]
    total: int
    limit: int
    offset: int


class Document(Contract):
    id: UUID
    title: str
    category: Category
    creator_name: str
    issuer_id: UUID | None
    approver_id: UUID | None
    approver_name: str | None
    workflow_state: Literal[
        "draft", "pending_approval", "ready_to_send", "sent", "legacy_shared"
    ]
    signing_purpose: Literal["issuer", "approval"] | None
    can_request_approval: StrictBool
    can_send: StrictBool
    sent_at: datetime | None
    review_requested_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version_id: UUID
    version_number: int
    recipient_count: int
    signer_count: int
    signature_count: int
    signature_state: Literal["pending", "partial", "signed"]
    can_sign: StrictBool


class DocumentPage(Contract):
    signed_total: int
    pending_total: int
    items: list[Document]
    total: int
    limit: int
    offset: int
    category_counts: dict[Category, int]


class Version(FileInfo):
    model_config = ConfigDict(extra="forbid", strict=False, frozen=True)

    id: UUID
    version_number: int
    size: int
    sha256: str


class Participant(Contract):
    id: UUID
    display_name: str
    email: str
    can_sign: StrictBool
    is_active: StrictBool
    is_issuer: StrictBool
    is_approver: StrictBool
    is_recipient: StrictBool


class Signature(Contract):
    purpose: Literal["issuer", "approval", "legacy"]
    id: UUID
    signer_id: UUID
    signer_name: str
    key_id: UUID
    public_base64: str
    fingerprint: str
    key_is_active: StrictBool
    signature_base64: str
    created_at: datetime


class DocumentDetail(Contract):
    document: Document
    version: Version
    participants: list[Participant]
    signatures: list[Signature]


class VerificationFile(Contract):
    version_id: UUID
    content_base64: str = Field(max_length=MAX_CONTENT_BASE64, repr=False)


class SignatureCheck(Contract):
    signature_id: UUID
    signer_name: str
    valid: StrictBool
    key_is_active: StrictBool


class Verification(Contract):
    document_id: UUID
    version_id: UUID
    source: Literal["stored", "uploaded"]
    content_matches: StrictBool
    signatures: list[SignatureCheck]
    all_valid: StrictBool


class Download(FileInfo):
    verification: Literal["integrity", "signatures"] = "integrity"
    content_base64: str = Field(repr=False)
