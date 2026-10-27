"""HTTP, AES/Shamir reales y contrato de Storage; RLS se comprueba además en SQL."""

import base64
import json
from contextlib import contextmanager
from functools import lru_cache
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import SupabaseSettings
from app.crypto.key_wrapping.share_envelope import ShareEnvelope, open_share
from app.crypto.shamir import serialize_share
from app.crypto.signatures import key_files
from app.crypto.signatures.rsa_pss import sha256
from app.infrastructure.supabase import SupabaseGateway
from app.main import create_app
from app.modules.documents.schemas import RecoverRequest
from app.modules.documents.service import recover_note
from app.modules.encryption_keys.service import generate_files

ACTOR = "10000000-0000-4000-8000-000000000002"
PEER = "10000000-0000-4000-8000-000000000003"
USER = "20000000-0000-4000-8000-000000000002"
GROUP = "30000000-0000-4000-8000-000000000001"
HEADERS = {"Authorization": "Bearer test.note.session"}
NOW = "2026-10-22T00:00:00Z"
PASSWORD = "clave-de-cifrado-segura"


@lru_cache
def keys_fixture():
    return [generate_files(PASSWORD.encode()) for _ in range(2)]


ORIGINAL = "Acuerdo diplomático de prueba\n".encode()


@contextmanager
def client(*, secret=True, permissions=None, **flags):
    state = {
        "calls": [],
        "note": None,
        "header": None,
        "digest": None,
        "storage": None,
        "receipt_hash": "",
        "keys": {},
        "envelopes": [],
        **flags,
    }

    for index, (actor, files) in enumerate(
        zip([ACTOR, PEER], keys_fixture(), strict=True)
    ):
        key_id = f"50000000-0000-4000-8000-{index + 1:012d}"
        state["keys"][key_id] = {
            "id": key_id,
            "profile_id": actor,
            "label": "Clave de prueba",
            "public_base64": files.public_base64,
            "fingerprint": files.fingerprint,
            "state": "active",
            "created_at": NOW,
            "activated_at": NOW,
            "retired_at": None,
        }

    def detail():
        return {
            "note": state["note"],
            "participants": [
                {
                    "profile_id": ACTOR,
                    "display_name": "Emisor",
                    "email": "issuer@example.test",
                    "group_role": "member",
                    "share_index": 1,
                    "encryption_key_id": "50000000-0000-4000-8000-000000000001",
                    "encryption_fingerprint": keys_fixture()[0].fingerprint,
                },
                {
                    "profile_id": PEER,
                    "display_name": "Participante",
                    "email": "peer@example.test",
                    "group_role": "manager",
                    "share_index": 2,
                    "encryption_key_id": "50000000-0000-4000-8000-000000000002",
                    "encryption_fingerprint": keys_fixture()[1].fingerprint,
                },
            ],
            "package_header": state["header"],
            "ciphertext_sha256": state["digest"],
        }

    def handle(request):
        state["calls"].append(request)
        server = request.headers["apikey"] == "sb_secret_test"
        if server:
            assert "authorization" not in request.headers
        else:
            assert request.headers["authorization"] == HEADERS["Authorization"]
        actor = state.get("actor", ACTOR)
        user = actor.replace("10000000", "20000000")
        path = request.url.path
        if path == "/auth/v1/user":
            return httpx.Response(
                200, json={"id": user, "app_metadata": {"provider": "google"}}
            )
        if path.endswith("/current_access"):
            return httpx.Response(
                200,
                json={
                    "profile": {
                        "id": actor,
                        "auth_user_id": user,
                        "email": "issuer@example.test",
                        "display_name": "Emisor",
                        "role_code": "staff",
                        "is_active": True,
                    },
                    "permissions": [
                        "documents.create",
                        "documents.read_assigned",
                        "recovery.request",
                    ]
                    if permissions is None
                    else permissions,
                },
            )
        if path.startswith("/storage/"):
            assert server and "/stc-documents/special-notes/" in path
            if request.method == "POST":
                assert request.headers["x-upsert"] == "false"
                if state.get("fail_storage"):
                    return httpx.Response(503)
                state["storage"] = request.content
                return httpx.Response(200, json={})
            if request.method == "DELETE":
                state["deleted"] = True
                if state.get("fail_delete"):
                    return httpx.Response(503)
                state["storage"] = None
                return httpx.Response(200, json={})
            return httpx.Response(200, content=state.get("tampered", state["storage"]))
        body = json.loads(request.content or "{}")
        if path.endswith("/server_begin_distributed_note"):
            assert server and body["p_actor"] == ACTOR
            if state.get("begin_error"):
                return httpx.Response(400, json={"code": state["begin_error"]})
            if state["note"] is not None:
                return httpx.Response(400, json={"code": "PN409"})
            state["note"] = {
                "id": body["p_note_id"],
                "group_id": GROUP,
                "group_name": "Grupo original",
                "group_version": body["p_expected_version"],
                "title": body["p_title"],
                "created_by": ACTOR,
                "creator_name": "Emisor",
                "filename": body["p_filename"],
                "media_type": body["p_media_type"],
                "size": body["p_size"],
                "participant_count": 2,
                "threshold": 2,
                "custody_mode": "individual-v1",
                "state": "staging",
                "created_at": NOW,
                "ready_at": None,
            }
            result = detail()
            if state.get("invalid_snapshot"):
                result["participants"] = []
            return httpx.Response(
                200, json={"detail": result, "keys": list(state["keys"].values())[:2]}
            )
        if path.endswith("/server_commit_distributed_note"):
            assert server
            if state.get("fail_commit"):
                return httpx.Response(503)
            state["header"] = body["p_header"]
            state["digest"] = body["p_ciphertext_sha256"]
            state["envelopes"] = body["p_envelopes"]
            state["note"]["state"] = "ready"
            state["note"]["ready_at"] = NOW
            if state.get("lost_commit_response"):
                return httpx.Response(503)
            return httpx.Response(200, json=None)
        if path.endswith("/server_cancel_group_note"):
            assert server
            if state["note"]["state"] == "cancelled" or (
                body["p_staging_only"] and state["note"]["state"] != "staging"
            ):
                return httpx.Response(200, json=False)
            if state["note"]["state"] == "ready":
                return httpx.Response(400, json={"code": "PN409"})
            state["note"]["state"] = "cancelled"
            return httpx.Response(200, json=True)
        if path.endswith("/server_confirm_group_note"):
            assert server and body["p_actor"] == ACTOR
            if state["note"]["custody_mode"] != "portable":
                return httpx.Response(400, json={"code": "PN409"})
            if body["p_receipt_sha256"] != state["receipt_hash"]:
                return httpx.Response(400, json={"code": "PN422"})
            state["note"]["state"] = "ready"
            state["note"]["ready_at"] = NOW
            return httpx.Response(200, json=None)
        if path.endswith("/get_group_note"):
            assert not server
            if state.get("read_denied"):
                return httpx.Response(400, json={"code": "PN404"})
            return httpx.Response(200, json=detail())
        if path.endswith("/list_group_notes"):
            return httpx.Response(
                200,
                json={
                    "items": [] if state["note"] is None else [state["note"]],
                    "total": int(state["note"] is not None),
                    "limit": 20,
                    "offset": 0,
                },
            )
        if path.endswith("/list_note_groups"):
            return httpx.Response(
                200, json={"items": [], "total": 0, "limit": 20, "offset": 0}
            )
        if path.endswith("/get_own_note_share"):
            if state.get("share_denied") or state["note"]["state"] != "ready":
                return httpx.Response(400, json={"code": "PN404"})
            envelope = next(
                (
                    e
                    for e in state["envelopes"]
                    if e["context"]["recipient_id"] == actor
                ),
                None,
            )
            return (
                httpx.Response(200, json=state.get("tampered_envelope", envelope))
                if envelope
                else httpx.Response(400, json={"code": "PN404"})
            )
        if path.endswith("/list_own_encryption_keys"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        k for k in state["keys"].values() if k["profile_id"] == actor
                    ]
                },
            )
        if path.endswith("/get_own_encryption_key"):
            key = state["keys"].get(body["p_key_id"])
            return (
                httpx.Response(200, json=key)
                if key and key["profile_id"] == actor
                else httpx.Response(400, json={"code": "PK404"})
            )
        if path.endswith("/server_register_encryption_key"):
            assert server and body["p_actor"] == actor
            if state.get("key_error"):
                return httpx.Response(400, json={"code": state["key_error"]})
            state["keys"][body["p_key_id"]] = {
                "id": body["p_key_id"],
                "profile_id": actor,
                "label": body["p_label"],
                "public_base64": body["p_public_base64"],
                "fingerprint": body["p_fingerprint"],
                "state": "pending",
                "created_at": NOW,
                "activated_at": None,
                "retired_at": None,
            }
            return httpx.Response(200, json=None)
        if path.endswith("/server_activate_encryption_key"):
            assert server and body["p_actor"] == actor
            key = state["keys"][body["p_key_id"]]
            if key["state"] == "retired":
                return httpx.Response(400, json={"code": "PK409"})
            for old in state["keys"].values():
                if old["profile_id"] == actor and old["state"] == "active":
                    old["state"] = "retired"
                    old["retired_at"] = NOW
            key["state"] = "active"
            key["activated_at"] = NOW
            key["retired_at"] = None
            return httpx.Response(200, json=None)
        if path.endswith("/retire_encryption_key"):
            assert not server
            key = state["keys"].get(body["p_key_id"])
            if not key or key["profile_id"] != actor:
                return httpx.Response(400, json={"code": "PK404"})
            key["state"] = "retired"
            key["retired_at"] = NOW
            return httpx.Response(200, json=None)
        raise AssertionError(path)

    gateway = SupabaseGateway(
        SupabaseSettings(
            "https://notes.example.test",
            "sb_publishable_test",
            "sb_secret_test" if secret else None,
        ),
        httpx.AsyncClient(transport=httpx.MockTransport(handle)),
    )
    # El feature persistente no depende del flag de demo portable.
    with TestClient(create_app(supabase=gateway, enable_local_workflow=False)) as app:
        yield app, state


