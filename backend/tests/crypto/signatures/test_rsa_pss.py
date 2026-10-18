import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, utils

from app.crypto.signatures import (
    generate_key_pair,
    sha256,
    sign,
    verify,
)


@pytest.fixture(scope="module")
def signer():
    return generate_key_pair()


def test_sha256_known_value():
    assert sha256(b"abc").hex() == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


def test_generated_key_parameters(signer):
    private_key, public_key = signer

    assert private_key.key_size == 2048
    assert public_key.key_size == 2048
    assert public_key.public_numbers().e == 65537
    assert private_key.public_key().public_numbers() == public_key.public_numbers()


def test_sign_and_verify(signer):
    private_key, public_key = signer
    message = "Memorándum interno de prueba.".encode()

    signature = sign(message, private_key)

    assert len(signature) == 256
    assert verify(message, signature, public_key) is True


def test_modified_document_is_rejected(signer):
    private_key, public_key = signer
    signature = sign(b"Documento original", private_key)

    assert verify(b"Documento modificado", signature, public_key) is False


def test_modified_signature_is_rejected(signer):
    private_key, public_key = signer
    message = b"Documento original"
    signature = bytearray(sign(message, private_key))
    signature[-1] ^= 1

    assert verify(message, bytes(signature), public_key) is False


def test_wrong_public_key_is_rejected(signer):
    private_key, _ = signer
    _, other_public_key = generate_key_pair()
    message = b"Documento original"

    signature = sign(message, private_key)

    assert verify(message, signature, other_public_key) is False


def test_interoperability_without_double_hashing(signer):
    private_key, public_key = signer
    message = b"Memorandum original"

    pss = padding.PSS(
        mgf=padding.MGF1(hashes.SHA256()),
        salt_length=32,
    )
    signature = sign(message, private_key)

    # Verificación directa con la biblioteca sobre el mensaje original.
    public_key.verify(signature, message, pss, hashes.SHA256())

    # El digest también verifica si se indica que ya fue calculado.
    public_key.verify(
        signature,
        sha256(message),
        pss,
        utils.Prehashed(hashes.SHA256()),
    )

    # Volver a calcular SHA-256 sobre el digest debe fallar.
    with pytest.raises(InvalidSignature):
        public_key.verify(
            signature,
            sha256(message),
            pss,
            hashes.SHA256(),
        )

    # Una firma creada directamente por la biblioteca también debe verificar.
    external_signature = private_key.sign(message, pss, hashes.SHA256())
    assert verify(message, external_signature, public_key) is True


@pytest.mark.parametrize(
    "algorithm,mgf_algorithm,salt_length",
    [
        (hashes.SHA256(), hashes.SHA256(), 0),
        (hashes.SHA256(), hashes.SHA256(), padding.PSS.MAX_LENGTH),
        (hashes.SHA256(), hashes.SHA1(), 32),
        (hashes.SHA384(), hashes.SHA256(), 32),
    ],
)
def test_incompatible_pss_parameters_are_rejected(
    signer, algorithm, mgf_algorithm, salt_length
):
    private_key, public_key = signer
    message = b"Memorandum original"

    signature = private_key.sign(
        message,
        padding.PSS(
            mgf=padding.MGF1(mgf_algorithm),
            salt_length=salt_length,
        ),
        algorithm,
    )

    assert verify(message, signature, public_key) is False
