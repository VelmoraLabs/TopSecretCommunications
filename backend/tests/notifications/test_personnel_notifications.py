"""La bandeja acepta el destino nuevo, sin convertirlo en una operación de descarga."""

from contextlib import contextmanager

import httpx
import pytest

from tests.memoranda.test_memoranda import HEADERS, NOW
from tests.notifications.test_notifications import NOTICE, inbox_client
from tests.notifications.test_notifications import material as material

DOCUMENT = "80000000-0000-4000-8000-000000000001"


@contextmanager
def personnel_inbox(material, changes=None):
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
                        "event_type": "personnel_file_shared",
                        "target_kind": "personnel_file",
                        "target_id": DOCUMENT,
                        "related_id": None,
                        "title": "Te compartieron un expediente de personal",
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


def test_new_personnel_target_is_preserved_without_download(material):
    with personnel_inbox(material) as (client, state):
        response = client.get(
            "/api/v1/notifications?category=documents", headers=HEADERS
        )
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["target_kind"] == "personnel_file"
        assert item["target_id"] == DOCUMENT
        assert "private_key_base64" not in item
        assert not any("personnel_file_material" in str(r.url) for r in state["calls"])
        assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize(
    "changes",
    [
        {"target_id": None},
        {"related_id": DOCUMENT},
        {"category": "recovery"},
        {"wrapped_key_base64": "must-not-leak"},
    ],
)
def test_invalid_personnel_notice_is_not_rendered_as_success(material, changes):
    with personnel_inbox(material, changes) as (client, _):
        response = client.get("/api/v1/notifications", headers=HEADERS)
        assert response.status_code == 503
        assert "must-not-leak" not in response.text
