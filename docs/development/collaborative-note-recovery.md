# Recuperación colaborativa de notas especiales

La interfaz y los avisos generales se actualizan en [Notificaciones y flujo](notifications-and-workflow.md).
La custodia sigue en la base de datos: no se exige subir el archivo del fragmento.

Este incremento completa el recorrido de las notas con `custody_mode=individual-v1`:
creación por grupo, ciphertext privado, entrega individual, solicitud, aportaciones,
reconstrucción n de n y descarga autorizada. Conserva las notas `portable` anteriores
con su recuperación manual. No altera las primitivas AES-GCM, Shamir, RSA-OAEP,
RSA-PSS ni el formato v1 del documento cifrado.

## Flujo para probar con tres cuentas

1. Preparar un grupo de tres perfiles activos. Cada persona debe haber activado su
   clave de cifrado y conservado el `.stckey.json` y su contraseña. Las claves de
   cifrado y firma permanecen separadas.
2. Un participante con `documents.create` crea una nota de grupo. Las asignaciones
   y claves originales se fijan al crearla, como en el incremento anterior.
3. Cualquier participante original con `recovery.request` abre la nota y pulsa
   **Solicitar recuperación**. Introduce motivo y plazo. El rol Integrante también
   puede solicitar, aunque no pueda crear documentos ni administrar grupos.
4. La solicitud comienza con 0 de n. El solicitante **no aporta automáticamente**.
   Solo puede existir una solicitud abierta por nota. El identificador del cliente
   evita duplicar la creación al perder una respuesta.
5. Cada participante original entra desde su cuenta, abre la misma nota y selecciona
   la solicitud. Revisa solicitante, motivo y vencimiento; pulsa **Aportar mi fragmento**,
   selecciona la privada original de su fragmento, introduce su contraseña y marca
   la autorización explícita. El frontend no envía un fragmento elegido por el usuario:
   el backend obtiene el sobre asignado y autentica su apertura.
6. El progreso cambia a 1 de n, 2 de n… Las aportaciones repetidas no incrementan el
   contador ni reemplazan la aportación previa. Pueden realizarse en distintos momentos;
   no se exige presencia simultánea.
7. Al reunir n de n, solamente el solicitante ve **Recuperar archivo**. Selecciona la
   clave de cifrado fijada cuando creó la solicitud, que puede ser distinta de la clave
   histórica de su fragmento, e introduce su contraseña.
8. Se reconstruye la clave y se autentica AES-GCM. Una comprobación final de permisos,
   estado, vigencia y participantes precede a la respuesta con el archivo. La UI inicia
   la descarga y pide comprobar que se guardó. La plataforma no puede probar que el
   sistema operativo terminó de guardar el archivo.
9. La recuperación queda completada y el solicitante dispone de diez minutos para
   repetir una descarga interrumpida. Cada reintento requiere de nuevo su clave privada
   y contraseña. No extiende el plazo ni duplica la auditoría de finalización.

## Qué clave se selecciona en cada operación

| Operación | Clave privada necesaria |
| --- | --- |
| Comprobar el fragmento propio | La clave histórica asignada al crear la nota |
| Aportar a una solicitud | La misma clave histórica del fragmento |
| Recuperar el documento como solicitante | La clave que estaba activa al crear esa solicitud |

La interfaz muestra el nombre de archivo esperado, su UUID y huella. Rotar una clave
no cambia notas o solicitudes existentes. Las claves retiradas siguen sirviendo para
sus asignaciones históricas. Si una persona pierde una privada necesaria, generar
otra no permite abrir esos sobres. El sistema no elimina al participante para reducir n.

## Protección temporal sin secreto maestro adicional

Al aportar, el backend abre exclusivamente el fragmento del actor autenticado y
verifica su contexto original. Después lo cifra para la pública del solicitante fijada
en la solicitud. Se reutilizan los sobres híbridos del incremento anterior:
AES-256-GCM protege el fragmento y RSA-OAEP/SHA-256 protege su clave AES de 32 bytes.
No se intenta cifrar directamente un JSON Shamir grande con RSA.

`ContributionContext` extiende el contexto autenticado existente con:

- `purpose="recovery-contribution"`.
- `request_id`, para impedir reutilizar una aportación en otra solicitud.
- `contributor_id`, para vincular el fragmento a quien autorizó.

El contexto conserva UUID de nota, set_id de Shamir, índice, n/n y UUID/huella de la
clave del destinatario. En las aportaciones el destinatario es **el solicitante**.
Todo el contexto se autentica como AAD. Cambiar request_id, autor, destinatario,
clave, ciphertext, nonce o tag impide abrir el sobre. El contrato derivado conserva
estos campos al serializar; no se pierden al utilizar el sobre base.

