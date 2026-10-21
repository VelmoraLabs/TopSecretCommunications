"""Flujo HTTP con criptografía real; RLS y grants se comprueban por separado en SQL."""

import base64
import json
from contextlib import contextmanager
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import SupabaseSettings
from app.crypto.signatures import key_files, rsa_pss
from app.infrastructure.supabase import SupabaseGateway
from app.main import create_app

PROFILE = "10000000-0000-4000-8000-000000000001"
USER = "20000000-0000-4000-8000-000000000001"
DOC = "40000000-0000-4000-8000-000000000001"
VERSION = "50000000-0000-4000-8000-000000000001"
KEY = "30000000-0000-4000-8000-000000000001"
HEADERS = {"Authorization": "Bearer valid.test.token"}
PASSWORD = "Contraseña de prueba 2026"
NOW = "2026-10-19T00:00:00Z"


@pytest.fixture(scope="module")
def files():
    return key_files.generate(PASSWORD.encode())


@contextmanager
def app_client(files, *, permissions=None, secret=True, **flags):
    state = {
        "calls": [],
        "data": b"Memorandum original\n",
        "id": DOC,
        "version": VERSION,
        "ready": True,
        "signatures": [],
        "keys": [],
        **flags,
    }
    state["keys"] = [
        {
            "id": KEY,
            "label": "Firma",
            "public_base64": files.public_base64,
            "fingerprint": files.fingerprint,
            "is_active": True,
            "created_at": NOW,
        }
    ]

    def detail():
        return {
            "document": {
                "id": state["id"],
                "title": "Prueba",
                "category": "memorandum",
                "creator_name": "Firmante",
                "issuer_id": state.get("issuer_id", PROFILE),
                "approver_id": state.get("approver_id"),
                "approver_name": "Embajador" if state.get("approver_id") else None,
                "workflow_state": state.get(
                    "workflow_state",
                    "ready_to_send" if state["signatures"] else "draft",
                ),
                "signing_purpose": state.get("signing_purpose", "issuer"),
                "can_request_approval": state.get("can_request_approval", False),
                "can_send": state.get("can_send", bool(state["signatures"])),
                "review_requested_at": None,
                "sent_at": NOW if state.get("workflow_state") == "sent" else None,
                "created_at": NOW,
                "updated_at": NOW,
                "version_id": state["version"],
                "version_number": 1,
                "recipient_count": 1,
                "signer_count": 1,
                "signature_count": len(state["signatures"]),
                "signature_state": "signed" if state["signatures"] else "pending",
                "can_sign": state.get("approval_allowed", False)
                or (not state["signatures"] and state.get("allowed", True)),
            },
            "version": {
                "id": state["version"],
                "version_number": 1,
                "filename": "memo.txt",
                "media_type": "text/plain",
                "size": len(b"Memorandum original\n"),
                "sha256": rsa_pss.sha256(b"Memorandum original\n").hex(),
            },
            "participants": [
                {
                    "id": PROFILE,
                    "display_name": "Firmante",
                    "email": "person@example.test",
                    "can_sign": True,
                    "is_issuer": True,
                    "is_approver": False,
                    "is_recipient": False,
                    "is_active": True,
                }
            ],
            "signatures": state["signatures"],
        }

    def handle(request):
        state["calls"].append(request)
        server = request.headers["apikey"] == "sb_secret_test"
        if server:
            assert "authorization" not in request.headers
        else:
            assert request.headers["apikey"] == "sb_publishable_test"
            assert request.headers["authorization"] == HEADERS["Authorization"]
        path = request.url.path
        if path == "/auth/v1/user":
            return httpx.Response(
                200, json={"id": USER, "app_metadata": {"provider": "google"}}
            )
        if path.endswith("/current_access"):
            return httpx.Response(
                200,
                json={
                    "profile": {
                        "id": PROFILE,
                        "auth_user_id": USER,
                        "email": "person@example.test",
                        "display_name": "Firmante",
                        "role_code": state.get("role", "ambassador"),
                        "is_active": True,
                    },
                    "permissions": [
                        "documents.read_assigned",
                        "documents.create",
                        "documents.sign",
                    ]
                    if permissions is None
                    else permissions,
                },
            )
        if path.startswith("/storage/"):
            assert server
            if request.method == "GET":
                return httpx.Response(200, content=state["data"])
            if request.method == "POST":
                if state.get("fail_upload"):
                    return httpx.Response(503)
                state["data"] = request.content
                assert request.headers["x-upsert"] == "false"
                return httpx.Response(200, json={})
            state["deleted"] = True
            return httpx.Response(200, json={})
        body = json.loads(request.content or "{}")
        if path.endswith("/get_stc_document"):
            if state.get("denied"):
                return httpx.Response(400, json={"code": "PD404"})
            return httpx.Response(200, json=detail())
        if path.endswith("/list_stc_documents"):
            return httpx.Response(
                200,
                json={
                    "items": [detail()["document"]],
                    "total": 1,
                    "limit": 20,
                    "offset": 0,
                    "signed_total": len(state["signatures"]),
                    "pending_total": 0 if state["signatures"] else 1,
                    "category_counts": {
                        "memorandum": 1,
                        "expediente": 0,
                        "nota": 0,
                        "especial": 0,
                        "acuerdo": 0,
                    },
                },
            )
        if path.endswith(("/list_document_candidates", "/list_document_approvers")):
            return httpx.Response(
                200, json={"items": [], "total": 0, "limit": 20, "offset": 0}
            )
        if path.endswith("/list_own_signing_keys"):
            return httpx.Response(200, json={"items": state["keys"]})
        if path.endswith("/retire_signing_key"):
            state["keys"][0]["is_active"] = False
            for s in state["signatures"]:
                s["key_is_active"] = False
            return httpx.Response(204)
        assert server and body["p_actor"] == PROFILE
        if path.endswith("/server_register_signing_key"):
            state["keys"].append(
                {
                    "id": body["p_key_id"],
                    "label": body["p_label"],
                    "public_base64": body["p_public_base64"],
                    "fingerprint": body["p_fingerprint"],
                    "is_active": True,
                    "created_at": NOW,
                }
            )
        elif path.endswith("/server_begin_memorandum"):
            state["id"], state["version"], state["ready"] = (
                body["p_document_id"],
                body["p_version_id"],
                False,
            )
        elif path.endswith("/server_complete_memorandum"):
            state["ready"] = True
            if state.get("lost_completion"):
                return httpx.Response(503)
        elif path.endswith("/server_abort_memorandum"):
            state["aborted"] = not state["ready"]
            return httpx.Response(200, json=state["aborted"])
        elif path.endswith("/server_commit_document_signature"):
            if state.get("revoked_during_sign"):
                return httpx.Response(400, json={"code": "PD409"})
            state["signatures"].append(
                {
                    "id": body["p_signature_id"],
                    "signer_id": PROFILE,
                    "purpose": state.get("signing_purpose", "issuer"),
                    "signer_name": "Firmante",
                    "key_id": KEY,
                    "public_base64": files.public_base64,
                    "fingerprint": files.fingerprint,
                    "key_is_active": True,
                    "signature_base64": body["p_signature_base64"],
                    "created_at": NOW,
                }
            )
        elif path.endswith(
            ("/server_request_memorandum_review", "/server_send_memorandum")
        ):
            if state.get("revoked_during_transition"):
                return httpx.Response(400, json={"code": "PD409"})
            state["workflow_state"] = (
                "pending_approval"
                if path.endswith("/server_request_memorandum_review")
                else "sent"
            )
        else:
            raise AssertionError(path)
        return httpx.Response(200, json=None)

    gateway = SupabaseGateway(
        SupabaseSettings(
            "https://project.supabase.co",
            "sb_publishable_test",
            "sb_secret_test" if secret else None,
        ),
        httpx.AsyncClient(transport=httpx.MockTransport(handle)),
    )
    with TestClient(
        create_app(enable_local_workflow=False, supabase=gateway)
    ) as client:
        yield client, state


