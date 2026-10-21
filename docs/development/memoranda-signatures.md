# Memorándums: emisión, aprobación y envío

## Contrato funcional

Cada memorándum tiene un emisor autenticado, destinatarios finales y, opcionalmente, un Embajador aprobador. No requiere grupo. Se prepara un borrador privado, el emisor firma sus bytes originales, solicita aprobación cuando corresponda y confirma el envío. Guardar, firmar, aprobar y enviar son acciones distintas.

La firma identifica a su firmante y permite detectar alteraciones posteriores. No cifra el documento ni garantiza que no pueda modificarse. La aprobación tiene significado institucional; utiliza el mismo RSA-PSS que la firma de emisión y no añade una fuerza criptográfica distinta. El destinatario verifica con las claves públicas confiables de los firmantes, no con su propia clave privada.

## Configurar este incremento

Este paquete parte de Grupos e integrantes v1 y RSA-PSS Memorándums v1 ya instalados. Se aplica en la misma rama, sin crear otra ni repetir paquetes. Conserva perfiles, grupos, claves públicas, archivos, firmas y sus UUID.

1. Detener FastAPI y Vite durante la actualización para no mezclar contratos anteriores/nuevos.
2. Aplicar el ZIP con su instalador, desde la raíz del repositorio.
3. Copiar **solo la migración nueva**:

   ```bash
   pbcopy < supabase/migrations/20261021000000_document_delivery.sql
   ```

4. En el proyecto correcto de Supabase: SQL Editor → New query → pegar TODO → ejecutar una sola vez como `postgres`. La transacción requiere previamente acceso, grupos y memorándums. No repetir migraciones anteriores ni bootstrap. Los SQL de pruebas nunca se ejecutan en la base real.
5. Reiniciar los servicios y recargar el navegador para consultar los permisos vigentes.

