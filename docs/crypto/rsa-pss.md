# SHA-256 y firmas RSA-PSS

## Alcance

El módulo `backend/app/crypto/signatures/` implementa SHA-256,
generación de claves RSA, firma y verificación de los bytes originales
de un documento. Es independiente de FastAPI, Supabase y permisos.

## Parámetros criptográficos

- RSA de 2048 bits.
- Exponente público: 65537.
- Hash: SHA-256.
- Padding: RSA-PSS.
- MGF1 con SHA-256.
- Salt de 32 bytes.

Se firma el mensaje original mediante `hashes.SHA256()`.
No se pasa un digest previamente calculado a `sign()`, para evitar
doble hashing.

## Funciones públicas

| Función | Resultado |
| --- | --- |
| `sha256(message)` | Digest de 32 bytes. |
| `generate_key_pair()` | Clave privada y clave pública, en ese orden. |
| `sign(message, private_key)` | Firma de 256 bytes. |
| `verify(message, signature, public_key)` | Booleano que indica si la firma corresponde. |

Las entradas deben ser bytes y las claves deben cumplir el perfil indicado.
Los tipos incompatibles o claves fuera del perfil producen
`InvalidSignatureInput`. Una firma en bytes que no corresponde devuelve
`False`.

El módulo conserva exactamente los bytes recibidos, incluidos los saltos
de línea. RSA-PSS es probabilístico: un mismo mensaje puede producir
firmas distintas que verifican correctamente.

## Pruebas y demostración

Desde `backend/`, con el entorno virtual activo:

```bash
python -m pytest tests/crypto/signatures -v
python -m demos.signatures_demo
```

Las pruebas cubren SHA-256, parámetros de claves, firma válida,
alteración del contenido y de la firma, clave pública incorrecta,
interoperabilidad, ausencia de doble hashing y rechazo de parámetros
PSS incompatibles.

La demo utiliza datos ficticios y claves generadas en memoria.

## Integración documental

`key_files.py` añade serialización sin dependencias HTTP: pública SPKI DER y privada PKCS8 DER cifrada, ambas en Base64. Reutiliza el perfil del módulo RSA-PSS aprobado.

`modules/memoranda/` vincula las claves con el perfil autenticado, exige `documents.sign` y asignación como emisor o aprobador en la etapa correspondiente, persiste versiones inmutables y asocia la firma Base64 al documento. El módulo criptográfico original no cambia. Ver la [guía completa](../development/memoranda-signatures.md).
