import secrets
from collections.abc import Sequence

from app.crypto.shamir.errors import (
    IncompatibleSharesError,
    InsufficientSharesError,
    InvalidShareError,
    ShamirError,
)
from app.crypto.shamir.field import PRIME, evaluate_polynomial, interpolate_at
from app.crypto.shamir.types import SECRET_SIZE, Share, validate_parameters


def split_secret(secret: bytes, threshold: int, share_count: int) -> list[Share]:
    """Divide un secreto de 32 bytes en n fragmentos con umbral t."""
    validate_parameters(threshold, share_count)
    if not isinstance(secret, bytes) or len(secret) != SECRET_SIZE:
        raise ShamirError("El secreto debe ser bytes de longitud 32.")

    coefficients = [int.from_bytes(secret, "big")]
    # Muestreo uniforme del campo completo, incluido cero.
    coefficients.extend(secrets.randbelow(PRIME) for _ in range(threshold - 1))
    set_id = secrets.token_hex(16)
    return [
        Share(
            set_id=set_id,
            threshold=threshold,
            share_count=share_count,
            x=x,
            y=evaluate_polynomial(coefficients, x),
        )
        for x in range(1, share_count + 1)
    ]


def reconstruct_secret(shares: Sequence[Share]) -> bytes:
    """Recupera los bytes originales; no autentica a los participantes."""
    if not shares:
        raise InsufficientSharesError("No se recibieron fragmentos.")
    if len(shares) > 255 or any(not isinstance(s, Share) for s in shares):
        raise InvalidShareError("Lista de fragmentos inválida.")

    first = shares[0]
    for share in shares:
        if (
            share.set_id,
            share.threshold,
            share.share_count,
            share.version,
            share.secret_size,
        ) != (
            first.set_id,
            first.threshold,
            first.share_count,
            first.version,
            first.secret_size,
        ):
            raise IncompatibleSharesError("Los fragmentos son de conjuntos distintos.")

    if len({share.x for share in shares}) != len(shares):
        raise InvalidShareError("Hay índices de fragmento repetidos.")
    if len(shares) < first.threshold:
        raise InsufficientSharesError("No se alcanzó el umbral requerido.")
    if len(shares) > first.share_count:
        raise InvalidShareError("Cantidad de fragmentos fuera del conjunto.")

    basis = [(share.x, share.y) for share in shares[: first.threshold]]
    for share in shares[first.threshold :]:
        if interpolate_at(basis, share.x) != share.y:
            raise InvalidShareError("Los fragmentos no forman un polinomio compatible.")

    value = interpolate_at(basis, 0)
    if value >= 1 << (8 * SECRET_SIZE):
        raise InvalidShareError("El resultado no corresponde a un secreto de 32 bytes.")
    return value.to_bytes(SECRET_SIZE, "big")
