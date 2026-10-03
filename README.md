# Top Secret Communications

Aplicación web para proteger, firmar y controlar el acceso a documentos de una oficina diplomática.

Proyecto académico de Criptografía — Ingeniería en Sistemas Computacionales, ESCOM, Instituto Politécnico Nacional.

Organización: **VelmoraLabs**.

## Objetivo del proyecto

Implementar un sistema de gestión documental que combine cifrado, firmas digitales y control de acceso. El tratamiento de cada documento dependerá de su categoría y de los permisos de los usuarios.

El proyecto contempla cuatro flujos:

| Tipo de documento | Protección prevista |
| --- | --- |
| Memorándum | Firma digital con RSA-PSS y SHA-256. |
| Expediente de personal | Cifrado AES-256-GCM y distribución de la clave mediante RSA-OAEP. |
| Nota diplomática o comunicado | Firma digital, cifrado y distribución de la clave a los destinatarios. |
| Nota diplomática especial | Cifrado AES-256-GCM y acceso conjunto mediante Shamir's Secret Sharing. |

## Estado actual

La base de desarrollo incluye:

- Backend FastAPI con endpoint `/health`.
- Prueba automatizada del endpoint de salud.
- Verificación de código Python con Ruff y mypy.
- Frontend inicial con React, TypeScript y Vite.
- Tailwind CSS integrado.
- GitHub Actions para comprobar backend y frontend.
- Flujo de Pull Requests hacia ramas protegidas.

Pendiente de implementar:

- Algoritmos y servicios criptográficos.
- Autenticación e integración con Supabase.
- Roles, permisos y gestión de documentos.
- Interfaz funcional y comunicación entre frontend y backend.
- Despliegue.

La interfaz actual corresponde a la plantilla inicial de Vite. Las comprobaciones de CI validan la base del proyecto; todavía no verifican los flujos documentales completos.

## Tecnologías

| Capa | Tecnologías |
| --- | --- |
| Frontend | React, TypeScript, Vite y Tailwind CSS. |
| Backend | Python y FastAPI. |
| Criptografía | Biblioteca `cryptography` e implementación propia de Shamir. |
| Autenticación prevista | Supabase Auth. |
| Base de datos prevista | PostgreSQL en Supabase. |
| Almacenamiento previsto | Supabase Storage. |
| Pruebas del backend | pytest y cliente de pruebas de FastAPI. |
| Calidad del backend | Ruff y mypy. |
| Calidad del frontend | ESLint, TypeScript y compilación con Vite. |
| Integración continua | GitHub Actions. |

## Arquitectura prevista

El frontend presenta las operaciones disponibles y envía solicitudes al backend.

El backend valida la identidad, los permisos y los datos recibidos. Después selecciona el flujo documental y utiliza el motor criptográfico para firmar, verificar, cifrar o descifrar.

Supabase proporcionará autenticación, almacenamiento y persistencia de los datos necesarios. El material privado de los usuarios y los fragmentos de Shamir tendrán un tratamiento específico conforme a la arquitectura del proyecto.

## Organización actual del código

| Ruta | Propósito |
| --- | --- |
| `backend/app/main.py` | Entrada de la API FastAPI y endpoint de salud. |
| `backend/app/crypto/` | Base para los módulos criptográficos. |
| `backend/tests/` | Pruebas automatizadas del backend. |
| `backend/pyproject.toml` | Configuración de pytest, Ruff y mypy. |
| `backend/requirements.in` | Dependencias directas del backend. |
| `backend/requirements-dev.in` | Dependencias directas de desarrollo. |
| `backend/requirements-dev.txt` | Versiones fijadas para instalar el entorno de desarrollo y CI. |
| `frontend/src/` | Código React y estilos. |
| `frontend/public/` | Recursos públicos del frontend. |
| `frontend/package.json` | Dependencias y scripts del frontend. |
| `frontend/package-lock.json` | Versiones de las dependencias npm. |
| `.github/workflows/ci-backend.yml` | Comprobaciones automáticas del backend. |
| `.github/workflows/ci-frontend.yml` | Comprobaciones automáticas del frontend. |
| `.github/pull_request_template.md` | Guía para describir los Pull Requests. |

