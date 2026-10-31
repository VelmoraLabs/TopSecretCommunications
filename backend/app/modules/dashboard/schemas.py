from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from app.modules.memoranda.schemas import Category, Contract

class DashboardStats(Contract):
    documents_total: int = Field(ge=0)
    notes_total: int = Field(ge=0)
    personnel_total: int = Field(ge=0, strict=True)
    signed_total: int = Field(ge=0)
    pending_total: int = Field(ge=0)
    pending_documents: int = Field(ge=0)
    pending_recoveries: int = Field(ge=0)
    pending_notes: int = Field(ge=0)
    pending_personnel: int = Field(ge=0, strict=True)


class DashboardEntry(Contract):
    id: UUID
    target_kind: Literal["document", "note", "recovery", "personnel_file"]
    target_id: UUID
    related_id: UUID | None
    title: str
    category: Category
    status: str
    subtitle: str
    occurred_at: AwareDatetime

    @model_validator(mode="after")
    def recovery_has_note(self) -> Self:
        if self.target_kind == "recovery" and self.related_id is None:
            raise ValueError("Falta la nota de la recuperación.")
        if self.target_kind == "personnel_file" and (
            self.category != "expediente"
            or self.target_id != self.id
            or self.related_id is not None
        ):
            raise ValueError("La referencia del expediente no coincide.")
        return self


class Dashboard(Contract):
    stats: DashboardStats
    category_counts: dict[Category, int]
    recent: list[DashboardEntry] = Field(max_length=6)
    pending: list[DashboardEntry] = Field(max_length=6)
    updated_at: AwareDatetime