def body(data=ORIGINAL, **changes):
    return {
        "request_id": str(uuid4()),
        "group_id": GROUP,
        "group_version": 1,
        "title": "Nota de prueba",
        "filename": "acuerdo.txt",
        "media_type": "text/plain",
        "content_base64": base64.b64encode(data).decode("ascii"),
        **changes,
    }


def create(app, payload=None):
    return app.post(
        "/api/v1/group-notes",
        headers=HEADERS,
        json=body() if payload is None else payload,
    )


def test_real_crypto_roundtrip_snapshot_and_storage_only_ciphertext():
    with client() as (app, state):
        response = create(app)
        assert response.status_code == 201, response.text
        result = response.json()
        assert result["note"]["state"] == "ready"
        assert result["note"]["custody_mode"] == "individual-v1"
        assert result["note"]["threshold"] == 2
        assert "shares" not in result and "backup_receipt" not in result
        target = result["note"]["id"]
        pkg = app.get(f"/api/v1/group-notes/{target}/package", headers=HEADERS).json()
        assert state["storage"] != ORIGINAL and len(state["storage"]) == len(ORIGINAL)
        assert state["storage"] == base64.b64decode(pkg["ciphertext_base64"])
        opened = []
        for i, envelope in enumerate(state["envelopes"]):
            sealed = ShareEnvelope.model_validate(envelope)
            private = key_files.load_private(
                keys_fixture()[i].private_base64, PASSWORD.encode()
            )
            opened.append(serialize_share(open_share(sealed, private, sealed.context)))
        recovered = recover_note(RecoverRequest(package=pkg, shares=opened))
        assert base64.b64decode(recovered.content_base64) == ORIGINAL
        for call in state["calls"]:
            if "/rest/" in call.url.path:
                assert ORIGINAL not in call.content
                assert all(part.encode() not in call.content for part in opened)
        assert all(part not in response.text for part in opened)
        assert all(
            files.private_base64 not in response.text for files in keys_fixture()
        )


