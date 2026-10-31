"""Pruebas reales de firma y cifrado; este bloque aún no integra SQL ni HTTP."""

import base64
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import ServiceError
from app.crypto.encryption import aes_gcm
from app.crypto.key_wrapping import rsa_oaep
from app.crypto.signatures import key_files, rsa_pss
from app.modules.auth.schemas import Access
from app.modules.auth.service import Principal
from app.modules.diplomatic_notes.schemas import (
    CreateDiplomaticNote,
    OpenDiplomaticNote,
    ProtectedDiplomaticNote,
    RegisteredSigningKey,
)
from app.modules.diplomatic_notes.service import (
    associated_data,
    open_note,
    protect_note,
    signing_message,
)
from app.modules.documents.schemas import MAX_FILE_SIZE
from app.modules.encryption_keys.schemas import EncryptionKey
from app.modules.encryption_keys.service import generate_files
from app.modules.personnel_files.schemas import ProtectedPersonnelFile

OWNER, RECIPIENT, OUTSIDER = (UUID(int=i) for i in (1, 2, 3))
PASSWORD = "contrasena-solo-pruebas"
ORIGINAL = b"Nota diplomatica: contenido de prueba\x00\xff"
PERMISSIONS = ["documents.create", "documents.read_assigned", "documents.sign"]


def encoded(data):
    return base64.b64encode(data).decode("ascii")


def principal(profile_id=OWNER, *, permissions=None, active=True, role="staff"):
    return Principal(
        access=Access.model_validate(
            {
                "profile": {
                    "id": profile_id,
                    "auth_user_id": profile_id,
                    "display_name": "Persona de prueba",
                    "email": f"persona-{profile_id.int}@example.test",
                    "role_code": role,
                    "is_active": active,
                },
                "permissions": PERMISSIONS if permissions is None else permissions,
            }
        ),
        token="token-solo-pruebas",
    )


@pytest.fixture(scope="module")
def registered():
    keys = {}
    for profile_id in (OWNER, RECIPIENT, OUTSIDER):
        files = generate_files(PASSWORD.encode())
        keys[profile_id] = (
            EncryptionKey(
                id=uuid4(),
                profile_id=profile_id,
                label="Cifrado de prueba",
                public_base64=files.public_base64,
                fingerprint=files.fingerprint,
                state="active",
                created_at="2026-10-30T00:00:00Z",
                activated_at="2026-10-30T00:00:00Z",
                retired_at=None,
            ),
            files,
        )
    signing_files = key_files.generate(PASSWORD.encode())
    signer = RegisteredSigningKey(
        id=uuid4(),
        profile_id=OWNER,
        public_base64=signing_files.public_base64,
        fingerprint=signing_files.fingerprint,
        is_active=True,
    )
    return keys, signer, signing_files


def request(registered, **changes):
    _, signer, files = registered
    return CreateDiplomaticNote.model_validate(
        {
            "kind": "diplomatic_note",
            "title": "Nota de prueba",
            "filename": "nota.bin",
            "content_base64": encoded(ORIGINAL),
            "recipients": [{"profile_id": str(RECIPIENT)}],
            "signing_key_id": signer.id,
            "private_key_base64": files.private_base64,
            "password": PASSWORD,
            **changes,
        }
    )


def prepare(registered, *, body=None, keys=None, signer=None, actor=None, **ids):
    encryption, signing, _ = registered
    return protect_note(
        principal() if actor is None else actor,
        request(registered) if body is None else body,
        [encryption[p][0] for p in (OWNER, RECIPIENT)] if keys is None else keys,
        signing if signer is None else signer,
        document_id=ids.get("document_id", uuid4()),
        version_id=ids.get("version_id", uuid4()),
    )


def credentials(protected, registered, profile_id=RECIPIENT, **changes):
    keys, _, _ = registered
    key, files = keys[profile_id]
    return OpenDiplomaticNote.model_validate(
        {
            "version_id": protected.header.version_id,
            "key_id": key.id,
            "private_key_base64": files.private_base64,
            "password": PASSWORD,
            **changes,
        }
    )


