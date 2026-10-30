# Expedientes de personal: contratos, persistencia y API

El módulo incluye servicio en memoria, integración SQL/Storage y rutas FastAPI.
La interfaz y la incorporación al catálogo/dashboard/notificaciones se implementarán
en el siguiente bloque. Las rutas pueden consultarse en `/docs`; aún no hay
pantalla de expedientes en el frontend.

## Política

- Cada alta contiene una versión inmutable; no hay edición de versiones todavía.
- Hasta 255 destinatarios seleccionados, más el creador si no estaba seleccionado.
- El creador conserva acceso mediante su propio sobre. No se exige grupo ni Shamir.
- Cada destinatario abre individualmente con la privada de protección original.
- Crear exige `documents.create` y `documents.read_assigned`. Leer exige perfil
  activo, cuenta vinculada, permiso de lectura y asignación explícita.
- Un administrador ajeno no obtiene acceso por su rol.
- Para publicar, todas las cuentas deben conservar acceso y las claves reservadas
  deben seguir activas. Retirar una clave después no bloquea los archivos históricos.
- Se reutiliza `stc_encryption_keys`; no se generan otros pares al cargar un archivo.
- No se firma con RSA-PSS en este módulo: su política es confidencialidad e
  integridad con AES-GCM y distribución individual de la AES con RSA-OAEP.