def seed_portable(app, state):
    result = create(app).json()
    state["note"]["custody_mode"] = "portable"
    state["note"]["state"] = "awaiting_backup"
    state["note"]["ready_at"] = None
    state["envelopes"] = []
    receipt = "p" * 43
    state["receipt_hash"] = sha256(receipt.encode()).hex()
    return result["note"]["id"], receipt


def test_existing_portable_note_can_still_confirm_and_retrieve_package():
    with client() as (app, state):
        target, receipt = seed_portable(app, state)
        confirmed = app.post(
            f"/api/v1/group-notes/{target}/confirm-backup",
            headers=HEADERS,
            json={"backup_receipt": receipt},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["note"]["state"] == "ready"
        assert (
            app.get(
                f"/api/v1/group-notes/{target}/package", headers=HEADERS
            ).status_code
            == 200
        )
        listed = app.get("/api/v1/group-notes", headers=HEADERS)
        assert listed.status_code == 200 and listed.json()["total"] == 1
        assert "shares" not in listed.text and "backup_receipt" not in listed.text


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "   "},
        {"title": "x\ncontrol"},
        {"filename": "../a.txt"},
        {"group_version": True},
        {"group_version": 0},
        {"group_id": "incorrecto"},
        {"request_id": "incorrecto"},
        {"actor": ACTOR},
        {"share_count": 2},
        {"threshold": 1},
        {"content_base64": "*invalido*"},
        {"custody_mode": "portable"},
    ],
)
def test_invalid_inputs_never_start_storage(payload):
    with client() as (app, state):
        response = create(app, body(**payload))
        assert response.status_code == 422
        assert not any(
            "/server_begin_" in r.url.path or "/storage/" in r.url.path
            for r in state["calls"]
        )
        assert "input" not in response.json()["detail"]