Las aportaciones se guardan cifradas en `stc_private.note_recovery_contributions`.
Esta tabla tiene RLS y revocaciones explícitas: no se expone a anon, authenticated
ni service_role por lecturas directas. Solo los RPC SECURITY DEFINER del backend
acceden al material, con autorización del solicitante y n aportaciones vigentes.
Los endpoints de usuario nunca devuelven estos sobres ni fragmentos en claro.

No se persisten privadas, contraseñas, claves AES reconstruidas ni documento
original. No se añade una clave maestra al `.env`. Como en la etapa anterior, el
backend es de confianza y maneja privadas/contraseñas temporalmente durante las
operaciones; esto no es cifrado de extremo a extremo frente al servidor. En despliegue
se usa HTTPS. No se promete borrado garantizado de copias de memoria en Python/JS.

## Estados y reglas

| Estado | Comportamiento |
| --- | --- |
| `pending` | Espera aportaciones; cada cuenta puede aportar una sola vez |
| `ready` | Están las n aportaciones; solo el solicitante puede recuperar |
| `completed` | Descifrado confirmado; permite reintentos por diez minutos |
| `cancelled` | El solicitante cerró la solicitud; material temporal eliminado |
| `rejected` | Un participante original rechazó; material temporal eliminado |
| `expired` | Venció el plazo sin completarse; material temporal eliminado |

El plazo por defecto es una hora. La UI ofrece 5 minutos, 15 minutos, una hora y
24 horas. La API admite entre 1 y 1440 minutos para pruebas y clientes autorizados.
Una solicitud completada dispone de su ventana fija de diez minutos, aunque el
plazo original de reunión termine antes o después. Expirar o cerrar no borra la
nota, los sobres originales ni la auditoría.

Un participante puede rechazar una solicitud abierta incluso después de aportar,
hasta que se complete. El rechazo cierra **esa solicitud para todos**; el sistema
requiere n de n y no la sigue con n−1. Cancelar corresponde al solicitante. Ambas
acciones requieren confirmación visible. Se puede iniciar otra solicitud posterior,
que necesita nuevas aportaciones: las anteriores no se reutilizan.

La pertenencia documental usa los participantes originales, no la composición
actual del grupo. Agregar miembros no concede acceso a notas/solicitudes anteriores;
retirar un miembro del grupo no borra su asignación histórica. Desactivar un perfil
o quitarle permisos sí bloquea lecturas y nuevas operaciones. La recuperación queda
bloqueada mientras algún participante original esté inactivo o sin permiso, sin
modificar n ni saltarse a esa persona. Restaurar su acceso permite continuar dentro
del plazo. El administrador no obtiene fragmentos ni descargas por su rol general.

## Autorización y concurrencia

La API usa el JWT y los permisos actuales de Supabase. Las escrituras criptográficas
se confirman por el canal del servidor después de abrir y validar los sobres.
La BD vuelve a comprobar actor, asignación, estado, plazo y participantes. Los JWT
no pueden registrar aportaciones arbitrarias ni declarar completada una recuperación.

Los RPC usan el bloqueo transaccional compartido con perfiles, grupos y notas.
La creación repetida con el mismo UUID/motivo/plazo devuelve la solicitud original,
sin renovar fechas. Otra solicitud abierta produce conflicto. Las aportaciones son
únicas por request_id/profile_id y no se suman dos veces ante reintentos concurrentes.

La reconstrucción utiliza únicamente el material autorizado obtenido por un RPC del
servidor. Comprueba autores únicos, contexto de solicitud y correspondencia de todos
los fragmentos; llama al `recover_note` existente para Shamir y autenticación AES-GCM.
Antes de devolver plaintext, un segundo RPC verifica que la solicitud no se rechazó,
canceló o venció durante el descifrado y que no se desactivó a un participante. Un
fallo de integridad o autorización no marca la solicitud como completada ni entrega
el contenido. Las respuestas `/api/` mantienen `Cache-Control: no-store`.

## Vencimiento y limpieza

La autorización comprueba los plazos en cada operación, aunque la limpieza todavía
no haya corrido. Las lecturas de solicitudes concilian vencimientos de esa nota.
Además, FastAPI inicia una tarea de mantenimiento cada 60 segundos si está configurada
la credencial del servidor. Se detiene correctamente al cerrar la aplicación y sus
errores registran solo un mensaje fijo, sin cuerpos, tokens ni fragmentos.

- Cancelación/rechazo eliminan el material temporal en la transacción del cierre.
- Vencimiento elimina las aportaciones pendientes y conserva metadatos/auditoría.
- Al concluir la ventana de reintento se borran los sobres de esa recuperación;
  se conservan el estado completed y el progreso histórico.

