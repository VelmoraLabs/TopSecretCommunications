# AES-256-GCM

`app/crypto/encryption/aes_gcm.py` es el módulo de cifrado reutilizable del backend.
Utiliza `AESGCM` de `cryptography`, dependencia ya fijada por el proyecto.
Es independiente de FastAPI, Shamir, usuarios y almacenamiento. No hay una
segunda implementación provisional.

## Contrato binario

```python
from app.crypto.encryption import decrypt, encrypt, generate_key

key = generate_key()
encrypted = encrypt(b"documento", key, associated_data=b"metadatos")
assert decrypt(encrypted, key, associated_data=b"metadatos") == b"documento"
```

| Elemento | Contrato |
| --- | --- |
| Clave | `bytes`, exactamente 32; generación con `AESGCM.generate_key(256)`. |
| Plaintext | `bytes`; admite contenido binario, ceros y archivos vacíos. |
| AAD | `bytes`, por defecto `b""`; autentica contexto sin cifrarlo. |
| Nonce | 12 bytes aleatorios de `secrets.token_bytes` por cifrado. |
| Ciphertext | `bytes`, longitud igual a la del plaintext. |
| Tag | 16 bytes; no se permite truncamiento. |
| Resultado | `EncryptedData`: dataclass inmutable con nonce, ciphertext y tag. |

La biblioteca devuelve ciphertext y tag concatenados. El módulo los separa al
cifrar y los reúne al descifrar. Solo devuelve plaintext después de verificar
la autenticación. No distingue si un fallo proviene de clave, nonce, ciphertext,
tag o AAD incorrectos.

## Claves y nonces

El servicio documental genera una clave nueva por archivo y divide esa misma
clave con Shamir. No la incorpora al resultado de cifrado ni al paquete.
`encrypt` genera su nonce internamente; el llamador no puede fijarlo.
El nonce es público y se conserva con el ciphertext y el tag.

Un par clave/nonce nunca debe reutilizarse. No existe un registro global de
nonces: el flujo utiliza una clave nueva por documento. Otro consumidor que
reutilice claves para grandes volúmenes deberá definir límites y rotación;
la generación aleatoria no garantiza unicidad matemática.

## Validaciones y errores

- `InvalidEncryptionInput`: tipo, clave, nonce, tag o tamaños inválidos.
- `AuthenticationError`: fallo de autenticación; no devuelve contenido.
- Ambas derivan de `EncryptionError`, que deriva de `ValueError`.

Solo se admiten `bytes`; cadenas, `None` y buffers mutables requieren conversión
explícita. El límite conservador por operación es `2**31 - 1 - 16` bytes de
contenido y `2**31 - 1` bytes de AAD. El servicio documental limita los archivos
a 5 MiB y las solicitudes HTTP a 8 MiB.

La conversión Base64 del paquete pertenece al módulo documental.

## Pruebas

```bash
python -m pytest tests/crypto/encryption -v
```

Incluyen vectores AES-256-GCM de resultado conocido, interoperabilidad con
la biblioteca, AAD, alteraciones, contenido vacío/binario, tipos y límites.
Los nonces fijos se inyectan exclusivamente en pruebas. No se afirma
certificación FIPS ni una auditoría de seguridad.

## Referencias

- [AESGCM en cryptography](https://cryptography.io/en/50.0.0/hazmat/primitives/aead/#cryptography.hazmat.primitives.ciphers.aead.AESGCM).
- [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).
- [Propuesta GCM de McGrew y Viega](https://csrc.nist.gov/projects/block-cipher-techniques/bcm/modes-development).
