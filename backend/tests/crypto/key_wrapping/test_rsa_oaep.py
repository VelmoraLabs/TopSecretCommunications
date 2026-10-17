import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa

from app.crypto.encryption import decrypt, encrypt, generate_key
from app.crypto.key_wrapping import (
    InvalidKeyWrappingInput,
    KeyUnwrappingError,
    generate_key_pair,
    unwrap_key,
    wrap_key,
)


@pytest.fixture(scope="module")
def recipient():
    return generate_key_pair()


@pytest.fixture(scope="module")
def other_recipient():
    return generate_key_pair()


def test_generated_key_pair_and_round_trip(recipient):
    private_key, public_key = recipient
    assert private_key.key_size == public_key.key_size == 2048
    assert public_key.public_numbers().e == 65537
    assert private_key.public_key().public_numbers() == public_key.public_numbers()
    aes_key = generate_key()
    wrapped = wrap_key(aes_key, public_key)
    assert isinstance(wrapped, bytes)
    assert len(wrapped) == 256
    assert unwrap_key(wrapped, private_key) == aes_key


def test_wrap_is_randomized(recipient):
    private_key, public_key = recipient
    aes_key = generate_key()
    first = wrap_key(aes_key, public_key)
    second = wrap_key(aes_key, public_key)
    assert first != second
    assert unwrap_key(first, private_key) == aes_key
    assert unwrap_key(second, private_key) == aes_key


def test_interoperability_with_explicit_oaep_sha256(recipient):
    private_key, public_key = recipient
    aes_key = generate_key()
    oaep = padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()),
        algorithm=hashes.SHA256(),
        label=None,
    )
    assert private_key.decrypt(wrap_key(aes_key, public_key), oaep) == aes_key
    assert unwrap_key(public_key.encrypt(aes_key, oaep), private_key) == aes_key


def test_two_recipients_recover_one_aes_encrypted_document(recipient, other_recipient):
    aes_key = generate_key()
    original = b"Expediente de prueba\x00\xff"
    aad = b"expediente:demo"
    encrypted = encrypt(original, aes_key, aad)
    for private_key, public_key in (recipient, other_recipient):
        recovered_key = unwrap_key(wrap_key(aes_key, public_key), private_key)
        assert recovered_key == aes_key
        assert decrypt(encrypted, recovered_key, aad) == original


def test_other_recipient_cannot_unwrap(recipient, other_recipient):
    private_key, public_key = recipient
    other_private, other_public = other_recipient
    aes_key = generate_key()
    with pytest.raises(KeyUnwrappingError):
        unwrap_key(wrap_key(aes_key, public_key), other_private)
    with pytest.raises(KeyUnwrappingError):
        unwrap_key(wrap_key(aes_key, other_public), private_key)


def test_modified_wrapped_key_is_rejected(recipient):
    private_key, public_key = recipient
    damaged = bytearray(wrap_key(generate_key(), public_key))
    damaged[-1] ^= 1
    with pytest.raises(KeyUnwrappingError):
        unwrap_key(bytes(damaged), private_key)


@pytest.mark.parametrize(
    "value",
    [None, "clave", bytearray(32), b"", bytes(16), bytes(24), bytes(31), bytes(33)],
)
def test_invalid_aes_key_is_rejected(recipient, value):
    with pytest.raises(InvalidKeyWrappingInput):
        wrap_key(value, recipient[1])


@pytest.mark.parametrize(
    "value", [None, "clave", bytearray(256), b"", bytes(255), bytes(257)]
)
def test_invalid_wrapped_key_is_rejected(recipient, value):
    with pytest.raises(InvalidKeyWrappingInput):
        unwrap_key(value, recipient[0])


def test_wrong_rsa_key_type_is_rejected(recipient):
    private_key, public_key = recipient
    ec_private = ec.generate_private_key(ec.SECP256R1())
    for value in (None, "clave", private_key, ec_private.public_key()):
        with pytest.raises(InvalidKeyWrappingInput):
            wrap_key(generate_key(), value)
    for value in (None, "clave", public_key, ec_private):
        with pytest.raises(InvalidKeyWrappingInput):
            unwrap_key(bytes(256), value)


def test_undersized_rsa_key_is_rejected():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    with pytest.raises(InvalidKeyWrappingInput):
        wrap_key(generate_key(), private_key.public_key())
    with pytest.raises(InvalidKeyWrappingInput):
        unwrap_key(bytes(128), private_key)


def test_larger_rsa_key_is_supported():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    aes_key = generate_key()
    wrapped = wrap_key(aes_key, private_key.public_key())
    assert len(wrapped) == 384
    assert unwrap_key(wrapped, private_key) == aes_key


@pytest.mark.parametrize(
    "algorithm,mgf_algorithm,label",
    [
        (hashes.SHA1(), hashes.SHA1(), None),
        (hashes.SHA256(), hashes.SHA1(), None),
        (hashes.SHA256(), hashes.SHA256(), b"otro contexto"),
    ],
)
def test_incompatible_oaep_parameters_are_rejected(
    recipient, algorithm, mgf_algorithm, label
):
    private_key, public_key = recipient
    wrapped = public_key.encrypt(
        generate_key(),
        padding.OAEP(mgf=padding.MGF1(mgf_algorithm), algorithm=algorithm, label=label),
    )
    with pytest.raises(KeyUnwrappingError):
        unwrap_key(wrapped, private_key)


@pytest.mark.parametrize("payload", [b"", bytes(16), bytes(31), bytes(33)])
def test_decrypted_payload_must_be_an_aes256_key(recipient, payload):
    private_key, public_key = recipient
    wrapped = public_key.encrypt(
        payload,
        padding.OAEP(
            mgf=padding.MGF1(hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    with pytest.raises(KeyUnwrappingError):
        unwrap_key(wrapped, private_key)