No se añaden dependencias, variables ni buckets. Se reutilizan `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y **`SUPABASE_SECRET_KEY` solo en `backend/.env`**, además del bucket privado `stc-documents` de 5 MiB. El frontend conserva su configuración pública. Nunca poner secretos en variables `VITE_` ni en Git. El proyecto existente no necesita nuevos cambios de OAuth.

Para una instalación nueva, las migraciones van en este orden: `20261016000000_access_control.sql`, `20261019000000_groups.sql`, `20261019100000_memoranda_signatures.sql`, `20261021000000_document_delivery.sql`. Si se usa CLI con historial remoto reconciliado, aplicar por CLI en lugar del SQL Editor; no usar ambos métodos. Una ejecución manual no registra automáticamente el historial del CLI.

## Permisos generales y asignaciones

| Acción | Administrador | Personal autorizado | Embajador | Miembro |
| --- | --- | --- | --- | --- |
| Crear y firmar documentos propios | Sí | Sí | Sí | No |
| Generar claves propias de firma | Sí | Sí | Sí | No |
| Aprobar institucionalmente un documento asignado | No | No | Sí | No |
| Leer y verificar documentos entregados a su cuenta | Sí | Sí | Sí | Sí |
| Administrar perfiles y grupos | Permisos administrativos existentes | No | No | No |

`documents.sign` se concede a los tres roles emisores. `documents.approve` es nuevo y se concede únicamente a `ambassador`. Tener permiso general no permite firmar documentos ajenos: se exige ser el emisor o el aprobador elegido en la etapa correspondiente. Un administrador puede firmar una emisión **propia**, pero no actuar en nombre de otra persona ni realizar aprobación institucional por ser administrador. Miembro conserva lectura y verificación, sin convertirse en emisor.

El emisor se resuelve a partir del JWT validado: no llega como campo editable del formulario. La aprobación requiere un Embajador activo, vinculado a Google y con permiso vigente. Los destinatarios pueden estar pendientes de primer login, pero deben estar activos para confirmar el envío. Cada destinatario es una asignación por documento, independiente de grupos. El límite es 255 destinatarios finales; el emisor no se añade ni cuenta como destinatario final.

## Estados y acceso

| Estado visible | Quién puede consultar el archivo | Acción siguiente |
| --- | --- | --- |
| Borrador | Emisor | Firmar emisión. Si ya firmó y necesita otra aprobación, solicitarla. |
| En aprobación | Emisor y Embajador asignado con autoridad vigente | Revisar la versión y firmar aprobación. |
| Listo para enviar | Emisor; aprobador si hubo revisión | El emisor confirma el envío. |
| Enviado | Emisor, aprobador participante y destinatarios finales activos | Descargar y verificar. |
| Flujo anterior | Asignaciones anteriores | Consultar/verificar historial; no incorporar nuevas firmas ni simular un envío. |

La carga técnica tiene sus propios estados `staging/ready/failed`; que un archivo esté `ready` solo significa que terminó de cargarse. **No significa que fue enviado**. La entrega se registra por separado en `stc_documents.delivery_state` y la fecha `sent_at`. El estado de firmas se conserva aparte para no confundir "firmado" con "enviado".

El aprobador no recibe acceso al crearse el borrador, aunque esté elegido o también sea destinatario final. El emisor debe firmar primero y solicitar la aprobación expresamente. Los destinatarios finales permanecen bloqueados hasta la confirmación de envío, tanto por API como por RLS. Conocer el UUID no habilita acceso y una cuenta administrativa ajena tampoco obtiene acceso.

La interfaz ofrece **Actualizar documento** para consultar una aprobación realizada desde otra cuenta. Este flujo no requiere Realtime ni presencia simultánea. La lista y el Dashboard reflejan solo registros autorizados; "Pendientes" incluye preparación, aprobación y envío, no únicamente ausencia de firma.

### Un Embajador como emisor y aprobador

Puede emitir documentos ordinarios o elegir su propia cuenta como aprobador institucional. En este último caso, una sola firma cubre ambas responsabilidades y el servidor exige que conserve la autoridad de Embajador al firmar y enviar. No necesita enviarse una solicitud ni generar dos firmas sobre los mismos bytes. Se conserva una firma con propósito `issuer` y la asignación institucional correspondiente.

### Cambios posteriores de permisos y participantes

Cada acción consulta los permisos actuales, incluso con un JWT no vencido. Una baja o pérdida de autoridad antes de la firma/envío puede bloquear la operación. Reactivar o restituir permisos exige la administración correspondiente; no se alteran firmantes o destinatarios automáticamente. Si se necesita cambiar el contenido, destinatarios o política de aprobación, crear otro borrador y firmar esa nueva versión. Este incremento no incluye edición de revisiones ni eliminación de borradores.

Una firma histórica sigue siendo verificable si su clave se retira o cambia el rol de su titular. La retirada impide nuevas firmas con esa clave; no borra las anteriores ni afirma que nunca fueron válidas. La validez matemática de una firma y la autoridad actual para emitir/aprobar/enviar se comprueban por separado.

## Recorrido de prueba

1. Como Administrador, Personal autorizado o Embajador, abrir **Mis claves de firma**, elegir etiqueta, contraseña y nombres `.txt` distintos y descargar pública y privada cifrada por separado. Guardar la privada antes de cerrar el resultado: no se conserva ni se puede descargar después.
2. Crear un memorándum con al menos un destinatario final. Sin aprobación institucional, guardar, revisar el original, firmar emisión y pulsar **Enviar a destinatarios** → confirmar.
3. Desde la cuenta destinataria, comprobar que el documento no era visible antes del envío y que ahora permite descargar/verificar sin firmar. Una cuenta ajena no debe verlo.
4. Crear otro documento con la casilla **Requiere aprobación institucional del Embajador** y elegir a otra cuenta Embajador. Firmar emisión y solicitar aprobación.
5. Con el Embajador, consultar el documento invitado, verificar la firma del emisor, revisar el contenido y firmar aprobación con su propia clave. No puede confirmar el envío en nombre del emisor.
6. Volver al emisor, pulsar **Actualizar documento** y confirmar el envío. El destinatario verá dos firmas sobre la misma versión.
7. Como Embajador, elegir su propia cuenta como aprobador y comprobar que basta una sola firma antes de enviar.
8. Verificar una copia cuyo contenido haya cambiado: debe fallar. Renombrar una copia con bytes idénticos no invalida sus firmas.

Usar perfiles de navegador separados para cuentas simultáneas; las pestañas del mismo perfil comparten sesión. Una contraseña o clave incorrecta no registra una firma. Recargar tras la migración para actualizar los permisos.

## Persistencia y servidor confiable

Se conservan las seis tablas documentales. La migración añade estado de entrega, aprobador y fechas al documento, y `purpose` (`issuer`, `approval`, `legacy`) a las firmas. Se fija la versión por UUID y los objetos de Storage se mantienen inmutables bajo `{document_id}/{version_id}`, sin `upsert`. No se cambia una versión ya firmada ni sus bytes. Las asignaciones y la política de aprobación se fijan al crear el borrador.

El backend verifica la integridad del objeto y las firmas existentes antes de solicitar revisión, aprobar o enviar. Las transiciones que afirman esas comprobaciones utilizan RPC **solo ejecutables por el servidor**. El navegador no puede registrar firmas ficticias, marcar un documento como enviado ni llamar directamente a la transición para saltarse FastAPI. Las RPC revalidan propietario, etapa, versión, clave y permisos con el bloqueo transaccional de acceso existente. Solicitud y envío son idempotentes y no duplican auditoría ante un reintento.

Las lecturas siguen usando el JWT del usuario y RLS. El canal reservado de servidor usa `SUPABASE_SECRET_KEY`; esa credencial nunca sustituye la identidad del usuario en las lecturas. Storage permanece privado y bloqueado para operaciones directas de anon/authenticated, incluso con otra política permisiva amplia.

La aplicación confía en el backend: genera claves y recibe temporalmente la privada cifrada y contraseña para firmar en memoria. No las persiste en BD/Storage ni en el navegador. Es una firma ejecutada en el servidor, no un esquema de clave exclusiva del dispositivo. En despliegue, HTTPS y no registrar cuerpos con secretos son requisitos. Los memorándums no llevan AES por defecto; su protección es firma y control de acceso. Otros tipos deberán añadir confidencialidad según su política.

## Criptografía y formatos conservados

RSA-PSS original no cambia: RSA-2048, exponente 65537, SHA-256, MGF1-SHA-256 y salt de 32 bytes. Se firman los bytes originales sin doble hashing. Pública SPKI DER en Base64; privada PKCS8 DER cifrada con `BestAvailableEncryption`, en Base64. Contraseña entre 12 y 256 caracteres, hasta 1024 bytes UTF-8. Huella pública: SHA-256 del DER público. Firma: 256 bytes representados como Base64.

El JSON de firmas descargado pasa a `format_version=2`, con propósito, emisor, aprobador y estado de entrega. Los metadatos de ese JSON no constituyen un manifiesto firmado independiente: identidad, cargo y política se apoyan en los registros confiables de la plataforma. Un verificador externo debe establecer la confianza en la identidad/autoridad asociada a cada clave; no basta confiar en un nombre escrito dentro del JSON. No se añaden certificados ni distribución externa automática.

La aprobación institucional no autoriza por sí sola divulgar un archivo fuera de la embajada. El incremento gestiona entrega interna; no incorpora correo, enlaces públicos ni permisos de salida externos. Los usuarios autorizados pueden descargar copias, por lo que el control de entrega interna no pretende impedir toda copia posterior.

## Compatibilidad con documentos anteriores

La migración identifica los documentos ya existentes como `legacy_shared` y sus firmas como `legacy`. Conserva sus asignaciones, claves, archivos y firmas verificables. No crea una firma del emisor, una aprobación institucional ni una fecha de envío que no existían. El campo de emisor declarado se devuelve nulo en esos registros. El creador original sigue apareciendo como creador.

No se retiran accesos concedidos previamente como si el documento nunca hubiera sido compartido. Estos registros se consultan y verifican; para aplicar el nuevo proceso debe crearse un nuevo borrador y firmarlo. La migración no rehace archivos ni convierte firmas antiguas en aprobaciones por el rol actual de su titular.

## Endpoints adicionales

Bajo `/api/v1`, con sesión válida:

| Método y ruta | Uso |
| --- | --- |
| `GET /documents/approvers` | Embajadores activos y vinculados, con búsqueda/paginación. |
| `POST /documents/{id}/request-approval` | Solicitar revisión después de verificar firma de emisión. |
| `POST /documents/{id}/send` | Verificar firmas y confirmar entrega final. |

Ambas acciones POST reciben únicamente `version_id`; actor y acción permitida se resuelven en servidor. La creación acepta destinatarios `{profile_id}` y `approver_id` opcional. Ya no admite `can_sign` en destinatarios ni un emisor elegido por el cliente. El propósito de cada firma lo determina el servidor según la asignación y la etapa. Se conservan los endpoints de claves, catálogo, detalle, archivo, firma y verificación.

Errores: 401 sin sesión; 403 sin permiso; 404 cuando el documento no está disponible para esa cuenta; 409 por etapa/versión/participantes incompatibles o firmas requeridas ausentes; 413 por tamaño; 422 por datos, claves o integridad inválidos; 503 por servicios/configuración no disponibles. Un error de validación no refleja el cuerpo ni sus secretos.

## Cargas interrumpidas

Se conserva la preparación `staging` → carga privada → confirmación `ready`, con intento de limpieza de cargas fallidas. PostgreSQL y Storage no son una única transacción; un fallo también durante la limpieza puede dejar un objeto privado pendiente de conciliación. Perder la respuesta de confirmación no borra un objeto `ready`.

Consulta de revisión, solo lectura, como operador:

```sql
select v.document_id, v.id as version_id, d.created_by as actor_profile_id,
       v.state, v.created_at, o.name as storage_object
