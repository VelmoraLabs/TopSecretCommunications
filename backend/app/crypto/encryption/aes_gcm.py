"""Cifrado autenticado AES-256-GCM, independiente de HTTP y de Shamir."""

import secrets
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_SIZE = 32
NONCE_SIZE = 12
TAG_SIZE = 16
# Límite conservador: ciphertext + tag cabe en la llamada de descifrado.
MAX_DATA_SIZE = (1 << 31) - 1 - TAG_SIZE
MAX_AAD_SIZE = (1 << 31) - 1


class EncryptionError(ValueError):
    """Error del contrato de cifrado."""


class InvalidEncryptionInput(EncryptionError):
    """Tipo, longitud o estructura de entrada no permitidos."""


class AuthenticationError(EncryptionError):
    """No se autenticaron clave, nonce, contenido, tag o AAD."""


def _check_bytes(value: bytes, name: str, maximum: int) -> None:
    if not isinstance(value, bytes):
        raise InvalidEncryptionInput(f"{name} debe ser bytes.")
    if len(value) > maximum:
        raise InvalidEncryptionInput(f"{name} supera el tamaño permitido.")


def _check_key(key: bytes) -> None:
    _check_bytes(key, "La clave", KEY_SIZE)
    if len(key) != KEY_SIZE:
        raise InvalidEncryptionInput("AES-256-GCM requiere una clave de 32 bytes.")


@dataclass(frozen=True, slots=True)
class EncryptedData:
    """Resultado binario: nonce de 96 bits, ciphertext y tag de 128 bits."""

    nonce: bytes
    ciphertext: bytes = field(repr=False)
    tag: bytes = field(repr=False)

    def __post_init__(self) -> None:
        _check_bytes(self.nonce, "El nonce", NONCE_SIZE)
        _check_bytes(self.ciphertext, "El texto cifrado", MAX_DATA_SIZE)
        _check_bytes(self.tag, "El tag", TAG_SIZE)
        if len(self.nonce) != NONCE_SIZE or len(self.tag) != TAG_SIZE:
            raise InvalidEncryptionInput("Se requieren nonce de 12 bytes y tag de 16.")


def generate_key() -> bytes:
    """Genera una clave aleatoria de 256 bits mediante la biblioteca criptográfica."""
    return AESGCM.generate_key(bit_length=256)


def encrypt(data: bytes, key: bytes, associated_data: bytes = b"") -> EncryptedData:
    """Cifra y autentica; cada llamada genera su propio nonce criptográfico."""
    _check_key(key)
    _check_bytes(data, "El contenido", MAX_DATA_SIZE)
    _check_bytes(associated_data, "Los datos asociados", MAX_AAD_SIZE)
    nonce = secrets.token_bytes(NONCE_SIZE)
    combined = AESGCM(key).encrypt(nonce, data, associated_data)
    return EncryptedData(
        nonce=nonce, ciphertext=combined[:-TAG_SIZE], tag=combined[-TAG_SIZE:]
    )


def decrypt(
    encrypted: EncryptedData, key: bytes, associated_data: bytes = b""
) -> bytes:
    """Devuelve plaintext solo después de verificar íntegramente la autenticación."""
    _check_key(key)
    _check_bytes(associated_data, "Los datos asociados", MAX_AAD_SIZE)
    if not isinstance(encrypted, EncryptedData):
        raise InvalidEncryptionInput("El contenido cifrado debe ser EncryptedData.")
    try:
        return AESGCM(key).decrypt(
            encrypted.nonce, encrypted.ciphertext + encrypted.tag, associated_data
        )
    except InvalidTag as exc:
        raise AuthenticationError(
            "No se pudo autenticar el contenido cifrado."
        ) from exc
