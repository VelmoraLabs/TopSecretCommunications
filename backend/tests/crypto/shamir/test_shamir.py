import json
from dataclasses import replace
from itertools import combinations

import pytest

from app.crypto.shamir import (
    IncompatibleSharesError,
    InsufficientSharesError,
    InvalidShareError,
    ShamirError,
    Share,
    deserialize_share,
    reconstruct_secret,
    serialize_share,
    split_secret,
)
from app.crypto.shamir.field import PRIME, evaluate_polynomial, interpolate_at


@pytest.mark.parametrize("threshold,share_count", [(2, 2), (2, 5), (3, 5), (4, 4)])
def test_every_threshold_subset_recovers_secret(
    threshold: int, share_count: int
) -> None:
    secret = bytes(range(32))
    shares = split_secret(secret, threshold, share_count)
    for group in combinations(shares, threshold):
        assert reconstruct_secret(group) == secret
        assert reconstruct_secret(list(reversed(group))) == secret
    assert reconstruct_secret(shares) == secret


@pytest.mark.parametrize(
    "secret", [bytes(32), bytes([255]) * 32, b"\x00" * 8 + b"a" * 24]
)
def test_byte_length_and_leading_zeros_are_preserved(secret: bytes) -> None:
    shares = split_secret(secret, 3, 5)
    result = reconstruct_secret(shares[:3])
    assert result == secret
    assert len(result) == 32


def test_known_polynomial_vector() -> None:
    # f(x) = 1234 + 166*x + 94*x^2.
    points = [(1, 1494), (2, 1942), (3, 2578)]
    assert evaluate_polynomial([1234, 166, 94], 1) == 1494
    assert interpolate_at(points, 0) == 1234
    assert interpolate_at(points, 4) == 3402


@pytest.mark.parametrize("threshold,share_count", [(1, 3), (0, 3), (4, 3), (2, 256)])
def test_invalid_parameters_are_rejected(threshold: int, share_count: int) -> None:
    with pytest.raises(ShamirError):
        split_secret(bytes(32), threshold, share_count)


def test_boolean_parameter_is_rejected() -> None:
    with pytest.raises(ShamirError):
        split_secret(bytes(32), True, 3)


@pytest.mark.parametrize("secret", [b"", b"short", bytes(31), bytes(33)])
def test_invalid_secret_size_is_rejected(secret: bytes) -> None:
    with pytest.raises(ShamirError):
        split_secret(secret, 2, 3)


def test_insufficient_shares_are_rejected() -> None:
    shares = split_secret(bytes(32), 3, 5)
    with pytest.raises(InsufficientSharesError):
        reconstruct_secret(shares[:2])
    with pytest.raises(InsufficientSharesError):
        reconstruct_secret([])


def test_all_participants_policy_requires_all_members() -> None:
    shares = split_secret(bytes(32), 4, 4)
    with pytest.raises(InsufficientSharesError):
        reconstruct_secret(shares[:3])
    assert reconstruct_secret(shares) == bytes(32)


def test_duplicate_indices_are_rejected() -> None:
    shares = split_secret(bytes(32), 3, 5)
    with pytest.raises(InvalidShareError):
        reconstruct_secret([shares[0], shares[0], shares[1]])


def test_different_sets_are_rejected() -> None:
    first = split_secret(bytes(32), 2, 3)
    second = split_secret(bytes(32), 2, 3)
    with pytest.raises(IncompatibleSharesError):
        reconstruct_secret([first[0], second[1]])


def test_metadata_mismatch_is_rejected() -> None:
    shares = split_secret(bytes(32), 3, 5)
    different = replace(shares[1], threshold=2)
    with pytest.raises(IncompatibleSharesError):
        reconstruct_secret([shares[0], different, shares[2]])


@pytest.mark.parametrize("x,y", [(0, 1), (4, 1), (1, -1), (1, PRIME)])
def test_invalid_coordinate_is_rejected(x: int, y: int) -> None:
    with pytest.raises(InvalidShareError):
        Share(set_id="a" * 32, threshold=2, share_count=3, x=x, y=y)


def test_inconsistent_extra_share_is_rejected() -> None:
    shares = split_secret(bytes(32), 3, 5)
    shares[3] = replace(shares[3], y=(shares[3].y + 1) % PRIME)
    with pytest.raises(InvalidShareError):
        reconstruct_secret(shares[:4])


def test_share_repr_omits_sensitive_coordinate() -> None:
    share = Share(set_id="a" * 32, threshold=2, share_count=3, x=1, y=987654321)
    assert "987654321" not in repr(share)


def test_serialization_preserves_large_integer_exactly() -> None:
    share = Share(set_id="a" * 32, threshold=2, share_count=3, x=1, y=PRIME - 1)
    payload = serialize_share(share)
    assert isinstance(json.loads(payload)["y"], str)
    assert deserialize_share(payload) == share


def test_serialized_shares_recover_secret() -> None:
    secret = bytes(range(32))
    restored = [
        deserialize_share(serialize_share(s)) for s in split_secret(secret, 3, 5)
    ]
    assert reconstruct_secret(restored[1:4]) == secret


@pytest.mark.parametrize("payload", ["", "not-json", "[]", "{}", "x" * 2049])
def test_malformed_payload_is_rejected(payload: str) -> None:
    with pytest.raises(InvalidShareError):
        deserialize_share(payload)


@pytest.mark.parametrize(
    "field,value",
    [
        ("version", 2),
        ("version", True),
        ("threshold", True),
        ("x", 0),
        ("set_id", "invalid"),
        ("secret_size", 31),
        ("y", 123),
        ("y", "-1"),
        ("y", "01"),
        ("y", str(PRIME)),
        ("extra", "unexpected"),
    ],
)
def test_invalid_serialized_fields_are_rejected(field: str, value: object) -> None:
    share = Share(set_id="a" * 32, threshold=2, share_count=3, x=1, y=2)
    data = json.loads(serialize_share(share))
    data[field] = value
    with pytest.raises(InvalidShareError):
        deserialize_share(json.dumps(data))


def test_duplicate_json_properties_are_rejected() -> None:
    share = Share(set_id="a" * 32, threshold=2, share_count=3, x=1, y=2)
    payload = serialize_share(share)
    payload = payload[:-1] + ',"x":2}'
    with pytest.raises(InvalidShareError):
        deserialize_share(payload)


def test_plain_shamir_does_not_authenticate_a_forged_set() -> None:
    # Un desplazamiento común altera el secreto sin romper el polinomio.
    # Esta prueba documenta el límite: Shamir no es autenticación de shares.
    shares = split_secret(bytes(32), 3, 5)
    forged = [replace(s, y=(s.y + 1) % PRIME) for s in shares]
    assert reconstruct_secret(forged) == (1).to_bytes(32, "big")
