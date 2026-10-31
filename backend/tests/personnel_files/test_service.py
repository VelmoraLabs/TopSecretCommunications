"""Contrato y servicio en memoria; no simulan una integración SQL inexistente."""

import base64
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import ServiceError
from app.crypto.key_wrapping import unwrap_key
from app.crypto.signatures import key_files
from app.modules.auth.schemas import Access
from app.modules.auth.service import Principal
from app.modules.documents.schemas import MAX_FILE_SIZE
from app.modules.encryption_keys.schemas import EncryptionKey
from app.modules.encryption_keys.service import generate_files
from app.modules.personnel_files.schemas import (
    CreatePersonnelFile,
    OpenPersonnelFile,
    ProtectedPersonnelFile,
)
from app.modules.personnel_files.service import open_file, protect_file

OWNER, RECIPIENT, OUTSIDER = (UUID(int=value) for value in (1, 2, 3))
PASSWORD = "contrasena-solo-pruebas"
ORIGINAL = b"Expediente de prueba\x00\xff"


def principal(profile_id, *, permissions=None, active=True):
    return Principal(
        access=Access.model_validate(
            {
                "profile": {
                    "id": profile_id,
                    "auth_user_id": profile_id,
                    "display_name": "Persona de prueba",
                    "email": f"persona-{profile_id.int}@example.test",
                    "role_code": "admin",
                    "is_active": active,
                },
                "permissions": (
                    ["documents.create", "documents.read_assigned"]
                    if permissions is None
                    else permissions
                ),
            }
        ),
        token="token-solo-pruebas",
    )


@pytest.fixture(scope="module")
def registered():
    result = {}
    for profile_id in (OWNER, RECIPIENT, OUTSIDER):
        files = generate_files(PASSWORD.encode())
        key = EncryptionKey(
            id=uuid4(),
            profile_id=profile_id,
            label="Protección de prueba",
            public_base64=files.public_base64,
            fingerprint=files.fingerprint,
            state="active",
            created_at="2026-10-29T00:00:00Z",
            activated_at="2026-10-29T00:00:00Z",
            retired_at=None,
        )
        result[profile_id] = (key, files)
    return result


def request(**changes):
    return CreatePersonnelFile.model_validate(
        {
            "title": "Expediente de prueba",
            "filename": "expediente.bin",
            "content_base64": base64.b64encode(ORIGINAL).decode(),
            "recipients": [{"profile_id": str(RECIPIENT)}],
            **changes,
        }
    )


def prepare(registered, *, body=None, keys=None, actor=None):
    return protect_file(
        principal(OWNER) if actor is None else actor,
        request() if body is None else body,
        [registered[p][0] for p in (OWNER, RECIPIENT)] if keys is None else keys,
        document_id=uuid4(),
        version_id=uuid4(),
    )


def credentials(protected, registered, profile_id=RECIPIENT, **changes):
    key, files = registered[profile_id]
    return OpenPersonnelFile.model_validate(
        {
            "version_id": protected.header.version_id,
            "key_id": key.id,
            "private_key_base64": files.private_base64,
            "password": PASSWORD,
            **changes,
        }
    )


def open_as(protected, registered, profile_id=RECIPIENT, **changes):
    return open_file(
        principal(profile_id),
        protected,
        registered[profile_id][0],
        credentials(protected, registered, profile_id, **changes),
    )


def changed_byte(encoded):
    data = bytearray(base64.b64decode(encoded))
    data[0] ^= 1
    return base64.b64encode(data).decode()


def test_creator_and_recipient_open_independently_with_one_shared_aes(registered):
    protected = prepare(registered)
    recovered_keys = []
    for profile_id in (OWNER, RECIPIENT):
        assert open_as(protected, registered, profile_id) == ORIGINAL
        envelope = next(
            item for item in protected.header.envelopes if item.profile_id == profile_id
        )
        private = key_files.load_private(
            registered[profile_id][1].private_base64, PASSWORD.encode()
        )
        recovered_keys.append(
            unwrap_key(base64.b64decode(envelope.wrapped_key_base64), private)
        )
    assert recovered_keys[0] == recovered_keys[1]
    assert len(recovered_keys[0]) == 32
    assert len(base64.b64decode(protected.ciphertext_base64)) == len(ORIGINAL)
    assert "aes_key" not in protected.model_dump()
    assert PASSWORD not in protected.model_dump_json()


@pytest.mark.parametrize("data", [b"", b"\x00\xff", bytes(range(256))])
def test_binary_round_trip_and_json_storage_contract(registered, data):
    protected = prepare(
        registered, body=request(content_base64=base64.b64encode(data).decode())
    )
    restored = ProtectedPersonnelFile.model_validate_json(protected.model_dump_json())
    assert open_as(restored, registered) == data


def test_new_version_generates_fresh_nonce_key_and_wrapping(registered):
    first, second = prepare(registered), prepare(registered)
    assert first.nonce_base64 != second.nonce_base64
    assert first.ciphertext_base64 != second.ciphertext_base64
    assert first.header.envelopes[0].wrapped_key_base64 != (
        second.header.envelopes[0].wrapped_key_base64
    )


def test_creator_selected_as_recipient_is_included_only_once(registered):
    body = request(recipients=[{"profile_id": str(OWNER)}])
    protected = prepare(registered, body=body, keys=[registered[OWNER][0]])
    assert len(protected.header.envelopes) == 1
    assert open_as(protected, registered, OWNER) == ORIGINAL


