"""El resumen utiliza el JWT del lector y valida la respuesta agregada de PostgreSQL."""

import json
from contextlib import contextmanager
from copy import deepcopy

import httpx
import pytest

from app.crypto.signatures import key_files
from tests.memoranda.test_memoranda import HEADERS, NOW, app_client

ID = "90000000-0000-4000-8000-000000000001"
DATA = {
    "stats": {
        "documents_total": 27,
        "notes_total": 26,
        "personnel_total": 0,
        "diplomatic_total": 0,
        "signed_total": 1,
        "pending_total": 1,
        "pending_documents": 0,
        "pending_recoveries": 1,
        "pending_notes": 0,
        "pending_personnel": 0,
        "pending_diplomatic": 0,
    },
    "category_counts": {
        "memorandum": 1,
        "expediente": 0,
        "nota": 0,
        "especial": 0,
        "acuerdo": 0,
    },
    "recent": [
        {
            "id": ID,
            "target_kind": "note",
            "target_id": ID,
            "related_id": None,
            "title": "Acuerdo de coordinación",
            "category": "especial",
            "status": "Cifrada · acceso conjunto",
            "subtitle": "Nota especial · Comité",
            "occurred_at": NOW,
        }
    ],
    "pending": [
        {
            "id": ID,
            "target_kind": "recovery",
            "target_id": ID,
            "related_id": ID,
            "title": "Acuerdo de coordinación",
            "category": "especial",
            "status": "Tu aportación está pendiente",
            "subtitle": "Recuperación · Comité",
            "occurred_at": NOW,
        }
    ],
    "updated_at": NOW,
}


@pytest.fixture(scope="module")
def material():
    return key_files.generate(b"Password de prueba 2026")


@contextmanager
def dashboard_client(material, *, permissions=None, data=None, failure=None):
    with app_client(material, permissions=permissions) as (client, state):
        gateway = client.app.state.supabase
        original = gateway.client._transport.handler

        def handle(request):
            if not request.url.path.endswith("/stc_dashboard"):
                return original(request)
            state["calls"].append(request)
            assert request.headers["apikey"] == "sb_publishable_test"
            assert request.headers["authorization"] == HEADERS["Authorization"]
            if failure:
                return httpx.Response(400, json={"code": failure})
            return httpx.Response(200, json=DATA if data is None else data)

        gateway.client._transport.handler = handle
        yield client, state


def test_summary_uses_global_counts_not_recent_page_length(material):
    with dashboard_client(material) as (client, state):
        response = client.get("/api/v1/dashboard", headers=HEADERS)
        assert response.status_code == 200
        assert response.json()["stats"]["notes_total"] == 26
        assert len(response.json()["recent"]) == 1
        assert response.json()["pending"][0]["related_id"] == ID
        assert json.loads(state["calls"][-1].content) == {}
        assert response.headers["Cache-Control"] == "no-store"


def test_caller_cannot_choose_another_profile(material):
    with dashboard_client(material) as (client, state):
        response = client.get("/api/v1/dashboard?recipient_id=" + ID, headers=HEADERS)
        assert response.status_code == 200
        assert json.loads(state["calls"][-1].content) == {}


def test_no_session_cannot_read_summary(material):
    with dashboard_client(material) as (client, _):
        assert client.get("/api/v1/dashboard").status_code == 401


def test_document_permission_is_required(material):
    with dashboard_client(material, permissions=[]) as (client, state):
        assert client.get("/api/v1/dashboard", headers=HEADERS).status_code == 403
        assert not any(r.url.path.endswith("/stc_dashboard") for r in state["calls"])


@pytest.mark.parametrize(
    "invalid", ["negative_count", "missing_stats", "missing_note", "invalid_date"]
)
def test_invalid_aggregate_does_not_become_zero_counts(material, invalid):
    data = deepcopy(DATA)
    if invalid == "negative_count":
        data["stats"]["notes_total"] = -1
    elif invalid == "missing_stats":
        del data["stats"]
    elif invalid == "missing_note":
        data["pending"][0]["related_id"] = None
    else:
        data["updated_at"] = "invalid"
    with dashboard_client(material, data=data) as (client, _):
        response = client.get("/api/v1/dashboard", headers=HEADERS)
        assert response.status_code == 503
        assert "stats" not in response.json()


def test_database_rechecks_current_permission(material):
    with dashboard_client(material, failure="DA403") as (client, _):
        response = client.get("/api/v1/dashboard", headers=HEADERS)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "dashboard_permission_denied"
