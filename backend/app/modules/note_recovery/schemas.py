from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool, field_validator

from app.crypto.key_wrapping.recovery_envelope import ContributionEnvelope
from app.modules.encryption_keys.schemas import PrivateKeyInput
from app.modules.memoranda.schemas import Contract, CreateMemo


class CreateRecovery(Contract):
    request_id: UUID
    reason: str = Field(min_length=1, max_length=240, strict=True)
    duration_minutes: int = Field(default=60, ge=1, le=1440, strict=True)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        return CreateMemo.clean_title(value)


class ContributionInput(PrivateKeyInput):
    approve: StrictBool

    @field_validator("approve")
    @classmethod
    def consent_required(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Confirma la autorización de esta recuperación.")
        return value


class PublicKey(Contract):
    id: UUID
    profile_id: UUID
    public_base64: str
    fingerprint: str


class Recovery(Contract):
    id: UUID
    note_id: UUID
    requester_id: UUID
    requester_name: str
    reason: str
    state: Literal["pending", "ready", "completed", "cancelled", "rejected", "expired"]
    participant_count: int
    contribution_count: int
    created_at: datetime
    expires_at: datetime
    completed_at: datetime | None
    download_until: datetime | None
    version: int
    can_contribute: StrictBool
    can_recover: StrictBool
    can_cancel: StrictBool
    can_reject: StrictBool
    blocked: StrictBool


class RecoveryParticipant(Contract):
    profile_id: UUID
    display_name: str
    share_index: int
    contributed_at: datetime | None
    rejected_at: datetime | None
    is_active: StrictBool


class RecoveryDetail(Contract):
    recovery: Recovery
    requester_key: PublicKey
    participants: list[RecoveryParticipant]


class RecoveryPage(Contract):
    has_open: StrictBool
    items: list[Recovery]
    total: int
    limit: int
    offset: int


class RecoveryMaterial(Contract):
    detail: RecoveryDetail
    envelopes: list[ContributionEnvelope] = Field(
        min_length=2, max_length=20, repr=False
    )
