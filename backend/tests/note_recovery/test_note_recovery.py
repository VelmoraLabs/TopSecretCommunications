"""Contrato HTTP, secretos y descifrado reales; SQL comprueba autorización RLS."""

import asyncio
import base64
import json
from contextlib import contextmanager
from copy import deepcopy
from uuid import UUID, uuid4

import httpx
import pytest

from app.crypto.key_wrapping.recovery_envelope import ContributionEnvelope
from app.modules.note_recovery import service
from tests.group_notes.test_group_notes import (
    ACTOR,
    HEADERS,
    NOW,
    ORIGINAL,
    PASSWORD,
    PEER,
    client,
    create,
    keys_fixture,
)


@contextmanager
def recovery_client(**flags):
    with client(
        permissions=[
            "documents.create",
            "documents.read_assigned",
            "recovery.request",
            "recovery.contribute",
        ]
    ) as (app, state):
        note = create(app).json()
        reqid = str(uuid4())
        state.update(
            {
                "request": reqid,
                "contributions": {},
                "version": 1,
                "recovery_state": "pending",
                **flags,
            }
        )
        gateway = app.app.state.supabase
        old = gateway.client._transport.handler
        requester_key = deepcopy(state["keys"]["50000000-0000-4000-8000-000000000002"])

        def detail():
            actor = state.get("actor", ACTOR)
            return {
                "recovery": {
                    "id": reqid,
                    "note_id": note["note"]["id"],
                    "requester_id": PEER,
                    "requester_name": "Participante",
                    "reason": "Consultar acuerdo",
                    "state": state["recovery_state"],
                    "participant_count": 2,
                    "contribution_count": len(state["contributions"]),
                    "created_at": NOW,
                    "expires_at": "2099-01-01T00:00:00Z",
                    "completed_at": NOW
                    if state["recovery_state"] == "completed"
                    else None,
                    "download_until": "2099-01-01T00:00:00Z"
                    if state["recovery_state"] == "completed"
                    else None,
                    "version": state["version"],
                    "can_contribute": state["recovery_state"] in ("pending", "ready")
                    and actor not in state["contributions"],
                    "can_recover": actor == PEER
                    and state["recovery_state"] in ("ready", "completed"),
                    "can_cancel": actor == PEER
                    and state["recovery_state"] in ("pending", "ready"),
                    "can_reject": state["recovery_state"] in ("pending", "ready"),
                    "blocked": False,
                },
                "requester_key": {
                    key: requester_key[key]
                    for key in ["id", "profile_id", "public_base64", "fingerprint"]
                },
                "participants": [
                    {
                        "profile_id": p["profile_id"],
                        "display_name": p["display_name"],
                        "share_index": p["share_index"],
                        "contributed_at": NOW
                        if p["profile_id"] in state["contributions"]
                        else None,
                        "rejected_at": None,
                        "is_active": True,
                    }
                    for p in note["participants"]
                ],
            }

        def handle(request):
            path = request.url.path
            if not any(
                path.endswith("/" + name)
                for name in [
                    "get_note_recovery",
                    "list_note_recoveries",
                    "create_note_recovery",
                    "server_contribute_note_recovery",
                    "server_note_recovery_material",
                    "server_complete_note_recovery",
                    "close_note_recovery",
                ]
            ):
                return old(request)
            state["calls"].append(request)
            body = json.loads(request.content or "{}")
            actor = state.get("actor", ACTOR)
            if state.get("deny_recovery"):
                return httpx.Response(400, json={"code": "PR404"})
            if path.endswith("/get_note_recovery") or path.endswith(
                "/create_note_recovery"
            ):
                return httpx.Response(200, json=detail())
            if path.endswith("/list_note_recoveries"):
                return httpx.Response(
                    200,
                    json={
                        "items": [detail()["recovery"]],
                        "has_open": state["recovery_state"] in ("pending", "ready"),
                        "total": 1,
                        "limit": 20,
                        "offset": 0,
                    },
                )
            if path.endswith("/server_contribute_note_recovery"):
                assert (
                    request.headers["apikey"] == "sb_secret_test"
                    and body["p_actor"] == actor
                )
                state["contributions"].setdefault(actor, body["p_envelope"])
                state["version"] = 1 + len(state["contributions"])
                if len(state["contributions"]) == 2:
                    state["recovery_state"] = "ready"
                return httpx.Response(200, json=None)
            if path.endswith("/server_note_recovery_material"):
                if actor != PEER:
                    return httpx.Response(400, json={"code": "PR403"})
                if state["recovery_state"] not in ("ready", "completed"):
                    return httpx.Response(400, json={"code": "PR410"})
                values = list(state["contributions"].values())
                if state.get("tamper_contribution"):
                    values = deepcopy(values)
                    data = bytearray(base64.b64decode(values[0]["ciphertext_base64"]))
                    data[0] ^= 1
                    values[0]["ciphertext_base64"] = base64.b64encode(data).decode()
                return httpx.Response(
                    200, json={"detail": detail(), "envelopes": values}
                )
            if path.endswith("/server_complete_note_recovery"):
                if state.get("final_error"):
                    return httpx.Response(400, json={"code": state["final_error"]})
                assert actor == PEER
                state["recovery_state"] = "completed"
                state["completed_calls"] = state.get("completed_calls", 0) + 1
                return httpx.Response(200, json=None)
            if path.endswith("/close_note_recovery"):
                state["recovery_state"] = body["p_action"]
                state["contributions"].clear()
                return httpx.Response(200, json=detail())
            raise AssertionError(path)

        gateway.client._transport = httpx.MockTransport(handle)
        yield app, state, note, reqid