## Requisitos de desarrollo

- Git.
- Python 3.14.5, utilizado por el CI del backend.
- Node.js 24, utilizado por el CI del frontend.
- npm.
- Un editor de código, por ejemplo VS Code.

Para reducir diferencias entre equipos, utilizar las versiones de Python y Node.js empleadas por CI.

Actualmente, ejecutar la base del proyecto no requiere credenciales de Supabase.

## Clonar el repositorio

```bash
git clone https://github.com/VelmoraLabs/TopSecretCommunications.git
cd TopSecretCommunications
git switch develop
git pull --ff-only origin develop
```

## Configurar el backend

Ejecutar desde la raíz del repositorio.

### macOS o Linux

```bash
python3.14 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
python -m pip check
```

### Windows — PowerShell

```powershell
py -3.14 -m venv backend/.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
python -m pip check
```

### Iniciar la API

Con el entorno virtual activo y desde la raíz:

```bash
python -m uvicorn app.main:app --app-dir backend --reload
```

| Recurso | URL |
| --- | --- |
| API local | http://127.0.0.1:8000 |
| Estado del backend | http://127.0.0.1:8000/health |
| Documentación interactiva | http://127.0.0.1:8000/docs |

La respuesta esperada de `/health` es:

```json
{"status":"ok"}
```

## Configurar el frontend

En otra terminal, desde la raíz del repositorio:

```bash
cd frontend
npm ci
npm run dev
```

Abrir la dirección que indique Vite. Normalmente es:

http://localhost:5173

Backend y frontend se ejecutan en terminales independientes. Para detener cualquiera de los dos, utilizar `Ctrl + C` en su terminal.

## Comprobaciones locales

Antes de subir cambios, ejecutar las comprobaciones de la parte modificada.

### Backend

Con el entorno virtual activo, desde la raíz:

```bash
cd backend
python -m pip check
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest
```

Si Ruff indica diferencias de formato, aplicar:

```bash
python -m ruff format .
```

Después, revisar los cambios y repetir las comprobaciones.

### Frontend

Desde la carpeta `frontend`:

```bash
npm run lint
npm run build
```

`npm run build` comprueba TypeScript y genera la compilación de producción.

Actualmente no hay pruebas funcionales automatizadas del frontend. Además de pasar estos comandos, revisar en el navegador cualquier cambio de interfaz.

## Flujo de colaboración

### Ramas permanentes

| Rama | Uso |
| --- | --- |
| `main` | Versiones estables aprobadas para entrega. |
| `develop` | Integración del trabajo del equipo. |

No realizar commits ni pushes directos a `main` o `develop`. Los cambios se integran mediante Pull Requests.

### Ramas de trabajo

Crear una rama por tarea a partir de `develop`.

| Prefijo | Uso | Ejemplo |
| --- | --- | --- |
| `feature/` | Nueva funcionalidad. | `feature/aes-gcm` |
| `fix/` | Corrección de errores. | `fix/health-response` |
| `docs/` | Documentación. | `docs/setup-guide` |
| `chore/` | Configuración y mantenimiento. | `chore/contribution-guide` |
| `ci/` | Automatización. | `ci/backend-checks` |

### Comenzar una tarea