def sign_body(files):
    return {
        "key_id": KEY,
        "version_id": VERSION,
        "private_key_base64": files.private_base64,
        "password": PASSWORD,
    }


def create_body():
    return {
        "title": "Prueba",
        "filename": "memo.txt",
        "content_base64": base64.b64encode(b"Memorandum original\n").decode(),
        "recipients": [{"profile_id": str(uuid4())}],
    }


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/api/v1/documents", None),
        ("GET", "/api/v1/documents/recipients", None),
        ("GET", "/api/v1/documents/approvers", None),
        ("POST", f"/api/v1/documents/{DOC}/request-approval", {}),
        ("POST", f"/api/v1/documents/{DOC}/send", {}),
        ("GET", f"/api/v1/documents/{DOC}", None),
        ("GET", f"/api/v1/documents/{DOC}/file", None),
        ("GET", f"/api/v1/documents/{DOC}/verification", None),
        ("GET", "/api/v1/signing/keys", None),
        ("POST", "/api/v1/documents/memoranda", {}),
        ("POST", "/api/v1/signing/keys", {}),
        ("POST", f"/api/v1/documents/{DOC}/signatures", {}),
        ("POST", f"/api/v1/documents/{DOC}/verification", {}),
        ("POST", f"/api/v1/signing/keys/{KEY}/retire", None),
    ],
)
def test_routes_require_session(files, method, path, body):
    with app_client(files) as (client, state):
        assert client.request(method, path, json=body).status_code == 401
        assert not state["calls"]


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/documents",
        f"/api/v1/documents/{DOC}",
        f"/api/v1/documents/{DOC}/file",
        f"/api/v1/documents/{DOC}/verification",
    ],
)
def test_read_permission_required(files, path):
    with app_client(files, permissions=[]) as (client, state):
        assert client.get(path, headers=HEADERS).status_code == 403
        assert len(state["calls"]) == 2


