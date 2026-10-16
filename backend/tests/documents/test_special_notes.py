import base64
import itertools
import json

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient

from app.crypto.shamir import deserialize_share, reconstruct_secret
from app.main import create_app
from app.modules.auth.schemas import Access
from app.modules.auth.service import Principal, get_principal
from app.modules.documents.schemas import MAX_FILE_SIZE, NotePackage
from app.modules.documents.service import associated_data

BASE = "/api/v1/documents/special-notes"
CONTENT = b"\x00\x00Nota reservada\n" + bytes(range(256))


@pytest.fixture
def client() -> TestClient:
    return TestClient(document_app())


def document_app():
    application = create_app(enable_local_workflow=True)
    # Estas pruebas aíslan el flujo criptográfico. La autenticación real se prueba
    # aparte, sin sobreescribir dependencias, en tests/auth/test_access.py.
    access = Access.model_validate(
        {
            "profile": {
                "id": "11111111-1111-4111-8111-111111111111",
                "auth_user_id": "22222222-2222-4222-8222-222222222222",
                "email": "test@example.test",
                "display_name": "Prueba",
                "role_code": "staff",
                "is_active": True,
            },
            "permissions": ["documents.create", "recovery.request"],
        }
    )
    application.dependency_overrides[get_principal] = lambda: Principal(
        access=access, token="solo-pruebas"
    )
    return application


