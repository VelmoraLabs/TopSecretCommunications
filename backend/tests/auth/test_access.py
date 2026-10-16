"""Contrato HTTP con Supabase y permisos de FastAPI, sin overrides de autenticación."""

import base64
import json
from contextlib import contextmanager
from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import SupabaseSettings
from app.infrastructure.supabase import SupabaseGateway
from app.main import create_app

USER_ID = "11111111-1111-4111-8111-111111111111"
PROFILE_ID = "22222222-2222-4222-8222-222222222222"
PROFILE = {
    "id": PROFILE_ID,
    "auth_user_id": USER_ID,
    "email": "owner@example.test",
    "display_name": "Responsable",
    "role_code": "admin",
    "is_active": True,
}
ACCESS = {
    "profile": PROFILE,
    "permissions": ["profiles.manage", "documents.create", "recovery.request"],
}
HEADERS = {"Authorization": "Bearer valid.test.token"}
NEW_PROFILE = {
    "email": "new@example.test",
    "display_name": "Nueva persona",
    "role_code": "staff",
}
DOC_BODY = {
    "filename": "nota.txt",
    "content_base64": base64.b64encode(b"Nota").decode(),
    "share_count": 2,
    "threshold": 2,
}


@contextmanager
def app_client(*, access=None, auth_status=200, overrides=None, transport_error=False):
    state = {"access": deepcopy(ACCESS if access is None else access), "calls": []}
    overrides = overrides or {}

    def handle(request):
        state["calls"].append(request)
        assert request.headers["apikey"] == "sb_publishable_test_key"
        assert request.headers["authorization"] == HEADERS["Authorization"]
        if transport_error:
            raise httpx.ConnectError(
                "Error que no debe salir a la respuesta", request=request
            )
        if request.url.path in overrides:
            value = overrides[request.url.path]
            return value(request) if callable(value) else value
        if request.url.path == "/auth/v1/user":
            return httpx.Response(
                auth_status,
                json={"id": USER_ID, "app_metadata": {"provider": "google"}},
            )
        if request.url.path == "/rest/v1/rpc/current_access":
            if state["access"] is False:
                return httpx.Response(
                    403, json={"code": "42501", "message": "Datos internos"}
                )
            return httpx.Response(200, json=state["access"])
        if request.url.path == "/rest/v1/roles":
            return httpx.Response(
                200,
                json=[
                    {
                        "code": "staff",
                        "name": "Personal autorizado",
                        "permissions": [{"permission_code": "documents.create"}],
                    }
                ],
            )
        if request.url.path == "/rest/v1/profiles":
            return httpx.Response(
                200,
                headers={"Content-Range": "0-0/1"},
                json=[
                    {
                        **PROFILE,
                        "created_by": None,
                        "created_at": "2026-10-15T00:00:00Z",
                        "updated_at": "2026-10-15T00:00:00Z",
                    }
                ],
            )
        if request.url.path == "/rest/v1/rpc/authorize_profile":
            return httpx.Response(200, json=PROFILE_ID)
        if request.url.path == "/rest/v1/rpc/update_profile":
            return httpx.Response(204)
        raise AssertionError(request.url.path)

    gateway = SupabaseGateway(
        SupabaseSettings("https://project.supabase.co", "sb_publishable_test_key"),
        httpx.AsyncClient(transport=httpx.MockTransport(handle)),
    )
    with TestClient(create_app(enable_local_workflow=True, supabase=gateway)) as client:
        yield client, state


@pytest.mark.parametrize(
    "path", ["/api/v1/auth/me", "/api/v1/admin/profiles", "/api/v1/admin/roles"]
)
def test_private_reads_require_session(path):
    with app_client() as (client, state):
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert response.headers["cache-control"] == "no-store"
        assert state["calls"] == []


@pytest.mark.parametrize(
    "authorization",
    [
        "Basic xyz",
        "Bearer xyz",
        "Bearer a.b.c extra",
        "Bearer a.b.c!",
        "Bearer " + "x" * 9000,
    ],
)
def test_malformed_bearer_is_rejected(authorization):
    with app_client() as (client, state):
        assert (
            client.get(
                "/api/v1/auth/me", headers={"Authorization": authorization}
            ).status_code
            == 401
        )
        assert state["calls"] == []