def test_missing_auth_and_permissions():
    with client() as (app, state):
        assert app.post("/api/v1/group-notes", json=body()).status_code == 401
        assert state["note"] is None
    with client(permissions=["documents.read_assigned"]) as (app, state):
        assert create(app).status_code == 403
        assert app.get("/api/v1/group-notes/groups", headers=HEADERS).status_code == 403
        assert state["note"] is None


@pytest.mark.parametrize(
    ("code", "status"),
    [("PN403", 403), ("PN404", 404), ("PN409", 409), ("PN422", 422), ("PN428", 409)],
)
def test_group_failures_before_encryption(code, status):
    with client(begin_error=code) as (app, state):
        assert create(app).status_code == status
        assert not any("/storage/" in r.url.path for r in state["calls"])


def test_secret_required_but_not_for_reading_groups():
    with client(secret=False) as (app, state):
        assert create(app).status_code == 503
        assert state["note"] is None
        assert app.get("/api/v1/group-notes/groups", headers=HEADERS).status_code == 200


@pytest.mark.parametrize("failure", ["fail_storage", "fail_commit", "invalid_snapshot"])
def test_failure_cancels_unfinished_note(failure):
    with client(**{failure: True}) as (app, state):
        assert create(app).status_code == 503
        assert state["note"]["state"] == "cancelled"
        assert state["storage"] is None


def test_lost_publication_response_does_not_delete_ready_note():
    with client(lost_commit_response=True) as (app, state):
        assert create(app).status_code == 503
        assert state["note"]["state"] == "ready"
        assert state["storage"] is not None and not state.get("deleted")
        target = state["note"]["id"]
        assert (
            app.get(
                f"/api/v1/group-notes/{target}/my-share", headers=HEADERS
            ).status_code
            == 200
        )


def test_wrong_legacy_receipt_and_distributed_downgrade():
    with client() as (app, state):
        result = create(app).json()
        target = result["note"]["id"]
        assert (
            app.post(
                f"/api/v1/group-notes/{target}/confirm-backup",
                headers=HEADERS,
                json={"backup_receipt": "a" * 43},
            ).status_code
            == 409
        )
        state["note"]["custody_mode"] = "portable"
        state["note"]["state"] = "awaiting_backup"
        state["note"]["ready_at"] = None
        response = app.post(
            f"/api/v1/group-notes/{target}/confirm-backup",
            headers=HEADERS,
            json={"backup_receipt": "a" * 43},
        )
        assert response.status_code == 422 and "a" * 43 not in response.text
        assert (
            app.post(
                f"/api/v1/group-notes/{target}/confirm-backup",
                headers=HEADERS,
                json={"backup_receipt": "short"},
            ).status_code
            == 422
        )


def test_ciphertext_modification_is_detected():
    with client() as (app, state):
        target = create(app).json()["note"]["id"]
        state["tampered"] = bytes([state["storage"][0] ^ 1]) + state["storage"][1:]
        response = app.get(f"/api/v1/group-notes/{target}/package", headers=HEADERS)
        assert (
            response.status_code == 422
            and response.json()["detail"]["code"] == "note_storage_integrity"
        )


def test_read_denied_before_storage():
    with client() as (app, state):
        target = create(app).json()["note"]["id"]
        state["read_denied"] = True
        assert (
            app.get(
                f"/api/v1/group-notes/{target}/package", headers=HEADERS
            ).status_code
            == 404
        )
        assert not any(
            r.method == "GET" and "/storage/" in r.url.path for r in state["calls"]
        )


