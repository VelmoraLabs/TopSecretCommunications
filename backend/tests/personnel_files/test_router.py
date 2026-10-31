"""API ASGI con autenticación real del proyecto y proveedor HTTP de prueba.

No se sustituyen dependencias de sesión ni el servicio de persistencia. Auth,
PostgREST y Storage se simulan en el transporte; AES-GCM y RSA son reales.
"""

import base64
import json
from contextlib import asynccontextmanager
from uuid import UUID

import httpx
import pytest

from app.core.request_limits import MAX_REQUEST_SIZE
from app.main import create_app
from tests.personnel_files.test_persistence import anyio_backend as anyio_backend
from tests.personnel_files.test_persistence import transport
from tests.personnel_files.test_service import (
    ORIGINAL,
    OUTSIDER,
    OWNER,
    PASSWORD,
    RECIPIENT,
    principal,
    request,
)
from tests.personnel_files.test_service import registered as registered

pytestmark = pytest.mark.anyio
BASE = "/api/v1/personnel-files"
ID = str(UUID(int=100))


def headers(profile_id=OWNER):
    return {"Authorization": f"Bearer {profile_id}.test.signature"}


def open_body(state, registered, profile_id=RECIPIENT, **changes):
    key, files = registered[profile_id]
    return {
        "version_id": state["file"]["version_id"],
        "key_id": str(key.id),
        "password": PASSWORD,
        "private_key_base64": files.private_base64,
        **changes,
    }


def provider_operations(state):
    return [
        call.url.path.rsplit("/", 1)[-1]
        for call in state["calls"]
        if call.url.path not in {"/auth/v1/user", "/rest/v1/rpc/current_access"}
    ]


@asynccontextmanager
async def web(registered, **flags):
    async with transport(registered, **flags) as (gateway, state):
        original = gateway.client._transport.handler

        def handle(req):
            if req.url.path not in {"/auth/v1/user", "/rest/v1/rpc/current_access"}:
                return original(req)
            state["calls"].append(req)
            assert req.headers["apikey"] == "sb_publishable_personnel_test"
            token = req.headers["authorization"].removeprefix("Bearer ")
            actor = UUID(token.split(".", 1)[0])
            assert token == f"{actor}.test.signature"
            if req.url.path == "/auth/v1/user":
                if state.get("invalid_session"):
                    return httpx.Response(401, json={"message": "Token rechazado"})
                return httpx.Response(
                    200,
                    json={
                        "id": str(actor),
                        "app_metadata": {
                            "provider": "email"
                            if state.get("wrong_provider")
                            else "google"
                        },
                    },
                )
            access = principal(actor).access.model_dump(mode="json")
            access["profile"]["is_active"] = not state.get("inactive", False)
            if actor == RECIPIENT:
                access["profile"]["role_code"] = "member"
                access["permissions"] = ["documents.read_assigned"]
            if "permissions" in state:
                access["permissions"] = state["permissions"]
            return httpx.Response(200, json=access)

        gateway.client._transport = httpx.MockTransport(handle)
        app = create_app(supabase=gateway, enable_local_workflow=False)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://stc.test"
        ) as client:
            yield client, state


async def test_http_create_list_detail_and_independent_downloads(registered):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        assert created.status_code == 201, created.text
        result = created.json()
        assert result["file"]["created_by"] == str(OWNER)
        assert result["file"]["state"] == "ready"
        document_id = result["file"]["id"]
        for actor in (OWNER, RECIPIENT):
            listed = await client.get(BASE, headers=headers(actor))
            assert listed.status_code == 200 and listed.json()["total"] == 1
            detail = await client.get(f"{BASE}/{document_id}", headers=headers(actor))
            assert detail.status_code == 200
            assert (
                "header" not in detail.json()
                and "wrapped_key_base64" not in detail.text
            )
            downloaded = await client.post(
                f"{BASE}/{document_id}/file",
                headers=headers(actor),
                json=open_body(state, registered, actor),
            )
            assert downloaded.status_code == 200, downloaded.text
            assert base64.b64decode(downloaded.json()["content_base64"]) == ORIGINAL
            for response in (created, listed, detail, downloaded):
                assert response.headers["cache-control"] == "no-store"
                assert response.headers["vary"] == "Authorization"
        assert state["downloads"] == 2
        assert all(PASSWORD.encode() not in call.content for call in state["calls"])