def test_unassigned_administrator_cannot_open(registered):
    protected = prepare(registered)
    with pytest.raises(ServiceError) as error:
        open_as(protected, registered, OUTSIDER)
    assert error.value.status == 404


@pytest.mark.parametrize("active,permissions", [(False, None), (True, [])])
def test_inactive_or_unprivileged_profiles_cannot_create_or_open(
    registered, active, permissions
):
    protected = prepare(registered)
    actor = principal(OWNER, active=active, permissions=permissions)
    with pytest.raises(ServiceError) as create_error:
        prepare(registered, actor=actor)
    assert create_error.value.status == 403
    with pytest.raises(ServiceError) as open_error:
        open_file(
            actor,
            protected,
            registered[OWNER][0],
            credentials(protected, registered, OWNER),
        )
    assert open_error.value.status == 403


@pytest.mark.parametrize("state", ["pending", "retired"])
def test_new_files_require_active_keys(registered, state):
    key = registered[RECIPIENT][0].model_copy(update={"state": state})
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[registered[OWNER][0], key])
    assert error.value.code == "personnel_key_not_active"


def test_retired_original_key_still_opens_historical_file(registered):
    protected = prepare(registered)
    retired = registered[RECIPIENT][0].model_copy(update={"state": "retired"})
    assert (
        open_file(
            principal(RECIPIENT), protected, retired, credentials(protected, registered)
        )
        == ORIGINAL
    )


@pytest.mark.parametrize(
    "profiles",
    [
        (OWNER,),
        (RECIPIENT,),
        (OWNER, RECIPIENT, OUTSIDER),
        (OWNER, RECIPIENT, RECIPIENT),
    ],
)
def test_missing_extra_or_duplicate_key_assignments_fail(registered, profiles):
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[registered[p][0] for p in profiles])
    assert error.value.code == "personnel_keys_incomplete"


@pytest.mark.parametrize("field", ["public_base64", "fingerprint"])
def test_invalid_registered_public_material_fails(registered, field):
    value = "incorrecta" if field == "public_base64" else "0" * 64
    key = registered[RECIPIENT][0].model_copy(update={field: value})
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[registered[OWNER][0], key])
    assert error.value.code == "invalid_personnel_key"


@pytest.mark.parametrize("kind", ["password", "private", "key_id", "version_id"])
def test_wrong_credentials_or_version_fail(registered, kind):
    protected = prepare(registered)
    changes = {
        "password": {"password": "contrasena-incorrecta"},
        "private": {"private_key_base64": registered[OWNER][1].private_base64},
        "key_id": {"key_id": uuid4()},
        "version_id": {"version_id": uuid4()},
    }
    with pytest.raises(ServiceError):
        open_as(protected, registered, **changes[kind])


@pytest.mark.parametrize("field", ["nonce_base64", "ciphertext_base64", "tag_base64"])
def test_changed_encryption_fields_fail_authentication(registered, field):
    protected = prepare(registered)
    payload = protected.model_dump(mode="json")
    payload[field] = changed_byte(payload[field])
    altered = ProtectedPersonnelFile.model_validate(payload)
    with pytest.raises(ServiceError) as error:
        open_as(altered, registered)
    assert error.value.code == "personnel_integrity_failed"


@pytest.mark.parametrize("field", ["document_id", "title", "filename", "media_type"])
def test_changed_aad_metadata_fails_authentication(registered, field):
    protected = prepare(registered)
    payload = protected.model_dump(mode="json")
    payload["header"][field] = str(uuid4()) if field == "document_id" else "alterado"
    altered = ProtectedPersonnelFile.model_validate(payload)
    with pytest.raises(ServiceError) as error:
        open_as(altered, registered)
    assert error.value.code == "personnel_integrity_failed"


def test_changing_another_recipients_envelope_also_invalidates_aad(registered):
    protected = prepare(registered)
    payload = protected.model_dump(mode="json")
    owner_envelope = payload["header"]["envelopes"][0]
    owner_envelope["wrapped_key_base64"] = changed_byte(
        owner_envelope["wrapped_key_base64"]
    )
    altered = ProtectedPersonnelFile.model_validate(payload)
    with pytest.raises(ServiceError) as error:
        open_as(altered, registered, RECIPIENT)
    assert error.value.code == "personnel_integrity_failed"


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"filename": "../expediente.txt"},
        {"recipients": []},
        {"recipients": [{"profile_id": str(RECIPIENT)}] * 2},
        {"created_by": str(OUTSIDER)},
        {"public_base64": "publica-del-cliente"},
        {"category": "memorandum"},
    ],
)
def test_invalid_creation_contracts_are_rejected(changes):
    with pytest.raises(ValidationError):
        request(**changes)


@pytest.mark.parametrize("value", ["%%%", "YQ===", "YQ"])
def test_noncanonical_base64_fails_before_encryption(registered, value):
    with pytest.raises(ServiceError) as error:
        prepare(registered, body=request(content_base64=value))
    assert error.value.code == "invalid_base64"


def test_five_mib_boundary_and_larger_file_rejection(registered):
    largest = b"x" * MAX_FILE_SIZE
    protected = prepare(
        registered, body=request(content_base64=base64.b64encode(largest).decode())
    )
    assert open_as(protected, registered) == largest
    # 5 MiB y 5 MiB + 1 comparten longitud Base64: comprobar bytes reales.
    with pytest.raises(ServiceError) as error:
        prepare(
            registered,
            body=request(content_base64=base64.b64encode(largest + b"x").decode()),
        )
    assert error.value.status == 413
