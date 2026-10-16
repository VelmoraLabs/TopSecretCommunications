from dataclasses import FrozenInstanceError, replace

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.crypto.encryption import (
    AuthenticationError,
    EncryptedData,
    InvalidEncryptionInput,
    aes_gcm,
    decrypt,
    encrypt,
    generate_key,
)


@pytest.mark.parametrize(
    "plaintext,ciphertext,tag",
    [
        ("", "", "530f8afbc74536b9a963b4f1c4cb738b"),
        (
            "00" * 16,
            "cea7403d4d606b6e074ec5d3baf39d18",
            "d0d1c8a799996bf0265b98b5d48ab919",
        ),
    ],
)
def test_known_aes256_gcm_vectors(monkeypatch, plaintext, ciphertext, tag):
    # Vectores 13 y 14, McGrew/Viega, GCM specification.
    # El nonce fijo se inyecta SOLO en la prueba; la API pública no lo recibe.
    monkeypatch.setattr(aes_gcm.secrets, "token_bytes", lambda size: bytes(size))
    result = encrypt(bytes.fromhex(plaintext), bytes(32))
    assert result.nonce == bytes(12)
    assert result.ciphertext.hex() == ciphertext
    assert result.tag.hex() == tag
    assert decrypt(result, bytes(32)) == bytes.fromhex(plaintext)


def test_key_generation_and_fresh_nonce_for_same_key():
    key = generate_key()
    assert isinstance(key, bytes) and len(key) == 32
    assert key != generate_key()
    first = encrypt(b"nota", key, b"metadatos")
    second = encrypt(b"nota", key, b"metadatos")
    assert len(first.nonce) == 12 and len(first.tag) == 16
    assert first.nonce != second.nonce
    assert decrypt(first, key, b"metadatos") == b"nota"


@pytest.mark.parametrize("plaintext", [b"", b"\x00\x00", bytes(range(256))])
def test_binary_and_aad_interoperability_with_library(plaintext):
    key = generate_key()
    aad = "Área reservada".encode()
    result = encrypt(plaintext, key, aad)
    assert (
        AESGCM(key).decrypt(result.nonce, result.ciphertext + result.tag, aad)
        == plaintext
    )
    # Un resultado producido fuera del módulo puede descifrarse por su contrato.
    nonce = bytes(range(12))
    combined = AESGCM(key).encrypt(nonce, plaintext, aad)
    imported = EncryptedData(nonce, combined[:-16], combined[-16:])
    assert decrypt(imported, key, aad) == plaintext


@pytest.mark.parametrize("field", ["nonce", "ciphertext", "tag", "aad", "key"])
def test_every_authenticated_component_is_checked(field):
    key = generate_key()
    result = encrypt(b"documento", key, b"metadatos")
    aad = b"metadatos"
    if field == "aad":
        aad = b"otros metadatos"
    elif field == "key":
        key = generate_key()
    else:
        value = bytearray(getattr(result, field))
        value[0] ^= 1
        result = replace(result, **{field: bytes(value)})
    with pytest.raises(AuthenticationError):
        decrypt(result, key, aad)


@pytest.mark.parametrize(
    "key", [b"", bytes(16), bytes(24), bytes(31), bytes(33), "k", None]
)
def test_invalid_key_type_and_length(key):
    with pytest.raises(InvalidEncryptionInput):
        encrypt(b"data", key)
    with pytest.raises(InvalidEncryptionInput):
        decrypt(EncryptedData(bytes(12), b"", bytes(16)), key)


@pytest.mark.parametrize("value", ["texto", None, bytearray(b"contenido"), 123])
def test_plaintext_and_aad_must_be_bytes(value):
    key = generate_key()
    with pytest.raises(InvalidEncryptionInput):
        encrypt(value, key)
    with pytest.raises(InvalidEncryptionInput):
        encrypt(b"data", key, value)
    with pytest.raises(InvalidEncryptionInput):
        decrypt(encrypt(b"data", key), key, value)


@pytest.mark.parametrize(
    "nonce,ciphertext,tag",
    [
        (bytes(11), b"", bytes(16)),
        (bytes(13), b"", bytes(16)),
        ("nonce", b"", bytes(16)),
        (bytes(12), None, bytes(16)),
        (bytes(12), b"", bytes(15)),
        (bytes(12), b"", bytes(17)),
        (bytes(12), b"", "tag"),
    ],
)
def test_encrypted_structure_is_validated(nonce, ciphertext, tag):
    with pytest.raises(InvalidEncryptionInput):
        EncryptedData(nonce, ciphertext, tag)


def test_decrypt_rejects_unknown_structure():
    with pytest.raises(InvalidEncryptionInput):
        decrypt({"nonce": bytes(12)}, generate_key())


def test_limits_without_allocating_large_buffers(monkeypatch):
    monkeypatch.setattr(aes_gcm, "MAX_DATA_SIZE", 4)
    monkeypatch.setattr(aes_gcm, "MAX_AAD_SIZE", 4)
    key = generate_key()
    with pytest.raises(InvalidEncryptionInput):
        encrypt(b"12345", key)
    with pytest.raises(InvalidEncryptionInput):
        encrypt(b"x", key, b"12345")
    with pytest.raises(InvalidEncryptionInput):
        EncryptedData(bytes(12), b"12345", bytes(16))


def test_result_is_immutable_and_does_not_contain_key():
    result = encrypt(b"documento", generate_key())
    assert not hasattr(result, "key")
    assert "ciphertext=" not in repr(result)
    with pytest.raises(FrozenInstanceError):
        result.tag = bytes(16)
