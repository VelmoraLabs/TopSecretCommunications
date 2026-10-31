# Notas diplomáticas y comunicados: punto 2.8

## Estado y alcance

Base del primer paquete: `bf1957a`, rama `feature/personnel-files`, con expedientes,
avisos y dashboard ya incorporados. El desarrollo nuevo se separa en
`feature/diplomatic-notes` para conservar el alcance del PR de expedientes.

El enunciado de Top Secret Communications exige confidencialidad y firma digital
para notas diplomáticas y comunicados. La categoría `nota` y sus textos existen
en el catálogo y en el frontend, pero eso no implementa la creación, el cifrado
ni la recuperación de esos documentos. La ruta de creación existente genera
memorándums y conserva sus bytes originales en Storage privado: no debe usarse
para almacenar primero una nota en claro y cifrarla después.

El bloque 1 incorporó contratos y un servicio síncrono en memoria. El bloque 2
incorpora persistencia en Supabase y Storage, con una migración adicional y sus
pruebas. Todavía no añade rutas, botones, avisos ni registros al dashboard.
Después de instalarlo, la web y `/docs` conservan su funcionalidad anterior.
Las pruebas Python no necesitan `.env`, conexión a Supabase ni cuentas reales.

| Documento | Política del servicio |
| --- | --- |
| Nota diplomática (`diplomatic_note`) | Firma RSA-PSS del emisor y cifrado AES-GCM; acceso individual por destinatario mediante RSA-OAEP. |
| Comunicado (`communique`) | Misma protección; el tipo forma parte de los datos firmados y autenticados. |
| Nota especial | Conserva el módulo de grupos y recuperación colaborativa existente. |
| Memorándum | Conserva el flujo de firma, aprobación y envío existente. |
| Expediente de personal | Conserva su flujo de cifrado individual, sin exigir firma. |

La primera versión de notas contempla una firma de emisión del creador. No
presupone una aprobación institucional adicional ni múltiples firmantes; esos
flujos requieren contratos propios si el equipo decide incorporarlos. La firma
del emisor no concede aprobación de un embajador.

## Archivos e interfaces

| Archivo | Contenido |
| --- | --- |
| `backend/app/modules/diplomatic_notes/__init__.py` | Identificación del módulo. |
| `backend/app/modules/diplomatic_notes/schemas.py` | Petición de creación, snapshot de firma, cabecera, paquete interno y credenciales de apertura. |
| `backend/app/modules/diplomatic_notes/service.py` | `protect_note`, `open_note`, representación canónica y comprobación de claves. |
| `backend/app/modules/diplomatic_notes/persistence.py` | Reserva, firma y cifrado en threadpool, publicación, cancelación y recuperación con verificación final. |
| `backend/tests/diplomatic_notes/test_diplomatic_persistence.py` | Gateway HTTP simulado con criptografía real y errores de carga/entrega. |
| `supabase/migrations/20261030180000_diplomatic_notes.sql` | Cuatro tablas con RLS, detalle autorizado, snapshots y operaciones exclusivas del servidor. |
| `supabase/scripts/check_diplomatic_notes_setup.sql` | Trece comprobaciones de solo lectura para después de migrar. |
| `supabase/tests/diplomatic_notes.sql` | Pruebas de contratos, grants, aislamiento, claves históricas e idempotencia. |
| `backend/tests/diplomatic_notes/test_diplomatic_service.py` | Pruebas reales de cifrado, firma, aislamiento y rechazo de alteraciones. |
| `docs/development/diplomatic-notes.md` | Alcance, decisiones e instrucciones de integración. |

`CreateDiplomaticNote` recibe tipo, título, archivo en Base64, destinatarios,
identificador de clave de firma y privada cifrada con su contraseña. Los dos
últimos secretos reutilizan `PrivateKeyInput`; la contraseña no se recorta.
No admite un emisor elegido, clave pública, firma ya fabricada ni umbral Shamir.

`RegisteredSigningKey` es un snapshot interno, con identificador, perfil dueño,
pública, huella e indicador de vigencia. No sustituye una consulta autorizada a
`stc_signing_keys`. `EncryptionKey` también procede del servidor, por cada perfil
original. Ningún endpoint futuro debe aceptar estos snapshots del navegador.

`protect_note(principal, body, recipient_keys, signing_key, *, document_id,
version_id)` devuelve `ProtectedDiplomaticNote`. Los identificadores de documento
y versión se reservan mediante SQL antes de firmar; no se toman de la
petición pública. El resultado contiene cabecera, firma, nonce, ciphertext y tag.

