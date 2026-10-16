"""Ejecutar desde backend: python -m demos.special_notes_demo."""

import base64

from app.modules.documents.schemas import (
    ProtectionResult,
    ProtectRequest,
    RecoverRequest,
)
from app.modules.documents.service import DocumentError, protect_note, recover_note


def main() -> None:
    original = "Nota diplomática especial: documento de prueba.\n".encode()
    protected = protect_note(
        ProtectRequest(
            filename="nota.txt",
            media_type="text/plain",
            content_base64=base64.b64encode(original).decode(),
            share_count=4,
            threshold=4,
        )
    )
    # El formato puede transportarse sin conservar la clave o el estado del servicio.
    portable = ProtectionResult.model_validate_json(protected.model_dump_json())
    print("NOTA ESPECIAL: AES-256-GCM + SHAMIR")
    print("Clave AES: 32 bytes; nonce: 12 bytes; tag: 16 bytes.")
    print("Documento protegido; fragmentos generados:", len(portable.shares))
    try:
        recover_note(
            RecoverRequest(package=portable.package, shares=portable.shares[:3])
        )
    except DocumentError as exc:
        print("Recuperación con 3 de 4:", exc.code)
    recovered = recover_note(
        RecoverRequest(package=portable.package, shares=portable.shares)
    )
    print(
        "Recuperación exacta con 4 de 4:",
        base64.b64decode(recovered.content_base64) == original,
    )
    altered = bytearray(base64.b64decode(portable.package.tag_base64))
    altered[0] ^= 1
    package = portable.package.model_copy(
        update={"tag_base64": base64.b64encode(altered).decode()}
    )
    try:
        recover_note(RecoverRequest(package=package, shares=portable.shares))
    except DocumentError as exc:
        print("Paquete alterado:", exc.code)
    print("La demo no escribe archivos ni muestra claves o fragmentos.")


if __name__ == "__main__":
    main()
