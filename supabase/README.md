# Acceso de usuarios de Top Secret Communications

Esta carpeta define la base de acceso y su vinculación con Supabase Auth.
La aplicación integra Google, sesión, verificación de JWT en FastAPI y
administración de perfiles. Ver [la guía de integración](../docs/development/authentication.md).
Los módulos AES-GCM y Shamir mantienen sus contratos.

## Archivos

| Archivo | Uso |
| --- | --- |
| `migrations/20261016000000_access_control.sql` | Migración inicial, ejecutar una vez. |
| `scripts/bootstrap_admin.sql` | Autorizar al primer administrador desde SQL Editor. |
| `scripts/check_access_setup.sql` | Comprobaciones de solo lectura. |
| `tests/access_control.sql` | Pruebas transaccionales para una base aislada sin perfiles. |

## 1. Incorporar los archivos al repositorio

Desde la raíz de tu repositorio, en macOS:

```bash
unzip -n "$HOME/Downloads/STC_Supabase_Acceso_v1.zip" -d .
```

El ZIP contiene únicamente esta carpeta `supabase/`. `-n` conserva cualquier
archivo que ya exista en la misma ruta. Si una ruta ya está ocupada, compárala
antes de sustituir nada. La extracción no ejecuta SQL ni modifica Supabase.

## 2. Ejecutar la migración

En terminal, desde la raíz del repositorio:

```bash
pbcopy < supabase/migrations/20261016000000_access_control.sql
```

En el proyecto correcto de Supabase, abre **SQL Editor > New query**, pega el
contenido y ejecútalo con el rol `postgres`. Copia el archivo completo, incluidos
`begin` y `commit`. Supabase puede mostrar una advertencia por las sentencias
`revoke`: estas retiran permisos predeterminados sobre los objetos nuevos de STC.

La migración no borra tablas existentes. Si ya existen tablas con estos nombres,
la transacción falla en vez de reemplazarlas. No vuelvas a ejecutarla después de
un resultado exitoso. Si el editor conserva una transacción abortada, ejecuta
`rollback;` antes de revisar el error y repetir una ejecución que haya fallado.

Se crean cinco tablas: `roles`, `permissions`, `role_permissions`, `profiles`
y `access_audit`, con RLS y permisos explícitos. Las funciones internas viven
en `stc_private`, que debe permanecer fuera de los esquemas expuestos por Data API.

Si más adelante administras esta base mediante Supabase CLI, registra esta
migración como aplicada en el historial remoto antes de un `db push`. Ejecutarla
manualmente desde SQL Editor no actualiza ese historial.

## 3. Dar de alta al primer administrador

```bash
pbcopy < supabase/scripts/bootstrap_admin.sql
```

Pega el contenido en otra consulta del SQL Editor. Cambia **solo los valores de
estas dos declaraciones**, dentro del bloque `declare`:

```sql
admin_email text := 'TU_CORREO_GOOGLE';
admin_name text := 'TU_NOMBRE';
```

Usa el correo exacto con el que iniciarás sesión en Google y tu nombre. Si un
valor contiene una comilla simple, escríbela duplicada dentro del literal SQL.
Conserva la plantilla del repositorio sin tus datos personales.

Ejecuta la consulta como `postgres`. Debe devolver un administrador activo con
estado **pendiente de primer login**. No necesita contraseña de aplicación y
todavía no aparecerá en **Authentication > Users**. En el primer login autorizado,
el trigger vincula el perfil con el ID de Supabase Auth.

El script impide crear otro administrador por esta vía si ya existe uno. No
promueve silenciosamente perfiles existentes. Si había una identidad de Google
con ese correo antes de esta migración, puede vincularla sin crear otra cuenta.

Para preparar otras cuentas antes de tener la interfaz, el responsable del
proyecto puede insertar sus altas desde SQL Editor:

```sql
insert into public.profiles(email, display_name, role_code)
values ('correo-del-integrante@gmail.com', 'Nombre del integrante', 'staff');
```

El correo debe estar en minúsculas y sin espacios. No insertes IDs inventados en
`auth_user_id`. En el uso normal, las altas se harán mediante `authorize_profile`
desde la sesión del administrador.

## 4. Registrar el control de altas

En **Authentication > Auth Hooks**, agrega/activa **Before User Created**:

- Tipo: **Postgres function**.
- Esquema: `public`.
- Función: `stc_before_user_created`.

Guarda la configuración y comprueba que el hook esté habilitado. El evento
**Custom Access Token** es distinto y no se utiliza en esta etapa. La migración
incluye los grants y la política de lectura que necesita `supabase_auth_admin`.

El hook permite únicamente el alta con Google de un perfil activo, preautorizado
y todavía sin identidad vinculada. Para los demás casos devuelve un error 403
genérico. No crea perfiles a partir de datos enviados por el navegador.

El trigger en `auth.users` vuelve a comprobar la autorización al insertar el
usuario. La vinculación ocurre en la misma transacción: si falla, no queda una
cuenta nueva sin perfil autorizado.

