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
from tests.diplomatic_notes.test_diplomatic_persistence import (
    anyio_backend as anyio_backend,
)
from tests.diplomatic_notes.test_diplomatic_persistence import transport
from tests.diplomatic_notes.test_diplomatic_service import (
    ORIGINAL,
    OUTSIDER,
    OWNER,
    PASSWORD,
    RECIPIENT,
    principal,
    request,
)
from tests.diplomatic_notes.test_diplomatic_service import registered as registered

pytestmark = pytest.mark.anyio
BASE = "/api/v1/diplomatic-notes"
ID = str(UUID(int=100))


def headers(profile_id=OWNER):
    return {"Authorization": f"Bearer {profile_id}.test.signature"}


def create_body(registered, **changes):
    body = request(registered, **changes)
    return {
        **body.model_dump(mode="json"),
        "password": body.password.get_secret_value(),
        "private_key_base64": body.private_key_base64.get_secret_value(),
    }


def open_body(state, registered, profile_id=RECIPIENT, **changes):
    key, files = registered[0][profile_id]
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
            assert req.headers["apikey"] == "sb_publishable_diplomatic_test"
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
                        "is_anonymous": state.get("anonymous", False),
                    },
                )
            access = principal(actor).access.model_dump(mode="json")
            if state.get("mismatched_identity"):
                access["profile"]["auth_user_id"] = str(OUTSIDER)
            access["profile"]["is_active"] = not state.get("inactive", False)
            if actor == OUTSIDER:
                access["profile"]["role_code"] = "admin"
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


@pytest.mark.parametrize("kind", ["diplomatic_note", "communique"])
async def test_http_create_list_detail_and_independent_downloads(registered, kind):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=create_body(registered, kind=kind)
        )
        assert created.status_code == 201, created.text
        result = created.json()
        assert result["file"]["created_by"] == str(OWNER)
        assert result["file"]["state"] == "ready"
        assert result["file"]["kind"] == kind
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
            assert downloaded.json()["verification"] == "signature-and-integrity"
            assert downloaded.json()["issuer_id"] == str(OWNER)
            assert downloaded.json()["signing_key_id"] == str(registered[1].id)
            assert downloaded.json()["signing_fingerprint"] == registered[1].fingerprint
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
                "search": "  Nota diplomática  ",
                "kind": "communique",
                "limit": 7,
                "offset": 14,
                "actor": str(OUTSIDER),
            },
        )
        assert response.status_code == 200
        operation = next(
            call
            for call in state["calls"]
            if call.url.path.endswith("/list_diplomatic_notes")
        )
        assert json.loads(operation.content) == {
            "p_search": "Nota diplomática",
            "p_kind": "communique",
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
            create_body(registered)
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
    [
        ("invalid_session", 401),
        ("inactive", 403),
        ("wrong_provider", 403),
        ("anonymous", 403),
        ("mismatched_identity", 403),
    ],
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
            json=create_body(registered)
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
            BASE, headers=headers(RECIPIENT), json=create_body(registered)
        )
        assert response.status_code == 403
        response = await client.post(f"{BASE}/{ID}/cancel", headers=headers(RECIPIENT))
        assert response.status_code == 403
        assert "server_begin_diplomatic_note" not in provider_operations(state)
        assert "server_cancel_diplomatic_note" not in provider_operations(state)


async def test_unassigned_administrator_cannot_read_download_or_cancel(registered):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=create_body(registered)
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
        {"signature_base64": "firma-del-cliente"},
        {"kind": "especial"},
        {"recipients": [{"profile_id": str(RECIPIENT)}] * 2},
    ],
)
async def test_invalid_creation_cannot_override_identity_or_keys(registered, changes):
    async with web(registered) as (client, state):
        body = {**create_body(registered), **changes}
        response = await client.post(BASE, headers=headers(), json=body)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_request"
        assert not provider_operations(state)


