# Autenticación, sesión y administración de perfiles

La aplicación utiliza Google mediante Supabase Auth, autorización vigente en
PostgreSQL y verificación del token en FastAPI. AES-GCM y Shamir siguen siendo
módulos independientes de HTTP y de usuarios.

## Requisito de base de datos

Aplicar primero `supabase/migrations/20261016000000_access_control.sql`, autorizar
al primer administrador y registrar `public.stc_before_user_created` como hook
**Before User Created**, siguiendo [la guía de Supabase](../../supabase/README.md).
Si ya completaste esos pasos, no vuelvas a ejecutar la migración ni el bootstrap.
Esta integración utiliza los mismos contratos; no añade otra migración.

Google debe estar habilitado y Email/Anonymous deshabilitados. **Allow new users
to sign up** debe estar habilitado una vez registrado el hook: la creación de la
identidad queda limitada a perfiles activos previamente autorizados.

## Aplicar la entrega incremental

La entrega parte de los ZIP de backend AES/Shamir, frontend de notas especiales
y base de acceso de Supabase ya aplicados. No aplicar sobre el frontend inicial
sin esas entregas. Desde la raíz del repositorio:

```bash
unzip -n "$HOME/Downloads/STC_Auth_Google_Admin_v1.zip" -d "$HOME/Downloads/STC_Auth_Google_Admin_v1"
git apply --check "$HOME/Downloads/STC_Auth_Google_Admin_v1/auth-google-admin.patch"
git apply "$HOME/Downloads/STC_Auth_Google_Admin_v1/auth-google-admin.patch"
```

El ZIP incluye una copia de los archivos modificados dentro de `files/` para
revisión. El parche conserva los cambios de las entregas anteriores. Si `--check`
reporta un conflicto, no uses opciones para forzar, sobrescribir o descartar
archivos; revisa las diferencias. No ejecutes de nuevo el parche tras aplicarlo.

## Variables de entorno

Se necesitan dos archivos, cada uno en la carpeta de su componente. Desde la raíz:

```bash
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
```

`cp -n` conserva cualquier configuración existente. Edita ambos archivos con el
editor que prefieras y coloca los valores reales del mismo proyecto:

`backend/.env`:

```dotenv
SUPABASE_URL=https://TU_REFERENCIA.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
STC_ENABLE_LOCAL_WORKFLOW=1
```

`frontend/.env.local`:

```dotenv
VITE_SUPABASE_URL=https://TU_REFERENCIA.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
```

La **Publishable key** se obtiene en Connect o Project Settings > API Keys. No es
el Client ID de Google, ni su Client Secret, ni una secret/service_role key, ni
una contraseña de PostgreSQL. El backend y el frontend rechazan claves de otro
tipo. El secreto OAuth de Google permanece exclusivamente en Supabase.

Los archivos `.env` y `.env.local` están ignorados por Git; las plantillas
`.env.example` sí se versionan. Vite incorpora variables `VITE_` en el JavaScript
del navegador, por lo que ninguna de ellas puede contener secretos.

## Instalar y ejecutar

Desde la raíz y con el entorno virtual de backend activo:

```bash
python -m pip install -r backend/requirements-dev.txt
python -m pip check
cd frontend
npm ci
cd ..
```

Se añade el SDK de Supabase al frontend y `httpx`/`python-dotenv` como dependencias
de ejecución del backend. No hace falta recrear tu entorno virtual.

Primera terminal, desde la raíz y con ese entorno activo:

```bash
python -m uvicorn app.main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000 --reload
```

Segunda terminal, desde la raíz:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Abrir **http://localhost:5173/login**. Utilizar `localhost` coincide con las URLs
configuradas en Google y Supabase. Entrar por `127.0.0.1` es un origen diferente;
requiere registrar ese origen y su callback de forma adicional si se quiere usar.

En Supabase, Site URL es `http://localhost:5173` y Redirect URLs incluye
`http://localhost:5173/auth/callback`. En Google, Authorized JavaScript origins
incluye `http://localhost:5173` y Authorized redirect URIs contiene la URL HTTPS
de Supabase que termina en `/auth/v1/callback`. No intercambiar ambos callbacks.
Tras editar variables, reiniciar los dos servicios.

## Flujo de sesión

