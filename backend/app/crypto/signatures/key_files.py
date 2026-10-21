"""Serialización Base64: privada PKCS8 cifrada y pública SubjectPublicKeyInfo."""

import base64
import binascii
from dataclasses import dataclass, field

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.crypto.signatures import rsa_pss

MAX_KEY_FILE = 16384


@dataclass(frozen=True, slots=True)
class KeyFiles:
    public_base64: str
    private_base64: str = field(repr=False)
    fingerprint: str


def public_bytes(key: rsa.RSAPublicKey) -> bytes:
    return key.public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def decode_key(value: str) -> bytes:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_KEY_FILE:
        raise rsa_pss.InvalidSignatureInput("Archivo de clave inválido.")
    normalized = value.strip()
    try:
        result = base64.b64decode(normalized, validate=True)
        if base64.b64encode(result).decode("ascii") != normalized:
            raise ValueError("Base64 no canónico.")
        return result
    except (ValueError, binascii.Error) as exc:
        raise rsa_pss.InvalidSignatureInput(
            "Archivo de clave Base64 inválido."
        ) from exc


def generate(password: bytes) -> KeyFiles:
    if not isinstance(password, bytes) or not 12 <= len(password) <= 1024:
        raise rsa_pss.InvalidSignatureInput(
            "La contraseña debe tener entre 12 y 1024 bytes."
        )
    private, public = rsa_pss.generate_key_pair()
    der = public_bytes(public)
    encrypted = private.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(password),
    )
    return KeyFiles(
        base64.b64encode(der).decode("ascii"),
        base64.b64encode(encrypted).decode("ascii"),
        rsa_pss.sha256(der).hex(),
    )


def load_private(value: str, password: bytes) -> rsa.RSAPrivateKey:
    try:
        key = serialization.load_der_private_key(decode_key(value), password=password)
    except (ValueError, TypeError, UnsupportedAlgorithm) as exc:
        raise rsa_pss.InvalidSignatureInput(
            "No se pudo abrir la clave privada. Revisa el archivo y la contraseña."
        ) from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise rsa_pss.InvalidSignatureInput("La clave privada debe ser RSA.")
    rsa_pss._validate_public_key(key.public_key())
    return key


def load_public(value: str) -> rsa.RSAPublicKey:
    try:
        key = serialization.load_der_public_key(decode_key(value))
    except (ValueError, TypeError, UnsupportedAlgorithm) as exc:
        raise rsa_pss.InvalidSignatureInput(
            "No se pudo abrir la clave pública."
        ) from exc
    if not isinstance(key, rsa.RSAPublicKey):
        raise rsa_pss.InvalidSignatureInput("La clave pública debe ser RSA.")
    rsa_pss._validate_public_key(key)
    return key
