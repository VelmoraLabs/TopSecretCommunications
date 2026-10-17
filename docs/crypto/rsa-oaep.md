# Protección de claves AES con RSA-OAEP

El módulo `backend/app/crypto/key_wrapping/rsa_oaep.py` protege claves AES-256
para destinatarios mediante `cryptography`. No conoce HTTP, usuarios, Supabase,
archivos ni Shamir. El módulo AES-GCM existente cifra el contenido del documento.

## Parámetros y contrato

| Elemento | Contrato |
| --- | --- |
| Generación RSA | 2048 bits; exponente público 65537. |
| Claves RSA recibidas | Objetos RSA de al menos 2048 bits. |
| OAEP | SHA-256; MGF1 con SHA-256; `label=None`. |
| Clave AES | `bytes`, exactamente 32 bytes. |
| Clave AES protegida | `bytes`; longitud del módulo RSA en bytes (256 para RSA-2048). |
| `generate_key_pair()` | Devuelve `(clave_privada, clave_publica)` en memoria. |
| `wrap_key(aes_key, public_key)` | Protege la clave AES con la clave pública del destinatario. |
| `unwrap_key(wrapped_key, private_key)` | Recupera una clave AES de 32 bytes con la clave privada correspondiente. |

OAEP es probabilístico: proteger dos veces la misma clave no debe producir un
resultado fijo. Los valores concretos del resultado cambian entre ejecuciones.

## Uso con AES-GCM

Ejecutar desde `backend/`:

```python
from app.crypto.encryption import decrypt, encrypt, generate_key
from app.crypto.key_wrapping import generate_key_pair, unwrap_key, wrap_key

private_key, public_key = generate_key_pair()
aes_key = generate_key()
encrypted = encrypt(b"documento", aes_key, b"metadatos")
wrapped_key = wrap_key(aes_key, public_key)
recovered_key = unwrap_key(wrapped_key, private_key)
assert decrypt(encrypted, recovered_key, b"metadatos") == b"documento"
```

Para varios destinatarios se cifra el documento una sola vez y se protege la
misma clave AES por separado con cada clave pública. Cada destinatario utiliza
su clave privada para recuperar su copia de la clave AES. Las claves privadas
no se incluyen en el paquete ni se guardan o transmiten por este módulo.

## Errores

- `InvalidKeyWrappingInput`: tipos, tamaños o claves RSA no permitidos.
- `KeyUnwrappingError`: fallo de OAEP o resultado que no es una clave de 32 bytes.
- Ambos derivan de `KeyWrappingError`, que deriva de `ValueError`.

El error de recuperación no distingue entre destinatario incorrecto, alteración
o parámetros OAEP incompatibles. Una longitud externa inválida se rechaza antes
de descifrar. La clave privada debe conservarse para poder recuperar el documento.

## Pruebas y demostración

```bash
python -m pytest tests/crypto/key_wrapping -v
python -m demos.key_wrapping_demo
```

Las pruebas cubren parámetros, interoperabilidad, recuperación con AES-GCM,
dos destinatarios, rechazo del destinatario incorrecto, alteraciones, entradas
inválidas y claves RSA de 3072 bits. La demo muestra recuperaciones y rechazos
con datos ficticios sin mostrar claves ni escribir archivos.

## Alcance de esta entrega

Corresponde al motor criptográfico y a pruebas locales de protección de claves.
Los destinatarios de la demo son pares RSA en memoria, no cuentas reales.
Todavía no implementa entrega por red, registro o autenticación de claves públicas,
serialización y custodia de claves privadas, endpoints, Supabase ni el flujo
completo de expedientes de personal. Tampoco firma documentos ni acredita
la identidad del remitente. Esas integraciones deben coordinarse por separado.

## Referencia

- [RSA y OAEP en cryptography](https://cryptography.io/en/50.0.0/hazmat/primitives/asymmetric/rsa/).