1. La ruta interna redirige al login si no hay sesión.
2. “Continuar con Google” inicia OAuth con PKCE y recuerda una ruta interna válida.
3. Google retorna a Supabase; este valida la identidad y ejecuta el control de alta.
4. La aplicación recibe un código en `/auth/callback` y lo intercambia con el
   verificador PKCE. El canje se deduplica para React StrictMode.
5. El callback retira los parámetros de la URL y consulta `/api/v1/auth/me`.
6. FastAPI verifica el token con Supabase Auth y consulta los permisos vigentes.
7. Solo después de esa comprobación se muestra el espacio de trabajo.

El SDK conserva la sesión en su almacenamiento local del navegador y renueva
los access tokens con el refresh token. No implementamos un segundo sistema de
tokens ni guardamos una copia propia de ellos. Las aportaciones, el archivo
recuperado y los resultados criptográficos siguen únicamente en memoria.

El estado de autenticación responde a inicio, renovación y cierre de sesión,
incluidos los eventos entre pestañas del SDK. Los permisos se vuelven a consultar
al recuperar el foco, cada 60 segundos mientras la página es visible y después
de editar el propio perfil. FastAPI los verifica en **cada operación protegida**;
la actualización visual periódica no es el control de seguridad.

“Cerrar sesión” utiliza el alcance local del SDK: cierra esta sesión del
navegador sin cerrar las demás sesiones del usuario. Las rutas internas se
desmontan y los resultados en memoria desaparecen. Si Supabase no permite
completar el cierre por un error de conexión, la interfaz informa el fallo para
reintentar. Un access token copiado previamente puede seguir siendo válido hasta
su vencimiento según las reglas de Supabase; el logout no promete invalidación
criptográfica instantánea de todas sus copias.

## Verificación de JWT en FastAPI

La petición usa `Authorization: Bearer <access_token>`. El backend envía ese token
al endpoint HTTPS `/auth/v1/user` del proyecto, con su Publishable key. Supabase
Auth verifica el JWT; el backend no acepta simplemente un payload decodificado.
Esto funciona tanto con firmas asimétricas como con proyectos que aún usan HS256
y no requiere compartir claves privadas ni el JWT Secret con la aplicación.

Después se ejecuta `current_access()` por PostgREST con **el mismo JWT**. El ID de
Auth debe coincidir con el perfil activo y el proveedor debe ser Google. No se
confía en roles enviados por React ni en `user_metadata` o claims de rol antiguos.

Las llamadas a Supabase están centralizadas en `infrastructure/supabase.py`, con
timeout, cierre del cliente HTTP y rechazo de redirecciones. Los fallos de red o
de Supabase devuelven `503` y bloquean el acceso; no activan un modo sin permisos.
El costo es una verificación de Auth y una consulta de permisos por operación.
No se almacenan permisos en una caché que retrase la desactivación de perfiles.

## Contratos HTTP

| Método y ruta | Permiso y respuesta |
| --- | --- |
| `GET /health` | Público; conserva `{status: "ok"}`. |
| `GET /api/v1/auth/me` | Perfil activo; `{profile, permissions}`. |
| `GET /api/v1/admin/profiles` | `profiles.manage`; listado paginado. |
| `GET /api/v1/admin/roles` | `profiles.manage`; catálogo con permisos por rol. |
| `POST /api/v1/admin/profiles` | `profiles.manage`; alta con `201` y `{id}`. |
| `PATCH /api/v1/admin/profiles/{id}` | `profiles.manage`; actualización con `204`. |
| `POST /api/v1/documents/special-notes/protect` | `documents.create`. |
| `POST /api/v1/documents/special-notes/recover` | `recovery.request`. |

El listado admite `email` (búsqueda parcial, máximo 80 caracteres), `active`
(booleano opcional), `limit` (1–100, por defecto 20) y `offset` (desde 0). Devuelve
`{items, total, limit, offset}`. El frontend pagina de 20 en 20.

El alta recibe `{email, display_name, role_code}`. La actualización recibe
`{display_name, role_code, is_active}`. No admite cambiar el correo, el ID de Auth
ni propiedades adicionales. Las escrituras llaman las RPC existentes: no se
realizan con una cuenta administrativa que eluda las políticas de la BD.

Errores: `401` sesión ausente/inválida, `403` acceso denegado, `409` correo
duplicado o último administrador, `422` entrada inválida y `503` proveedor o
configuración no disponibles. El formato es `{detail: {code, message}}`.
No se devuelven detalles internos de PostgreSQL ni tokens en los mensajes.