## Archivos y responsabilidades

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/modules/personnel_files/schemas.py` | Contratos públicos e internos, límites y validaciones. |
| `backend/app/modules/personnel_files/service.py` | Preparación y apertura síncronas en memoria. |
| `backend/app/modules/personnel_files/persistence.py` | RPC, Storage, publicación y autorización final de descarga. |
| `backend/app/modules/personnel_files/router.py` | Rutas autenticadas, validación HTTP y respuestas públicas. |
| `backend/app/main.py` | Registro del router, errores públicos y cabeceras de no almacenamiento en caché. |
| `supabase/migrations/20261030000000_personnel_files.sql` | Tablas, RLS, grants y RPC nuevas. |
| `supabase/scripts/check_personnel_files_setup.sql` | Inventario de solo lectura para el proyecto compartido. |
| `backend/tests/personnel_files/` | Contratos, criptografía real y contrato HTTP del gateway. |
| `supabase/tests/personnel_files.sql` | Pruebas transaccionales para una base aislada vacía. |

Las tablas de expedientes son independientes del flujo de firma/aprobación de
memorándums. No se cambia el significado de sus estados ni se cuentan expedientes
como memorándums sin firmar. La futura interfaz deberá integrar ambos módulos
mediante sus contratos correspondientes.

## Persistencia

| Ubicación | Datos |
| --- | --- |
| `public.stc_personnel_files` | ID, versión, creador, nombre/tipo/tamaño, título y estado. |
| `public.stc_personnel_file_recipients` | Perfil y clave original fijados al reservar. |
| `public.stc_personnel_file_audit` | Reservas, publicaciones, cancelaciones y entregas autorizadas. |
| `stc_private.personnel_file_material` | Cabecera autenticada con sobres RSA-OAEP, nonce, tag y SHA-256 del ciphertext. |
| Storage `stc-documents/personnel-files/{document_id}/{version_id}/ciphertext` | Solo bytes cifrados. |

No se guardan originales, AES en claro, privadas ni contraseñas. Los metadatos
autorizados sí son legibles; no se promete ocultar nombres o tamaños al servidor.
Las privadas y contraseñas se procesan temporalmente en el backend al abrir.
Este es un modelo con backend de confianza, no cifrado extremo a extremo frente
al propio servidor. Se debe usar HTTPS fuera del desarrollo local.

La cabecera completa, incluidos los sobres ordenados por perfil, es AAD de GCM.
No puede editarse para cambiar destinatarios sin invalidar el tag. Los sobres
completos se usan internamente; `PersonnelDetail` y `PersonnelPage` no los exponen.

## Secuencia de creación

1. `create()` valida permisos de la sesión y el tamaño real del contenido.
2. `server_begin_personnel_file` vuelve a comprobar permisos actuales y resuelve
   las claves activas desde la base. Registra `staging` y un snapshot de acceso.
3. El backend valida la reserva, genera una AES nueva, prepara un sobre RSA-OAEP
   por persona y cifra el documento una vez con AES-GCM.
4. Sube únicamente ciphertext mediante la credencial secreta del servidor,
   sin `upsert` y sin incluir originales en las RPC.
5. `server_commit_personnel_file` serializa la publicación con cambios de perfiles
   y claves, verifica el snapshot y guarda todo el material en una transacción.
6. El estado pasa a `ready`; entonces los destinatarios pueden consultarlo.

SQL no descifra ni verifica matemáticamente GCM/RSA: esas comprobaciones se hacen
en Python. Las RPC de publicación solo se conceden a `service_role`; el navegador
no puede inventar un actor, una clave o una publicación.

## Fallos y reintentos

PostgreSQL y Storage no forman una transacción distribuida. Ante un error, se
intenta cancelar la preparación y retirar el objeto privado. La cancelación
devuelve `false` si la carga ya está publicada: perder una respuesta después de
publicar nunca provoca borrarla. Repetir la misma publicación es idempotente.

Si falla la limpieza de Storage, queda un objeto privado asociado a un expediente
cancelado; no vuelve a estar disponible. Se registra un mensaje fijo sin cuerpos,
claves, contraseñas ni contenido. El creador puede reintentar `cancel()` para
conciliar esa carga desde la ruta de cancelación. No hay recolector
automático de objetos huérfanos en este bloque.

Un reintento nuevo de `create()` genera otros IDs; no hay clave de idempotencia
de cliente todavía. Después de una respuesta perdida se debe consultar el
listado antes de iniciar otra carga.

## Descarga

`server_personnel_file_material` comprueba asignación, cuenta y permiso actuales.
El backend verifica IDs, versión y metadatos; obtiene la clave original mediante
el JWT del usuario y descarga ciphertext de la ruta fija. Comprueba tamaño y
SHA-256 del ciphertext antes de abrir la privada y verificar GCM.

Antes de devolver plaintext, `server_complete_personnel_download` vuelve a
comprobar cuenta activa, permiso, asignación, estado, versión y digest. Una baja
detectada en esa comprobación bloquea la entrega aunque el descifrado ya terminara.
El evento `downloaded` registra autorización de entrega, no confirma que el
navegador haya guardado el archivo. Ninguna revocación recupera copias ya entregadas.

## API HTTP

Prefijo: `/api/v1/personnel-files`. Todas las operaciones exigen un Bearer JWT
de Supabase. La dependencia existente consulta Auth y los permisos actuales de
PostgreSQL; no acepta un rol o actor proporcionado por el cliente.

| Método y ruta | Resultado | Permiso |
| --- | --- | --- |
| `GET /api/v1/personnel-files` | Listado autorizado, 200. | `documents.read_assigned` |
| `POST /api/v1/personnel-files` | Creación y publicación, 201. | `documents.create` y lectura |
| `GET /api/v1/personnel-files/{document_id}` | Metadatos y participantes, 200. | Lectura y asignación |
| `POST /api/v1/personnel-files/{document_id}/file` | Original autenticado en Base64, 200. | Lectura, asignación y privada original |
| `POST /api/v1/personnel-files/{document_id}/cancel` | Preparación cancelada, 200. | Creación, lectura y ser el creador |

El listado acepta `search` de hasta 80 caracteres, `limit` entre 1 y 100 y
`offset` entre 0 y 100000. La creación recibe `CreatePersonnelFile`; el servidor
resuelve las claves y genera IDs, no los recibe del navegador. La apertura recibe
`version_id`, `key_id`, `private_key_base64` y `password` mediante JSON en el cuerpo,
nunca en la URL. La cancelación no elimina expedientes publicados: devuelve 409.

Se devuelven DTO públicos sin cabecera completa ni sobres. Las descargas sí
contienen el original en Base64 después de autorizar y autenticar el documento.
Las respuestas `/api/` usan `Cache-Control: no-store`. Los errores de validación
no reproducen el cuerpo recibido, contraseñas ni claves privadas.

Estados relevantes: 401 sin sesión válida; 403 sin permiso; 404 para un expediente
ajeno o no disponible; 409 por conflicto de estado/cuentas/claves; 422 para datos
o autenticación criptográfica inválidos; 413 si se supera el límite de archivo de
5 MiB o el límite HTTP global de 8 MiB; 503 si falla la configuración o el proveedor.

El router se registra también con `STC_ENABLE_LOCAL_WORKFLOW=0`: no depende de
las herramientas manuales de notas especiales. Estas rutas no requieren nuevas
migraciones después de `20261030000000_personnel_files.sql`.

Para comprobar su registro, iniciar el backend y abrir `http://127.0.0.1:8000/docs`.
Debe aparecer el grupo **Expedientes de personal** con cinco operaciones. Sin
Bearer, consultar el listado devuelve 401; eso no indica que falte la ruta.