def test_generate_export_sign_verify_download_retire(files):
    with app_client(files) as (client, state):
        created = client.post(
            "/api/v1/signing/keys",
            headers=HEADERS,
            json={
                "label": "Nueva",
                "password": PASSWORD,
                "private_filename": "mi-privada.txt",
                "public_filename": "mi-publica.txt",
            },
        )
        assert created.status_code == 201
        assert created.headers["cache-control"] == "no-store"
        exported = created.json()
        assert exported["private_filename"] == "mi-privada.txt"
        assert (
            key_files.load_private(exported["private_base64"], PASSWORD.encode())
            .public_key()
            .public_numbers()
            == key_files.load_public(exported["key"]["public_base64"]).public_numbers()
        )
        signed = client.post(
            f"/api/v1/documents/{DOC}/signatures",
            headers=HEADERS,
            json=sign_body(files),
        )
        assert signed.status_code == 200, signed.text
        assert len(state["signatures"]) == 1
        checked = client.get(f"/api/v1/documents/{DOC}/verification", headers=HEADERS)
        assert checked.status_code == 200 and checked.json()["all_valid"]
        got = client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS)
        assert base64.b64decode(got.json()["content_base64"]) == state["data"]
        assert (
            client.post(
                f"/api/v1/signing/keys/{KEY}/retire", headers=HEADERS
            ).status_code
            == 204
        )
        assert client.get(
            f"/api/v1/documents/{DOC}/verification", headers=HEADERS
        ).json()["all_valid"]
        assert not client.get(
            f"/api/v1/documents/{DOC}/verification", headers=HEADERS
        ).json()["signatures"][0]["key_is_active"]


def test_created_memorandum_needs_no_group(files):
    with app_client(files) as (client, state):
        response = client.post(
            "/api/v1/documents/memoranda", json=create_body(), headers=HEADERS
        )
        assert response.status_code == 201, response.text
        assert state["ready"]
        sent = json.loads(
            next(
                r.content
                for r in state["calls"]
                if r.url.path.endswith("/server_begin_memorandum")
            )
        )
        assert "group_id" not in sent and sent["p_actor"] == PROFILE
        assert len(sent["p_recipients"]) == 1


