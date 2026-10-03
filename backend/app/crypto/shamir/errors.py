class ShamirError(ValueError):
    """Error de parámetros, formato o reconstrucción de Shamir."""


class InvalidShareError(ShamirError):
    """Un fragmento tiene un formato o valor inválido."""


class InsufficientSharesError(ShamirError):
    """No se alcanzó el umbral de fragmentos."""


class IncompatibleSharesError(ShamirError):
    """Los fragmentos no pertenecen al mismo conjunto."""
