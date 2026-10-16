# Backend de notas especiales

Entrega basada en `develop`, commit `be288967dfa02b83f21df7165869df081c8021c5`.
Incorpora AES-256-GCM, el servicio documental y su API. No modifica frontend,
dependencias, workflows ni la implementación existente de Shamir.

## Aplicar

Con los cambios anteriores guardados, desde la raíz:

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/backend-encryption-shamir
unzip -n "$HOME/Downloads/STC_Backend_AES_Shamir_v1.zip" -d "$HOME/Downloads/STC_Backend_AES_Shamir_v1"
git apply --check "$HOME/Downloads/STC_Backend_AES_Shamir_v1/backend-aes-shamir.patch" && git apply "$HOME/Downloads/STC_Backend_AES_Shamir_v1/backend-aes-shamir.patch"
```

El parche incorpora todos los archivos con sus rutas. Si encuentra un conflicto,
se detiene sin modificar el proyecto. No copiar además los archivos manualmente
ni extraer con sobrescritura sobre el repositorio. No se crean commits automáticamente.

## Organización

| Ubicación | Función |
| --- | --- |
| `app/crypto/encryption/aes_gcm.py` | Claves AES-256 y cifrado autenticado. |
| `app/crypto/shamir/` | División, reconstrucción y formato existentes. |
| `app/modules/documents/schemas.py` | Contratos y paquete versionado. |
| `app/modules/documents/service.py` | Coordinación de ambos algoritmos. |
| `app/modules/documents/router.py` | Rutas HTTP. |
| `app/core/request_limits.py` | Límite del cuerpo antes de procesar JSON/Base64. |

Los algoritmos no se importan entre sí. El servicio genera una clave AES nueva,
la divide con Shamir y cifra el contenido. La recuperación reconstruye esa clave
y autentica el archivo antes de devolverlo. No hay un almacén alternativo de
claves, estado global de documentos ni escrituras a disco.

Shamir conserva el soporte genérico `t de n`. El flujo de notas especiales exige
`t = n` y no admite reducir esa política mediante un modo de demostración.

## Paquete v1

| Campos | Contenido |
| --- | --- |
| `format`, `version`, `algorithm` | `stc-special-note`, entero `1`, `AES-256-GCM+Shamir`. |
| `document_id` | Identificador del conjunto Shamir. |
| `filename`, `media_type`, `size` | Metadatos y tamaño original en bytes. |
| `share_count`, `threshold`, `access_mode` | Participaciones; modo `all-members`. |
| `nonce_base64` | Nonce de 12 bytes. |
| `ciphertext_base64` | Ciphertext sin tag; admite cadena vacía. |
| `tag_base64` | Tag completo de 16 bytes. |

Los metadatos son públicos y autenticados. El AAD es el JSON de los campos de
`NoteHeader` con claves ordenadas, separadores `,` y `:`, `ensure_ascii=True` y
codificación ASCII. El nonce y el tag se verifican mediante GCM.

La respuesta de protección contiene `package` y `shares` por separado.
El paquete no contiene clave ni fragmentos. Cada fragmento mantiene el JSON
existente de Shamir y su coordenada `y` como texto decimal.

## Ejecución

Activar el entorno existente e instalar las dependencias fijadas:

```bash
python -m pip install -r backend/requirements-dev.txt
```

Las rutas portables se habilitan con `STC_ENABLE_LOCAL_WORKFLOW=1` en
`backend/.env` y siempre exigen sesión y permisos. Desde la raíz:

```bash
python -m uvicorn app.main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000 --reload
```

Abrir [Swagger](http://127.0.0.1:8000/docs). Su botón Authorize requiere un access
token de usuario válido. Para iniciar sesión desde React y configurar Supabase,
consultar [autenticación](authentication.md).

| Ruta | Entrada | Resultado |
| --- | --- | --- |
| `POST /api/v1/documents/special-notes/protect` | `filename`, `content_base64`, `share_count` y `threshold`; `media_type` y `access_mode` opcionales. | `package` y `shares`. |
| `POST /api/v1/documents/special-notes/recover` | `package` y lista `shares`. | Nombre, tipo, tamaño y `content_base64` del original. |
| `GET /health` | Sin cuerpo. | `{"status":"ok"}`, como antes. |

Estados: `200` correcto; `409` fragmentos insuficientes; `422` formato, conjunto
o integridad criptográfica inválidos; `413` tamaño excesivo; `404` si las rutas no se habilitan.
La capa de sesión añade `401`/`403` y `503` si no se puede verificar el acceso.
Los errores contienen `detail.code` y `detail.message` sin copiar datos sensibles.
Las respuestas de operación incluyen `Cache-Control: no-store`.

Se admiten 2 a 20 participantes, archivos de hasta 5 MiB y cuerpos HTTP de hasta
8 MiB, también sin Content-Length. La protección no acepta claves, nonce ni tag
elegidos por el cliente; esos valores se generan en el backend.

## Comprobar

Desde `backend/`:

```bash
python -m pip check
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest
python -m demos.special_notes_demo
```

La demo verifica cifrado, serialización portable, rechazo con 3 de 4, recuperación
exacta con 4 de 4 y rechazo de un tag alterado. No escribe archivos ni imprime
claves o fragmentos. Las pruebas HTTP recuperan también desde una aplicación nueva.

## Integración posterior

Frontend, autenticación y permisos de operaciones ya se integran sobre estos
contratos. RSA-OAEP, firmas, Storage, pertenencia al documento y aportación individual
son etapas posteriores. El motor criptográfico no necesita duplicarse.

En esta etapa el operador autenticado recibe todos los fragmentos: se comprueba el
flujo criptográfico, no consentimiento independiente entre cuentas. La futura
persistencia deberá distribuir y proteger los fragmentos por participante,
sin una clave AES alternativa que permita eludir el umbral.

## Validación criptográfica original

Python 3.14.5 y las dependencias fijadas del repositorio: 112 pruebas aprobadas;
Ruff, formato y mypy correctos. También se comprobó el recorrido HTTP con Uvicorn
y la recuperación exacta de bytes. Permanece el aviso de deprecación de httpx
en TestClient; no causa fallos y no se modificaron dependencias por ese aviso.