@pytest.mark.parametrize(
    "change",
    [
        {"password": "Contraseña incorrecta"},
        {"key_id": str(uuid4())},
        {"version_id": str(uuid4())},
        {"private_key_base64": "invalid-base64"},
    ],
)
def test_wrong_private_key_password_or_version_not_committed(files, change):
    with app_client(files) as (client, state):
        response = client.post(
            f"/api/v1/documents/{DOC}/signatures",
            headers=HEADERS,
            json={**sign_body(files), **change},
        )
        assert response.status_code in (409, 422)
        assert not state["signatures"]
        assert (
            PASSWORD not in response.text and files.private_base64 not in response.text
        )


def test_other_private_key_not_committed(files):
    other = key_files.generate(PASSWORD.encode())
    with app_client(files) as (client, state):
        result = client.post(
            f"/api/v1/documents/{DOC}/signatures",
            headers=HEADERS,
            json={**sign_body(files), "private_key_base64": other.private_base64},
        )
        assert result.status_code == 422 and not state["signatures"]


@pytest.mark.parametrize("flag", ["denied", "revoked_during_sign"])
def test_authorization_and_concurrent_revocation(files, flag):
    with app_client(files, **{flag: True}) as (client, state):
        result = client.post(
            f"/api/v1/documents/{DOC}/signatures",
            headers=HEADERS,
            json=sign_body(files),
        )
        assert result.status_code in (404, 409)
        assert not state["signatures"]


def test_document_modified_in_storage_cannot_be_signed_or_downloaded(files):
    with app_client(files) as (client, state):
        state["data"] = b"Alterado"
        assert (
            client.post(
                f"/api/v1/documents/{DOC}/signatures",
                headers=HEADERS,
                json=sign_body(files),
            ).status_code
            == 422
        )
        assert (
            client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS).status_code
            == 422
        )
        assert not state["signatures"]


def test_modified_upload_fails_verification(files):
    with app_client(files) as (client, state):
        assert (
            client.post(
                f"/api/v1/documents/{DOC}/signatures",
                headers=HEADERS,
                json=sign_body(files),
            ).status_code
            == 200
        )
        result = client.post(
            f"/api/v1/documents/{DOC}/verification",
            headers=HEADERS,
            json={
                "version_id": VERSION,
                "content_base64": base64.b64encode(b"Alterado").decode(),
            },
        )
        assert result.status_code == 200
        assert (
            result.json()["content_matches"] is False
            and result.json()["all_valid"] is False
        )
        assert result.json()["signatures"][0]["valid"] is False


def test_unsigned_hash_match_is_not_reported_as_valid_signature(files):
    with app_client(files) as (client, _):
        result = client.get(
            f"/api/v1/documents/{DOC}/verification", headers=HEADERS
        ).json()
        assert (
            result["content_matches"]
            and not result["all_valid"]
            and result["signatures"] == []
        )


@pytest.mark.parametrize(
    "patch",
    [
        {"recipients": []},
        {"recipients": [{"profile_id": PROFILE, "can_sign": False}]},
        {"recipients": [{"profile_id": PROFILE}] * 2},
        {"group_id": str(uuid4())},
        {"category": "especial"},
        {"filename": "../secreto.txt"},
        {"title": "\n"},
        {"content_base64": "$invalid"},
    ],
)
def test_invalid_creation_not_published(files, patch):
    with app_client(files) as (client, state):
        response = client.post(
            "/api/v1/documents/memoranda",
            headers=HEADERS,
            json={**create_body(), **patch},
        )
        assert response.status_code == 422
        assert not any(
            r.url.path.endswith("/server_begin_memorandum") for r in state["calls"]
        )


@pytest.mark.parametrize(
    "patch",
    [
        {"private_filename": "../privada.txt"},
        {
            "public_filename": "clave-privada.txt",
            "private_filename": "CLAVE-PRIVADA.TXT",
        },
        {"password": "corta"},
        {"label": "\n"},
        {"actor_profile_id": PROFILE},
    ],
)
def test_key_inputs_validated(files, patch):
    with app_client(files) as (client, state):
        body = {
            "label": "Firma",
            "password": PASSWORD,
            "private_filename": "privada.txt",
            "public_filename": "publica.txt",
            **patch,
        }
        assert (
            client.post("/api/v1/signing/keys", headers=HEADERS, json=body).status_code
            == 422
        )
        assert not any(
            r.url.path.endswith("/server_register_signing_key") for r in state["calls"]
        )


