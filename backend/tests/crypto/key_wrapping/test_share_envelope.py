"""Sobres reales: aislamiento, autenticación, contexto y reconstrucción n de n."""

import base64
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.crypto.key_wrapping import rsa_oaep
from app.crypto.key_wrapping.share_envelope import (
    EnvelopeContext,
    ShareEnvelope,
    open_share,
    seal_share,
)
from app.crypto.shamir import reconstruct_secret, split_secret
from app.crypto.signatures.key_files import public_bytes
from app.crypto.signatures.rsa_pss import sha256


@pytest.fixture(scope="module")
def keys():
    return [rsa_oaep.generate_key_pair() for _ in range(3)]


def make_context(share, public):
    return EnvelopeContext(
        note_id=uuid4(),
        set_id=share.set_id,
        recipient_id=uuid4(),
        key_id=uuid4(),
        fingerprint=sha256(public_bytes(public)).hex(),
        share_index=share.x,
        share_count=share.share_count,
        threshold=share.threshold,
    )


def test_real_hybrid_roundtrip_and_all_participants_required(keys):
    secret = b"s" * 32
    shares = split_secret(secret, 3, 3)
    recovered = []
    for share, (private, public) in zip(shares, keys, strict=True):
        context = make_context(share, public)
        sealed = seal_share(share, public, context)
        assert len(base64.b64decode(sealed.wrapped_key_base64)) == 256
        assert str(share.y) not in sealed.model_dump_json()
        assert "private" not in sealed.model_dump_json()
        copy = ShareEnvelope.model_validate_json(sealed.model_dump_json())
        recovered.append(open_share(copy, private, context))
    assert reconstruct_secret(recovered) == secret
    with pytest.raises(ValueError):
        reconstruct_secret(recovered[:2])


def test_other_private_key_cannot_open_share(keys):
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = make_context(share, keys[0][1])
    sealed = seal_share(share, keys[0][1], context)
    with pytest.raises(ValueError):
        open_share(sealed, keys[1][0], context)


@pytest.mark.parametrize(
    "field",
    [
        "note_id",
        "recipient_id",
        "key_id",
        "set_id",
        "fingerprint",
        "share_index",
        "share_count",
        "threshold",
    ],
)
def test_context_substitution_is_rejected(keys, field):
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = make_context(share, keys[0][1])
    sealed = seal_share(share, keys[0][1], context)
    changed = {
        "note_id": uuid4(),
        "recipient_id": uuid4(),
        "key_id": uuid4(),
        "set_id": "f" * 32,
        "fingerprint": "a" * 64,
        "share_index": 2,
        "share_count": 3,
        "threshold": 3,
    }[field]
    altered = sealed.model_copy(
        update={"context": context.model_copy(update={field: changed})}
    )
    with pytest.raises(ValueError):
        open_share(altered, keys[0][0], context)
    # Incluso si alguien acepta el contexto alterado como esperado, el tag lo detecta.
    with pytest.raises(ValueError):
        open_share(altered, keys[0][0], altered.context)


@pytest.mark.parametrize(
    "field", ["wrapped_key_base64", "nonce_base64", "ciphertext_base64", "tag_base64"]
)
def test_bit_flip_is_rejected_with_valid_base64(keys, field):
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = make_context(share, keys[0][1])
    sealed = seal_share(share, keys[0][1], context)
    raw = bytearray(base64.b64decode(getattr(sealed, field)))
    raw[0] ^= 1
    altered = sealed.model_copy(update={field: base64.b64encode(raw).decode()})
    with pytest.raises(ValueError):
        open_share(altered, keys[0][0], context)


def test_new_random_envelope_every_time(keys):
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = make_context(share, keys[0][1])
    a, b = [seal_share(share, keys[0][1], context) for _ in range(2)]
    assert a.nonce_base64 != b.nonce_base64
    assert a.wrapped_key_base64 != b.wrapped_key_base64
    assert a.ciphertext_base64 != b.ciphertext_base64


def test_wrong_share_index_or_threshold_rejected_before_encrypt(keys):
    share = split_secret(b"s" * 32, 2, 3)[0]
    context = make_context(share, keys[0][1])
    with pytest.raises(ValueError):
        seal_share(share, keys[0][1], context)


def test_malformed_envelope_has_bounded_canonical_base64(keys):
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = make_context(share, keys[0][1])
    data = seal_share(share, keys[0][1], context).model_dump()
    for field, value in [
        ("nonce_base64", "!" * 16),
        ("ciphertext_base64", "A" * 4097),
        ("tag_base64", "A" * 23 + "="),
    ]:
        with pytest.raises(ValidationError):
            ShareEnvelope.model_validate({**data, field: value})


def test_seal_rejects_context_fingerprint_for_a_different_public_key(keys):
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = make_context(share, keys[1][1])
    with pytest.raises(ValueError):
        seal_share(share, keys[0][1], context)
