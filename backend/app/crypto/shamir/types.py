import re
from dataclasses import dataclass, field

from app.crypto.shamir.errors import InvalidShareError, ShamirError
from app.crypto.shamir.field import PRIME

SECRET_SIZE = 32
MAX_SHARES = 255
FORMAT_VERSION = 1


def validate_parameters(threshold: int, share_count: int) -> None:
    if type(threshold) is not int or type(share_count) is not int:
        raise ShamirError("El umbral y la cantidad deben ser enteros.")
    if not 2 <= threshold <= share_count <= MAX_SHARES:
        raise ShamirError("Se requiere 2 <= umbral <= cantidad <= 255.")


@dataclass(frozen=True, slots=True)
class Share:
    set_id: str
    threshold: int
    share_count: int
    x: int
    y: int = field(repr=False)
    version: int = FORMAT_VERSION
    secret_size: int = SECRET_SIZE

    def __post_init__(self) -> None:
        if not isinstance(self.set_id, str) or not re.fullmatch(
            r"[0-9a-f]{32}", self.set_id
        ):
            raise InvalidShareError("Identificador de conjunto inválido.")
        try:
            validate_parameters(self.threshold, self.share_count)
        except ShamirError as exc:
            raise InvalidShareError(str(exc)) from exc
        if type(self.x) is not int or not 1 <= self.x <= self.share_count:
            raise InvalidShareError("Índice de fragmento inválido.")
        if type(self.y) is not int or not 0 <= self.y < PRIME:
            raise InvalidShareError("Valor del fragmento fuera del campo.")
        if type(self.version) is not int or self.version != FORMAT_VERSION:
            raise InvalidShareError("Versión de fragmento no soportada.")
        if type(self.secret_size) is not int or self.secret_size != SECRET_SIZE:
            raise InvalidShareError("El secreto debe tener 32 bytes.")
