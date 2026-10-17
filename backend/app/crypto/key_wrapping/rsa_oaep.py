"""Protección de claves AES-256 mediante RSA-OAEP con SHA-256."""

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

AES_KEY_SIZE = 32
RSA_KEY_SIZE = 2048
PUBLIC_EXPONENT = 65537


class KeyWrappingError(ValueError):
    """Error del módulo de protección de claves."""


class InvalidKeyWrappingInput(KeyWrappingError):
    """Tipo, longitud o clave RSA no permitidos."""


class KeyUnwrappingError(KeyWrappingError):
    """No se pudo recuperar una clave AES válida."""


def _oaep() -> padding.OAEP:
    return padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()),
        algorithm=hashes.SHA256(),
        label=None,
    )


def generate_key_pair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    """Genera un par RSA en memoria; devuelve primero la clave privada."""
    private_key = rsa.generate_private_key(
        public_exponent=PUBLIC_EXPONENT,
        key_size=RSA_KEY_SIZE,
    )
    return private_key, private_key.public_key()


def wrap_key(aes_key: bytes, public_key: rsa.RSAPublicKey) -> bytes:
    """Protege una clave AES de 32 bytes para un destinatario."""
    if not isinstance(aes_key, bytes) or len(aes_key) != AES_KEY_SIZE:
        raise InvalidKeyWrappingInput("La clave AES debe ser bytes de longitud 32.")
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise InvalidKeyWrappingInput("Se requiere una clave pública RSA.")
    if public_key.key_size < RSA_KEY_SIZE:
        raise InvalidKeyWrappingInput("La clave RSA debe tener al menos 2048 bits.")
    return public_key.encrypt(aes_key, _oaep())


def unwrap_key(wrapped_key: bytes, private_key: rsa.RSAPrivateKey) -> bytes:
    """Recupera una clave AES usando la clave privada del destinatario."""
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise InvalidKeyWrappingInput("Se requiere una clave privada RSA.")
    if private_key.key_size < RSA_KEY_SIZE:
        raise InvalidKeyWrappingInput("La clave RSA debe tener al menos 2048 bits.")
    if not isinstance(wrapped_key, bytes):
        raise InvalidKeyWrappingInput("La clave protegida debe ser bytes.")
    expected_size = (private_key.key_size + 7) // 8
    if len(wrapped_key) != expected_size:
        raise InvalidKeyWrappingInput("La clave protegida tiene longitud inválida.")
    try:
        aes_key = private_key.decrypt(wrapped_key, _oaep())
    except ValueError as exc:
        raise KeyUnwrappingError("No se pudo recuperar la clave AES.") from exc
    if len(aes_key) != AES_KEY_SIZE:
        raise KeyUnwrappingError("No se pudo recuperar la clave AES.")
    return aes_key
