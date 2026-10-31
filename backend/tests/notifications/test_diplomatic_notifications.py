"""La bandeja acepta el destino nuevo, sin convertirlo en una operación de descarga."""

from contextlib import contextmanager

import httpx
import pytest

from tests.memoranda.test_memoranda import HEADERS, NOW
from tests.notifications.test_notifications import NOTICE, inbox_client
from tests.notifications.test_notifications import material as material

DOCUMENT = "80000000-0000-4000-8000-000000000001"


@contextmanager
def diplomatic_inbox(material, changes=None):
    with inbox_client(material) as (client, state):
        gateway = client.app.state.supabase
        original = gateway.client._transport.handler

        def handle(request):
            response = original(request)
            if request.url.path.endswith("/list_stc_notifications"):
                data = response.json()
                data["items"] = [
                    {
                        "id": NOTICE,
                        "category": "documents",
                        "event_type": "diplomatic_note_shared",
                        "target_kind": "diplomatic_note",
                        "target_id": DOCUMENT,
                        "related_id": None,
                        "title": "Te compartieron una nota diplomática",
                        "body": "Recupéralo con tu privada original.",
                        "created_at": NOW,
                        "read_at": None,
                        **(changes or {}),
                    }
                ]
                return httpx.Response(200, json=data)
            return response

        gateway.client._transport.handler = handle
        yield client, state


@pytest.mark.parametrize("event", ["diplomatic_note_shared", "communique_shared"])
def test_new_diplomatic_target_is_preserved_without_download(material, event):
    with diplomatic_inbox(material, {"event_type": event}) as (client, state):
        response = client.get(
            "/api/v1/notifications?category=documents", headers=HEADERS
        )
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["target_kind"] == "diplomatic_note"
        assert item["target_id"] == DOCUMENT
        assert "private_key_base64" not in item
        assert not any("diplomatic_note_material" in str(r.url) for r in state["calls"])
        assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize(
    "changes",
    [
        {"target_id": None},
        {"related_id": DOCUMENT},
        {"category": "recovery"},
        {"event_type": "note_shared"},
        {"wrapped_key_base64": "must-not-leak"},
    ],
)
def test_invalid_diplomatic_notice_is_not_rendered_as_success(material, changes):
    with diplomatic_inbox(material, changes) as (client, _):
        response = client.get("/api/v1/notifications", headers=HEADERS)
        assert response.status_code == 503
        assert "must-not-leak" not in response.text