## 5. Ajustes de autenticación

Cuando ya estén aplicados la migración, el alta inicial y el hook:

| Ajuste | Valor |
| --- | --- |
| Google | Habilitado, con Client ID/Secret ya configurados. |
| Allow new users to sign up | Habilitado, con el hook registrado. |
| Allow anonymous sign-ins | Deshabilitado. |
| Proveedor Email | Deshabilitado para este flujo de Google. |
| Allow manual linking, si aparece | Deshabilitado. |
| Site URL local | `http://localhost:5173` |
| Redirect URL local | `http://localhost:5173/auth/callback` |

El permiso de crear usuarios debe estar habilitado para que el primer login de
Google pueda crear la identidad. El hook limita esa creación a las altas del
administrador. No habrá formulario público de registro.

La ruta `/auth/callback` está implementada en React. Para probar el login completo,
configura las variables del frontend y backend según la guía de integración.
No se necesita crear manualmente JWT, contraseñas de usuarios ni un JWT Secret.

## 6. Verificar

```bash
pbcopy < supabase/scripts/check_access_setup.sql
```

Ejecuta esa consulta de solo lectura en SQL Editor. Resultados esperados:

- Cuatro roles y seis permisos en el catálogo.
- Las cinco tablas muestran `rls_enabled = true`.
- Tu administrador aparece activo, pendiente de primer login.
- `anon_can_read_profiles`, `client_can_update_profiles` y `anon_can_authorize`
  son `false`; `auth_can_call_hook` es `true`.
- El trigger `stc_auth_user_created` aparece con `tgenabled = O`.

La consulta no comprueba la selección del hook en el Dashboard: revísala también
en **Authentication > Auth Hooks**. El SQL Editor con rol `postgres` puede leer
todas las filas; eso no representa los permisos de un usuario de la aplicación.

## Modelo de permisos

| Capacidad general | admin | ambassador | staff | member |
| --- | --- | --- | --- | --- |
| Gestionar perfiles, rol y estado | Sí | No | No | No |
| Crear documentos | Sí | Sí | Sí | No |
| Leer documentos asignados | Sí | Sí | Sí | Sí |
| Firmar emisión de documentos propios | Sí | Sí | Sí | No |
| Aprobar institucionalmente documentos asignados | No | Sí | No | No |
| Solicitar recuperación de una nota de su grupo | Sí | Sí | Sí | Sí |
| Aportar su fragmento a una sesión de su grupo | Sí | Sí | Sí | Sí |

Cada perfil tiene un rol general. La pertenencia a grupos y la asignación de
documentos son relaciones independientes. Ninguna capacidad general permite
leer todos los documentos o fragmentos. Esta migración implementa la protección
de perfiles; las capacidades documentales son el catálogo que los próximos
endpoints deberán exigir, junto con la asignación al documento o al grupo.

La autorización se resuelve con `auth.uid()` y el estado actual de la BD. No se
aceptan roles provenientes de `user_metadata`, del formulario o de claims de rol
obsoletos. Cambiar o desactivar el perfil afecta inmediatamente a estas políticas
y RPC, incluso si el JWT todavía no venció. Esto no revoca por sí mismo la sesión
de Supabase. La integración de FastAPI aplica además verificación de JWT y consulta de permisos
en cada operación protegida.

Las cuentas existentes sin perfil autorizado no obtienen acceso a estas tablas.
Para retirar acceso se desactiva el perfil, conservando su registro y auditoría.
Un administrador pendiente de primer login no cuenta como sustituto del último
administrador activo vinculado. Los cambios administrativos se serializan con un
lock transaccional para comprobar esa condición sin carreras entre dos cambios.

## Contratos para la integración

Las tres RPC públicas siguientes se llaman con el JWT de usuario mediante el
cliente Supabase. No requieren poner una clave secret/service_role en React.

| RPC | Resultado |
| --- | --- |
| `current_access()` | `{profile, permissions}` del usuario activo. |
| `authorize_profile(p_email, p_display_name, p_role_code)` | UUID del nuevo perfil pendiente. Solo admin. |
| `update_profile(p_profile_id, p_display_name, p_role_code, p_is_active)` | Actualiza nombre, rol y estado. Solo admin. |

`update_profile` no permite cambiar el correo ni reasignar la identidad. La
aplicación no puede escribir directamente las tablas, incluso siendo admin:
debe usar estas RPC. El catálogo de roles y permisos se modifica mediante futuras
migraciones revisables. Las altas, cambios y vinculaciones se registran en
`access_audit`, de lectura exclusiva para administradores.

No llames las RPC de gestión desde SQL Editor esperando que `postgres` equivalga
a tu sesión de Google: no hay un JWT de usuario en ese contexto y se rechazan.

## Pruebas

`tests/access_control.sql` contiene 47 comprobaciones y termina con `rollback`.
Exige una instancia Supabase de prueba sin perfiles, con la migración aplicada;
rechaza ejecutarse sobre una base que ya tenga perfiles. No ejecutar como parte
de la configuración del proyecto real.