def protect(client, *, content=CONTENT, count=4, threshold=None, mode="all-members"):
    response = client.post(
        f"{BASE}/protect",
        json={
            "filename": "nota-área.bin",
            "media_type": "application/octet-stream",
            "content_base64": base64.b64encode(content).decode(),
            "share_count": count,
            "threshold": count if threshold is None else threshold,
            "access_mode": mode,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def recover(client, protected, shares=None):
    return client.post(
        f"{BASE}/recover",
        json={
            "package": protected["package"],
            "shares": protected["shares"] if shares is None else shares,
        },
    )


@pytest.mark.parametrize("content", [b"", CONTENT, bytes(512)])
def test_portable_binary_roundtrip_after_new_app(client, content):
    protected = protect(client, content=content)
    # Otra aplicación no tiene la clave original ni estado de la primera petición.
    with TestClient(document_app()) as fresh:
        response = recover(fresh, protected)
    assert response.status_code == 200
    assert base64.b64decode(response.json()["content_base64"]) == content
    assert response.json()["filename"] == "nota-área.bin"
    assert response.json()["size"] == len(content)
    assert set(protected) == {"package", "shares"}
    assert "key" not in protected["package"]


def test_independent_aesgcm_interoperability(client):
    result = protect(client)
    package = NotePackage.model_validate(result["package"])
    key = reconstruct_secret([deserialize_share(s) for s in result["shares"]])
    original = AESGCM(key).decrypt(
        base64.b64decode(package.nonce_base64),
        base64.b64decode(package.ciphertext_base64)
        + base64.b64decode(package.tag_base64),
        associated_data(package),
    )
    assert original == CONTENT


def test_all_members_required_in_every_incomplete_combination(client):
    result = protect(client, count=5)
    for group in itertools.combinations(result["shares"], 4):
        response = recover(client, result, list(group))
        assert response.status_code == 409
    response = recover(client, result, list(reversed(result["shares"])))
    assert response.status_code == 200
    assert base64.b64decode(response.json()["content_base64"]) == CONTENT


def test_insufficient_shares_are_rejected_by_api(client):
    result = protect(client)
    response = recover(client, result, result["shares"][:3])
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "insufficient_shares"


def test_duplicate_shares_are_rejected(client):
    result = protect(client)
    response = recover(client, result, [result["shares"][0]] * 4)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_shares"


def test_shares_from_other_notes_are_rejected(client):
    first = protect(client)
    second = protect(client)
    response = recover(client, first, second["shares"])
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "incompatible_shares"


@pytest.mark.parametrize(
    "field", ["ciphertext_base64", "nonce_base64", "tag_base64", "filename"]
)
def test_authenticated_content_and_metadata(client, field):
    result = protect(client)
    package = result["package"]
    if field == "filename":
        package[field] = "otro-nombre.bin"
    else:
        value = bytearray(base64.b64decode(package[field]))
        value[0] ^= 1
        package[field] = base64.b64encode(value).decode()
    response = recover(client, result)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "integrity_failed"
    assert "content_base64" not in response.json()


def test_valid_size_forged_secret_is_detected_by_aesgcm(client):
    result = protect(client)
    # Alterar coherentemente Shamir puede reconstruir otra clave de tamaño válido.
    # AES-GCM debe impedir que se devuelvan bytes como si fueran el archivo original.
    forged = []
    for payload in result["shares"]:
        data = json.loads(payload)
        from app.crypto.shamir.field import PRIME

        data["y"] = str((int(data["y"]) + 1) % PRIME)
        forged.append(json.dumps(data))
    response = recover(client, result, forged)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] in {"integrity_failed", "invalid_shares"}


@pytest.mark.parametrize(
    "change",
    [
        {"filename": "../nota.txt"},
        {"filename": "nota\n.txt"},
        {"filename": "\ud800.txt"},
        {"content_base64": "%%%"},
        {"content_base64": "AB=="},
        {"share_count": True},
        {"share_count": 21, "threshold": 21},
        {"threshold": 3},
        {"threshold": 5},
        {"extra": "no permitido"},
        {"access_mode": "threshold-demo"},
    ],
)
def test_invalid_protection_requests(client, change):
    payload = {
        "filename": "nota.txt",
        "content_base64": "aG9sYQ==",
        "share_count": 4,
        "threshold": 4,
    }
    response = client.post(
        f"{BASE}/protect",
        content=json.dumps(payload | change, ensure_ascii=True),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "aG9sYQ==" not in response.text


def test_size_boundary(client):
    result = protect(client, content=b"x" * MAX_FILE_SIZE, count=2)
    assert recover(client, result).status_code == 200
    response = client.post(
        f"{BASE}/protect",
        json={
            "filename": "grande.bin",
            "content_base64": base64.b64encode(b"x" * (MAX_FILE_SIZE + 1)).decode(),
            "threshold": 2,
            "share_count": 2,
        },
    )
    assert response.status_code in {413, 422}


def test_request_limit_even_without_content_length(client):
    chunks = (b"x" * (1024 * 1024) for _ in range(9))
    response = client.post(
        f"{BASE}/protect", content=chunks, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_local_routes_disabled_by_default(monkeypatch):
    monkeypatch.delenv("STC_ENABLE_LOCAL_WORKFLOW", raising=False)
    with TestClient(create_app()) as client:
        assert client.post(f"{BASE}/protect", json={}).status_code == 404
        assert client.get("/health").json() == {"status": "ok"}


def test_package_version_and_share_format_rejected(client):
    result = protect(client)
    result["package"]["version"] = 2
    assert recover(client, result).status_code == 422
    result["package"]["version"] = 1
    assert recover(client, result, ["{}", "{}", "{}", "{}"]).status_code == 422


def test_version_bool_and_truncated_tag_rejected(client):
    result = protect(client)
    result["package"]["version"] = True
    assert recover(client, result).status_code == 422
    result["package"]["version"] = 1
    result["package"]["tag_base64"] = base64.b64encode(bytes(15)).decode()
    assert recover(client, result).status_code == 422


def test_packages_are_unique_and_responses_not_cacheable(client):
    first = protect(client)
    second = protect(client)
    assert first["package"]["document_id"] != second["package"]["document_id"]
    assert first["package"]["nonce_base64"] != second["package"]["nonce_base64"]
    response = recover(client, first)
    assert response.headers["Cache-Control"] == "no-store"


def test_request_limit_accumulates_streamed_chunks():
    import asyncio

    from app.core.request_limits import RequestBodyLimit

    called = False
    messages = iter(
        [
            {"type": "http.request", "body": b"123", "more_body": True},
            {"type": "http.request", "body": b"456", "more_body": False},
        ]
    )
    sent = []

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    async def app(scope, receive, send):
        nonlocal called
        called = True

    asyncio.run(
        RequestBodyLimit(app, max_bytes=5)(
            {"type": "http", "method": "POST"}, receive, send
        )
    )
    assert not called
    assert sent[0]["status"] == 413
