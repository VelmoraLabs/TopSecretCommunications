from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, model_validator

from app.modules.memoranda.schemas import Contract

Category = Literal["groups", "documents", "recovery", "account"]


class Notification(Contract):
    id: UUID
    category: Category
    event_type: str
    target_kind: Literal[
        "group", "document", "note", "recovery", "keys", "account", "personnel_file"
    ]
    target_id: UUID | None
    related_id: UUID | None
    title: str
    body: str
    created_at: AwareDatetime
    read_at: AwareDatetime | None

    @model_validator(mode="after")
    def personnel_reference(self) -> Self:
        if self.target_kind == "personnel_file" and (
            self.category != "documents"
            or self.target_id is None
            or self.related_id is not None
        ):
            raise ValueError("La referencia del aviso de expediente no es válida.")
        return self


class NotificationPage(Contract):
    items: list[Notification]
    total: int
    unread_count: int
    limit: int
    offset: int
    snapshot_at: AwareDatetime


class ReadAll(Contract):
    before: AwareDatetime