def open_as(protected, registered, profile_id=RECIPIENT, **changes):
    keys, signer, _ = registered
    return open_note(
        principal(profile_id, permissions=["documents.read_assigned"], role="member"),
        protected,
        keys[profile_id][0],
        signer,
        credentials(protected, registered, profile_id, **changes),
    )


def decode(value):
    return base64.b64decode(value)


def damaged(value):
    data = bytearray(decode(value))
    data[0] ^= 1
    return encoded(data)


def aes_for(protected, registered, profile_id):
    keys, _, _ = registered
    private = key_files.load_private(
        keys[profile_id][1].private_base64, PASSWORD.encode()
    )
    assigned = next(e for e in protected.header.envelopes if e.profile_id == profile_id)
    return rsa_oaep.unwrap_key(decode(assigned.wrapped_key_base64), private)


@pytest.mark.parametrize("kind", ["diplomatic_note", "communique"])
def test_both_document_types_are_signed_and_open_independently(registered, kind):
    protected = prepare(registered, body=request(registered, kind=kind))
    for profile_id in (OWNER, RECIPIENT):
        assert open_as(protected, registered, profile_id) == ORIGINAL
    aes = [aes_for(protected, registered, p) for p in (OWNER, RECIPIENT)]
    assert aes[0] == aes[1] and len(aes[0]) == 32
    assert protected.header.kind == kind
    assert len(decode(protected.ciphertext_base64)) == len(ORIGINAL)
    public = key_files.load_public(registered[1].public_base64)
    signature = decode(protected.signature_base64)
    assert rsa_pss.verify(
        signing_message(protected.header, ORIGINAL), signature, public
    )
    # Es un contrato nuevo con dominio y metadatos, no una firma de memorándum.
    assert not rsa_pss.verify(ORIGINAL, signature, public)


@pytest.mark.parametrize(
    "data", [b"", b"\x00\xff", bytes(range(256)), "México 🇲🇽".encode()]
)
def test_binary_json_round_trip(registered, data):
    protected = prepare(
        registered, body=request(registered, content_base64=encoded(data))
    )
    restored = ProtectedDiplomaticNote.model_validate_json(protected.model_dump_json())
    assert open_as(restored, registered) == data


def test_new_version_never_reuses_aes_nonce_signature_or_envelopes(registered):
    ids = {"document_id": uuid4(), "version_id": uuid4()}
    first = prepare(registered, **ids)
    second = prepare(registered, **ids)
    assert aes_for(first, registered, OWNER) != aes_for(second, registered, OWNER)
    assert first.nonce_base64 != second.nonce_base64
    assert first.signature_base64 != second.signature_base64
    assert first.header.envelopes != second.header.envelopes


def test_internal_result_and_repr_do_not_hold_original_private_or_password(registered):
    body = request(registered)
    protected = prepare(registered, body=body)
    result = protected.model_dump_json()
    for secret in (PASSWORD, registered[2].private_base64, encoded(ORIGINAL)):
        assert secret not in result
        assert secret not in repr(body)
    assert "aes_key" not in result and "private_key" not in result
    assert protected.ciphertext_base64 not in repr(protected)


def test_self_recipient_occurs_only_once(registered):
    keys = registered[0]
    protected = prepare(
        registered,
        body=request(registered, recipients=[{"profile_id": str(OWNER)}]),
        keys=[keys[OWNER][0]],
    )
    assert len(protected.header.envelopes) == 1
    assert open_as(protected, registered, OWNER) == ORIGINAL


def test_unassigned_administrator_cannot_open(registered):
    protected = prepare(registered)
    with pytest.raises(ServiceError) as error:
        open_note(
            principal(OUTSIDER, role="admin"),
            protected,
            registered[0][OUTSIDER][0],
            registered[1],
            credentials(protected, registered, OUTSIDER),
        )
    assert error.value.status == 404


@pytest.mark.parametrize("missing", PERMISSIONS)
def test_creation_requires_all_three_permissions(registered, missing):
    with pytest.raises(ServiceError) as error:
        prepare(
            registered,
            actor=principal(permissions=[p for p in PERMISSIONS if p != missing]),
        )
    assert error.value.status == 403