Con el directorio de trabajo limpio:

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/nombre-de-la-tarea
```

### Guardar y subir el trabajo

Revisar primero qué archivos cambiaron:

```bash
git status
git diff
```

Agregar únicamente los archivos de la tarea y crear el commit. Sustituir la ruta del ejemplo por la del archivo correspondiente:

```bash
git add ruta/del/archivo
git diff --cached
git commit -m "feat: describe el cambio"
git push -u origin feature/nombre-de-la-tarea
```

Prefijos habituales para los commits:

- `feat:` nueva funcionalidad.
- `fix:` corrección.
- `docs:` documentación.
- `test:` pruebas.
- `chore:` mantenimiento.
- `ci:` automatización.

### Abrir un Pull Request

1. Seleccionar `develop` como rama base.
2. Seleccionar la rama de la tarea como origen.
3. Describir el cambio y cómo se verifica.
4. Añadir evidencia cuando sea útil.
5. Esperar los resultados de CI Backend y CI Frontend.
6. Solicitar revisión al líder.

El líder, **Sangrador21**, revisa e integra los cambios. Puede integrar sus propios Pull Requests cuando haya verificado el trabajo y las comprobaciones obligatorias hayan pasado.

Los merges hacia `develop` utilizan **Squash and merge**.

Las entregas estables se integran desde `develop` hacia `main` mediante un Pull Request autorizado por el líder, utilizando **Merge**.

### Actualizar una rama con cambios de develop

Guardar o resolver primero los cambios locales pendientes. Después:

```bash
git fetch origin
git merge origin/develop
```

Ejecutar estos comandos estando en la rama de la tarea. Si aparecen conflictos, resolverlos antes de continuar.

Tras la actualización, repetir las comprobaciones locales y subir la rama.

### Después de integrar el PR

```bash
git switch develop
git pull --ff-only origin develop
```

Crear la siguiente rama a partir de esta versión actualizada.

## Integración continua

Los workflows se ejecutan en Pull Requests hacia `main` y `develop`, y en pushes a esas ramas.

| Check obligatorio | Comprobaciones |
| --- | --- |
| `backend-checks` | Instalación de dependencias, `pip check`, lint, formato, tipos y pruebas. |
| `frontend-checks` | Instalación con `npm ci`, lint y compilación con verificación de TypeScript. |

Si un check falla:

1. Abrir el detalle del check y consultar el paso que falló.
2. Corregir el problema en la misma rama.
3. Ejecutar la comprobación local correspondiente.
4. Crear un commit y hacer push.

El Pull Request se actualiza automáticamente con los nuevos commits.

Las ramas protegidas requieren los checks configurados y estar actualizadas con la rama base.

Actualmente no hay despliegue automático configurado.

## Manejo de dependencias

- No modificar dependencias si la tarea no lo requiere.
- Versionar `frontend/package-lock.json`.
- Utilizar `npm ci` para instalar las dependencias existentes.
- Si se agregan dependencias Python, mantener coherentes los archivos `.in` y el archivo de versiones fijadas.
- No subir `node_modules` ni el entorno virtual.
- Indicar en el PR cualquier cambio de dependencias.

## Seguridad y configuración

No subir al repositorio:

- Archivos `.env` con valores reales.
- Contraseñas, tokens o credenciales.
- Claves privadas o claves AES.
- Fragmentos reales de Shamir.
- Documentos confidenciales.
- Registros que contengan material sensible.

Cuando se incorporen variables de entorno, documentarlas mediante archivos `.env.example` con valores de ejemplo.

Las variables del frontend con prefijo `VITE_` son visibles en el navegador. No colocar secretos ni credenciales privilegiadas de Supabase en ellas.

Los ejemplos y las pruebas deben utilizar datos ficticios y material criptográfico generado exclusivamente para pruebas.

## Convenciones del equipo

1. Mantener cada PR centrado en una tarea.
2. Usar nombres descriptivos para ramas, commits y funciones.
3. Añadir pruebas para comportamientos nuevos y casos de error relevantes.
4. Documentar los endpoints y cambios de configuración.
5. Actualizar este README cuando cambie la instalación o el flujo de trabajo.
6. Revisar los archivos antes de hacer commit.
7. Resolver los comentarios de revisión antes del merge.
8. Mantener las comprobaciones obligatorias en verde.