def payload(index=0, **changes):
    return {
        "private_key_base64": keys_fixture()[index].private_base64,
        "password": PASSWORD,
        **changes,
    }


def contribute(app, state, request, index):
    state["actor"] = [ACTOR, PEER][index]
    return app.post(
        f"/api/v1/note-recoveries/{request}/contribute",
        headers=HEADERS,
        json=payload(index, approve=True),
    )


def test_real_encrypted_contributions_exact_recovery_and_no_private_persistence():
    with recovery_client() as (app, state, note, request):
        for index in [0, 1]:
            response = contribute(app, state, request, index)
            assert response.status_code == 200, response.text
            assert response.json()["recovery"]["contribution_count"] == index + 1
            assert "envelopes" not in response.json()
        response = app.post(
            f"/api/v1/note-recoveries/{request}/recover",
            headers=HEADERS,
            json=payload(1),
        )
        assert response.status_code == 200, response.text
        assert base64.b64decode(response.json()["content_base64"]) == ORIGINAL
        assert state["recovery_state"] == "completed"
        assert all(
            ContributionEnvelope.model_validate(e).context.request_id == UUID(request)
            for e in state["contributions"].values()
        )
        for call in state["calls"]:
            if "/rest/" in call.url.path:
                assert PASSWORD.encode() not in call.content
                assert all(
                    f.private_base64.encode() not in call.content
                    for f in keys_fixture()
                )
                assert ORIGINAL not in call.content
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "changes",
    [
        {"approve": False},
        {"approve": 1},
        {"approve": "true"},
        {"approve": None},
        {"password": "corta"},
        {"actor": PEER},
        {"shares": ["no permitido"]},
    ],
)
def test_contribution_requires_explicit_valid_input(changes):
    with recovery_client() as (app, state, _note, request):
        response = app.post(
            f"/api/v1/note-recoveries/{request}/contribute",
            headers=HEADERS,
            json=payload(0, **{"approve": True, **changes}),
        )
        assert response.status_code == 422
        assert not state["contributions"]
        assert PASSWORD not in response.text


def test_no_consent_or_auth_no_contribution():
    with recovery_client() as (app, state, _note, request):
        assert (
            app.post(
                f"/api/v1/note-recoveries/{request}/contribute",
                headers=HEADERS,
                json=payload(),
            ).status_code
            == 422
        )
        assert (
            app.post(
                f"/api/v1/note-recoveries/{request}/contribute",
                json=payload(approve=True),
            ).status_code
            == 401
        )
        assert not state["contributions"]


@pytest.mark.parametrize("index,password", [(0, "incorrecta-segura"), (1, PASSWORD)])
def test_wrong_private_or_password_does_not_contribute(index, password):
    with recovery_client() as (app, state, _note, request):
        response = app.post(
            f"/api/v1/note-recoveries/{request}/contribute",
            headers=HEADERS,
            json=payload(index, password=password, approve=True),
        )
        assert response.status_code == 422 and not state["contributions"]
        assert response.json()["detail"]["code"] == "invalid_encryption_private_key"