La eliminación periódica de las filas de aportación requiere un backend en ejecución. Si está detenido,
la autorización sigue rechazando operaciones fuera de plazo cuando vuelve a atender
solicitudes; el material cifrado se limpia al consultar la nota o durante el siguiente
ciclo. No se utiliza almacenamiento temporal en memoria como único registro y las
solicitudes/aportaciones sobreviven a un reinicio. El RPC idempotente
`server_cleanup_note_recoveries()` también queda disponible para un planificador
operativo futuro, exclusivamente con la credencial del servidor. No requiere pg_cron.

## Progreso y Realtime

La migración añade **solo `public.stc_note_recoveries`** a la publicación
`supabase_realtime` cuando existe. Tiene RLS para participantes originales activos.
Nunca publica privadas, contraseñas, originales o aportaciones cifradas. El cliente
escucha INSERT/UPDATE filtrados por note_id y vuelve a consultar FastAPI; un evento
no concede permisos ni es una autorización de recuperación. No se suscribe a DELETE.

La UI renueva el token de Realtime desde la sesión existente y elimina el canal al
cerrar el detalle. También concilia cada cinco segundos y al recuperar foco/visibilidad,
para detectar vencimientos o eventos perdidos. Si el WebSocket no conecta, el flujo
sigue funcionando y muestra que utiliza la actualización automática de respaldo.
El mensaje de conexión en vivo solo aparece cuando el canal informa SUBSCRIBED.

Referencias: [Postgres Changes y publicaciones](https://supabase.com/docs/guides/realtime/postgres-changes),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[cifrado autenticado](https://cryptography.io/en/latest/hazmat/primitives/aead/).

## Arquitectura y API

- `modules/note_recovery/{schemas,service,router}.py`: contratos, coordinación y API.
- `crypto/key_wrapping/recovery_envelope.py`: contexto de aportación sobre la composición
  híbrida existente. No modifica las primitivas.
- `features/group-notes/recoveries.ts`: contratos, peticiones y selección de clave.
- `RecoveryPanel.tsx`: listado, creación, consentimiento, rechazo/cancelación y descarga.
- `useRecoveryUpdates.ts`: invalidación por Realtime y conciliación automática.

| Ruta | Operación |
| --- | --- |
| GET/POST `/api/v1/group-notes/{note_id}/recoveries` | Listar o crear solicitudes |
| GET `/api/v1/note-recoveries/{id}` | Estado y participantes; sin material criptográfico |
| POST `/api/v1/note-recoveries/{id}/contribute` | Privada cifrada, contraseña y approve=true |
| POST `/api/v1/note-recoveries/{id}/recover` | Privada del solicitante y contraseña; archivo autenticado |
| POST `/api/v1/note-recoveries/{id}/cancel` | Cierre por el solicitante |
| POST `/api/v1/note-recoveries/{id}/reject` | Rechazo por participante original |

## Instalación

Aplicar el ZIP sobre la misma rama que ya tiene las dos entregas anteriores.
Ejecutar una sola vez `supabase/migrations/20261026000000_collaborative_note_recovery.sql`
en SQL Editor como postgres. Requiere las seis migraciones anteriores. No repetirlas,
no ejecutar fixtures de `supabase/tests` en el proyecto real y no crear otro bucket.
No hay dependencias ni variables de entorno nuevas. Reiniciar backend/frontend.

Supabase cloud normalmente ya tiene la publicación `supabase_realtime`; el SQL añade
la tabla de metadatos automáticamente. Si se usa una instalación propia sin esa
publicación, la consulta periódica sigue funcionando. Para activar el WebSocket de
esa instalación, configurar Realtime y agregar esta tabla a su publicación según la
documentación del proveedor. No agregar la tabla privada de aportaciones.

## Pruebas realizadas

- 438 pruebas de backend, incluidas 33 nuevas: contexto de aportación, consentimiento,
  errores, integridad y autorización final. Ruff, formato, mypy y pip check correctos.
- 24 pruebas de frontend, incluidas 6 nuevas: contratos, claves históricas, separación de
  operaciones, invalidación y limpieza de suscripciones. ESLint/build correctos.
- 328 comprobaciones SQL: 279 anteriores y 49 nuevas, sobre PostgreSQL embebido.
- 39 verificaciones HTTP adicionales contra FastAPI/PostgreSQL/criptografía reales:
  tres identidades, descifrado exacto, rotación de clave después de solicitar,
  idempotencia, rechazo, cancelación y descarga restringida.
- 24 comprobaciones en navegador con cuentas separadas, consentimiento, errores
  accesibles, progreso, recuperación exacta y vista móvil sin desbordamiento.

Auth y Storage remotos se sustituyeron por contratos locales; se conservan las
comprobaciones de la aplicación y RLS real en la BD local. No se modificó tu Supabase
ni Google OAuth. El navegador comprobó el progreso con la consulta de respaldo; el
transporte WebSocket del proveedor se debe comprobar en tu proyecto tras la migración.
No se afirma haber probado una conexión remota de Supabase Realtime.
