"""API real con transporte Supabase controlado; RLS se prueba en groups.sql."""

import json
from contextlib import contextmanager
from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import SupabaseSettings
from app.infrastructure.supabase import SupabaseGateway
from app.main import create_app

ADMIN_ID = "10000000-0000-4000-8000-000000000001"
MEMBER_ID = "10000000-0000-4000-8000-000000000002"
GROUP_ID = "30000000-0000-4000-8000-000000000001"
USER_ID = "20000000-0000-4000-8000-000000000001"
HEADERS = {"Authorization": "Bearer valid.test.token"}
GROUP = {
    "id": GROUP_ID,
    "name": "Comité",
    "description": "Coordinación",
    "is_active": True,
    "version": 1,
    "created_at": "2026-10-19T00:00:00Z",
    "updated_at": "2026-10-19T00:00:00Z",
    "member_count": 2,
    "active_member_count": 2,
    "my_role": None,
    "can_manage": True,
    "can_archive": True,
}
CANDIDATE = {
    "id": MEMBER_ID,
    "display_name": "Integrante",
    "email": "member@example.test",
    "role_code": "member",
    "is_active": True,
    "is_linked": False,
}
CREATE = {
    "name": "Comité",
    "description": "Coordinación",
    "members": [
        {"profile_id": ADMIN_ID, "group_role": "manager"},
        {"profile_id": MEMBER_ID, "group_role": "member"},
    ],
}
UPDATE = {
    "name": "Comité",
    "description": "Coordinación",
    "is_active": True,
    "expected_version": 1,
}
MEMBER = {"profile_id": MEMBER_ID, "group_role": "member", "expected_version": 1}
OPERATIONS = [
    ("GET", "/api/v1/groups", None),
    ("GET", "/api/v1/groups/candidates", None),
    ("GET", f"/api/v1/groups/{GROUP_ID}", None),
    ("POST", "/api/v1/groups", CREATE),
    ("PATCH", f"/api/v1/groups/{GROUP_ID}", UPDATE),
    ("PUT", f"/api/v1/groups/{GROUP_ID}/members", MEMBER),
    (
        "DELETE",
        f"/api/v1/groups/{GROUP_ID}/members/{MEMBER_ID}?expected_version=1",
        None,
    ),
]


@contextmanager
def client_for(*, permissions=None, response=None):
    state = {
        "calls": [],
        "permissions": ["groups.read", "groups.manage"]
        if permissions is None
        else permissions,
    }

    def handle(request):
        assert request.headers["authorization"] == HEADERS["Authorization"]
        assert request.headers["apikey"] == "sb_publishable_test_key"
        state["calls"].append(request)
        if request.url.path == "/auth/v1/user":
            return httpx.Response(
                200, json={"id": USER_ID, "app_metadata": {"provider": "google"}}
            )
        if request.url.path == "/rest/v1/rpc/current_access":
            return httpx.Response(
                200,
                json={
                    "profile": {
                        "id": ADMIN_ID,
                        "auth_user_id": USER_ID,
                        "email": "admin@example.test",
                        "display_name": "Admin",
                        "role_code": "admin",
                        "is_active": True,
                    },
                    "permissions": state["permissions"],
                },
            )
        if response is not None:
            return response(request) if callable(response) else response
        if request.url.path.endswith("/list_stc_groups"):
            return httpx.Response(
                200, json={"items": [GROUP], "total": 1, "limit": 20, "offset": 0}
            )
        if request.url.path.endswith("/get_stc_group"):
            return httpx.Response(
                200,
                json={
                    "group": GROUP,
                    "members": [
                        {
                            **CANDIDATE,
                            "group_role": "member",
                            "joined_at": "2026-10-19T00:00:00Z",
                        }
                    ],
                },
            )
        if request.url.path.endswith("/list_group_candidates"):
            return httpx.Response(
                200, json={"items": [CANDIDATE], "total": 1, "limit": 20, "offset": 0}
            )
        if request.url.path.endswith("/create_stc_group"):
            return httpx.Response(200, json=GROUP_ID)
        return httpx.Response(204)

    gateway = SupabaseGateway(
        SupabaseSettings("https://project.supabase.co", "sb_publishable_test_key"),
        httpx.AsyncClient(transport=httpx.MockTransport(handle)),
    )
    with TestClient(
        create_app(enable_local_workflow=False, supabase=gateway)
    ) as client:
        yield client, state


@pytest.mark.parametrize("method,path,body", OPERATIONS)
def test_every_operation_requires_session(method, path, body):
    with client_for() as (client, state):
        result = client.request(method, path, json=body)
        assert result.status_code == 401
        assert not state["calls"]


@pytest.mark.parametrize("method,path,body", OPERATIONS)
def test_permissions_are_checked_before_group_rpc(method, path, body):
    with client_for(permissions=[]) as (client, state):
        result = client.request(method, path, json=body, headers=HEADERS)
        assert result.status_code == 403
        assert len(state["calls"]) == 2


