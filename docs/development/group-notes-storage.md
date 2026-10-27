> **Evolución del flujo:** esta guía documenta la etapa de custodia portable y
> sigue aplicando a las notas creadas con ese modo. Con la migración
> `20261025000000_recipient_share_custody.sql`, las notas nuevas usan entrega
> individual. Consulta [custodia individual](recipient-share-custody.md).

# Notas especiales de grupo: participantes y almacenamiento cifrado

## Alcance de esta entrega

Parte de `develop` en `008d883` (PR #12). Implementa crear una nota para un grupo,
conservar sus participantes originales y persistir el documento cifrado. Los
módulos AES-256-GCM, Shamir, RSA-OAEP y RSA-PSS no se modifican.

La entrega individual con RSA-OAEP, solicitudes de recuperación, aportaciones
entre cuentas y Realtime corresponden a la siguiente etapa. Este incremento
conserva la custodia portable existente mediante archivos: **el creador recibe
una sola vez todos los fragmentos** y puede descargar un resguardo confidencial.
No se afirma que ya se hayan entregado fragmentos a cada cuenta.

El modo de custodia se registra como `portable`, de modo que una integración
posterior no cambie silenciosamente cómo se recuperan estas notas existentes.
Los resguardos ya guardados siguen utilizando el paquete y fragmentos v1.

## Configuración

1. Crear una rama nueva basada en el `develop` actualizado y aplicar el ZIP.
2. Mantener las variables actuales de backend y frontend. Para la persistencia se
   reutiliza `SUPABASE_SECRET_KEY` exclusivamente en el backend. No copiarla a
   React ni a Git. La recuperación portable conserva su flag existente
   `STC_ENABLE_LOCAL_WORKFLOW=1`; la persistencia no depende de ese flag.
3. En el mismo proyecto Supabase, abrir **SQL Editor → New query** y ejecutar
   completo `supabase/migrations/20261022000000_group_notes_storage.sql`, una vez
   como `postgres`. Las cuatro migraciones anteriores deben estar aplicadas;
   no repetirlas ni ejecutar los archivos de `supabase/tests` en la base real.
4. Se reutiliza el bucket privado `stc-documents` de 5 MiB. No crear otro bucket ni
   cambiar su visibilidad. La migración comprueba que ya tenga esa configuración.
5. Reiniciar FastAPI y Vite. Entrar a **Notas especiales → Notas del grupo**.

Si las migraciones previas se ejecutaron por SQL Editor, ese método no registra
su aplicación en el historial del CLI. Mantener el mismo método o reconciliar
ese historial antes de utilizar `supabase db push`.

## Reglas de grupos y acceso

| Operación | Regla |
| --- | --- |
| Crear una nota | Perfil activo con `documents.create` y pertenencia actual al grupo activo. Puede ser integrante o responsable. |
| Seleccionar grupo | Solo los grupos propios activos; el administrador ajeno no aparece como miembro automáticamente. |
| Participantes | Todos los integrantes vigentes, entre 2 y 20, sin perfiles desactivados. No se excluye a nadie silenciosamente. Se admiten perfiles autorizados pendientes de primer acceso. |
| Umbral | `threshold = share_count = cantidad del snapshot`; el cliente no lo elige. |
| Publicar | Solo el creador, con permiso vigente, grupo activo y pertenencia actual; todos los participantes originales deben seguir activos. |
| Consultar preparación | Solo su creador. |
| Consultar nota compartida | Perfiles activos con `documents.read_assigned` incluidos en el snapshot original. |
| Cambiar el grupo después | No cambia ni el grupo histórico ni sus participantes. Un nuevo miembro no obtiene notas anteriores; uno retirado conserva su asignación documental original mientras su perfil tenga acceso. |
| Cancelar preparación | Solo su creador activo; no permite cancelar una nota ya compartida. |

La pertenencia documental original es diferente de la pertenencia actual al
grupo. Desactivar un perfil bloquea sus lecturas; retirar su membresía no borra
su asignación histórica ni invalida archivos que ya haya descargado.

## Flujo y estados

1. El cliente genera un UUID de solicitud. El servidor valida archivo e identidad.
2. Una RPC de servidor fija grupo, versión, nombres, perfiles, papeles e índices
   de fragmento en una transacción. Exige la versión previsualizada del grupo.
3. FastAPI reutiliza `documents.service.protect_note`: AES-256-GCM cifra el archivo
   y Shamir divide la clave según el número real del snapshot.
4. Solo el ciphertext binario se sube al prefijo
   `stc-documents/special-notes/<note_id>/ciphertext`, sin sobrescribir objetos.
   Su tamaño coincide con el original; nonce y tag se conservan en la cabecera.
5. La cabecera pública v1, digest SHA-256 **del ciphertext** y snapshot se guardan
   en PostgreSQL. El estado pasa a `awaiting_backup`.
6. El creador descarga `<note_id>.stcbackup.json` y confirma que lo guardó. Esa
   descarga contiene paquete cifrado, asignaciones, fragmentos y un recibo aleatorio.
7. La confirmación verifica el recibo y los permisos; publica la nota como `ready`.
   Los participantes originales ya pueden consultar metadatos y descargar el
   paquete cifrado, pero la plataforma todavía no les entrega fragmentos.

| Estado | Significado |
| --- | --- |
| `staging` | Snapshot reservado; carga todavía sin confirmar. Solo lo ve su creador. |
| `awaiting_backup` | Ciphertext guardado; falta resguardar y confirmar. Solo lo ve su creador. |
| `ready` | Resguardo confirmado; paquete cifrado disponible para los participantes originales. |
| `cancelled` | Preparación cancelada; no puede compartirse. Se conserva su auditoría. |

El recibo evita confirmar una preparación sin haber recibido su material de
resguardo. Se persiste únicamente su hash en una tabla privada, nunca el recibo
original. No demuestra que el navegador haya guardado físicamente la descarga:
la interfaz pide comprobar su existencia. No es un fragmento ni permite descifrar.

**El resguardo contiene todos los fragmentos.** Quien tenga esa copia completa
puede reunir el secreto mediante el flujo portable. Tratarla como confidencial;
esta etapa no ofrece custodia criptográfica independiente por participante.

## Persistencia y seguridad

- Tablas: `stc_group_notes`, `stc_group_note_participants`, `stc_group_note_audit` y
  `stc_private.group_note_receipts`.
- No se almacenan plaintext, clave AES, fragmentos, contraseña o copia del
  resguardo. El archivo original solo se procesa transitoriamente en FastAPI.
- La clave, fragmentos y recibo salen una sola vez hacia el creador; los listados,
  detalles y descargas posteriores no los devuelven.
- Las lecturas usan JWT, permiso actual y RLS; no dependen de un botón oculto.
  Las escrituras solo admiten RPC de servidor, con revalidación del actor real.
- Se reutilizan las políticas restrictivas del bucket: un JWT de usuario no puede
  leer, escribir o actualizar directamente los objetos, aunque conozca la ruta.
- Al descargar, el backend comprueba tamaño y digest contra los metadatos antes
  de reconstruir el paquete. AES-GCM verifica autenticidad al recuperar el original.
  El digest almacenado detecta cambios del objeto; no equivale a una firma digital.
- La cabecera v1 conserva su AAD existente, que vincula archivo y conjunto de
  Shamir. La procedencia del grupo se garantiza con las transacciones y permisos
  de la base de datos confiable; no se afirma que la cabecera v1 firme al grupo.
- El snapshot se conserva por transacción y no tiene endpoints de edición. Los
  cambios de grupo y perfil comparten el lock de la organización existente.
- El UUID de solicitud es único: una solicitud duplicada se rechaza sin generar
  una segunda carga. Confirmar el mismo resguardo es idempotente y no duplica auditoría.

El backend sigue siendo un servidor confiable, como en los flujos existentes.
Un operador con privilegios de base de datos/servidor no queda fuera del modelo
por el hecho de usar RLS. Tampoco puede revocarse una copia ya descargada.

## Recargas, interrupciones y conciliación

- Si guardaste el resguardo y recargaste antes de confirmar, abre la preparación,
  importa su `.stcbackup.json` y confirma. No hace falta volver a cifrar el archivo.
- Si no recibiste o no guardaste el resguardo, la plataforma no puede recrear los
  fragmentos. La nota sigue sin compartir: cancela esa preparación y crea otra.
- Un fallo de carga cancela el registro todavía en `staging` e intenta eliminar el
  objeto privado. Si el servidor confirmó la carga y se perdió su respuesta,
  no se borra el objeto confirmado; queda pendiente de resguardo o cancelación.
- Si se perdió la respuesta de publicación, puedes repetir la confirmación con
  el mismo resguardo. Las transiciones no publican una nota cancelada.
- No hay transacción distribuida entre PostgreSQL y Storage. Una caída del
  proceso o un fallo de eliminación puede dejar un objeto privado huérfano.
  No se publica ni habilita una lectura a terceros por esa situación.

La conciliación operativa debe revisar primero `id`, `state`, `created_at` y
`ready_at` de `stc_group_notes` y comparar el prefijo exacto de Storage. Cancelar
preparaciones desde la cuenta creadora cuando sea posible. Solo eliminar objetos
confirmados como cancelados y sin carga en curso; **nunca borrar por antigüedad
ni eliminar objetos `awaiting_backup`/`ready` como reacción a un timeout**. La
cancelación conserva el snapshot y auditoría. La limpieza de huérfanos requiere
el acceso operativo del proyecto; este incremento no ejecuta borrados masivos.

## Endpoints

Todos requieren sesión. Crear/confirmar exige además `documents.create`.

| Método y ruta | Uso |
| --- | --- |
| `GET /api/v1/group-notes/groups` | Grupos propios y sus integrantes para previsualización. |
| `GET /api/v1/group-notes` | Notas visibles y preparaciones propias, con búsqueda/paginación. |
| `POST /api/v1/group-notes` | Reserva, cifra y guarda; entrega material de resguardo una vez. |
| `GET /api/v1/group-notes/{id}` | Metadatos y participantes originales. |
| `GET /api/v1/group-notes/{id}/package` | Paquete cifrado reconstruido desde Storage y cabecera. |
| `POST /api/v1/group-notes/{id}/confirm-backup` | Confirma recibo/resguardo y publica. |
| `POST /api/v1/group-notes/{id}/cancel` | Cancela exclusivamente una preparación propia. |

## Pruebas

En el backend, con su entorno virtual activo:

```bash
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m mypy
```

Desde `frontend`:

```bash
npm test
npm run lint
npm run build
```

Las pruebas SQL están en `supabase/tests/group_notes.sql`, para una base aislada
sin perfiles y con las cinco migraciones. Sus fixtures se revierten; no son
instrucciones de configuración ni se ejecutan en el proyecto real.

Recorrido manual con documentos ficticios:

1. Crear un grupo con 2–20 perfiles activos e incorporar explícitamente al emisor.
   Su rol general necesita `documents.create`; el papel de responsable no lo concede.
2. En Notas especiales crear una nota, revisar participantes y guardar el resguardo.
3. Antes de confirmar, comprobar desde otra cuenta que la preparación no aparece.
4. Recargar como creador, reimportar el resguardo y confirmar. Como participante,
   comprobar metadatos y descargar el paquete cifrado.
5. Renombrar el grupo y agregar/retirar integrantes: comprobar que el snapshot no
   cambia y un miembro nuevo no accede a la nota anterior.
6. Importar el resguardo en la sección correspondiente para preparar la recuperación
   portable; recuperar con todos los fragmentos y comprobar los bytes originales.
7. Probar título vacío, archivo grande, grupo con perfil inactivo, grupo modificado
   después de previsualizar, resguardo de otra nota y cancelación de una preparación.

Validación local: 366 pruebas de backend, 12 de frontend y las comprobaciones SQL
más los recorridos de navegador descritos en la entrega. PostgreSQL se probó con
PGlite y contratos locales de Auth/PostgREST/Storage; no se modificó el Supabase
remoto ni se volvió a configurar Google OAuth.