def test_closed_or_unavailable_request_does_not_load_private():
    with recovery_client(deny_recovery=True) as (app, state, _note, request):
        response = app.post(
            f"/api/v1/note-recoveries/{request}/contribute",
            headers=HEADERS,
            json=payload(approve=True),
        )
        assert response.status_code == 404 and not state["contributions"]
        assert not any(
            c.url.path.endswith("/get_own_encryption_key") for c in state["calls"]
        )


def test_incomplete_or_other_user_cannot_recover():
    with recovery_client() as (app, state, _note, request):
        state["actor"] = PEER
        assert (
            app.post(
                f"/api/v1/note-recoveries/{request}/recover",
                headers=HEADERS,
                json=payload(1),
            ).status_code
            == 409
        )
        contribute(app, state, request, 0)
        contribute(app, state, request, 1)
        state["actor"] = ACTOR
        assert (
            app.post(
                f"/api/v1/note-recoveries/{request}/recover",
                headers=HEADERS,
                json=payload(0),
            ).status_code
            == 403
        )
        assert state["recovery_state"] == "ready"


@pytest.mark.parametrize("tamper", ["tamper_contribution", "tamper_package"])
def test_tampered_material_never_completes(tamper):
    with recovery_client() as (app, state, _note, request):
        contribute(app, state, request, 0)
        contribute(app, state, request, 1)
        if tamper == "tamper_contribution":
            state[tamper] = True
        else:
            state["tampered"] = bytes([state["storage"][0] ^ 1]) + state["storage"][1:]
        response = app.post(
            f"/api/v1/note-recoveries/{request}/recover",
            headers=HEADERS,
            json=payload(1),
        )
        assert response.status_code == 422
        assert state["recovery_state"] == "ready" and not state.get("completed_calls")
        assert "content_base64" not in response.json()


@pytest.mark.parametrize("code", ["PR410", "PR412", "PR409"])
def test_final_authorization_after_decrypt_can_block_delivery(code):
    with recovery_client(final_error=code) as (app, state, _note, request):
        contribute(app, state, request, 0)
        contribute(app, state, request, 1)
        response = app.post(
            f"/api/v1/note-recoveries/{request}/recover",
            headers=HEADERS,
            json=payload(1),
        )
        assert response.status_code == 409
        assert "content_base64" not in response.text and not state.get(
            "completed_calls"
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("reason", "   "),
        ("reason", "mal\ncontrol"),
        ("duration_minutes", 0),
        ("duration_minutes", True),
        ("duration_minutes", 1441),
        ("request_id", "mal"),
        ("requester_id", PEER),
    ],
)
def test_invalid_creation_does_not_call_rpc(field, value):
    with recovery_client() as (app, state, note, _request):
        response = app.post(
            f"/api/v1/group-notes/{note['note']['id']}/recoveries",
            headers=HEADERS,
            json={
                "request_id": str(uuid4()),
                "reason": "Consultar acuerdo",
                "duration_minutes": 60,
                field: value,
            },
        )
        assert response.status_code == 422
        assert not any(
            c.url.path.endswith("/create_note_recovery") for c in state["calls"]
        )


def test_closed_requests_remain_in_history():
    with recovery_client() as (app, state, note, request):
        state["actor"] = PEER
        response = app.post(
            f"/api/v1/note-recoveries/{request}/cancel", headers=HEADERS
        )
        assert (
            response.status_code == 200
            and response.json()["recovery"]["state"] == "cancelled"
        )
        listed = app.get(
            f"/api/v1/group-notes/{note['note']['id']}/recoveries", headers=HEADERS
        )
        assert listed.status_code == 200 and listed.json()["has_open"] is False


def test_cleanup_task_calls_only_server_rpc_and_can_be_cancelled(monkeypatch):
    calls = []

    class Gateway:
        async def server_request(self, *args, **kwargs):
            calls.append((args, kwargs))

    sleeps = 0

    async def tick(seconds):
        nonlocal sleeps
        assert seconds == 60
        sleeps += 1
        if sleeps > 1:
            raise asyncio.CancelledError

    monkeypatch.setattr(service.asyncio, "sleep", tick)

    async def run():
        with pytest.raises(asyncio.CancelledError):
            await service.cleanup_loop(Gateway())

    asyncio.run(run())
    assert calls == [
        (("POST", "/rest/v1/rpc/server_cleanup_note_recoveries"), {"body": {}})
    ]