from public.stc_document_versions v
join public.stc_documents d on d.id = v.document_id
left join storage.objects o
  on o.bucket_id = 'stc-documents'
 and o.name = v.document_id::text || '/' || v.id::text
where v.state in ('staging', 'failed')
  and v.created_at < now() - interval '1 hour'
order by v.created_at;
```

Detener cargas y confirmar que no hay una operación activa antes de limpiar. Para `staging`, usar `server_abort_memorandum` con los tres UUID; continuar solo si devuelve true o la fila ya estaba `failed`. Eliminar objetos fallidos por API/SDK de Storage o Dashboard, nunca borrando `storage.objects` con SQL. Conservar auditoría y no borrar objetos `ready`. En múltiples procesos, una conciliación automática necesita exclusión mutua y antigüedad apropiada.

## Comprobaciones

Desde `backend/`, con el entorno virtual activo:

```bash
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m mypy
```

Desde la raíz:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
```

Pruebas SQL **solo en BD aislada vacía con las cuatro migraciones**, no en el proyecto real:

```bash
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_control.sql
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/groups.sql
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/memoranda.sql
```

Validación: **334 pruebas de backend**, **47 + 58 + 76 comprobaciones SQL**, **31 comprobaciones de navegador documental y 22 de regresión**, además de una migración sobre datos anteriores con firma RSA-PSS real. Ruff, formato, mypy, lint y build correctos.

Validación local con Python 3.12.14 (el repositorio conserva configuración/CI de Python 3.14), PostgreSQL embebido/PGlite y navegador Chromium contra React/FastAPI más un servidor controlado de contratos Auth/PostgREST/Storage. Las comprobaciones SQL usan firmas ficticias únicamente para probar grants/RLS/estados; las pruebas Python y de navegador ejecutan RSA-PSS real. No se utilizaron tus secretos ni se ejecutó SQL en tu Supabase remoto. El recorrido real de OAuth y la instalación de la migración se confirman en tu entorno.

## Siguiente etapa

Se conserva AES-GCM + Shamir portable. Siguen RSA-OAEP aplicado a los otros flujos documentales, entrega individual de fragmentos, participantes originales congelados de notas especiales, recuperación colaborativa y Realtime. Los grupos mantienen su alcance propio; no conceden acceso automático a memorándums. El límite portable de 20 fragmentos y el límite de grupos de 255 no cambian en este incremento.