@pytest.mark.parametrize("method,path,body", OPERATIONS)
def test_routes_forward_user_identity_and_are_not_local_workflow(method, path, body):
    with client_for() as (client, state):
        result = client.request(method, path, json=body, headers=HEADERS)
        assert result.status_code in (200, 201, 204)
        assert result.headers["cache-control"] == "no-store"
        assert result.headers["vary"] == "Authorization"
        assert len(state["calls"]) == 3
        forwarded = json.loads(state["calls"][-1].content)
        assert "actor_profile_id" not in forwarded
        if body and "expected_version" in body:
            assert forwarded["p_expected_version"] == body["expected_version"]


def test_reader_can_reach_group_rpc_but_cannot_create():
    with client_for(permissions=["groups.read"]) as (client, state):
        assert (
            client.get(f"/api/v1/groups/{GROUP_ID}", headers=HEADERS).status_code == 200
        )
        result = client.post("/api/v1/groups", json=CREATE, headers=HEADERS)
        assert result.status_code == 403
        assert len(state["calls"]) == 5


@pytest.mark.parametrize(
    "patch",
    [
        {"members": []},
        {"members": [CREATE["members"][0]]},
        {"members": CREATE["members"] * 128},
        {"members": [CREATE["members"][0], CREATE["members"][0]]},
        {
            "members": [
                {"profile_id": ADMIN_ID, "group_role": "member"},
                CREATE["members"][1],
            ]
        },
        {"name": " "},
        {"name": "x" * 101},
        {"name": "A\nB"},
        {"description": "x" * 501},
        {
            "members": [
                {"profile_id": ADMIN_ID, "group_role": "admin"},
                CREATE["members"][1],
            ]
        },
        {
            "members": [
                {"profile_id": ADMIN_ID, "group_role": "manager", "is_admin": True},
                CREATE["members"][1],
            ]
        },
        {"owner_id": ADMIN_ID},
    ],
)
def test_create_rejects_invalid_or_client_controlled_fields(patch):
    with client_for() as (client, state):
        result = client.post(
            "/api/v1/groups", json={**deepcopy(CREATE), **patch}, headers=HEADERS
        )
        assert result.status_code == 422
        assert len(state["calls"]) == 2


@pytest.mark.parametrize("version", [0, -1, True, "1", None, 2147483647])
def test_mutations_require_valid_version(version):
    with client_for() as (client, state):
        result = client.patch(
            f"/api/v1/groups/{GROUP_ID}",
            json={**UPDATE, "expected_version": version},
            headers=HEADERS,
        )
        assert result.status_code == 422
        assert len(state["calls"]) == 2


@pytest.mark.parametrize(
    "query", ["limit=101", "offset=-1", "state=invalid", "search=" + "x" * 81]
)
def test_query_is_bounded(query):
    with client_for() as (client, state):
        assert client.get("/api/v1/groups?" + query, headers=HEADERS).status_code == 422
        assert len(state["calls"]) == 2


def test_candidates_use_rpc_with_literal_search_and_group_scope():
    with client_for() as (client, state):
        search = "x),role_code.eq.admin"
        result = client.get(
            "/api/v1/groups/candidates",
            params={"group_id": GROUP_ID, "search": search, "limit": 10, "offset": 20},
            headers=HEADERS,
        )
        assert result.status_code == 200
        request = state["calls"][-1]
        assert request.url.path == "/rest/v1/rpc/list_group_candidates"
        assert json.loads(request.content) == {
            "p_group_id": GROUP_ID,
            "p_search": search,
            "p_limit": 10,
            "p_offset": 20,
        }


@pytest.mark.parametrize(
    "code,status,error_code",
    [
        ("PT403", 403, "group_permission_denied"),
        ("PT404", 404, "group_not_found"),
        ("PT409", 409, "group_conflict"),
        ("PT422", 422, "invalid_group"),
    ],
)
def test_database_scope_conflicts_and_invariants_are_not_hidden(
    code, status, error_code
):
    with client_for(
        response=httpx.Response(
            status, json={"code": code, "message": "INTERNAL_SECRET"}
        )
    ) as (client, _):
        result = client.put(
            f"/api/v1/groups/{GROUP_ID}/members", json=MEMBER, headers=HEADERS
        )
        assert result.status_code == status
        assert result.json()["detail"]["code"] == error_code
        assert "INTERNAL_SECRET" not in result.text


@pytest.mark.parametrize("value", [None, {}, {"items": [], "total": 0}, "invalid"])
def test_malformed_upstream_does_not_leak_response(value):
    with client_for(response=httpx.Response(200, json=value)) as (client, _):
        result = client.get("/api/v1/groups", headers=HEADERS)
        assert result.status_code == 503
        assert result.json()["detail"]["code"] == "invalid_group_response"


def test_missing_configuration_fails_closed(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    with TestClient(create_app(enable_local_workflow=False)) as client:
        assert client.get("/api/v1/groups", headers=HEADERS).status_code == 503
