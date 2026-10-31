"""Gateway HTTP con criptografía real. RLS y grants se prueban además en SQL."""

import base64
import json
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import UUID, uuid4

import httpx
import pytest

from app.core.config import SupabaseSettings
from app.core.errors import ServiceError
from app.infrastructure.supabase import SupabaseGateway
from app.modules.personnel_files import persistence
from app.modules.personnel_files.schemas import OpenPersonnelFile
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
NOW = "2026-10-30T00:00:00Z"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def session(profile_id=OWNER):
    return replace(principal(profile_id), token=str(profile_id))


def opening(state, registered, profile_id=RECIPIENT, **changes):
    key, files = registered[profile_id]
    return OpenPersonnelFile.model_validate(
        {
            "version_id": state["file"]["version_id"],
            "key_id": key.id,
            "password": PASSWORD,
            "private_key_base64": files.private_base64,
            **changes,
        }
    )


@asynccontextmanager
async def transport(registered, *, secret=True, **flags):
    state = {
        "calls": [],
        "file": None,
        "participants": [],
        "stored": None,
        "material": None,
        "downloads": 0,
        **flags,
    }
    keys = {
        str(value[0].id): value[0].model_dump(mode="json")
        for value in registered.values()
    }

    def detail():
        return {"file": state["file"], "participants": state["participants"]}

    def error(code):
        return httpx.Response(400, json={"code": code, "message": "Detalle interno"})

    def visible(actor):
        return (
            state["file"]
            and any(p["profile_id"] == str(actor) for p in state["participants"])
            and (
                state["file"]["state"] == "ready"
                or state["file"]["created_by"] == str(actor)
            )
        )

    def handle(req):
        state["calls"].append(req)
        body = json.loads(req.content) if req.url.path.startswith("/rest/") else {}
        if req.headers["apikey"] == "sb_publishable_personnel_test":
            # Acepta el token por perfil del contrato de persistencia y el JWT
            # de prueba usado por la suite HTTP, sin cambiar el header recibido.
            actor = UUID(
                req.headers["authorization"].removeprefix("Bearer ").split(".", 1)[0]
            )
        else:
            assert req.headers["apikey"] == "sb_secret_personnel_test"
            assert "authorization" not in req.headers
            actor = UUID(body["p_actor"]) if "p_actor" in body else None
        operation = req.url.path.rsplit("/", 1)[-1]
        if operation == "server_begin_personnel_file":
            if state.get("begin_error"):
                return error(state["begin_error"])
            state["file"] = {
                "id": body["p_document_id"],
                "version_id": body["p_version_id"],
                "created_by": str(actor),
                "title": body["p_title"],
                "filename": body["p_filename"],
                "media_type": body["p_media_type"],
                "size": body["p_size"],
                "state": "staging",
                "created_at": NOW,
                "ready_at": None,
            }
            profiles = {r["profile_id"] for r in body["p_recipients"]} | {str(actor)}
            selected = [key for key in keys.values() if key["profile_id"] in profiles]
            state["participants"] = [
                {
                    "profile_id": key["profile_id"],
                    "display_name": "Persona",
                    "email": "persona@example.test",
                    "key_id": key["id"],
                    "fingerprint": key["fingerprint"],
                    "is_active": True,
                }
                for key in sorted(selected, key=lambda k: k["profile_id"])
            ]
            if state.get("lost_begin"):
                return httpx.Response(503)
            result = {"detail": detail(), "keys": selected}
            if state.get("bad_reservation") == "keys":
                result["keys"] = []
            if state.get("bad_reservation") == "owner":
                result["detail"]["file"] = {
                    **state["file"],
                    "created_by": str(OUTSIDER),
                }
            return httpx.Response(200, json=result)
        if operation == "server_commit_personnel_file":
            if state.get("commit_error"):
                return error(state["commit_error"])
            state["material"] = {
                "header": body["p_header"],
                "nonce_base64": body["p_nonce_base64"],
                "tag_base64": body["p_tag_base64"],
                "ciphertext_sha256": body["p_ciphertext_sha256"],
            }
            state["file"]["state"] = "ready"
            state["file"]["ready_at"] = NOW
            return (
                httpx.Response(503) if state.get("lost_commit") else httpx.Response(204)
            )
        if operation == "server_cancel_personnel_file":
            if state.get("cancel_error"):
                return httpx.Response(503)
            if not state["file"] or state["file"]["state"] == "ready":
                return httpx.Response(200, json=False)
            state["file"]["state"] = "cancelled"
            return httpx.Response(200, json=True)
        if operation == "get_personnel_file":
            return (
                httpx.Response(200, json=detail()) if visible(actor) else error("PF404")
            )
        if operation == "list_personnel_files":
            items = [state["file"]] if visible(actor) else []
            return httpx.Response(
                200,
                json={
                    "items": items,
                    "total": len(items),
                    "limit": body["p_limit"],
                    "offset": body["p_offset"],
                },
            )
        if operation == "server_personnel_file_material":
            if not visible(actor) or state["file"]["state"] != "ready":
                return error("PF404")
            result = {"detail": detail(), **state["material"]}
            if state.get("bad_material") == "nonce":
                result["nonce_base64"] = "!" * 16
            if state.get("bad_material") == "identity":
                result["header"] = {**result["header"], "document_id": str(uuid4())}
            return httpx.Response(200, json=result)
        if operation == "get_own_encryption_key":
            key = keys.get(body["p_key_id"])
            return (
                httpx.Response(200, json=key)
                if key and key["profile_id"] == str(actor)
                else error("PK404")
            )
        if operation == "server_complete_personnel_download":
            if state.get("deny_final"):
                return error("PF404")
            state["downloads"] += 1
            return httpx.Response(204)
        if req.url.path.startswith("/storage/v1/object/stc-documents/personnel-files/"):
            if req.method == "POST":
                assert req.headers["x-upsert"] == "false"
                assert req.headers["content-type"] == "application/octet-stream"
                state["stored"] = req.content
                return (
                    httpx.Response(503)
                    if state.get("upload_error")
                    else httpx.Response(200)
                )
            if req.method == "GET":
                data = state["stored"]
                if state.get("bad_storage"):
                    data = bytes([data[0] ^ 1]) + data[1:]
                return httpx.Response(200, content=data)
            if req.method == "DELETE":
                state["stored"] = None
                return httpx.Response(200)
        raise AssertionError(req.url.path)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    gateway = SupabaseGateway(
        SupabaseSettings(
            "https://personnel.example.test",
            "sb_publishable_personnel_test",
            "sb_secret_personnel_test" if secret else None,
        ),
        client,
    )
    try:
        yield gateway, state
    finally:
        await gateway.close()