def test_idempotency_and_cancel_guard():
    with client() as (app, state):
        payload = body()
        result = create(app, payload).json()
        target = result["note"]["id"]
        assert create(app, payload).status_code == 409
        assert (
            sum(
                r.method == "POST" and "/storage/" in r.url.path for r in state["calls"]
            )
            == 1
        )
        assert (
            app.post(
                f"/api/v1/group-notes/{target}/cancel", headers=HEADERS
            ).status_code
            == 409
        )
        assert state["storage"] is not None
        state["note"]["state"] = "staging"
        state["note"]["ready_at"] = None
        assert (
            app.post(
                f"/api/v1/group-notes/{target}/cancel", headers=HEADERS
            ).status_code
            == 204
        )
        assert state["note"]["state"] == "cancelled" and state["storage"] is None
        assert (
            app.get(
                f"/api/v1/group-notes/{target}/package", headers=HEADERS
            ).status_code
            == 409
        )


def test_empty_document_keeps_tag():
    with client() as (app, state):
        response = create(app, body(b""))
        assert response.status_code == 201, response.text
        assert (
            state["storage"] == b""
            and len(base64.b64decode(response.json()["package_header"]["tag_base64"]))
            == 16
        )


@pytest.mark.parametrize("query", ["?limit=0", "?offset=-1", "?search=" + "a" * 81])
def test_invalid_pagination(query):
    with client() as (app, _):
        assert (
            app.get("/api/v1/group-notes" + query, headers=HEADERS).status_code == 422
        )


def test_each_account_only_receives_its_own_envelope():
    with client() as (app, state):
        target = create(app).json()["note"]["id"]
        for actor in [ACTOR, PEER]:
            state["actor"] = actor
            response = app.get(
                f"/api/v1/group-notes/{target}/my-share", headers=HEADERS
            )
            assert response.status_code == 200
            assert response.json()["context"]["recipient_id"] == actor
            assert response.json()["context"]["note_id"] == target
            assert "y" not in response.json()


def test_check_success_wrong_password_wrong_key_and_retired_key():
    with client() as (app, state):
        target = create(app).json()["note"]["id"]
        path = f"/api/v1/group-notes/{target}/my-share/check"
        payload = {
            "private_key_base64": keys_fixture()[0].private_base64,
            "password": PASSWORD,
        }
        assert (
            app.post(
                path, headers=HEADERS, json={**payload, "password": "wrong-password"}
            ).status_code
            == 422
        )
        assert (
            app.post(
                path,
                headers=HEADERS,
                json={
                    **payload,
                    "private_key_base64": keys_fixture()[1].private_base64,
                },
            ).status_code
            == 422
        )
        response = app.post(path, headers=HEADERS, json=payload)
        assert response.status_code == 200 and response.json()["valid"] is True
        assert (
            "share" not in response.json()
            and payload["private_key_base64"] not in response.text
        )
        state["keys"]["50000000-0000-4000-8000-000000000001"]["state"] = "retired"
        assert app.post(path, headers=HEADERS, json=payload).status_code == 200


def test_check_rejects_bit_flip_with_valid_base64():
    with client() as (app, state):
        target = create(app).json()["note"]["id"]
        envelope = dict(state["envelopes"][0])
        raw = bytearray(base64.b64decode(envelope["ciphertext_base64"]))
        raw[0] ^= 1
        envelope["ciphertext_base64"] = base64.b64encode(raw).decode()
        state["tampered_envelope"] = envelope
        response = app.post(
            f"/api/v1/group-notes/{target}/my-share/check",
            headers=HEADERS,
            json={
                "private_key_base64": keys_fixture()[0].private_base64,
                "password": PASSWORD,
            },
        )
        assert (
            response.status_code == 422
            and response.json()["detail"]["code"] == "share_integrity_failed"
        )


def test_share_denial_before_private_key_load():
    with client() as (app, state):
        target = create(app).json()["note"]["id"]
        state["share_denied"] = True
        response = app.post(
            f"/api/v1/group-notes/{target}/my-share/check",
            headers=HEADERS,
            json={
                "private_key_base64": keys_fixture()[0].private_base64,
                "password": PASSWORD,
            },
        )
        assert response.status_code == 404
        assert not any(
            r.url.path.endswith("/get_own_encryption_key") for r in state["calls"]
        )