`open_note(principal, protected, encryption_key, signing_key, body)` devuelve
los bytes originales únicamente después de autenticar GCM y verificar RSA-PSS.
`OpenDiplomaticNote` incluye versión, identificador de clave de cifrado y privada
cifrada con contraseña. El destinatario no necesita una privada de firma.

## Protección y comprobación

1. Verificar que el emisor está activo y tiene `documents.create`,
   `documents.read_assigned` y `documents.sign`.
2. Verificar que la clave de firma es del emisor, coincide con la seleccionada y
   está activa. Validar pública y huella usando el módulo de Axel.
3. Resolver exactamente una clave activa de cifrado por destinatario y por
   creador, sin duplicados. Si se selecciona al propio creador, se incluye una vez.
   No reutilizar el mismo material RSA para firma y cifrado.
4. Validar los bytes originales, hasta 5 MiB. Generar una AES nueva de 32 bytes y
   protegerla con RSA-OAEP para cada perfil. Ordenar los sobres por UUID de perfil.
5. Construir la cabecera definitiva y firmar el mensaje especificado abajo con
   RSA-PSS. Reutilizar `memoranda.service.make_signature`: abre la privada de firma,
   comprueba que corresponde a la pública confiable y verifica la firma generada.
6. Cifrar el archivo original con AES-GCM, usando cabecera y firma como AAD.
   La firma se conserva separada en material privado, no dentro del ciphertext.
   El ciphertext tiene el mismo tamaño que el original y cabe en el límite de
   5 MiB existente; nonce, tag y firma se persisten fuera del objeto de Storage.
7. Para abrir, comprobar perfil, asignación original, versión y claves originales.
   Recuperar AES con la privada RSA-OAEP del destinatario, validar GCM y comprobar
   la firma RSA-PSS del emisor antes de devolver el archivo.

Las primitivas se conservan: AES-256-GCM con nonce de 12 bytes y tag de 16;
RSA-OAEP/MGF1 con SHA-256 y RSA-2048; RSA-PSS con RSA-2048, exponente 65537,
SHA-256, MGF1-SHA-256 y salt de 32 bytes. No se modifican archivos de
`app/crypto/`, memorándums ni expedientes.

### Mensaje de firma v1

No se firma un digest previamente calculado. Se entrega a RSA-PSS este mensaje:

```text
b"STC:DIPLOMATIC:SIGNED-CONTENT:v1\x00"
+ longitud_cabecera_json_en_8_bytes_big_endian
+ cabecera_json_canónica_ascii
+ bytes_originales_del_archivo
```

La cabecera usa `model_dump(mode="json")` y JSON con claves ordenadas,
separadores `,` y `:`, y `ensure_ascii=True`. Vincula formato, versión de formato,
algoritmos, tipo de documento, documento, versión, creador, título, nombre,
tipo MIME, tamaño, clave de firma, huella y todos los sobres RSA-OAEP.

El AAD de GCM es la misma cabecera canónica, un byte nulo y la firma Base64 ASCII.
La firma tiene 256 bytes. La estructura distingue una nota de un comunicado y
evita trasladar su firma a otro documento, versión o conjunto de destinatarios.

Este es un contrato nuevo de mensaje firmado: no es intercambiable con la firma
de memorándums sobre los bytes del archivo a solas. La primitiva de Axel es la
misma. Su futura pantalla de verificación debe reconstruir este mensaje v1.

La firma separada es necesaria incluso con GCM: un destinatario legítimo obtiene
la AES y podría volver a cifrar contenido modificado con un tag válido. No puede
generar la firma original del emisor sobre ese nuevo mensaje. Las pruebas
incluyen ese intento y exigen el rechazo antes de entregar bytes.

## Claves históricas y límites

- Una clave de cifrado retirada abre notas anteriores que la usaron. Una clave
  de firma desactivada sigue verificando sus firmas anteriores; no firma notas
  nuevas. No se reemplaza automáticamente ninguna por la clave nueva activa.
- Un lector no necesita `documents.sign`; un administrador no asignado tampoco
  puede abrir. SQL revalida participantes activos y permisos de lectura, además
  de pertenencia y vigencia de las claves, en reserva y publicación.
- El servicio criptográfico presupone snapshots confiables. El bloque de
  persistencia los obtiene mediante RPC de servidor, valida su correspondencia,
  usa RLS para el detalle y revalida el acceso al terminar la recuperación.
  La autenticación HTTP del módulo se implementará en el bloque 3.