async def test_create_persists_only_ciphertext_and_protected_keys(registered):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        assert result.file.state == "ready"
        assert state["stored"] != ORIGINAL and len(state["stored"]) == len(ORIGINAL)
        assert len(state["material"]["header"]["envelopes"]) == 2
        for req in state["calls"]:
            if req.url.path.startswith("/rest/"):
                assert ORIGINAL not in req.content
                assert PASSWORD.encode() not in req.content
                assert b'"content_base64"' not in req.content
                assert b'"private_key_base64"' not in req.content
                assert b'"aes_key"' not in req.content
        assert "header" not in result.model_dump()


async def test_owner_and_recipient_download_independently_after_storage_round_trip(
    registered,
):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        for profile_id in (OWNER, RECIPIENT):
            downloaded = await persistence.download(
                gateway,
                session(profile_id),
                result.file.id,
                opening(state, registered, profile_id),
            )
            assert base64.b64decode(downloaded.content_base64) == ORIGINAL
        assert state["downloads"] == 2
        assert all(PASSWORD.encode() not in call.content for call in state["calls"])


async def test_metadata_reads_use_user_token_and_outsider_is_not_assigned(registered):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        assert (await persistence.list_files(gateway, session(RECIPIENT))).total == 1
        assert (await persistence.list_files(gateway, session(OUTSIDER))).total == 0
        with pytest.raises(ServiceError) as error:
            await persistence.detail(gateway, session(OUTSIDER), result.file.id)
        assert error.value.status == 404
        with pytest.raises(ServiceError) as error:
            await persistence.download(
                gateway,
                session(OUTSIDER),
                result.file.id,
                opening(state, registered, OUTSIDER),
            )
        assert error.value.status == 404 and state["downloads"] == 0


@pytest.mark.parametrize("flag", ["upload_error", "lost_begin"])
async def test_interrupted_creation_cancels_and_cleans_private_object(registered, flag):
    async with transport(registered, **{flag: True}) as (gateway, state):
        with pytest.raises(ServiceError):
            await persistence.create(gateway, session(), request())
        assert state["file"]["state"] == "cancelled" and state["stored"] is None
        assert any(call.method == "DELETE" for call in state["calls"])


async def test_lost_publication_response_keeps_ready_file_and_ciphertext(registered):
    async with transport(registered, lost_commit=True) as (gateway, state):
        with pytest.raises(ServiceError):
            await persistence.create(gateway, session(), request())
        assert state["file"]["state"] == "ready" and state["stored"] is not None
        assert not any(call.method == "DELETE" for call in state["calls"])


