"""Contratos de sesión y perfiles. El rol siempre proviene de la base de datos."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

RoleCode = Literal["admin", "ambassador", "staff", "member"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProfileInput(Contract):
    display_name: str = Field(min_length=1, max_length=120, strict=True)
    role_code: RoleCode

    @field_validator("display_name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if any(
            ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in value
        ):
            raise ValueError("El nombre no puede contener controles.")
        return value


class ProfileCreate(ProfileInput):
    email: str = Field(
        min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", strict=True
    )

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        if any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("El correo contiene caracteres inválidos.")
        return value.lower()


class ProfileUpdate(ProfileInput):
    is_active: StrictBool


class AccessProfile(ProfileCreate):
    id: UUID
    auth_user_id: UUID
    is_active: StrictBool


class Profile(ProfileCreate):
    id: UUID
    auth_user_id: UUID | None
    is_active: StrictBool
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class Access(Contract):
    profile: AccessProfile
    permissions: list[str]


class AuthIdentity(BaseModel):
    id: UUID
    is_anonymous: bool = False
    app_metadata: dict[str, Any] = Field(default_factory=dict)


class Role(Contract):
    code: RoleCode
    name: str
    permissions: list[str]

    @field_validator("permissions", mode="before")
    @classmethod
    def permission_names(cls, value: Any) -> Any:
        if isinstance(value, list) and all(isinstance(p, dict) for p in value):
            return sorted(p["permission_code"] for p in value)
        return value


class ProfilePage(Contract):
    items: list[Profile]
    total: int
    limit: int
    offset: int


class CreatedProfile(Contract):
    id: UUID