- No se persisten originales, AES en claro, privadas ni contraseñas en el
  resultado. La operación procesa secretos temporalmente en el backend; no es
  cifrado de extremo a extremo frente al servidor ni garantiza borrado de memoria.
- El paquete y su cabecera son internos. La persistencia separa detalle público
  autorizado de material privado. No expone sobres, firma ni ciphertext mediante
  listados ni publica estas tablas en Realtime.
- Crear una nota nueva exige claves de cifrado activas de todos los perfiles
  originales. La rotación no redistribuye ni modifica documentos ya publicados.

## Orden de los siguientes bloques

| Bloque | Trabajo pendiente y prueba principal |
| --- | --- |
| 1. Contratos y servicio | Implementado en el primer paquete: firmar, cifrar y recuperar en memoria; rechazar alteraciones y claves ajenas. |
| 2. Supabase y Storage | Implementado en este segundo paquete: reserva de versión y asignaciones, snapshot de firma confiable, material privado, RLS, carga solo cifrada, publicación y cancelación seguras. |
| 3. API autenticada | Listado, detalle, creación, recuperación verificada y cancelación; threadpool y comprobación final antes de entregar. |
| 4. Frontend | Seleccionar nota/comunicado, destinatarios y privada de firma para crear; privada de cifrado para recuperar; mostrar verificación del emisor. |
| 5. Avisos y resumen | Notificar publicación y dirigir al detalle; contar documentos firmados y cifrados sin duplicarlos con el catálogo anterior. |
| 6. Integración y entrega | Dos cuentas, claves históricas, permisos, firma y GCM alterados, errores de carga, documentación y revisión del equipo. |

La interfaz futura aprovechará Mis claves de firma y Mis claves de cifrado;
no requiere generar un par nuevo por documento. Moralitos puede seguir como
Miembro receptor. Roberto necesita su clave de firma y su clave de cifrado
separadas para emitir; sus claves actuales pueden reutilizarse si están vigentes.

## Persistencia del bloque 2

La migración `20261030180000_diplomatic_notes.sql` se aplica una vez después de
las once anteriores, incluida la de avisos/dashboard de expedientes. No edita
migraciones anteriores, las funciones existentes ni el bucket compartido.

| Tabla | Datos |
| --- | --- |
| `public.stc_diplomatic_notes` | Identidad, tipo, emisor, clave de firma original, metadatos y estado `staging`, `ready` o `cancelled`. |
| `public.stc_diplomatic_note_recipients` | Perfiles originales y clave RSA-OAEP original de cada uno, incluido el emisor. |
| `public.stc_diplomatic_note_audit` | Reserva, publicación, cancelación y entrega autorizada. |
| `stc_private.diplomatic_note_material` | Cabecera firmada, firma RSA-PSS, nonce, tag y digest del ciphertext. |

El objeto de Storage contiene solo ciphertext en
`stc-documents/diplomatic-notes/{document_id}/{version_id}/ciphertext`.
No se envía contenido original, privada ni contraseña a las RPC de Supabase.
La firma digital no es un secreto, pero se conserva dentro del material privado
para mantener un único canal autorizado de recuperación y verificación.

Dos RPC de usuario consultan metadatos: `get_diplomatic_note` y
`list_diplomatic_notes`. El listado filtra por título y tipo, con paginación y
conteo total autorizado. Cargas incompletas o canceladas solo son visibles para
su creador. Una nota publicada solo es visible para sus asignados con permiso
actual. No existe una excepción para administradores ajenos.

Las cinco RPC `server_begin_diplomatic_note`, `server_commit_diplomatic_note`,
`server_cancel_diplomatic_note`, `server_diplomatic_note_material` y
`server_complete_diplomatic_download` están reservadas a `service_role`.
El snapshot de firma procede siempre de su registro original y pertenece al
emisor. No se acepta una pública de firma enviada por quien descarga.
La clave de firma desactivada conserva su uso de verificación histórica.

La reserva y publicación usan el mismo bloqueo transaccional que los cambios de
perfiles y claves existentes. Si cambia una cuenta o se retira una clave durante
la preparación, no se publica. SQL comprueba forma, identidad, tamaños, Base64
canónico y coincidencia con la reserva; la comprobación criptográfica de
RSA-PSS/GCM corresponde al backend, no a PostgreSQL.

El contenido se cifra antes de enviarse a Storage. La publicación del material,
el estado `ready` y la auditoría comparten transacción. Una repetición idéntica de
publicación confirmada no duplica el evento; una firma diferente no reemplaza la
original. El backend no reintenta automáticamente la creación completa con otro
identificador. Ante una respuesta perdida, primero conciliar el listado.