Con una conexión `psql` a esa base aislada:

```bash
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_control.sql
```

Se comprobaron RLS, usuarios anónimos, altas no autorizadas, proveedor Google,
vinculación, metadatos manipulados, escritura directa, cambios de rol, perfiles
desactivados, auditoría y conservación del último administrador. También se probó
el bootstrap con valores pendientes de sustituir, el alta inicial y la repetición.

Validación local realizada con PostgreSQL 18.6 embebido mediante PGlite, recreando
los roles de Supabase y el contrato de `auth.uid()`/`auth.users`. No se ejecutó
contra el proyecto remoto ni contra Google OAuth. La integración de FastAPI/React tiene sus pruebas propias; el login de Google real
se verifica al configurar las variables del proyecto.

## Estado de integración

Google/PKCE, sesión, verificación de JWT, permisos y administración están
implementados. Las comprobaciones y comandos se describen en la
[guía de autenticación](../docs/development/authentication.md).

La migración `20261019000000_groups.sql` añade grupos, integrantes, responsables,
archivo, control de concurrencia y auditoría. Ejecutarla una sola vez después de
la migración de acceso; la [guía de grupos](../docs/development/groups.md) describe
su configuración, permisos y pruebas.

La migración `20261019100000_memoranda_signatures.sql` integra memorándums, destinatarios individuales, claves públicas, versiones, firmas y auditoría; crea el bucket privado `stc-documents`. Aplicarla una sola vez después de acceso y grupos. Necesita `SUPABASE_SECRET_KEY` solo en el backend para RPC de escritura confiables y Storage, nunca en React. Las lecturas conservan el JWT y RLS. Consulta [instalación y permisos RSA-PSS](../docs/development/memoranda-signatures.md).

La migración `20261021000000_document_delivery.sql` añade borrador privado, firma del emisor, aprobación opcional del Embajador y envío explícito. Solo se habilita el acceso a destinatarios finales al confirmar el envío. Conserva documentos anteriores como historial del flujo previo, sin inventar firmas ni fechas. Aplicarla una sola vez después de memorándums; no repetir las anteriores.

La migración `20261022000000_group_notes_storage.sql` añade notas especiales de grupo, participantes originales inmutables, auditoría y confirmación de resguardo. Reutiliza el bucket privado `stc-documents`: no crear otro ni volverlo público. Ejecutarla una sola vez después de las cuatro anteriores. No almacena el original, claves AES ni fragmentos. Consulta [instalación y alcance de notas de grupo](../docs/development/group-notes-storage.md).

La migración de custodia individual siguiente incorpora RSA-OAEP y sobres por destinatario. La migración de recuperación colaborativa incorpora solicitudes, aportaciones protegidas y progreso con Realtime. Los memorándums no exigen grupos.

## Referencias

- [Supabase: Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- [Supabase: Auth Hooks y permisos](https://supabase.com/docs/guides/auth/auth-hooks)
- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: datos de usuario y triggers](https://supabase.com/docs/guides/auth/managing-user-data)

## Custodia individual de fragmentos

Después de las cinco migraciones anteriores, ejecutar una sola vez
`migrations/20261025000000_recipient_share_custody.sql`. Añade públicas de cifrado,
auditoría y sobres individuales con RLS. No modifica los datos de notas portables,
no crea otro bucket ni requiere secretos nuevos. Los archivos en `tests/` son solo
para una BD local vacía; nunca ejecutarlos sobre el proyecto real.

## Recuperación colaborativa de notas

Ejecutar una sola vez `migrations/20261026000000_collaborative_note_recovery.sql`
después de las seis anteriores. Añade solicitudes, progreso y auditoría con RLS;
las aportaciones cifradas viven en `stc_private` sin acceso directo de clientes.
Solo los metadatos de solicitudes se agregan a `supabase_realtime`. FastAPI limpia
material vencido cada minuto mientras está en ejecución. No exige nuevos secretos,
buckets ni extensiones. Consulta la guía de recuperación para estados y reintentos.

## Notificaciones generales y recorrido simplificado

Centro de avisos persistentes por destinatario, enlaces directos a las operaciones,
recuperación con fragmentos cifrados de la base de datos y verificación de firmas
antes de descargar. Conserva las claves y documentos existentes.

Guía: [Notificaciones y flujo](../docs/development/notifications-and-workflow.md).

Migración nueva: `20261026120000_notifications.sql`, después de las siete anteriores.
Ejecutar una sola vez como postgres; no repetir migraciones ni ejecutar fixtures remotos.

## Dashboard y avisos específicos

Resumen autorizado de documentos/notas, tareas propias y contexto histórico de
notificaciones. Los selectores de claves conservan el nombre del archivo válido.
Guía: [Dashboard y contexto](../docs/development/dashboard-and-notification-context.md).

Migración nueva: `20261026180000_dashboard_notification_context.sql`, después de las ocho anteriores.
