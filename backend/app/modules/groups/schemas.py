"""Contratos de grupos. Los roles de grupo no modifican el rol general."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, StrictBool, field_validator, model_validator

from app.modules.auth.schemas import Contract, RoleCode

GroupRole = Literal["manager", "member"]


class GroupInput(Contract):
    name: str = Field(min_length=1, max_length=100, strict=True)
    description: str = Field(default="", max_length=500, strict=True)

    @field_validator("name", "description")
    @classmethod
    def printable(cls, value: str) -> str:
        if any(
            ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value
        ):
            raise ValueError("No se permiten caracteres de control.")
        return value


class MemberInput(Contract):
    profile_id: UUID
    group_role: GroupRole


class GroupCreate(GroupInput):
    members: list[MemberInput] = Field(min_length=2, max_length=255)

    @model_validator(mode="after")
    def valid_members(self) -> Self:
        if len({member.profile_id for member in self.members}) != len(self.members):
            raise ValueError("Los integrantes deben ser distintos.")
        if not any(member.group_role == "manager" for member in self.members):
            raise ValueError("Selecciona al menos un responsable.")
        return self


class VersionInput(Contract):
    expected_version: int = Field(ge=1, le=2147483646, strict=True)


class GroupUpdate(GroupInput, VersionInput):
    is_active: StrictBool


class MemberUpdate(MemberInput, VersionInput):
    pass


class GroupSummary(GroupInput):
    id: UUID
    is_active: StrictBool
    version: int
    created_at: datetime
    updated_at: datetime
    member_count: int
    active_member_count: int
    my_role: GroupRole | None
    can_manage: StrictBool
    can_archive: StrictBool


class Candidate(Contract):
    id: UUID
    display_name: str
    email: str
    role_code: RoleCode
    is_active: StrictBool
    is_linked: StrictBool


class GroupMember(Candidate):
    group_role: GroupRole
    joined_at: datetime


class GroupDetail(Contract):
    group: GroupSummary
    members: list[GroupMember]


class GroupPage(Contract):
    items: list[GroupSummary]
    total: int
    limit: int
    offset: int


class CandidatePage(Contract):
    items: list[Candidate]
    total: int
    limit: int
    offset: int


class CreatedGroup(Contract):
    id: UUID