def test_upload_failure_aborts_and_cleans_private_object(files):
    with app_client(files, fail_upload=True) as (client, state):
        assert (
            client.post(
                "/api/v1/documents/memoranda", headers=HEADERS, json=create_body()
            ).status_code
            == 503
        )
        assert state["aborted"] and state["deleted"] and not state["ready"]


def test_lost_completion_response_never_deletes_ready_file(files):
    with app_client(files, lost_completion=True) as (client, state):
        assert (
            client.post(
                "/api/v1/documents/memoranda", headers=HEADERS, json=create_body()
            ).status_code
            == 503
        )
        assert state["ready"] and not state["aborted"] and not state.get("deleted")


def test_secret_required_and_never_returned(files):
    with app_client(files, secret=False) as (client, state):
        response = client.post(
            "/api/v1/signing/keys",
            headers=HEADERS,
            json={
                "label": "Firma",
                "password": PASSWORD,
                "private_filename": "privada.txt",
                "public_filename": "publica.txt",
            },
        )
        assert response.status_code == 503
        assert "sb_secret_test" not in response.text
        assert not any(
            r.url.path.endswith("/server_register_signing_key") for r in state["calls"]
        )
    assert "sb_secret_test" not in repr(
        SupabaseSettings(
            "https://project.supabase.co", "sb_publishable_test", "sb_secret_test"
        )
    )


@pytest.mark.parametrize("secret", ["sb_publishable_bad", "eyJ.legacy.jwt", "invalid"])
def test_server_config_rejects_other_key_types(secret):
    with pytest.raises(ValueError):
        SupabaseSettings("https://project.supabase.co", "sb_publishable_test", secret)


def test_key_files_password_base64_and_exact_profile(files):
    assert files.private_base64 not in repr(files)
    private = key_files.load_private(files.private_base64, PASSWORD.encode())
    public = key_files.load_public(files.public_base64)
    assert private.key_size == 2048 and public.public_numbers().e == 65537
    assert files.fingerprint == rsa_pss.sha256(key_files.public_bytes(public)).hex()
    for value in ["", "$", "A" * 20000]:
        with pytest.raises(rsa_pss.SignatureError):
            key_files.decode_key(value)
    with pytest.raises(rsa_pss.SignatureError):
        key_files.load_private(files.private_base64, b"Incorrecta")


