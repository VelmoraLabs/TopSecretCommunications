"""Contrato de bandeja bajo JWT; PostgreSQL prueba aislamiento y eventos reales."""

import json
from contextlib import contextmanager

import httpx
import pytest

from app.crypto.signatures import key_files
from tests.memoranda.test_memoranda import HEADERS, NOW, app_client

NOTICE = "90000000-0000-4000-8000-000000000001"


@pytest.fixture(scope="module")
def material():
    return key_files.generate(b"Password de prueba 2026")


@contextmanager
def inbox_client(material, *, failure=None, invalid=False):
    with app_client(material, permissions=[]) as (client, state):
        gateway = client.app.state.supabase
        original = gateway.client._transport.handler

        def handle(request):
            if not request.url.path.endswith(
                (
                    "/list_stc_notifications",
                    "/read_stc_notification",
                    "/read_all_stc_notifications",
                )
            ):
                return original(request)
            state["calls"].append(request)
            assert request.headers["apikey"] == "sb_publishable_test"
            assert request.headers["authorization"] == HEADERS["Authorization"]
            if failure:
                return httpx.Response(400, json={"code": failure})
            if request.url.path.endswith("/list_stc_notifications"):
                if invalid:
                    return httpx.Response(200, json={"items": []})
                return httpx.Response(
                    200,
                    json={
                        "items": [
                            {
                                "id": NOTICE,
                                "category": "groups",
                                "event_type": "group_added",
                                "target_kind": "group",
                                "target_id": None,
                                "related_id": None,
                                "title": "Te agregaron a un grupo",
                                "body": "Consulta tu asignación.",
                                "created_at": NOW,
                                "read_at": None,
                            }
                        ],
                        "total": 1,
                        "unread_count": 1,
                        "limit": 20,
                        "offset": 0,
                        "snapshot_at": NOW,
                    },
                )
            return httpx.Response(204)

        gateway.client._transport.handler = handle
        yield client, state


def test_profile_without_document_permissions_has_own_inbox(material):
    with inbox_client(material) as (client, state):
        response = client.get(
            "/api/v1/notifications?state=unread&category=groups&limit=5&offset=2",
            headers=HEADERS,
        )
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json()["unread_count"] == 1
        body = json.loads(state["calls"][-1].content)
        assert body == {
            "p_state": "unread",
            "p_category": "groups",
            "p_limit": 5,
            "p_offset": 2,
        }
        assert "recipient_id" not in body


@pytest.mark.parametrize(
    "query", ["state=other", "category=other", "limit=0", "offset=-1", "limit=101"]
)
def test_invalid_filters_do_not_reach_inbox_rpc(material, query):
    with inbox_client(material) as (client, state):
        response = client.get("/api/v1/notifications?" + query, headers=HEADERS)
        assert response.status_code == 422
        assert not any(
            r.url.path.endswith("/list_stc_notifications") for r in state["calls"]
        )


def test_mark_read_uses_caller_jwt_and_explicit_notification(material):
    with inbox_client(material) as (client, state):
        response = client.post(f"/api/v1/notifications/{NOTICE}/read", headers=HEADERS)
        assert response.status_code == 204
        assert json.loads(state["calls"][-1].content) == {"p_notification_id": NOTICE}


def test_mark_all_uses_server_snapshot_not_recipient_from_client(material):
    with inbox_client(material) as (client, state):
        response = client.post(
            "/api/v1/notifications/read-all", headers=HEADERS, json={"before": NOW}
        )
        assert response.status_code == 204
        assert list(json.loads(state["calls"][-1].content)) == ["p_before"]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"before": "not-a-date"},
        {"before": "2026-10-26T12:00:00"},
        {"before": NOW, "recipient_id": NOTICE},
    ],
)
def test_invalid_mark_all_is_rejected(material, body):
    with inbox_client(material) as (client, state):
        response = client.post(
            "/api/v1/notifications/read-all", headers=HEADERS, json=body
        )
        assert response.status_code == 422
        assert not any(
            r.url.path.endswith("/read_all_stc_notifications") for r in state["calls"]
        )


@pytest.mark.parametrize(
    ("code", "status"), [("NT403", 403), ("NT404", 404), ("NT422", 422)]
)
def test_database_errors_are_safe_and_specific(material, code, status):
    with inbox_client(material, failure=code) as (client, _):
        response = client.get("/api/v1/notifications", headers=HEADERS)
        assert response.status_code == status
        assert code not in response.text


def test_inbox_requires_authenticated_session(material):
    with inbox_client(material) as (client, _):
        assert client.get("/api/v1/notifications").status_code == 401
        assert client.post(f"/api/v1/notifications/{NOTICE}/read").status_code == 401


def test_invalid_provider_response_does_not_become_empty_success(material):
    with inbox_client(material, invalid=True) as (client, _):
        assert client.get("/api/v1/notifications", headers=HEADERS).status_code == 503