Las respuestas `/api/`, incluidos sus errores, utilizan `Cache-Control: no-store`.
La documentación OpenAPI describe el encabezado Bearer. Swagger no genera el
login de Google: su botón Authorize necesita un access token de usuario válido.

## Administración

La ruta `/administracion` muestra perfiles reales, búsqueda por correo, estados,
paginación, alta de cuentas y edición de nombre/rol/estado. El catálogo de permisos
proviene de la base de datos; no es una lista de usuarios de ejemplo.

La navegación administrativa requiere `profiles.manage`. Escribir directamente
la URL o enviar una petición manual no elude las comprobaciones del backend y la
BD. Cada cambio usa la auditoría y la protección del último administrador activo
vinculado definidas en la migración inicial.

Un perfil nuevo aparece pendiente de primer acceso. Si Google está en modo de
prueba, su cuenta debe estar permitida también por la configuración Audience de
Google. Al entrar se vincula al perfil que autorizó el administrador.

## Alcance documental

Dashboard y Documentos conservan contenido ficticio marcado como ejemplo.
Notas especiales procesa archivos reales y ahora exige sesión y permisos.
Se conserva el formato portable v1, la política n de n y la descarga individual
de fragmentos desde la cuenta que ejecuta la protección.

Todavía no se asigna cada fragmento a un destinatario distinto, no se guardan
documentos en Storage ni se coordinan recuperaciones entre cuentas. Un usuario
autorizado que tenga el paquete y todos los fragmentos puede recuperarlo en este
flujo portable. Las capacidades generales no sustituyen las futuras relaciones
de grupos y documentos. No presentar esta entrega como distribución colaborativa
ya completada ni como cifrado de extremo a extremo frente al backend.

El flag `STC_ENABLE_LOCAL_WORKFLOW` sigue controlando si se registran las rutas
portables, pero nunca elimina sus requisitos de sesión o permisos. Las funciones
criptográficas y las demos por terminal continúan funcionando sin Supabase.

## Comprobación local y prueba con el proyecto real

```bash
cd backend
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m mypy app
cd ../frontend
npm run lint
npm run build
```

Verificación de esta entrega: **160 pruebas de backend correctas**, Ruff, mypy,
lint y build del frontend, además de **25 comprobaciones de navegador**. El
backend se ejecutó aquí con Python 3.12; el repositorio conserva su objetivo
Python 3.14. La prueba de navegador usa el SDK real, FastAPI y PostgreSQL 18
embebido con un proveedor OAuth controlado.

Se mantienen las pruebas criptográficas previas. Las pruebas de documentos
sobreescriben la dependencia de identidad solo dentro de su fixture para aislar
el motor. `tests/auth/test_access.py` prueba la API sin ese override, con respuestas
controladas de Supabase: autorización, rechazos, RPC, validación y errores.

Las comprobaciones incluyen PKCE, recarga, renovación, sesión entre pestañas,
logout, rechazo de JWT manipulado, desactivación con JWT vigente, último admin,
fallos del proveedor y recuperación de bytes mediante AES-GCM/Shamir. La interfaz
se revisó a 1440, 768, 390 y 320 píxeles. Estas pruebas no sustituyen el login con
Google real en tu proyecto, que requiere tus variables de entorno.

Después de configurar las variables:

1. Entrar con tu Google autorizado: comprobar nombre, rol y administración.
2. Recargar la página y abrir otra pestaña: comprobar la sesión.
3. Autorizar a un compañero y entrar desde otro perfil de navegador.
4. Verificar que un miembro no pueda administrar ni crear documentos.
5. Cambiar su rol/desactivar su perfil y comprobar el rechazo en otra operación.
6. Intentar desactivar al último administrador: debe rechazarse.
7. Cifrar y recuperar un archivo; comprobar que el contenido se conserva.
8. Cerrar sesión y comprobar que volver a una URL interna lleva al login.

Para cuentas distintas usar perfiles de navegador diferentes o ventanas privadas
separadas. Las pestañas del mismo perfil comparten la sesión de Supabase.

## Referencias

- [Supabase: identidad verificada por Auth](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase: flujo PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase: JWT y validación con Auth](https://supabase.com/docs/guides/auth/jwts)
- [Supabase: OAuth con Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase: sesiones](https://supabase.com/docs/guides/auth/sessions)
- [Supabase: exchangeCodeForSession](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession)
- [Supabase: onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase: signOut](https://supabase.com/docs/reference/javascript/auth-signout)
