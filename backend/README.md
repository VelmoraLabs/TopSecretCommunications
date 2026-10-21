# Backend de Top Secret Communications

FastAPI coordina el acceso y los flujos documentales. AES-256-GCM y Shamir están
implementados en módulos independientes de la API y de Supabase.

## Preparación

Desde la raíz del repositorio, con Python 3.14:

```bash
python3.14 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
cp -n backend/.env.example backend/.env
```

Si el entorno ya existe, actívalo y actualiza las dependencias. En Windows se
puede usar `py -3.14` y `.\backend\.venv\Scripts\Activate.ps1`.

Configura `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y
`STC_ENABLE_LOCAL_WORKFLOW=1` en `backend/.env`. La base debe tener aplicada la
[migración de acceso](../supabase/README.md). No se usa una secret/service_role key
ni se comparte el JWT Secret. La [guía de integración](../docs/development/authentication.md)
describe los pasos de Google, las variables y la verificación.

## Ejecutar

Desde la raíz y con el entorno activo:

```bash
python -m uvicorn app.main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000 --reload
```

- Salud: `http://127.0.0.1:8000/health`.
- OpenAPI: `http://127.0.0.1:8000/docs`.
- `GET /health` es público y devuelve `{"status":"ok"}`.
- Las rutas `/api/v1/auth`, `/api/v1/admin` y las operaciones documentales exigen
  un access token de usuario de Supabase.
- El flag documental controla el registro de rutas, no desactiva su autenticación.

## Rutas y permisos

| Ruta | Permiso |
| --- | --- |
| `GET /api/v1/auth/me` | Perfil activo vinculado al usuario. |
| `GET /api/v1/admin/profiles` | `profiles.manage`. |
| `GET /api/v1/admin/roles` | `profiles.manage`. |
| `POST /api/v1/admin/profiles` | `profiles.manage`. |
| `PATCH /api/v1/admin/profiles/{id}` | `profiles.manage`. |
| `POST /api/v1/documents/special-notes/protect` | `documents.create`. |
| `POST /api/v1/documents/special-notes/recover` | `recovery.request`. |

El backend verifica el token con `GET /auth/v1/user` del proyecto y consulta
`current_access()` por PostgREST con ese JWT. Los cambios de perfil tienen efecto
sin depender de claims de rol guardados en el cliente. Se rechazan sesiones
anónimas, perfiles desactivados y permisos insuficientes. Un fallo de Supabase
produce `503`; no se permite continuar sin autorización.

Las altas y actualizaciones usan las RPC de la migración para conservar RLS,
auditoría y la protección del último administrador. Los errores HTTP contienen
`detail.code` y `detail.message`; no incluyen tokens ni detalles internos de la BD.

## Organización

| Ruta | Responsabilidad |
| --- | --- |
| `app/crypto/encryption/` | Clave AES-256, nonce, GCM, tag y autenticación. |
| `app/crypto/shamir/` | División, reconstrucción y serialización de la clave. |
| `app/modules/documents/` | Contratos y coordinación del flujo portable. |
| `app/modules/auth/` | Sesión, permisos y administración de perfiles. |
| `app/infrastructure/supabase.py` | HTTP hacia Auth/PostgREST con identidad de usuario. |
| `app/core/config.py` | Configuración de conexión validada. |
| `app/core/errors.py` | Errores públicos de servicio. |
| `app/core/request_limits.py` | Límite del cuerpo antes de procesar archivos. |

El motor criptográfico no importa FastAPI ni consulta usuarios. Los perfiles se
persisten en Supabase, pero los documentos y fragmentos siguen en formato portable:
aún no se asignan a cuentas distintas ni se guardan en Storage.

## Pruebas y calidad

Desde `backend/`, con el entorno activo:

```bash
python -m pip check
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m mypy app
```

Las pruebas no necesitan credenciales reales. Las de autenticación usan transporte
HTTP controlado para comprobar rechazos, permisos, RPC y respuestas del proveedor.
Las del flujo documental aíslan esa dependencia; las del motor conservan sus
validaciones matemáticas y criptográficas.

## Demos criptográficas

Desde `backend/`:

```bash
python -m demos.shamir_demo
python -m demos.special_notes_demo
```

Estas demos funcionan sin Supabase y no son una ruta alternativa para autenticar
usuarios de la aplicación.

## Documentación

- [Shamir](../docs/crypto/shamir.md).
- [AES-256-GCM](../docs/crypto/aes-gcm.md).
- [Contrato documental](../docs/development/special-notes-backend.md).
- [Sesión y administración](../docs/development/authentication.md).
- [Organización del backend](../docs/development/backend-architecture.md).
- [Grupos, integrantes y permisos por grupo](../docs/development/groups.md).

## Memorándums y RSA-PSS

El flujo real está en `app/modules/memoranda/`; reutiliza `app/crypto/signatures/` sin modificar RSA-PSS. Consulta [configuración, endpoints y prueba completa](../docs/development/memoranda-signatures.md). Requiere la nueva migración y `SUPABASE_SECRET_KEY` solo en el backend. No hay nuevas dependencias.