@pytest.mark.parametrize("status", [400, 401, 403])
def test_expired_or_invalid_token_rejected_by_auth(status):
    with app_client(auth_status=status) as (client, state):
        assert client.get("/api/v1/auth/me", headers=HEADERS).status_code == 401
        assert len(state["calls"]) == 1


def test_current_access_is_checked_each_request_and_returns_no_token():
    with app_client() as (client, state):
        response = client.get("/api/v1/auth/me", headers=HEADERS)
        assert response.status_code == 200
        assert response.json() == ACCESS
        assert "valid.test.token" not in response.text
        state["access"] = False
        assert client.get("/api/v1/auth/me", headers=HEADERS).status_code == 403
        assert len(state["calls"]) == 4


@pytest.mark.parametrize(
    "change", ["mismatched_user", "inactive", "non_google", "anonymous"]
)
def test_identity_and_profile_must_match(change):
    access = deepcopy(ACCESS)
    identity = {"id": USER_ID, "app_metadata": {"provider": "google"}}
    if change == "mismatched_user":
        access["profile"]["auth_user_id"] = PROFILE_ID
    if change == "inactive":
        access["profile"]["is_active"] = False
    if change == "non_google":
        identity["app_metadata"]["provider"] = "email"
    if change == "anonymous":
        identity["is_anonymous"] = True
    with app_client(
        access=access, overrides={"/auth/v1/user": httpx.Response(200, json=identity)}
    ) as (client, _):
        assert client.get("/api/v1/auth/me", headers=HEADERS).status_code == 403


def test_role_label_alone_does_not_grant_management():
    with app_client(access={"profile": PROFILE, "permissions": []}) as (client, state):
        assert client.get("/api/v1/admin/profiles", headers=HEADERS).status_code == 403
        assert (
            client.post(
                "/api/v1/admin/profiles", json=NEW_PROFILE, headers=HEADERS
            ).status_code
            == 403
        )
        assert all("authorize_profile" not in r.url.path for r in state["calls"])


def test_admin_reads_paginated_profiles_and_catalog():
    with app_client() as (client, state):
        response = client.get(
            "/api/v1/admin/profiles?email=example&active=false&limit=5&offset=2",
            headers=HEADERS,
        )
        assert response.status_code == 200
        assert response.json()["total"] == 1
        request = state["calls"][-1]
        assert request.url.params["email"] == "ilike.*example*"
        assert request.url.params["is_active"] == "eq.false"
        assert request.url.params["offset"] == "2"
        assert request.headers["prefer"] == "count=exact"
        response = client.get("/api/v1/admin/roles", headers=HEADERS)
        assert response.status_code == 200
        assert response.json()[0]["permissions"] == ["documents.create"]


def test_admin_create_normalizes_input_and_calls_rpc():
    with app_client() as (client, state):
        response = client.post(
            "/api/v1/admin/profiles",
            headers=HEADERS,
            json={
                **NEW_PROFILE,
                "email": " NEW@EXAMPLE.TEST ",
                "display_name": " Nueva persona ",
            },
        )
        assert response.status_code == 201
        assert response.json() == {"id": PROFILE_ID}
        assert json.loads(state["calls"][-1].content) == {
            "p_email": "new@example.test",
            "p_display_name": "Nueva persona",
            "p_role_code": "staff",
        }


def test_admin_update_uses_rpc_and_identity_cannot_be_changed():
    with app_client() as (client, _):
        body = {
            "display_name": "Actualizado",
            "role_code": "member",
            "is_active": False,
        }
        assert (
            client.patch(
                f"/api/v1/admin/profiles/{PROFILE_ID}", json=body, headers=HEADERS
            ).status_code
            == 204
        )
        assert (
            client.patch(
                f"/api/v1/admin/profiles/{PROFILE_ID}",
                json={**body, "auth_user_id": PROFILE_ID},
                headers=HEADERS,
            ).status_code
            == 422
        )


@pytest.mark.parametrize(
    "body",
    [
        {**NEW_PROFILE, "email": "invalid"},
        {**NEW_PROFILE, "role_code": "superadmin"},
        {**NEW_PROFILE, "display_name": ""},
        {**NEW_PROFILE, "display_name": "A\x00B"},
        {**NEW_PROFILE, "is_active": True},
        {**NEW_PROFILE, "email": 123},
    ],
)
def test_invalid_profile_inputs_never_reach_write_rpc(body):
    with app_client() as (client, state):
        response = client.post("/api/v1/admin/profiles", json=body, headers=HEADERS)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_request"
        assert all("authorize_profile" not in r.url.path for r in state["calls"])


