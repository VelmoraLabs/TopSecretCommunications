import secrets
from itertools import combinations

from app.crypto.shamir import (
    InsufficientSharesError,
    deserialize_share,
    reconstruct_secret,
    serialize_share,
    split_secret,
)


def main() -> None:
    secret = secrets.token_bytes(32)
    shares = split_secret(secret, threshold=3, share_count=5)
    recovered = reconstruct_secret([shares[0], shares[2], shares[4]])
    print("SHAMIR: DEMOSTRACIÓN LOCAL CON DATOS DE PRUEBA")
    print("Secreto: 32 bytes / 256 bits (valor oculto)")
    print("Configuración: umbral 3, participantes 5")
    print("Índices generados:", [share.x for share in shares])
    print("Recuperación con índices 1, 3 y 5:", recovered == secret)

    try:
        reconstruct_secret(shares[:2])
    except InsufficientSharesError:
        print("Recuperación con 2 fragmentos: rechazada por umbral insuficiente")

    valid = sum(
        reconstruct_secret(group) == secret for group in combinations(shares, 3)
    )
    print(f"Combinaciones válidas de 3 fragmentos: {valid}/10")
    restored = [deserialize_share(serialize_share(share)) for share in shares]
    print(
        "Reconstrucción después de serializar:", reconstruct_secret(restored) == secret
    )

    all_members = split_secret(secret, threshold=4, share_count=4)
    print("Acceso conjunto 4 de 4:", reconstruct_secret(all_members) == secret)
    print("No se guardaron secretos ni fragmentos en disco.")


if __name__ == "__main__":
    main()
