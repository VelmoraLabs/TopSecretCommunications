"""SHA-256 y RSA-PSS sobre los bytes originales de un documento."""

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

RSA_KEY_SIZE = 2048
PUBLIC_EXPONENT = 65537
SALT_LENGTH = 32


class SignatureError(ValueError):
    """Error del módulo de firmas digitales."""


class InvalidSignatureInput(SignatureError):
    """Tipo de entrada o clave incompatible con el perfil RSA-PSS."""


def _validate_message(message: bytes) -> None:
    if not isinstance(message, bytes):
        raise InvalidSignatureInput("El mensaje debe ser bytes.")


def _validate_public_key(public_key: rsa.RSAPublicKey) -> None:
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise InvalidSignatureInput("Se requiere una clave pública RSA.")
    if (
        public_key.key_size != RSA_KEY_SIZE
        or public_key.public_numbers().e != PUBLIC_EXPONENT
    ):
        raise InvalidSignatureInput("Se requiere RSA de 2048 bits con e=65537.")


def _pss() -> padding.PSS:
    return padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=SALT_LENGTH)


def sha256(message: bytes) -> bytes:
    """Devuelve el digest de 32 bytes; no se pasa este resultado a sign()."""
    _validate_message(message)
    digest = hashes.Hash(hashes.SHA256())
    digest.update(message)
    return digest.finalize()


def generate_key_pair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    """Genera claves de firma en memoria; devuelve primero la privada."""
    private_key = rsa.generate_private_key(
        public_exponent=PUBLIC_EXPONENT, key_size=RSA_KEY_SIZE
    )
    return private_key, private_key.public_key()


def sign(message: bytes, private_key: rsa.RSAPrivateKey) -> bytes:
    """Firma el mensaje original, aplicando SHA-256 una sola vez internamente."""
    _validate_message(message)
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise InvalidSignatureInput("Se requiere una clave privada RSA.")
    _validate_public_key(private_key.public_key())
    return private_key.sign(message, _pss(), hashes.SHA256())


def verify(message: bytes, signature: bytes, public_key: rsa.RSAPublicKey) -> bool:
    """False si la firma no corresponde; entradas incompatibles producen error."""
    _validate_message(message)
    if not isinstance(signature, bytes):
        raise InvalidSignatureInput("La firma debe ser bytes.")
    _validate_public_key(public_key)
    if len(signature) != RSA_KEY_SIZE // 8:
        return False
    try:
        public_key.verify(signature, message, _pss(), hashes.SHA256())
    except InvalidSignature:
        return False
    return True
