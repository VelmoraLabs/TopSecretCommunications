"""Errores públicos de la API, sin incluir respuestas sensibles del proveedor."""


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