@pytest.mark.parametrize("active,permissions", [(False, PERMISSIONS), (True, [])])
def test_inactive_and_unprivileged_profiles_fail_create_and_open(
    registered, active, permissions
):
    protected = prepare(registered)
    actor = principal(active=active, permissions=permissions)
    with pytest.raises(ServiceError) as creation:
        prepare(registered, actor=actor)
    assert creation.value.status == 403
    with pytest.raises(ServiceError) as opening:
        open_note(
            actor,
            protected,
            registered[0][OWNER][0],
            registered[1],
            credentials(protected, registered, OWNER),
        )
    assert opening.value.status == 403


@pytest.mark.parametrize(
    "field,value",
    [("profile_id", OUTSIDER), ("id", UUID(int=88)), ("is_active", False)],
)
def test_signer_must_be_current_active_key_of_actor(registered, field, value):
    signer = registered[1].model_copy(update={field: value})
    with pytest.raises(ServiceError) as error:
        prepare(registered, signer=signer)
    assert error.value.code == "diplomatic_signing_key_mismatch"


@pytest.mark.parametrize("field", ["public_base64", "fingerprint"])
def test_bad_signing_registry_material_is_unavailable(registered, field):
    signer = registered[1].model_copy(
        update={field: "%%%" if field == "public_base64" else "0" * 64}
    )
    with pytest.raises(ServiceError) as error:
        prepare(registered, signer=signer)
    assert error.value.code == "invalid_diplomatic_signing_key"
    assert error.value.status == 503


@pytest.mark.parametrize(
    "case", ["password", "encryption_private", "malformed_private"]
)
def test_wrong_signing_credentials_never_encrypt(registered, monkeypatch, case):
    changes = {
        "password": {"password": "contrasena-incorrecta"},
        "encryption_private": {
            "private_key_base64": registered[0][OWNER][1].private_base64
        },
        "malformed_private": {"private_key_base64": "%%%"},
    }[case]

    def unexpected(*args, **kwargs):
        pytest.fail("No debe cifrar si la firma no pudo comprobarse.")

    monkeypatch.setattr(aes_gcm, "encrypt", unexpected)
    with pytest.raises(ServiceError) as error:
        prepare(registered, body=request(registered, **changes))
    assert error.value.code == "invalid_signing_key"


@pytest.mark.parametrize(
    "profiles",
    [
        (OWNER,),
        (RECIPIENT,),
        (OWNER, RECIPIENT, OUTSIDER),
        (OWNER, RECIPIENT, RECIPIENT),
    ],
)
def test_recipient_snapshot_is_exact(registered, profiles):
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[registered[0][p][0] for p in profiles])
    assert error.value.code == "diplomatic_keys_incomplete"


@pytest.mark.parametrize("state", ["pending", "retired"])
def test_creation_requires_active_encryption_keys(registered, state):
    owner, recipient = (registered[0][p][0] for p in (OWNER, RECIPIENT))
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[owner, recipient.model_copy(update={"state": state})])
    assert error.value.code == "diplomatic_key_not_active"


@pytest.mark.parametrize(
    "case", ["reused_id", "reused_material", "signing_as_encryption"]
)
def test_distinct_keys_and_purposes_are_enforced(registered, case):
    owner, recipient = (registered[0][p][0] for p in (OWNER, RECIPIENT))
    signer = registered[1]
    changes = {
        "reused_id": {"id": owner.id},
        "reused_material": {
            "public_base64": owner.public_base64,
            "fingerprint": owner.fingerprint,
        },
        "signing_as_encryption": {
            "public_base64": signer.public_base64,
            "fingerprint": signer.fingerprint,
        },
    }[case]
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[owner, recipient.model_copy(update=changes)])
    assert error.value.code == "diplomatic_keys_repeated"