async def test_filters_are_bounded_trimmed_and_forwarded_with_the_user_jwt(registered):
    async with web(registered) as (client, state):
        response = await client.get(
            BASE,
            headers=headers(),
            params={
                "search": "  Expediente  ",
                "limit": 7,
                "offset": 14,
                "actor": str(OUTSIDER),
            },
        )
        assert response.status_code == 200
        operation = next(
            call
            for call in state["calls"]
            if call.url.path.endswith("/list_personnel_files")
        )
        assert json.loads(operation.content) == {
            "p_search": "Expediente",
            "p_limit": 7,
            "p_offset": 14,
        }
        assert operation.headers["authorization"] == headers()["Authorization"]


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", ""),
        ("POST", ""),
        ("GET", f"/{ID}"),
        ("POST", f"/{ID}/file"),
        ("POST", f"/{ID}/cancel"),
    ],
)
async def test_every_route_requires_a_session_before_document_operations(
    registered, method, path
):
    async with web(registered) as (client, state):
        body = (
            request().model_dump(mode="json")
            if not path
            else {
                "version_id": ID,
                "key_id": ID,
                "password": PASSWORD,
                "private_key_base64": "privada-no-usada",
            }
        )
        response = await client.request(
            method, BASE + path, json=body if method == "POST" else None
        )
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert response.headers["cache-control"] == "no-store"
        assert not state["calls"]


@pytest.mark.parametrize("token", ["sin-formato", "a.b", "a.b.c.d"])
async def test_malformed_bearer_does_not_contact_supabase(registered, token):
    async with web(registered) as (client, state):
        response = await client.get(BASE, headers={"Authorization": "Bearer " + token})
        assert response.status_code == 401 and not state["calls"]


@pytest.mark.parametrize(
    "flag,status",
    [("invalid_session", 401), ("inactive", 403), ("wrong_provider", 403)],
)
async def test_auth_rejection_prevents_document_calls(registered, flag, status):
    async with web(registered, **{flag: True}) as (client, state):
        response = await client.get(BASE, headers=headers())
        assert response.status_code == status
        assert not provider_operations(state)


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", ""),
        ("POST", ""),
        ("GET", f"/{ID}"),
        ("POST", f"/{ID}/file"),
        ("POST", f"/{ID}/cancel"),
    ],
)
async def test_empty_current_permissions_block_every_route(registered, method, path):
    async with web(registered, permissions=[]) as (client, state):
        response = await client.request(
            method,
            BASE + path,
            headers=headers(),
            json=request().model_dump(mode="json")
            if not path
            else {
                "version_id": ID,
                "key_id": ID,
                "password": PASSWORD,
                "private_key_base64": "privada-no-usada",
            },
        )
        assert response.status_code == 403
        assert not provider_operations(state)


async def test_member_can_read_but_cannot_create_or_cancel(registered):
    async with web(registered) as (client, state):
        listed = await client.get(BASE, headers=headers(RECIPIENT))
        assert listed.status_code == 200
        response = await client.post(
            BASE, headers=headers(RECIPIENT), json=request().model_dump(mode="json")
        )
        assert response.status_code == 403
        response = await client.post(f"{BASE}/{ID}/cancel", headers=headers(RECIPIENT))
        assert response.status_code == 403
        assert "server_begin_personnel_file" not in provider_operations(state)
        assert "server_cancel_personnel_file" not in provider_operations(state)


async def test_unassigned_administrator_cannot_read_download_or_cancel(registered):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        document_id = created.json()["file"]["id"]
        for method, path, body in [
            ("GET", "", None),
            ("POST", "/file", open_body(state, registered, OUTSIDER)),
            ("POST", "/cancel", None),
        ]:
            response = await client.request(
                method,
                f"{BASE}/{document_id}{path}",
                headers=headers(OUTSIDER),
                json=body,
            )
            assert response.status_code == 404
        assert state["downloads"] == 0 and state["file"]["state"] == "ready"