Una cancelación solo autoriza borrar Storage si SQL devuelve exactamente `true`.
Si el servidor ya publicó antes de perderse la respuesta, devuelve `false` y el
objeto se conserva. Si falla la limpieza, permanece privado y puede reintentarse
por el creador. No hay recolector automático de objetos huérfanos. La transacción
SQL no abarca Storage y una interrupción abrupta del proceso puede dejar cargas
pendientes de conciliación.

Para descargar se valida material, asignación y versión, se lee ciphertext,
se comprueba su digest, se autentica GCM y se verifica RSA-PSS. Una última RPC
revalida permiso, asignación, estado, versión y digest antes de devolver los bytes.
La auditoría `downloaded` indica autorización de entrega; no demuestra que el
navegador terminó de guardar el archivo. La respuesta incorpora emisor, clave y
huella originales y `verification="signature-and-integrity"`.

## Instalación local y validación

Guardar primero el bloque 1 en `feature/diplomatic-notes`, con sus cinco archivos.
Después extraer el segundo paquete en la raíz del proyecto, en la misma rama.
El segundo paquete cambia ocho archivos respecto al bloque 1; no modifica el
servicio criptográfico ni sus 82 pruebas iniciales. No requiere dependencias nuevas.

Desde CMD:

```bat
cd /d "%USERPROFILE%\Desktop\TopSecretCommunications"
backend\.venv\Scripts\activate.bat
cd backend
python -m pytest tests/diplomatic_notes -q
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest -q
cd ..
git --no-pager diff --check
git --no-pager status --short --untracked-files=all
```

Resultados locales con los requisitos fijados y Python 3.12.14:

- 122 pruebas del módulo: 82 del servicio y 40 de persistencia.
- 707 pruebas Python totales aprobadas; Ruff aprobado y 102 archivos con formato.
- Mypy sin errores en 72 archivos fuente. Persiste el warning de FastAPI/httpx.
- Doce migraciones aplicadas en PostgreSQL/PGlite 0.5.13; 616 comprobaciones SQL
  aprobadas, incluidas 86 de notas y comunicados y las 530 anteriores.
- Inventario nuevo: trece filas `true`; los inventarios de expedientes de once y
  ocho filas conservan su resultado.
- Ensayo de actualización desde las once migraciones anteriores: conserva todos
  los registros y funciones previas, incluido un expediente publicado, material
  privado, claves, avisos y contexto.
- Dos recorridos de contrato para nota y comunicado: reserva real en SQL local,
  firma/cifrado reales en Python, publicación/material SQL, recuperación verificada
  en Python y revalidación final SQL. Son comprobaciones locales con datos
  sintéticos; no usan el proyecto compartido ni prueban la API HTTP real de Storage.
- El equipo de Roberto usa Python 3.14.5; debe ejecutar los mismos controles.

Después de aprobar las pruebas, en Supabase SQL Editor ejecutar solo el archivo
completo de la migración nueva. Copiar con UTF-8 desde la raíz en CMD:

```bat
powershell -NoProfile -Command "Get-Content -LiteralPath 'supabase\migrations\20261030180000_diplomatic_notes.sql' -Raw -Encoding UTF8 | Set-Clipboard"
```

Después ejecutar el inventario de solo lectura:

```bat
powershell -NoProfile -Command "Get-Content -LiteralPath 'supabase\scripts\check_diplomatic_notes_setup.sql' -Raw -Encoding UTF8 | Set-Clipboard"
```

Deben aparecer trece filas con `correcto=true`. No repetir migraciones previas.
No ejecutar `supabase/tests/diplomatic_notes.sql` en el proyecto compartido: sus
fixtures exigen una base aislada y vacía y terminan en rollback. Todavía no hay
pantalla ni rutas HTTP de notas para probar documentos reales desde la web.
No se modificó el Supabase compartido durante estas comprobaciones locales.

## Git y revisión

Mantener el PR #16 centrado en expedientes. La rama nueva parte de su último
commit porque necesita ese servicio y sus contratos. Mientras el PR siga abierto,
una comparación contra `develop` también incluirá los commits de expedientes.
No abrir otro PR general hacia `develop` sin revisar esa base.

Después de que Yael integre expedientes, revisar cómo se hizo el merge y actualizar
la base de notas conservando solo sus commits nuevos. Si se usó squash, no asumir
que un fast-forward incorporará la nueva base. Guardar cada bloque en un commit separado: cinco archivos del servicio y ocho
archivos de persistencia. No mezclar estos cambios con el PR #16 de expedientes.