@pytest.mark.parametrize("field", ["email", "display_name"])
def test_surrogates_in_json_are_rejected_without_write(field):
    body = {**NEW_PROFILE, field: "bad\ud800@example.test"}
    with app_client() as (client, state):
        response = client.post(
            "/api/v1/admin/profiles",
            content=json.dumps(body).encode(),
            headers={**HEADERS, "Content-Type": "application/json"},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_request"
        assert all("authorize_profile" not in r.url.path for r in state["calls"])


@pytest.mark.parametrize(
    "code,expected",
    [("23505", 409), ("42501", 403), ("23503", 422), ("23514", 422), ("P0002", 404)],
)
def test_database_errors_are_sanitized(code, expected):
    with app_client(
        overrides={
            "/rest/v1/rpc/authorize_profile": httpx.Response(
                400, json={"code": code, "message": "INTERNAL_SECRET"}
            )
        }
    ) as (client, _):
        response = client.post(
            "/api/v1/admin/profiles", json=NEW_PROFILE, headers=HEADERS
        )
        assert response.status_code == expected
        assert "INTERNAL_SECRET" not in response.text


def test_last_admin_error_is_actionable():
    with app_client(
        overrides={
            "/rest/v1/rpc/update_profile": httpx.Response(
                400,
                json={
                    "code": "23514",
                    "message": (
                        "Debe permanecer un administrador activo "
                        "que ya haya iniciado sesión."
                    ),
                },
            )
        }
    ) as (client, _):
        response = client.patch(
            f"/api/v1/admin/profiles/{PROFILE_ID}",
            headers=HEADERS,
            json={"display_name": "Admin", "role_code": "member", "is_active": True},
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "last_admin"


@pytest.mark.parametrize("status", [429, 500, 503, 302])
def test_auth_unavailable_fails_closed(status):
    with app_client(auth_status=status) as (client, _):
        assert client.get("/api/v1/auth/me", headers=HEADERS).status_code == 503


def test_network_failure_fails_closed_and_hides_provider_error():
    with app_client(transport_error=True) as (client, _):
        response = client.get("/api/v1/auth/me", headers=HEADERS)
        assert response.status_code == 503
        assert "no debe salir" not in response.text


def test_invalid_json_from_provider_does_not_break_api():
    with app_client(
        overrides={"/auth/v1/user": httpx.Response(200, text="not json")}
    ) as (client, _):
        assert client.get("/api/v1/auth/me", headers=HEADERS).status_code == 503


def test_documents_require_authentication_and_creation_permission():
    with app_client(
        access={
            "profile": {**PROFILE, "role_code": "member"},
            "permissions": ["recovery.request"],
        }
    ) as (client, _):
        assert (
            client.post(
                "/api/v1/documents/special-notes/protect", json=DOC_BODY
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/v1/documents/special-notes/protect",
                json=DOC_BODY,
                headers=HEADERS,
            ).status_code
            == 403
        )


def test_authenticated_document_roundtrip():
    with app_client() as (client, _):
        protected = client.post(
            "/api/v1/documents/special-notes/protect", json=DOC_BODY, headers=HEADERS
        )
        assert protected.status_code == 200
        response = client.post(
            "/api/v1/documents/special-notes/recover",
            json=protected.json(),
            headers=HEADERS,
        )
        assert response.status_code == 200
        assert base64.b64decode(response.json()["content_base64"]) == b"Nota"


def test_missing_configuration_has_no_unauthenticated_fallback(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    with TestClient(create_app(enable_local_workflow=True)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/v1/auth/me", headers=HEADERS).status_code == 503
        assert (
            client.post(
                "/api/v1/documents/special-notes/protect", json=DOC_BODY
            ).status_code
            == 401
        )


@pytest.mark.parametrize(
    "url,key",
    [
        ("http://remote.example", "sb_publishable_test"),
        ("https://user:pass@example.com", "sb_publishable_test"),
        ("https://example.com/path", "sb_publishable_test"),
        ("https://example.com", "sb_secret_test"),
    ],
)
def test_unsafe_configuration_rejected(url, key):
    with pytest.raises(ValueError):
        SupabaseSettings(url, key)


def test_configuration_repr_does_not_include_key():
    assert "sb_publishable_test" not in repr(
        SupabaseSettings("https://project.supabase.co", "sb_publishable_test")
    )
