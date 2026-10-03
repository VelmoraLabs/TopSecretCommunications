# Top Secret Communications

Aplicación web para proteger, firmar y controlar el acceso a documentos de una oficina diplomática mediante criptografía y permisos de usuario.

Proyecto académico de Criptografía de la Escuela Superior de Cómputo, Instituto Politécnico Nacional. Desarrollado por **VelmoraLabs**.

[Repositorio](https://github.com/VelmoraLabs/TopSecretCommunications) · [Guía del backend](backend/README.md) · [Arquitectura modular](docs/development/backend-architecture.md) · [Módulo Shamir](docs/crypto/shamir.md)

## Contenido

- [Objetivo y flujos documentales](#objetivo-y-flujos-documentales)
- [Tecnologías y alcance implementado](#tecnologías-y-alcance-implementado)
- [Arquitectura y organización del código](#arquitectura-y-organización-del-código)
- [Equipo y distribución del trabajo](#equipo-y-distribución-del-trabajo)
- [Instalación inicial](#instalación-inicial)
- [Ejecución local](#ejecución-local)
- [Pruebas y comprobaciones](#pruebas-y-comprobaciones)
- [Flujo de trabajo con Git y GitHub](#flujo-de-trabajo-con-git-y-github)
- [Integración continua](#integración-continua)
- [Dependencias y configuración](#dependencias-y-configuración)
- [Reglas de colaboración](#reglas-de-colaboración)

## Objetivo y flujos documentales

El sistema combina firmas digitales, cifrado y control de acceso. Cada categoría documental tiene un flujo de protección definido:

| Documento | Flujo de protección |
| --- | --- |
| Memorándum | Firma y verificación con RSA-PSS y SHA-256. |
| Expediente de personal | Cifrado con AES-256-GCM y protección de la clave para sus destinatarios mediante RSA-OAEP. |
| Nota diplomática o comunicado | Firma digital, cifrado y distribución de la clave a los destinatarios autorizados. |
| Nota diplomática especial | Cifrado con AES-256-GCM y reconstrucción conjunta de la clave mediante Shamir's Secret Sharing. |

En las notas especiales, el acceso conjunto requiere la participación de todos los integrantes definidos para el documento: el umbral de Shamir es igual al número de fragmentos (`threshold = share_count`). El módulo criptográfico admite también otros umbrales para su reutilización y sus pruebas.

## Tecnologías y alcance implementado

| Capa | Tecnología |
| --- | --- |
| Frontend | React, TypeScript, Vite y Tailwind CSS. |
| Backend | Python y FastAPI. |
| Motor criptográfico | Biblioteca `cryptography` e implementación propia de Shamir. |
| Autenticación | Supabase Auth. |
| Persistencia | PostgreSQL y Storage de Supabase. |
| Pruebas del backend | pytest y cliente de pruebas de FastAPI. |
| Calidad del backend | Ruff y mypy. |
| Calidad del frontend | ESLint, TypeScript y compilación con Vite. |
| Integración continua | GitHub Actions. |

La base implementada incluye la API de salud, la organización modular del backend, Shamir con división, reconstrucción y serialización de fragmentos, sus pruebas y una demostración local. El frontend incluye la base React/Vite con Tailwind CSS. Ambos componentes tienen comprobaciones automáticas de CI.

La integración con Supabase, los demás algoritmos, los flujos documentales, los permisos y la interfaz funcional se incorporan en las siguientes tareas. Shamir funciona como módulo Python independiente; todavía no tiene endpoints HTTP. La aplicación completa y el despliegue siguen en desarrollo.

## Arquitectura y organización del código

El frontend presenta las operaciones y consume la API. Los módulos funcionales del backend coordinan los permisos y los flujos documentales; utilizan el motor criptográfico y los adaptadores de persistencia.

| Componente | Responsabilidad |
| --- | --- |
| Frontend | Vistas, formularios, interacción y solicitudes HTTP. |
| API | Contratos HTTP, validación de solicitudes y respuestas. |
| Módulos funcionales | Políticas de acceso, casos de uso y coordinación de operaciones. |
| Motor criptográfico | Firma, verificación, cifrado, protección de claves y compartición de secretos. |
| Infraestructura | Integración con servicios externos, base de datos y almacenamiento. |

### Estructura implementada

Las rutas de esta tabla forman parte del repositorio con la incorporación del módulo Shamir:

| Ruta | Uso |
| --- | --- |
| `backend/app/main.py` | Crea la aplicación FastAPI y registra las rutas. |
| `backend/app/api/router.py` | Reúne los routers de la API. |
| `backend/app/modules/health/router.py` | Implementa `GET /health`. |
| `backend/app/crypto/shamir/` | Implementa división, reconstrucción, validación y serialización de secretos de 32 bytes. |
| `backend/tests/test_health.py` | Verifica el endpoint de salud. |
| `backend/tests/crypto/shamir/` | Verifica el comportamiento del módulo Shamir y sus casos de error. |
| `backend/demos/shamir_demo.py` | Demuestra Shamir con datos ficticios en memoria. |
| `backend/pyproject.toml` | Configura pytest, Ruff y mypy. |
| `backend/requirements.in` | Declara las dependencias directas del backend. |
| `backend/requirements-dev.in` | Declara las dependencias de desarrollo. |
| `backend/requirements-dev.txt` | Fija las versiones instaladas en desarrollo y CI. |
| `backend/README.md` | Explica los comandos y el funcionamiento del backend. |
| `frontend/src/` | Contiene el código React, los recursos y los estilos. |
| `frontend/public/` | Contiene recursos públicos del frontend. |
| `frontend/package.json` | Declara las dependencias y los scripts del frontend. |
| `frontend/package-lock.json` | Fija las versiones de las dependencias npm. |
| `docs/development/backend-architecture.md` | Define la organización modular y las responsabilidades. |
| `docs/crypto/shamir.md` | Documenta el contrato, las validaciones y los límites de Shamir. |
| `.github/workflows/` | Contiene los workflows de CI de backend y frontend. |
| `.github/pull_request_template.md` | Proporciona la plantilla de los Pull Requests. |

### Organización de los siguientes módulos

Estas rutas se crean al implementar su funcionalidad; no representan módulos ya terminados:

| Ruta en `backend/app/` | Responsabilidad |
| --- | --- |
| `crypto/signatures/` | SHA-256 y firmas RSA-PSS. |
| `crypto/encryption/` | Cifrado y descifrado AES-256-GCM. |
| `crypto/key_wrapping/` | Protección y recuperación de claves mediante RSA-OAEP. |
| `modules/auth/` | Validación de identidad y sesiones de Supabase. |
| `modules/access/` | Permisos y coordinación del acceso conjunto. |
| `modules/documents/` | Gestión de documentos y sus casos de uso. |
| `modules/documents/workflows/` | Coordinación de la protección según la categoría documental. |
| `modules/keys/` | Gestión de claves públicas y sobres de claves. |
| `infrastructure/` | Adaptadores de Supabase, PostgreSQL y Storage. |
| `core/` | Configuración compartida y manejo general de errores. |

Cada módulo funcional reúne los archivos que necesita: `router.py` para HTTP, `schemas.py` para los modelos de entrada y salida, `service.py` para los casos de uso y `repository.py` cuando utiliza persistencia. Cada paquete Python lleva su `__init__.py`.

Las funciones de `app/crypto/` reciben datos mediante argumentos y devuelven resultados. No importan FastAPI, no consultan Supabase y no deciden permisos de usuario. Los flujos documentales llaman a estos algoritmos sin duplicar sus implementaciones.

Las rutas funcionales que se incorporen utilizarán el prefijo `/api/v1`. El endpoint de salud conserva `/health`.

## Equipo y distribución del trabajo

| Integrante | Responsabilidad principal |
| --- | --- |
| Sangrador Curiel Yael Sebastian | Liderazgo e integración; Shamir; autenticación; permisos y acceso conjunto. |
| Hernández Saucedo Axel Ariel | SHA-256 y firmas digitales RSA-PSS. |
| Morales Hernández Roberto Carlos | AES-256-GCM y protección de claves RSA-OAEP. |

La gestión documental, los adaptadores de Supabase y la conexión con el frontend requieren coordinación entre los integrantes. Los contratos de los módulos y sus cambios se documentan en cada Pull Request.

El líder del repositorio es [Sangrador21](https://github.com/Sangrador21). Los integrantes trabajan con permisos de escritura en sus ramas; la integración a `develop` y `main` queda a cargo del líder.

## Instalación inicial

### Requisitos

- Git y una cuenta de GitHub con acceso de escritura al repositorio para colaborar.
- Python **3.14.5**, versión utilizada por el CI del backend.
- Node.js **24** y npm, utilizados por el CI del frontend.
- Un editor de código.

Verificar las versiones antes de instalar:

```bash
git --version
python3.14 --version
node --version
npm --version
```

En Windows, verificar Python con `py -3.14 --version`.

### Clonar y seleccionar develop

```bash
git clone https://github.com/VelmoraLabs/TopSecretCommunications.git
cd TopSecretCommunications
git switch develop
git pull --ff-only origin develop
```

La instalación se realiza desde `develop`. Antes de modificar archivos, crear una rama de trabajo siguiendo la sección de Git.

### Instalar el backend

Desde la raíz del repositorio, en macOS o Linux:

```bash
python3.14 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
python -m pip check
```

Desde la raíz del repositorio, en Windows con PowerShell:

```powershell
py -3.14 -m venv backend/.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
python -m pip check
```

Crear el entorno una sola vez. En una terminal nueva, activarlo con el comando correspondiente a tu sistema antes de ejecutar Python. Si cambian las dependencias al actualizar el repositorio, repetir la instalación desde `requirements-dev.txt`.

### Instalar el frontend

En otra terminal, desde la raíz:

```bash
cd frontend
npm ci
cd ..
```

`npm ci` instala las versiones del archivo `package-lock.json`. Repetirlo cuando una actualización cambie las dependencias del frontend.

La base implementada y la demostración de Shamir se ejecutan sin credenciales de Supabase. No es necesario crear archivos `.env` para estos pasos.

## Ejecución local

### Backend

Desde la raíz, con el entorno virtual activo:

```bash
python -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

### Frontend

En otra terminal, desde la raíz:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Estos comandos fijan las direcciones locales:

| Recurso | URL |
| --- | --- |
| Frontend | [http://127.0.0.1:5173](http://127.0.0.1:5173) |
| Salud del backend | [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) |
| Documentación interactiva de la API | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) |

`GET /health` devuelve:

```json
{"status":"ok"}
```

Si un puerto está ocupado, detener el proceso que lo utiliza antes de iniciar el servicio. El frontend utiliza `--strictPort` para impedir que Vite cambie silenciosamente a otro puerto.

Detener cada servicio con `Ctrl + C` en su terminal. El frontend muestra la base inicial de Vite; los flujos documentales y su conexión con la API se incorporan en las tareas de integración.

## Pruebas y comprobaciones

Ejecutar las comprobaciones de los componentes modificados antes de hacer push. Los Pull Requests ejecutan los checks de ambos componentes.

### Backend

Desde la raíz, con el entorno virtual activo:

```bash
cd backend
python -m pip check
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest
cd ..
```

Si hay diferencias de formato, ejecutar `python -m ruff format ruta/del/archivo.py` desde `backend/`, indicando el archivo afectado. Revisar el cambio y repetir la comprobación de formato.

### Demostración y pruebas de Shamir

Desde la raíz, con el entorno virtual activo:

```bash
cd backend
python -m demos.shamir_demo
python -m pytest tests/crypto/shamir -v
cd ..
```

La demo comprueba la reconstrucción 3 de 5, todas las combinaciones de ese umbral, el rechazo de fragmentos insuficientes, la serialización y el caso 4 de 4. Utiliza un secreto ficticio en memoria y no imprime claves ni fragmentos.

Shamir divide y reconstruye secretos; la autenticación de los participantes y su vinculación al documento pertenecen a los módulos funcionales. Consultar [el diseño de Shamir](docs/crypto/shamir.md) para sus contratos y límites de integridad.

### Frontend

Desde la raíz:

```bash
cd frontend
npm run lint
npm run build
cd ..
```

`npm run build` verifica TypeScript y genera la compilación de producción. Las pruebas funcionales automatizadas del frontend se incorporarán con sus funcionalidades; revisar también en el navegador los cambios de interfaz.

## Flujo de trabajo con Git y GitHub

**Todo cambio de desarrollo sale de una rama propia y entra mediante un Pull Request hacia `develop`. No hacer commits ni pushes directos a `main` o `develop`.**

### Ramas

| Rama | Uso | Integración |
| --- | --- | --- |
| `main` | Versiones estables para entrega. | PR desde `develop`, integrado por el líder con **Create a merge commit**. |
| `develop` | Integración del trabajo del equipo. | PR desde la rama de una tarea, integrado por el líder con **Squash and merge**. |
| `feature/nombre` | Funcionalidad nueva. | PR hacia `develop`. |
| `fix/nombre` | Corrección de un error. | PR hacia `develop`. |
| `docs/nombre` | Documentación. | PR hacia `develop`. |
| `chore/nombre` | Configuración o mantenimiento. | PR hacia `develop`. |
| `ci/nombre` | Workflows y automatización. | PR hacia `develop`. |

### 1. Comenzar una tarea

Desde la raíz, revisar que no haya cambios pendientes con `git status`. Si hay trabajo sin guardar, resolverlo en su rama antes de cambiar de rama.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/backend-rsa-pss
```

`feature/backend-rsa-pss` es el ejemplo de esta guía. Sustituirlo por el nombre de tu tarea en todos los comandos siguientes. Cada tarea utiliza una rama propia; no reutilizar una rama cuyo PR ya se integró.

### 2. Desarrollar y verificar

Implementar la tarea en su módulo, añadir las pruebas correspondientes y actualizar la documentación afectada. Ejecutar las comprobaciones locales de backend o frontend.

Antes de guardar cambios, confirmar la rama y revisar los archivos:

```bash
git branch --show-current
git status
git diff
git diff --check
```

La rama activa tiene que ser la de la tarea. Si aparece `main` o `develop`, crear una rama de trabajo antes de hacer el commit.

### 3. Crear el commit y subir la rama

Agregar únicamente los archivos de la tarea. Sustituir la ruta del ejemplo por las rutas reales de los archivos modificados:

```bash
git add ruta/del/archivo
git diff --cached
git diff --cached --check
git commit -m "feat: implement RSA-PSS signatures"
git push -u origin feature/backend-rsa-pss
```

Revisar el contenido preparado con `git diff --cached` antes del commit. No agregar archivos de configuración personal, secretos ni cambios ajenos a la tarea.

| Prefijo del commit | Uso |
| --- | --- |
| `feat:` | Funcionalidad nueva. |
| `fix:` | Corrección. |
| `test:` | Pruebas. |
| `docs:` | Documentación. |
| `chore:` | Mantenimiento o configuración. |
| `ci:` | Automatización. |

### 4. Abrir el Pull Request

En GitHub, abrir **Pull requests → New pull request** y seleccionar:

- **base:** `develop`.
- **compare:** la rama de la tarea, por ejemplo `feature/backend-rsa-pss`.

Completar la plantilla del PR con el problema resuelto, los cambios, los comandos de validación y la evidencia necesaria. Comprobar el destino antes de crearlo: los PR de tareas no apuntan a `main`.

Esperar los checks obligatorios `backend-checks` y `frontend-checks`. Solicitar revisión al líder y atender los comentarios en la misma rama. Cada nuevo commit enviado a esa rama actualiza el PR y vuelve a ejecutar las comprobaciones.

Los integrantes no integran sus propios PR. El líder **Sangrador21** revisa e integra los cambios del equipo; también puede integrar sus propios PR tras verificar el código y obtener los checks obligatorios en verde. Resolver las conversaciones de revisión antes del merge.

### 5. Actualizar la rama cuando cambie develop

La rama de la tarea debe incorporar los cambios de `develop` antes del merge. Con los cambios locales guardados y estando en la rama de la tarea:

```bash
git branch --show-current
git fetch origin
git merge origin/develop
```

Si aparecen conflictos, resolver los archivos, agregar los archivos resueltos con `git add` y completar el merge con `git commit`. Si no hay conflictos, Git puede completar el merge automáticamente.

Repetir las comprobaciones de los componentes afectados y subir la actualización:

```bash
git push origin feature/backend-rsa-pss
```

No utilizar `--force` para resolver conflictos o errores de actualización. Si `git pull --ff-only` falla en una rama permanente, revisar la divergencia con el líder antes de continuar.

### 6. Después del merge

Con el directorio de trabajo limpio:

```bash
git switch develop
git pull --ff-only origin develop
```

Crear la siguiente rama desde este `develop` actualizado. Los commits nuevos se realizan en la nueva rama de la tarea.

### Entregas a main

El líder prepara el PR con **base `main`** y **compare `develop`**, revisa el alcance de la entrega y espera los checks obligatorios. La integración utiliza **Create a merge commit** para conservar la relación entre las ramas permanentes.

## Integración continua

GitHub Actions ejecuta los workflows en los Pull Requests hacia `develop` y `main`, y en los pushes a esas ramas. Ambos checks se ejecutan también cuando el cambio es de documentación.

| Workflow | Check obligatorio | Validaciones |
| --- | --- | --- |
| CI Backend | `backend-checks` | Instalación, `pip check`, Ruff lint, Ruff formato, mypy y pytest. |
| CI Frontend | `frontend-checks` | Instalación con `npm ci`, ESLint y build con verificación de TypeScript. |

Las ramas protegidas requieren los checks en verde y la actualización con la rama base. El permiso de integración del líder no sustituye estas comprobaciones.

Si un check falla, abrir su detalle en **Checks**, identificar el paso que falló, corregirlo en la misma rama y ejecutar el comando local correspondiente. Crear un nuevo commit y hacer push para actualizar el PR.

CI comprueba lo que está implementado y cubierto por sus herramientas y pruebas. La revisión del código y las pruebas de los flujos completos forman parte del trabajo de integración. No hay despliegue automático configurado.

## Dependencias y configuración

- Instalar las dependencias Python desde `backend/requirements-dev.txt` y las del frontend con `npm ci`.
- Versionar `frontend/package-lock.json` y el archivo de versiones fijadas de Python.
- Si una tarea agrega o actualiza dependencias Python, mantener coherentes los archivos `.in` y `requirements-dev.txt` y explicar el cambio en el PR.
- Si una tarea agrega o actualiza dependencias npm, incluir los cambios de `package.json` y `package-lock.json` y comprobar `npm ci`, lint y build.
- No subir `node_modules`, entornos virtuales, cachés ni resultados de compilación.
- Al incorporar variables de entorno, documentar su uso y crear los archivos `.env.example` necesarios con valores ficticios.

Los archivos `.env` con valores reales, las credenciales privilegiadas de Supabase, las claves privadas, las claves AES, los fragmentos reales de Shamir y los documentos confidenciales no se suben al repositorio ni se incluyen en logs o evidencia de PR.

Las variables `VITE_` son visibles en el navegador. No colocar secretos ni credenciales privilegiadas en ellas. Las pruebas y demostraciones utilizan datos ficticios y material criptográfico generado para ese propósito.

## Reglas de colaboración

1. Crear una rama desde `develop` actualizado para cada tarea.
2. Abrir los PR de desarrollo hacia `develop` y dejar la integración al líder.
3. Mantener cada PR centrado en una tarea y describir cómo se verifica.
4. Respetar los módulos y sus responsabilidades; acordar los cambios de contratos compartidos.
5. Añadir pruebas para los algoritmos, las validaciones y los casos de error relevantes.
6. Revisar los archivos preparados antes de hacer commit y evitar material sensible.
7. Resolver los comentarios, los conflictos y los checks fallidos en la misma rama.
8. Actualizar el README y la documentación técnica cuando cambien los comandos, los módulos o los contratos.

Para ampliar la información técnica, consultar [la guía del backend](backend/README.md), [la organización modular](docs/development/backend-architecture.md) y [el diseño de Shamir](docs/crypto/shamir.md).