def signed_state(client, files):
    response = client.post(
        f"/api/v1/documents/{DOC}/signatures", headers=HEADERS, json=sign_body(files)
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("review", [False, True])
def test_transition_verifies_crypto_and_uses_server_channel(files, review):
    with app_client(files) as (client, state):
        signed_state(client, files)
        state["can_request_approval"] = review
        path = "request-approval" if review else "send"
        response = client.post(
            f"/api/v1/documents/{DOC}/{path}",
            headers=HEADERS,
            json={"version_id": VERSION},
        )
        assert response.status_code == 200, response.text
        assert response.json()["document"]["workflow_state"] == (
            "pending_approval" if review else "sent"
        )
        call = state["calls"][-2]
        assert call.headers["apikey"] == "sb_secret_test"
        assert json.loads(call.content)["p_actor"] == PROFILE


@pytest.mark.parametrize(
    "problem",
    [
        "unsigned",
        "wrong_version",
        "wrong_issuer",
        "legacy",
        "bad_signature",
        "changed_file",
        "revoked",
        "not_allowed",
    ],
)
@pytest.mark.parametrize("review", [False, True])
def test_failed_transition_never_publishes(files, problem, review):
    with app_client(files) as (client, state):
        if problem != "unsigned":
            signed_state(client, files)
        state["can_request_approval"] = problem not in ("unsigned", "not_allowed")
        if problem == "wrong_issuer":
            state["issuer_id"] = str(uuid4())
        if problem == "legacy":
            state["workflow_state"] = "legacy_shared"
        if problem == "bad_signature":
            state["signatures"][0]["signature_base64"] = base64.b64encode(
                bytes(256)
            ).decode()
        if problem == "changed_file":
            state["data"] = b"Modificado"
        if problem == "revoked":
            state["revoked_during_transition"] = True
        if problem == "not_allowed":
            state["can_send"] = False
        path = "request-approval" if review else "send"
        response = client.post(
            f"/api/v1/documents/{DOC}/{path}",
            headers=HEADERS,
            json={
                "version_id": str(uuid4()) if problem == "wrong_version" else VERSION
            },
        )
        assert response.status_code in (403, 409, 422), response.text
        assert state.get("workflow_state") not in ("pending_approval", "sent")
        if problem != "revoked":
            assert not any(
                r.url.path.endswith(
                    ("/server_send_memorandum", "/server_request_memorandum_review")
                )
                for r in state["calls"]
            )


def test_approval_checks_issuer_signature_before_signing(files):
    with app_client(files) as (client, state):
        signed_state(client, files)
        state["signing_purpose"] = "approval"
        state["signatures"][0]["signature_base64"] = base64.b64encode(
            bytes(256)
        ).decode()
        # El backend verifica aunque SQL anuncie una acción disponible.
        state["allowed"] = True
        # Permitir la aprobación después de la firma del emisor.
        state["approval_allowed"] = True
        response = client.post(
            f"/api/v1/documents/{DOC}/signatures",
            headers=HEADERS,
            json=sign_body(files),
        )
        assert response.status_code == 422, response.text
        assert len(state["signatures"]) == 1


@pytest.mark.parametrize("role", ["admin", "staff", "ambassador"])
def test_emitter_key_generation_uses_permission_not_fixed_role(files, role):
    with app_client(files, role=role) as (client, _):
        response = client.post(
            "/api/v1/signing/keys",
            headers=HEADERS,
            json={
                "label": "Emisión",
                "password": PASSWORD,
                "private_filename": "privada.txt",
                "public_filename": "publica.txt",
            },
        )
        assert response.status_code == 201


def test_approver_uuid_from_json_is_forwarded_to_database(files):
    approver = str(uuid4())
    with app_client(files) as (client, state):
        response = client.post(
            "/api/v1/documents/memoranda",
            headers=HEADERS,
            json={**create_body(), "approver_id": approver},
        )
        assert response.status_code == 201, response.text
        call = next(
            r for r in state["calls"] if r.url.path.endswith("/server_begin_memorandum")
        )
        assert json.loads(call.content)["p_approver"] == approver


@pytest.mark.parametrize("action", ["send", "request-approval"])
def test_delivery_actions_require_creator_permission(files, action):
    with app_client(files, permissions=["documents.read_assigned"]) as (client, state):
        response = client.post(
            f"/api/v1/documents/{DOC}/{action}",
            headers=HEADERS,
            json={"version_id": VERSION},
        )
        assert response.status_code == 403
        assert not any(
            r.url.path.endswith(
                ("/server_send_memorandum", "/server_request_memorandum_review")
            )
            for r in state["calls"]
        )


@pytest.mark.parametrize("action", ["send", "request-approval"])
def test_delivery_actions_reject_forged_actor(files, action):
    with app_client(files) as (client, _):
        response = client.post(
            f"/api/v1/documents/{DOC}/{action}",
            headers=HEADERS,
            json={"version_id": VERSION, "actor_profile_id": str(uuid4())},
        )
        assert response.status_code == 422


@pytest.mark.parametrize("stage", ["sent", "legacy_shared"])
def test_closed_documents_cannot_get_additional_signature(files, stage):
    with app_client(files, workflow_state=stage) as (client, state):
        result = client.post(
            f"/api/v1/documents/{DOC}/signatures",
            headers=HEADERS,
            json=sign_body(files),
        )
        assert result.status_code == 409
        assert not state["signatures"]
