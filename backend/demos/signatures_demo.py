"""Ejecutar desde backend: python -m demos.signatures_demo."""

from app.crypto.signatures import generate_key_pair, sha256, sign, verify


def main() -> None:
    message = b"Mensaje ficticio como documento de prueba.\n"
    private_key, public_key = generate_key_pair()
    _, other_public_key = generate_key_pair()
    signature = sign(message, private_key)

    damaged = bytearray(signature)
    damaged[-1] ^= 1

    checks = {
        "Documento original: firma válida": verify(message, signature, public_key),
        "Documento alterado: rechazado": not verify(
            message + b"Alterado", signature, public_key
        ),
        "Firma alterada: rechazada": not verify(message, bytes(damaged), public_key),
        "Clave pública distinta: rechazada": not verify(
            message, signature, other_public_key
        ),
    }

    print("FIRMAS: RSA-PSS + SHA-256")
    print("RSA: 2048 bits; e=65537; MGF1: SHA-256; salt: 32 bytes.")
    print("SHA-256 del documento ficticio:", sha256(message).hex())
    print("Longitud de firma:", len(signature), "bytes")

    for label, passed in checks.items():
        print(f"{label}: {passed}")

    if not all(checks.values()):
        raise RuntimeError("Falló una comprobación de la demo de firmas.")

    print("Demo local en memoria; no representa identidad ni permisos de usuario.")


if __name__ == "__main__":
    main()
