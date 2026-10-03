import json
import re

from app.crypto.shamir.errors import InvalidShareError
from app.crypto.shamir.types import Share

MAX_SERIALIZED_LENGTH = 2048
FIELDS = {"version", "set_id", "threshold", "share_count", "secret_size", "x", "y"}


def serialize_share(share: Share) -> str:
    """Devuelve JSON sensible; y es texto para evitar pérdida de precisión."""
    return json.dumps(
        {
            "version": share.version,
            "set_id": share.set_id,
            "threshold": share.threshold,
            "share_count": share.share_count,
            "secret_size": share.secret_size,
            "x": share.x,
            "y": str(share.y),
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidShareError("El JSON contiene propiedades repetidas.")
        result[key] = value
    return result


def deserialize_share(payload: str) -> Share:
    """Valida un fragmento versionado antes de utilizarlo."""
    if not isinstance(payload, str) or len(payload) > MAX_SERIALIZED_LENGTH:
        raise InvalidShareError("Tamaño o tipo de fragmento inválido.")
    try:
        data: object = json.loads(payload, object_pairs_hook=_unique_object)
    except (ValueError, RecursionError) as exc:
        raise InvalidShareError("El fragmento no es JSON válido.") from exc
    if not isinstance(data, dict) or set(data) != FIELDS:
        raise InvalidShareError("Las propiedades del fragmento son inválidas.")

    version = data["version"]
    set_id = data["set_id"]
    threshold = data["threshold"]
    share_count = data["share_count"]
    secret_size = data["secret_size"]
    x = data["x"]
    y = data["y"]
    if not isinstance(set_id, str) or not isinstance(y, str):
        raise InvalidShareError("El identificador y la coordenada y deben ser texto.")
    if not re.fullmatch(r"0|[1-9][0-9]{0,156}", y):
        raise InvalidShareError("La coordenada y debe ser un entero decimal válido.")
    integers = [version, threshold, share_count, secret_size, x]
    if any(type(value) is not int for value in integers):
        raise InvalidShareError("Los parámetros deben ser enteros.")
    return Share(
        set_id=set_id,
        threshold=threshold,
        share_count=share_count,
        x=x,
        y=int(y),
        version=version,
        secret_size=secret_size,
    )