@pytest.mark.parametrize("field", ["public_base64", "fingerprint"])
def test_corrupt_encryption_registry_fails_before_signing(
    registered, monkeypatch, field
):
    def unexpected(*args, **kwargs):
        pytest.fail("No debe firmar con un snapshot de cifrado inválido.")

    monkeypatch.setattr(rsa_pss, "sign", unexpected)
    owner, recipient = (registered[0][p][0] for p in (OWNER, RECIPIENT))
    bad = recipient.model_copy(
        update={field: "%%%" if field == "public_base64" else "0" * 64}
    )
    with pytest.raises(ServiceError) as error:
        prepare(registered, keys=[owner, bad])
    assert error.value.code == "invalid_diplomatic_encryption_key"


def test_original_retired_encryption_and_signing_keys_still_verify_history(registered):
    protected = prepare(registered)
    key = registered[0][RECIPIENT][0].model_copy(update={"state": "retired"})
    signer = registered[1].model_copy(update={"is_active": False})
    assert (
        open_note(
            principal(RECIPIENT, permissions=["documents.read_assigned"]),
            protected,
            key,
            signer,
            credentials(protected, registered),
        )
        == ORIGINAL
    )


@pytest.mark.parametrize(
    "case", ["password", "other_private", "signing_private", "key_id", "version_id"]
)
def test_wrong_open_credentials_are_rejected(registered, case):
    protected = prepare(registered)
    changes = {
        "password": {"password": "contrasena-incorrecta"},
        "other_private": {"private_key_base64": registered[0][OWNER][1].private_base64},
        "signing_private": {"private_key_base64": registered[2].private_base64},
        "key_id": {"key_id": uuid4()},
        "version_id": {"version_id": uuid4()},
    }[case]
    with pytest.raises(ServiceError):
        open_as(protected, registered, **changes)


@pytest.mark.parametrize(
    "field,value",
    [("profile_id", RECIPIENT), ("id", UUID(int=89)), ("fingerprint", "0" * 64)],
)
def test_verification_requires_original_registered_signer(registered, field, value):
    protected = prepare(registered)
    signer = registered[1].model_copy(update={field: value})
    with pytest.raises(ServiceError) as error:
        open_note(
            principal(RECIPIENT),
            protected,
            registered[0][RECIPIENT][0],
            signer,
            credentials(protected, registered),
        )
    assert error.value.code == "diplomatic_signing_key_mismatch"


@pytest.mark.parametrize(
    "field", ["nonce_base64", "ciphertext_base64", "tag_base64", "signature_base64"]
)
def test_each_binary_component_is_authenticated(registered, field):
    protected = prepare(registered)
    payload = protected.model_dump(mode="json")
    payload[field] = damaged(payload[field])
    altered = ProtectedDiplomaticNote.model_validate(payload)
    with pytest.raises(ServiceError) as error:
        open_as(altered, registered)
    assert error.value.code == "diplomatic_integrity_failed"


@pytest.mark.parametrize(
    "field,value",
    [
        ("title", "Otro título"),
        ("filename", "otro.bin"),
        ("media_type", "text/plain"),
        ("kind", "communique"),
        ("document_id", str(UUID(int=99))),
    ],
)
def test_metadata_tampering_without_retagging_fails_gcm(registered, field, value):
    protected = prepare(registered)
    payload = protected.model_dump(mode="json")
    payload["header"][field] = value
    altered = ProtectedDiplomaticNote.model_validate(payload)
    with pytest.raises(ServiceError) as error:
        open_as(altered, registered)
    assert error.value.code == "diplomatic_integrity_failed"


