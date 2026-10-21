# Grupos e integrantes

## Configuración

Esta etapa parte de `develop` en `ed5574f` (incluye el PR #11). Conserva las
primitivas AES-GCM, Shamir, RSA-OAEP y RSA-PSS, la sesión Google y los perfiles.
No requiere dependencias ni variables de entorno nuevas.

1. Aplicar los archivos del paquete sobre una rama nueva basada en `develop`.
2. En el mismo proyecto de Supabase, abrir **SQL Editor → New query** y ejecutar
   completo `supabase/migrations/20261019000000_groups.sql` con el rol `postgres`.
   Requiere la migración de acceso del 16 de octubre ya instalada. No volver a
   ejecutar esa migración anterior ni el bootstrap del administrador.
3. Reiniciar FastAPI y Vite. Recargar la página o volver a iniciar sesión para
   consultar los permisos nuevos. Los JWT no necesitan claims nuevos.
4. Entrar como administrador y abrir **Grupos e integrantes** (`/grupos`). Crear
   el primer grupo con al menos dos perfiles activos y un responsable.

La migración es transaccional y se aplica una sola vez. No elimina datos ni
modifica los usuarios, los roles generales existentes o las claves criptográficas.
El editor SQL no registra automáticamente una migración como aplicada en la
historia del CLI: si después se adopta Supabase CLI, reconciliar esa historia
antes de ejecutar `db push`. No mezclar ambos métodos de despliegue sin revisarla.

No hay que crear buckets, activar Realtime ni modificar Google OAuth, el hook de
Auth, sus URLs de retorno o los `.env`. No se utiliza `service_role` en la app.

## Reglas

| Acción | Administrador (`groups.manage`) | Responsable del grupo | Integrante |
| --- | --- | --- | --- |
| Crear grupos | Sí | No | No |
| Consultar metadatos y participantes | Todos los grupos | Sus grupos | Sus grupos |
| Editar nombre y propósito | Sí | Si el grupo está activo | No |
| Agregar, retirar o cambiar el papel de una persona | Si está activo | Si está activo | No |
| Archivar y reactivar | Sí | No | No |
| Consultar candidatos activos | Sí para crear o gestionar grupos activos | Solo para gestionar su grupo activo | No |
| Obtener documentos o fragmentos por estas operaciones | No | No | No |

`groups.read` se asigna a los cuatro roles generales. `groups.manage`, únicamente
a `admin`. Dentro de cada grupo existen `manager` (Responsable) y `member`
(Integrante). Ese papel no cambia el rol general ni concede `documents.sign` o
`documents.create`. Un administrador no se incorpora al grupo automáticamente.

La creación exige entre 2 y 255 perfiles distintos y activos, incluyendo al menos
un responsable activo. Un perfil autorizado pendiente de primer login puede ser
integrante o responsable; solo podrá operar cuando vincule su cuenta Google.
Las bajas/cambios no permiten dejar menos de dos integrantes ni perder el último
responsable activo. Se pueden designar varios responsables; para transferir la
responsabilidad, promover primero a otro integrante y después degradar o retirar
al anterior. Los responsables pueden incorporar nuevos responsables.

La desactivación global de un perfil revoca su acceso inmediatamente, conservando
su membresía e historial. La pantalla distingue activos de integrantes totales.
Puede dejar a un grupo sin responsable activo: un administrador debe asignar uno
desde el grupo activo antes de continuar su gestión. No se altera el comportamiento
existente de las bajas de perfiles para impedir la revocación urgente de acceso.

Archivar conserva integrantes e historial y bloquea cambios de membresía incluso
para administradores. Un administrador puede reactivarlo si conserva al menos dos
integrantes y un responsable activo. No hay borrado permanente desde la aplicación.

## Base de datos y seguridad

- `stc_groups`: nombre, descripción, estado, creador y versión.
- `stc_group_members`: relación perfil/grupo, papel, fecha de incorporación y baja
  lógica (`removed_at`). Reincorporar no duplica la relación; la auditoría conserva
  las operaciones anteriores.
- `stc_group_audit`: actor, acción, detalles y fecha. Sin claves ni fragmentos.

Las tres tablas tienen RLS. Se revocan escrituras directas, también al
administrador de la aplicación. Solo se permite lectura del alcance autorizado.
Las RPC verifican de nuevo al usuario activo mediante `auth.uid()` y los permisos
actuales en BD. Los clientes no envían identidad del actor ni permisos.

El directorio de candidatos devuelve solo los datos necesarios de perfiles activos
(nombre, correo, rol general y si ya ingresaron). No abre lectura general de
`profiles` a los responsables ni devuelve `auth_user_id`. Los miembros sí pueden
consultar el nombre, correo y rol de las personas de su propio grupo.

La auditoría puede consultarse con RLS por administración o por responsables de
grupos activos; no hay editor de auditoría. Los usuarios ajenos reciben el mismo
404 para un grupo inexistente y para uno fuera de su alcance.

Todas las mutaciones de grupos comparten el lock transaccional de administración
de perfiles y bloquean la fila del grupo. Exigen `expected_version`, incrementan
`version` y registran la auditoría en la misma transacción. Una edición obsoleta
devuelve 409: actualizar y revisar antes de repetir. Esta serialización es una
elección conservadora para el volumen del proyecto y coordina las bajas globales
con la comprobación de perfiles activos.

Las funciones `security definer` usan `search_path = ''`, objetos calificados y
grants explícitos. Los helpers internos de escritura no son invocables por clientes.
Las búsquedas son literales y paginadas, sin expresiones PostgREST construidas con
texto del usuario. Las respuestas HTTP privadas usan `no-store`.

## Backend y frontend

El backend añade `app/modules/groups/{schemas,service,router}.py`. Reutiliza
`Principal`, la verificación de sesión, los permisos y `SupabaseGateway` existentes.
Sus rutas se registran siempre; no dependen de `STC_ENABLE_LOCAL_WORKFLOW`.

| Endpoint | Operación |
| --- | --- |
| `GET /api/v1/groups` | Lista por nombre y estado, con paginación y alcance actual. |
| `GET /api/v1/groups/candidates` | Candidatos para crear o gestionar (`group_id` opcional). |
| `POST /api/v1/groups` | Creación atómica, incluidos los integrantes. |
| `GET /api/v1/groups/{id}` | Metadatos y miembros actuales, con capacidades calculadas. |
| `PATCH /api/v1/groups/{id}` | Nombre, descripción y estado, con versión. |
| `PUT /api/v1/groups/{id}/members` | Alta, reincorporación o cambio de papel, con versión. |
| `DELETE /api/v1/groups/{id}/members/{profile_id}?expected_version=N` | Baja lógica con versión. |

Las RPC respectivas son `list_stc_groups`, `list_group_candidates`,
`create_stc_group`, `get_stc_group`, `update_stc_group`, `set_stc_group_member` y
`remove_stc_group_member`. Las mutaciones devuelven 204 salvo creación (201 + UUID).

El frontend separa contratos/API en `features/groups/groups.ts`, formularios y
componentes compartidos en `GroupComponents.tsx`, la pantalla en
`pages/Groups/GroupsPage.tsx` y su estilo en `groups.css`. Reutiliza componentes,
tipografía, colores, iconos, modal, sesión y cliente HTTP del proyecto.
Incluye búsqueda, filtros, paginación, detalle, altas, edición, archivo/reactivación,
confirmación de bajas, estados vacíos y mensajes de errores/concurrencia. Hay botón
de actualización; los cambios de otra sesión se consultan al actualizar. No usa
todavía eventos de Realtime.

## Validación

Desde `backend/`, con el entorno virtual y las dependencias actuales:

```bash
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m mypy
```

Desde `frontend/`:

```bash
npm run lint
npm run build
```

Las pruebas HTTP usan transporte Supabase controlado, sin credenciales reales y
sin sustituir las dependencias de autenticación. Las pruebas SQL van **únicamente
en una base aislada sin perfiles reales**, con ambas migraciones aplicadas:

```bash
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_control.sql
psql "$STC_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/groups.sql
```

Ambos archivos comprueban que la base esté vacía y terminan en `rollback`.
`access_control.sql` conserva 47 comprobaciones de acceso; `groups.sql` añade 58.
El test anterior ahora cuenta sus seis permisos originales explícitamente para
seguir siendo válido cuando futuras migraciones amplíen el catálogo.

## Qué sigue

Este bloque termina la organización real de grupos, no la distribución documental.
El flujo portable actual de notas especiales sigue funcionando como antes y no
representa todavía un documento persistido asignado a un grupo.

Para notas colaborativas, el documento deberá congelar sus participantes originales,
exigir perfiles activos/vinculados y claves disponibles, guardar el cifrado en
Storage privado y entregar cada fragmento a su destinatario. La recuperación tendrá
solicitudes y aportaciones propias. Cambiar un grupo no deberá cambiar documentos
anteriores. **No reutilizar `can_view_group` como permiso de lectura documental**:
su alcance administrativo solo autoriza metadatos de organización.

La sección 2 de RSA-PSS ya está integrada para memorándums con destinatarios individuales; no exige grupos. La [guía de memorándums](memoranda-signatures.md) describe claves Base64 por usuario, firmas asociadas, permisos y pruebas. Ser responsable de grupo sigue sin conceder `documents.sign`.

Referencias: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
y [funciones](https://supabase.com/docs/guides/database/functions) de Supabase.
