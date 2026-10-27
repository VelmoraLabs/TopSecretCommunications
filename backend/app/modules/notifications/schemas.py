from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime

from app.modules.memoranda.schemas import Contract

Category = Literal["groups", "documents", "recovery", "account"]


class Notification(Contract):
    id: UUID
    category: Category
    event_type: str
    target_kind: Literal["group", "document", "note", "recovery", "keys", "account"]
    target_id: UUID | None
    related_id: UUID | None
    title: str
    body: str
    created_at: AwareDatetime
    read_at: AwareDatetime | None


class NotificationPage(Contract):
    items: list[Notification]
    total: int
    unread_count: int
    limit: int
    offset: int
    snapshot_at: AwareDatetime


class ReadAll(Contract):
    before: AwareDatetime