@pytest.mark.parametrize(
    "change",
    ["content", "title", "kind", "document_id", "version_id", "recipient_envelope"],
)
def test_authorized_recipient_cannot_forge_issuer_even_with_aes_and_valid_gcm(
    registered, change
):
    protected = prepare(registered)
    payload = protected.model_dump(mode="json")
    data = ORIGINAL
    if change == "content":
        data = b"X" + ORIGINAL[1:]
    elif change == "recipient_envelope":
        owner = next(
            e for e in payload["header"]["envelopes"] if e["profile_id"] == str(OWNER)
        )
        owner["wrapped_key_base64"] = damaged(owner["wrapped_key_base64"])
    else:
        payload["header"][change] = {
            "title": "Suplantación de título",
            "kind": "communique",
            "document_id": str(uuid4()),
            "version_id": str(uuid4()),
        }[change]
    altered = ProtectedDiplomaticNote.model_validate(payload)
    aes = aes_for(protected, registered, RECIPIENT)
    aad = associated_data(altered.header, altered.signature_base64)
    retagged = aes_gcm.encrypt(data, aes, aad)
    assert aes_gcm.decrypt(retagged, aes, aad) == data  # GCM sí pasa.
    payload.update(
        nonce_base64=encoded(retagged.nonce),
        ciphertext_base64=encoded(retagged.ciphertext),
        tag_base64=encoded(retagged.tag),
    )
    forged = ProtectedDiplomaticNote.model_validate(payload)
    with pytest.raises(ServiceError) as error:
        open_as(forged, registered)  # La firma falla; no entrega plaintext.
    assert error.value.code == "diplomatic_integrity_failed"


def test_new_encryption_key_does_not_replace_historical_assignment(registered):
    protected = prepare(registered)
    replacement = registered[0][OUTSIDER][0].model_copy(
        update={"profile_id": RECIPIENT}
    )
    body = credentials(
        protected,
        registered,
        key_id=replacement.id,
        private_key_base64=registered[0][OUTSIDER][1].private_base64,
    )
    with pytest.raises(ServiceError) as error:
        open_note(principal(RECIPIENT), protected, replacement, registered[1], body)
    assert error.value.code == "diplomatic_encryption_key_mismatch"
    assert open_as(protected, registered) == ORIGINAL


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"filename": "../nota.txt"},
        {"media_type": "text/plain\r\nX: Y"},
        {"kind": "especial"},
        {"kind": "memorandum"},
        {"recipients": []},
        {"recipients": [{"profile_id": str(RECIPIENT)}] * 2},
        {"created_by": str(OUTSIDER)},
        {"public_base64": "del-cliente"},
        {"signature_base64": "firma-del-cliente"},
        {"threshold": 1},
        {"password": "corta"},
        {"password": "a" * 256 + "b"},
        {"password": "a" * 12 + "\x00"},
    ],
)
def test_invalid_or_client_controlled_contracts_fail(registered, changes):
    with pytest.raises(ValidationError):
        request(registered, **changes)


@pytest.mark.parametrize("value", ["%%%", "YQ===", "YQ"])
def test_invalid_content_base64_fails_before_signing(registered, monkeypatch, value):
    def unexpected(*args, **kwargs):
        pytest.fail("No debe firmar contenido Base64 inválido.")

    monkeypatch.setattr(rsa_pss, "sign", unexpected)
    with pytest.raises(ServiceError) as error:
        prepare(registered, body=request(registered, content_base64=value))
    assert error.value.code == "invalid_base64"


@pytest.mark.parametrize("version", [True, 1.0, "1", 2])
def test_format_version_is_strict_integer_one(registered, version):
    payload = prepare(registered).model_dump(mode="json")
    payload["header"]["format_version"] = version
    with pytest.raises(ValidationError):
        ProtectedDiplomaticNote.model_validate(payload)


def test_personnel_and_special_note_packages_are_not_interchangeable(registered):
    payload = prepare(registered).model_dump(mode="json")
    with pytest.raises(ValidationError):
        ProtectedPersonnelFile.model_validate(payload)
    payload["header"]["format"] = "stc-special-note"
    with pytest.raises(ValidationError):
        ProtectedDiplomaticNote.model_validate(payload)


def test_five_mib_file_fits_existing_storage_limit_and_one_extra_byte_fails(registered):
    data = b"x" * MAX_FILE_SIZE
    protected = prepare(
        registered, body=request(registered, content_base64=encoded(data))
    )
    assert len(decode(protected.ciphertext_base64)) == MAX_FILE_SIZE
    assert open_as(protected, registered) == data
    with pytest.raises(ServiceError) as error:
        prepare(
            registered, body=request(registered, content_base64=encoded(data + b"x"))
        )
    assert error.value.status == 413