@pytest.mark.parametrize(
    "query",
    [
        "limit=0",
        "limit=101",
        "offset=-1",
        "offset=100001",
        "search=" + "a" * 81,
        "kind=especial",
        "kind=nota",
    ],
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
            BASE, headers=headers(), json=create_body(registered)
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
            BASE, headers=headers(), json=create_body(registered)
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
    async with web(registered, commit_error="DN409", cancel_error=True) as (
        client,
        state,
    ):
        failed = await client.post(
            BASE, headers=headers(), json=create_body(registered)
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
            BASE, headers=headers(), json=create_body(registered)
        )
        cancelled = await client.post(
            f"{BASE}/{created.json()['file']['id']}/cancel", headers=headers()
        )
        assert cancelled.status_code == 409 and state["stored"] is not None


async def test_invalid_provider_response_is_sanitized(registered):
    async with web(registered, bad_reservation="keys") as (client, state):
        response = await client.post(
            BASE, headers=headers(), json=create_body(registered)
        )
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "invalid_diplomatic_response"
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
        assert "ProtectedDiplomaticNote" not in schema["components"]["schemas"]
        assert "DiplomaticMaterial" not in schema["components"]["schemas"]
        assert "DiplomaticReservation" not in schema["components"]["schemas"]
        assert "RegisteredSigningKey" not in schema["components"]["schemas"]
        password = schema["components"]["schemas"]["CreateDiplomaticNote"][
            "properties"
        ]["password"]
        assert password["writeOnly"] is True
        assert not state["calls"]


@pytest.mark.parametrize("missing", ["documents.sign", "documents.read_assigned"])
async def test_creator_also_needs_signing_and_read_permission(registered, missing):
    permissions = ["documents.create", "documents.sign", "documents.read_assigned"]
    permissions.remove(missing)
    async with web(registered, permissions=permissions) as (client, state):
        response = await client.post(
            BASE, headers=headers(), json=create_body(registered)
        )
        assert response.status_code == 403 and not provider_operations(state)


@pytest.mark.parametrize("case", ["password", "wrong_private", "invalid_private"])
async def test_invalid_signing_credentials_never_publish_or_echo_secrets(
    registered, case
):
    body = create_body(registered)
    changes = {
        "password": {"password": "contrasena-incorrecta"},
        "wrong_private": {"private_key_base64": registered[0][OWNER][1].private_base64},
        "invalid_private": {"private_key_base64": "privada-invalida-de-prueba"},
    }[case]
    body.update(changes)
    async with web(registered) as (client, state):
        response = await client.post(BASE, headers=headers(), json=body)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_signing_key"
        assert body["password"] not in response.text
        assert body["private_key_base64"] not in response.text
        assert state["file"]["state"] == "cancelled" and state["stored"] is None
        assert "server_commit_diplomatic_note" not in provider_operations(state)


@pytest.mark.parametrize("field", ["signature_base64", "nonce_base64", "tag_base64"])
async def test_altered_signature_or_authenticators_never_return_http_plaintext(
    registered, field
):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=create_body(registered)
        )
        document_id = created.json()["file"]["id"]
        data = bytearray(base64.b64decode(state["material"][field]))
        data[0] ^= 1
        state["material"][field] = base64.b64encode(data).decode("ascii")
        response = await client.post(
            f"{BASE}/{document_id}/file",
            headers=headers(RECIPIENT),
            json=open_body(state, registered),
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "diplomatic_integrity_failed"
        assert "content_base64" not in response.text and state["downloads"] == 0


@pytest.mark.parametrize("change", ["version_id", "key_id"])
async def test_download_uses_original_version_and_key_before_storage(
    registered, change
):
    async with web(registered) as (client, state):
        created = await client.post(
            BASE, headers=headers(), json=create_body(registered)
        )
        document_id = created.json()["file"]["id"]
        response = await client.post(
            f"{BASE}/{document_id}/file",
            headers=headers(RECIPIENT),
            json=open_body(state, registered, **{change: ID}),
        )
        assert response.status_code == (409 if change == "version_id" else 422)
        assert state["downloads"] == 0
        assert not any(
            c.method == "GET" and "/storage/" in c.url.path for c in state["calls"]
        )


async def test_lost_commit_response_does_not_erase_published_note(registered):
    async with web(registered, lost_commit=True) as (client, state):
        response = await client.post(
            BASE, headers=headers(), json=create_body(registered)
        )
        assert response.status_code == 503
        assert state["file"]["state"] == "ready" and state["stored"] is not None
        assert not any(c.method == "DELETE" for c in state["calls"])
        listed = await client.get(BASE, headers=headers())
        assert listed.json()["total"] == 1


async def test_creator_can_cancel_pending_load_after_losing_signing_permission(
    registered,
):
    async with web(registered, commit_error="DN409", cancel_error=True) as (
        client,
        state,
    ):
        response = await client.post(
            BASE, headers=headers(), json=create_body(registered)
        )
        assert response.status_code == 409
        state["cancel_error"] = False
        state["permissions"] = ["documents.create", "documents.read_assigned"]
        response = await client.post(
            f"{BASE}/{state['file']['id']}/cancel", headers=headers()
        )
        assert response.status_code == 200
        assert (
            response.json()["file"]["state"] == "cancelled" and state["stored"] is None
        )