@pytest.mark.parametrize(
    "changes",
    [
        {"created_by": str(OUTSIDER)},
        {"public_base64": "publica-arbitraria"},
        {"recipients": [{"profile_id": str(RECIPIENT)}] * 2},
    ],
)
async def test_invalid_creation_cannot_override_identity_or_keys(registered, changes):
    async with web(registered) as (client, state):
        body = {**request().model_dump(mode="json"), **changes}
        response = await client.post(BASE, headers=headers(), json=body)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_request"
        assert not provider_operations(state)


@pytest.mark.parametrize(
    "query",
    ["limit=0", "limit=101", "offset=-1", "offset=100001", "search=" + "a" * 81],
)
async def test_invalid_query_is_rejected_before_document_rpc(registered, query):
    async with web(registered) as (client, state):
        response = await client.get(BASE + "?" + query, headers=headers())
        assert response.status_code == 422 and not provider_operations(state)


async def test_invalid_uuid_and_wrong_download_method(registered):
    async with web(registered) as (client, state):
        invalid = await client.get(BASE + "/no-es-uuid", headers=headers())
        assert invalid.status_code == 422 and not provider_operations(state)
        wrong_method = await client.get(f"{BASE}/{ID}/file", headers=headers())
        assert wrong_method.status_code == 405


async def test_invalid_private_input_error_never_echoes_credentials(registered):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        document_id = created.json()["file"]["id"]
        body = open_body(state, registered)
        response = await client.post(
            f"{BASE}/{document_id}/file",
            headers=headers(RECIPIENT),
            json={**body, "version_id": "version-invalida"},
        )
        assert response.status_code == 422
        assert (
            PASSWORD not in response.text
            and body["private_key_base64"] not in response.text
        )
        response = await client.post(
            f"{BASE}/{document_id}/file",
            headers=headers(RECIPIENT),
            json={**body, "password": "incorrecta-de-prueba"},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_encryption_private_key"
        assert "content_base64" not in response.json() and state["downloads"] == 0


async def test_final_authorization_failure_is_an_http_error_without_plaintext(
    registered,
):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        state["deny_final"] = True
        response = await client.post(
            f"{BASE}/{created.json()['file']['id']}/file",
            headers=headers(RECIPIENT),
            json=open_body(state, registered),
        )
        assert response.status_code == 404
        assert "content_base64" not in response.json() and state["downloads"] == 0


async def test_creator_can_cancel_interrupted_preparation_but_not_ready_file(
    registered,
):
    async with web(registered, commit_error="PF409", cancel_error=True) as (
        client,
        state,
    ):
        failed = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        assert failed.status_code == 409
        state["cancel_error"] = False
        cancelled = await client.post(
            f"{BASE}/{state['file']['id']}/cancel", headers=headers()
        )
        assert (
            cancelled.status_code == 200
            and cancelled.json()["file"]["state"] == "cancelled"
        )
        assert state["stored"] is None
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        cancelled = await client.post(
            f"{BASE}/{created.json()['file']['id']}/cancel", headers=headers()
        )
        assert cancelled.status_code == 409 and state["stored"] is not None


async def test_invalid_provider_response_is_sanitized(registered):
    async with web(registered, bad_reservation="keys") as (client, state):
        response = await client.post(
            BASE, headers=headers(), json=request().model_dump(mode="json")
        )
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "invalid_personnel_response"
        assert (
            "content_base64" not in response.text
            and "ValidationError" not in response.text
        )


async def test_global_body_limit_applies_to_new_routes_before_authentication(
    registered,
):
    async with web(registered) as (client, state):
        response = await client.post(
            BASE,
            content=b"x" * (MAX_REQUEST_SIZE + 1),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413 and not state["calls"]


async def test_openapi_registers_all_five_operations_without_internal_material(
    registered,
):
    async with web(registered) as (client, state):
        response = await client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        for method, path in [
            ("get", BASE),
            ("post", BASE),
            ("get", BASE + "/{document_id}"),
            ("post", BASE + "/{document_id}/file"),
            ("post", BASE + "/{document_id}/cancel"),
        ]:
            operation = schema["paths"][path][method]
            assert operation["security"] == [{"HTTPBearer": []}]
        assert "ProtectedPersonnelFile" not in schema["components"]["schemas"]
        assert "PersonnelMaterial" not in schema["components"]["schemas"]
        assert not state["calls"]
