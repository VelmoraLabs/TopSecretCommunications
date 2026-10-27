"""Ciclo real PKCS8, separación de claves y acceso HTTP por perfil."""

import json

import pytest

from app.crypto.signatures import key_files
from app.crypto.signatures.rsa_pss import sha256
from tests.group_notes.test_group_notes import (
    ACTOR,
    HEADERS,
    PASSWORD,
    PEER,
    client,
    keys_fixture,
)


def test_generate_activate_rotate_retire_without_private_persistence():
    with client() as (app, state):
        response = app.post(
            "/api/v1/encryption-keys",
            headers=HEADERS,
            json={"label": "Mi clave", "password": PASSWORD},
        )
        assert response.status_code == 201, response.text
        result = response.json()
        key = result["key"]
        assert key["profile_id"] == ACTOR and key["state"] == "pending"
        private = key_files.load_private(result["private_base64"], PASSWORD.encode())
        assert (
            sha256(key_files.public_bytes(private.public_key())).hex()
            == key["fingerprint"]
        )
        listed = app.get("/api/v1/encryption-keys", headers=HEADERS)
        assert (
            listed.status_code == 200
            and result["private_base64"] not in listed.text
            and PASSWORD not in listed.text
        )
        payload = {"private_key_base64": result["private_base64"], "password": PASSWORD}
        response = app.post(
            f"/api/v1/encryption-keys/{key['id']}/activate",
            headers=HEADERS,
            json=payload,
        )
        assert response.status_code == 200 and response.json()["state"] == "active"
        assert (
            sum(
                k["state"] == "active" and k["profile_id"] == ACTOR
                for k in state["keys"].values()
            )
            == 1
        )
        assert (
            app.post(
                f"/api/v1/encryption-keys/{key['id']}/retire", headers=HEADERS
            ).status_code
            == 204
        )
        assert (
            app.post(
                f"/api/v1/encryption-keys/{key['id']}/activate",
                headers=HEADERS,
                json=payload,
            ).status_code
            == 409
        )
        for request in state["calls"]:
            if "/rest/" in request.url.path:
                assert PASSWORD.encode() not in request.content
                assert result["private_base64"].encode() not in request.content
        assert result["private_base64"] not in json.dumps(state["keys"])


def test_wrong_password_or_private_does_not_activate():
    with client() as (app, state):
        key = app.post(
            "/api/v1/encryption-keys",
            headers=HEADERS,
            json={"label": "Mi clave", "password": PASSWORD},
        ).json()
        path = f"/api/v1/encryption-keys/{key['key']['id']}/activate"
        for private, password in [
            (key["private_base64"], "incorrecta-segura"),
            (keys_fixture()[1].private_base64, PASSWORD),
        ]:
            response = app.post(
                path,
                headers=HEADERS,
                json={"private_key_base64": private, "password": password},
            )
            assert (
                response.status_code == 422
                and "invalid_encryption_private_key" in response.text
            )
        assert state["keys"][key["key"]["id"]]["state"] == "pending"
        assert not any(
            r.url.path.endswith("/server_activate_encryption_key")
            for r in state["calls"]
        )


def test_other_profiles_key_cannot_activate_or_retire():
    with client() as (app, _):
        peer_id = "50000000-0000-4000-8000-000000000002"
        assert (
            app.post(
                f"/api/v1/encryption-keys/{peer_id}/activate",
                headers=HEADERS,
                json={
                    "private_key_base64": keys_fixture()[1].private_base64,
                    "password": PASSWORD,
                },
            ).status_code
            == 404
        )
        assert (
            app.post(
                f"/api/v1/encryption-keys/{peer_id}/retire", headers=HEADERS
            ).status_code
            == 404
        )
        assert all(
            k["profile_id"] != PEER
            for k in app.get("/api/v1/encryption-keys", headers=HEADERS).json()["items"]
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"label": "   "},
        {"label": "mala\nclave"},
        {"password": "corta"},
        {"password": "\x00" * 12},
        {"password": "a" * 257},
        {"profile_id": PEER},
        {"public_base64": "arbitraria"},
        {"state": "active"},
    ],
)
def test_invalid_requests_do_not_register(payload):
    with client() as (app, state):
        response = app.post(
            "/api/v1/encryption-keys",
            headers=HEADERS,
            json={"label": "Mi clave", "password": PASSWORD, **payload},
        )
        assert response.status_code == 422 and PASSWORD not in response.text
        assert not any("/server_register_" in r.url.path for r in state["calls"])


@pytest.mark.parametrize(
    ("code", "status"), [("PK403", 403), ("PK404", 404), ("PK409", 409), ("PK422", 422)]
)
def test_key_rpc_errors(code, status):
    with client(key_error=code) as (app, _):
        assert (
            app.post(
                "/api/v1/encryption-keys",
                headers=HEADERS,
                json={"label": "Mi clave", "password": PASSWORD},
            ).status_code
            == status
        )


def test_members_can_generate_and_auth_required():
    with client(permissions=["documents.read_assigned"]) as (app, _):
        assert app.get("/api/v1/encryption-keys").status_code == 401
        assert (
            app.post(
                "/api/v1/encryption-keys",
                headers=HEADERS,
                json={"label": "Mi clave", "password": PASSWORD},
            ).status_code
            == 201
        )
    with client(permissions=[]) as (app, _):
        assert app.get("/api/v1/encryption-keys", headers=HEADERS).status_code == 403
