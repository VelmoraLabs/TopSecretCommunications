"""Una descarga comprueba firmas reales y no presenta un borrador como firmado."""

import base64

import pytest

from app.crypto.signatures import key_files
from tests.memoranda.test_memoranda import DOC, HEADERS, app_client, sign_body


@pytest.fixture(scope="module")
def material():
    return key_files.generate("Contraseña de prueba 2026".encode())


def sign(client, material):
    response = client.post(
        f"/api/v1/documents/{DOC}/signatures", headers=HEADERS, json=sign_body(material)
    )
    assert response.status_code == 200


def test_unsigned_draft_reports_integrity_only(material):
    with app_client(material) as (client, _):
        response = client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS)
        assert response.status_code == 200
        assert response.json()["verification"] == "integrity"


def test_sent_document_checks_signature_and_returns_original(material):
    with app_client(material) as (client, state):
        sign(client, material)
        state["workflow_state"] = "sent"
        response = client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS)
        assert response.status_code == 200
        assert response.json()["verification"] == "signatures"
        assert base64.b64decode(response.json()["content_base64"]) == state["data"]


def test_tampered_signature_blocks_download_even_with_intact_file(material):
    with app_client(material) as (client, state):
        sign(client, material)
        raw = bytearray(base64.b64decode(state["signatures"][0]["signature_base64"]))
        raw[0] ^= 1
        state["signatures"][0]["signature_base64"] = base64.b64encode(raw).decode()
        response = client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS)
        assert response.status_code == 422
        assert "content_base64" not in response.json()


def test_sent_without_required_issuer_signature_is_not_delivered(material):
    with app_client(material, workflow_state="sent") as (client, _):
        assert (
            client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS).status_code
            == 422
        )


def test_missing_institutional_approval_blocks_sent_download(material):
    with app_client(material) as (client, state):
        sign(client, material)
        state["workflow_state"] = "sent"
        state["approver_id"] = "10000000-0000-4000-8000-000000000099"
        assert (
            client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS).status_code
            == 422
        )


def test_retired_key_does_not_invalidate_historical_signature(material):
    with app_client(material) as (client, state):
        sign(client, material)
        state["signatures"][0]["key_is_active"] = False
        state["workflow_state"] = "sent"
        assert (
            client.get(f"/api/v1/documents/{DOC}/file", headers=HEADERS).status_code
            == 200
        )
