"""Ejecutar desde backend: python -m demos.key_wrapping_demo."""

from app.crypto.encryption import AuthenticationError, EncryptedData, generate_key
from app.crypto.encryption import decrypt as decrypt_document
from app.crypto.encryption import encrypt as encrypt_document
from app.crypto.key_wrapping import (
    KeyUnwrappingError,
    generate_key_pair,
    unwrap_key,
    wrap_key,
)


def main() -> None:
    original = b"Expediente de personal: documento ficticio.\n"
    aad = b"expediente:demo"
    aes_key = generate_key()
    encrypted = encrypt_document(original, aes_key, aad)
    private_a, public_a = generate_key_pair()
    private_b, public_b = generate_key_pair()
    wrapped_a = wrap_key(aes_key, public_a)
    wrapped_b = wrap_key(aes_key, public_b)

    print("PROTECCION DE CLAVES: AES-256-GCM + RSA-OAEP")
    print("Documento cifrado una vez; destinatarios simulados: 2")
    print("Clave AES: 32 bytes; RSA: 2048 bits; OAEP y MGF1: SHA-256.")
    print("Clave protegida por destinatario:", len(wrapped_a), "bytes")
    for name, private_key, wrapped in (
        ("A", private_a, wrapped_a),
        ("B", private_b, wrapped_b),
    ):
        recovered_key = unwrap_key(wrapped, private_key)
        recovered = decrypt_document(encrypted, recovered_key, aad)
        print(f"Recuperacion exacta para destinatario {name}:", recovered == original)

    try:
        unwrap_key(wrapped_a, private_b)
    except KeyUnwrappingError:
        print("Clave privada de otro destinatario: rechazada")

    damaged = bytearray(wrapped_a)
    damaged[-1] ^= 1
    try:
        unwrap_key(bytes(damaged), private_a)
    except KeyUnwrappingError:
        print("Clave protegida alterada: rechazada")

    damaged_tag = bytearray(encrypted.tag)
    damaged_tag[0] ^= 1
    damaged_document = EncryptedData(
        nonce=encrypted.nonce,
        ciphertext=encrypted.ciphertext,
        tag=bytes(damaged_tag),
    )
    try:
        decrypt_document(damaged_document, unwrap_key(wrapped_a, private_a), aad)
    except AuthenticationError:
        print("Documento con tag alterado: rechazado")

    print("Demo local; no usa cuentas ni escribe archivos ni muestra claves.")


if __name__ == "__main__":
    main()