## Instalación

Desde la rama `feature/personnel-files`, incorporar los archivos y ejecutar:

```bat
cd backend
python -m pytest tests/personnel_files -v
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest -q
```

En el proyecto Supabase compartido, después de las nueve migraciones anteriores,
ejecutar una sola vez el archivo completo
`supabase/migrations/20261030000000_personnel_files.sql` como `postgres` en SQL Editor.
No repetir migraciones anteriores. Las tablas previas y los objetos del bucket
existente se conservan. Si falla, la transacción revierte la instalación nueva;
resolver el error antes de volver a intentarlo. No ejecutar parcialmente.

Ejecutar después `supabase/scripts/check_personnel_files_setup.sql`: sus once
filas deben indicar `true`. Esto comprueba presencia y permisos principales;
no sustituye la validación de las operaciones desde una sesión real.

Se reutilizan `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`.
La secreta permanece exclusivamente en `backend/.env`; no se requieren nuevos
secretos ni cambios en el frontend para este bloque.

## Pruebas SQL aisladas

`supabase/tests/personnel_files.sql` exige una base sin perfiles y termina en
`rollback`. Nunca ejecutar este archivo de pruebas en el proyecto compartido.
Con las diez migraciones aplicadas en una base de prueba:

```sh
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/personnel_files.sql
```

Las pruebas Python usan criptografía real y un transporte HTTP de prueba para
Supabase. Las SQL comprueban RLS, grants, snapshots, publicación y carreras de
estado mediante cambios entre reserva y confirmación. No sustituyen una prueba
contra el servicio remoto de Storage ni simulan dos transacciones simultáneas.

Validación de contratos y persistencia: 64 casos de expedientes y 534 pruebas
Python totales; Ruff, formato y mypy correctos. En PostgreSQL 18.6 mediante PGlite 0.5.13
pasaron las 59 comprobaciones SQL nuevas, las 423 anteriores y las once del
inventario. Python se ejecutó con 3.12.14 y las dependencias fijadas del proyecto;
el entorno de referencia del equipo es 3.14.5. La validación local no modificó
el proyecto remoto.

El bloque HTTP añade 35 casos que atraviesan el router, la dependencia real de
autenticación, persistencia y criptografía. El proveedor Supabase se sustituye
por un transporte HTTP de prueba, sin reemplazar dependencias de FastAPI. No se
usaron credenciales reales ni se ejecutó Google OAuth o Storage remoto.
Con la API, pasan 99 casos del módulo y 569 pruebas totales del backend, además
de Ruff, formato y mypy. Este bloque no cambia SQL ni requiere repetir la migración.
