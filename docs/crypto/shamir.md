# Shamir's Secret Sharing

## Contrato

El módulo divide secretos de exactamente 32 bytes, correspondientes al tamaño
de una clave AES-256. Soporta `2 <= threshold <= share_count <= 255`. El límite
255 es una decisión de esta implementación, no un límite general de Shamir.

- `split_secret(secret, threshold, share_count) -> list[Share]`
- `reconstruct_secret(shares) -> bytes`
- `serialize_share(share) -> str`
- `deserialize_share(payload) -> Share`

Para notas especiales que exijan a todos los participantes, usar `threshold =
share_count`. Las funciones no cifran documentos, verifican JWT ni autentican
usuarios. Los fragmentos y secretos se procesan en memoria.

## Matemática y aleatoriedad

Se utiliza el campo primo `p = 2**521 - 1`. Todo secreto de 32 bytes es menor
que p. Se convierte a entero en orden big-endian y se usa como coeficiente
constante de un polinomio con t coeficientes. Los otros t-1 coeficientes se
muestrean uniformemente con `secrets.randbelow(p)`, incluido cero.

Se evalúa el polinomio en los índices 1 a n mediante Horner. Para reconstruir,
se interpola con Lagrange en x=0, usando inversos modulares y aritmética entera.
El resultado se convierte a exactamente 32 bytes para preservar ceros iniciales.

No se genera un primo nuevo por cada secreto ni se usan números flotantes.
El primo también aparece como parámetro de campo en NIST SP 800-186; eso no
implica que NIST certifique esta implementación académica de Shamir.

## Formato y validación

Un fragmento contiene: `version`, `set_id`, `threshold`, `share_count`,
`secret_size`, `x` e `y`. `set_id` es un identificador aleatorio de 128 bits.
No es una clave ni una firma.

En JSON, `y` es una cadena decimal: los enteros de este campo no caben en la
representación numérica exacta habitual de JavaScript. Se validan tamaño,
propiedades, tipos, versión, rangos y claves JSON duplicadas. No se incluyen
ejemplos con fragmentos reales en el repositorio.

La reconstrucción rechaza índices repetidos, conjuntos o metadatos diferentes
y cantidad insuficiente de fragmentos. Si recibe más de t fragmentos, comprueba
que los adicionales coincidan con el polinomio de los primeros t.

## Límite de integridad

Shamir básico proporciona compartición por umbral, no autenticación de los
fragmentos. Con exactamente t fragmentos alterados puede obtenerse otro secreto
de tamaño válido; incluso un conjunto modificado de forma coherente puede
superar la comprobación del polinomio. Los metadatos también pueden falsificarse.

La integración debe vincular fragmentos a participantes autorizados y al
documento. AES-GCM comprobará la autenticidad del ciphertext al descifrar, pero
no identificará por sí solo al participante que aportó un fragmento incorrecto.
La prueba `test_plain_shamir_does_not_authenticate_a_forged_set` documenta este
límite. Python no garantiza borrado seguro de enteros o bytes al liberar memoria.

## Pruebas y demostración

Las pruebas incluyen un vector de polinomio conocido, todas las combinaciones
de umbral en conjuntos pequeños, reconstrucción en distinto orden, ceros
iniciales, valores extremos, rechazo por umbral, índices duplicados, conjuntos
mezclados, metadatos inválidos y serialización exacta de enteros grandes.

Desde `backend/`, con el entorno activo:

```bash
python -m pytest tests/crypto/shamir -v
python -m demos.shamir_demo
```

Las pruebas funcionales no constituyen una demostración formal de seguridad.

## Referencias

- Shamir, A. (1979). How to Share a Secret.
  https://dspace.mit.edu/entities/publication/91c51bfc-5678-409c-80c5-44ce8fcdbadf
- Python: secrets.
  https://docs.python.org/3/library/secrets.html
- NIST SP 800-186, campo primo P-521.
  https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-186.pdf