@pytest.mark.parametrize(
    "code,status",
    [("PF403", 403), ("PF404", 404), ("PF409", 409), ("PF422", 422), ("PF428", 409)],
)
async def test_database_errors_are_mapped_without_provider_details(
    registered, code, status
):
    async with transport(registered, begin_error=code) as (gateway, state):
        with pytest.raises(ServiceError) as error:
            await persistence.create(gateway, session(), request())
        assert error.value.status == status and "Detalle interno" not in str(
            error.value
        )
        assert not any(call.method == "DELETE" for call in state["calls"])


@pytest.mark.parametrize("value", ["keys", "owner"])
async def test_invalid_reservation_never_uploads_and_is_cancelled(registered, value):
    async with transport(registered, bad_reservation=value) as (gateway, state):
        with pytest.raises(ServiceError) as error:
            await persistence.create(gateway, session(), request())
        assert error.value.code == "invalid_personnel_response"
        assert state["stored"] is None and state["file"]["state"] == "cancelled"
        assert not any(
            call.method == "POST" and "/storage/" in call.url.path
            for call in state["calls"]
        )


@pytest.mark.parametrize("flag", ["bad_storage", "deny_final"])
async def test_corruption_or_permission_change_prevents_plaintext_delivery(
    registered, flag
):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        state[flag] = True
        with pytest.raises(ServiceError) as error:
            await persistence.download(
                gateway, session(RECIPIENT), result.file.id, opening(state, registered)
            )
        assert error.value.code in {
            "personnel_storage_integrity",
            "personnel_file_not_found",
        }
        assert state["downloads"] == 0


@pytest.mark.parametrize("kind", ["nonce", "identity"])
async def test_invalid_material_is_rejected_without_reading_storage(registered, kind):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        state["bad_material"] = kind
        with pytest.raises(ServiceError) as error:
            await persistence.download(
                gateway, session(RECIPIENT), result.file.id, opening(state, registered)
            )
        assert error.value.code == "invalid_personnel_response"
        assert not any(
            call.method == "GET" and "/storage/" in call.url.path
            for call in state["calls"]
        )


async def test_wrong_password_never_completes_a_download(registered):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        with pytest.raises(ServiceError) as error:
            await persistence.download(
                gateway,
                session(RECIPIENT),
                result.file.id,
                opening(state, registered, password="incorrecta-de-prueba"),
            )
        assert error.value.code == "invalid_encryption_private_key"
        assert state["downloads"] == 0


async def test_missing_backend_secret_makes_no_provider_requests(registered):
    async with transport(registered, secret=False) as (gateway, state):
        with pytest.raises(ServiceError) as error:
            await persistence.create(gateway, session(), request())
        assert error.value.status == 503 and not state["calls"]


async def test_failed_cleanup_never_masks_publication_error(registered):
    async with transport(registered, commit_error="PF409", cancel_error=True) as (
        gateway,
        state,
    ):
        with pytest.raises(ServiceError) as error:
            await persistence.create(gateway, session(), request())
        assert error.value.code == "personnel_conflict"
        assert not any(call.method == "DELETE" for call in state["calls"])


async def test_creator_can_retry_cleanup_of_a_failed_preparation(registered):
    async with transport(registered, commit_error="PF409", cancel_error=True) as (
        gateway,
        state,
    ):
        with pytest.raises(ServiceError):
            await persistence.create(gateway, session(), request())
        assert state["file"]["state"] == "staging" and state["stored"] is not None
        state["cancel_error"] = False
        result = await persistence.cancel(gateway, session(), UUID(state["file"]["id"]))
        assert result.file.state == "cancelled" and state["stored"] is None


async def test_published_file_cannot_be_cancelled_or_deleted(registered):
    async with transport(registered) as (gateway, state):
        result = await persistence.create(gateway, session(), request())
        with pytest.raises(ServiceError) as error:
            await persistence.cancel(gateway, session(), result.file.id)
        assert error.value.status == 409 and state["stored"] is not None
        with pytest.raises(ServiceError) as error:
            await persistence.cancel(gateway, session(RECIPIENT), result.file.id)
        assert error.value.status == 403
        assert not any(call.method == "DELETE" for call in state["calls"])


async def test_missing_creation_permission_never_contacts_provider(registered):
    async with transport(registered) as (gateway, state):
        actor = session()
        actor.access.permissions.clear()
        with pytest.raises(ServiceError) as error:
            await persistence.create(gateway, actor, request())
        assert error.value.status == 403 and not state["calls"]
