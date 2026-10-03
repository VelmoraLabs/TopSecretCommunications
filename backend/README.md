# Backend — Top Secret Communications

Python + FastAPI. El motor criptográfico se organiza en `app/crypto/` y los
módulos funcionales en `app/modules/`. La configuración existente de pytest,
Ruff y mypy permanece en `pyproject.toml`.

## Instalación

Desde la raíz del repositorio, en macOS/Linux:

```bash
python3.14 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
```

En PowerShell:

```powershell
py -3.14 -m venv backend/.venv
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
```

Si el entorno ya existe, solo activarlo. Shamir usa la biblioteca estándar y
no incorpora dependencias. CI emplea Python 3.14.5.

## Ejecutar la API

Desde la raíz y con el entorno activo:

```bash
python -m uvicorn app.main:app --app-dir backend --reload
```

- Salud: http://127.0.0.1:8000/health
- Documentación: http://127.0.0.1:8000/docs

`/health` conserva la respuesta `{"status":"ok"}`. El módulo Shamir todavía
no tiene rutas HTTP públicas. Tampoco requiere credenciales de Supabase.

## Verificar el backend

Con el entorno activo, desde `backend/`:

```bash
python -m pip check
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest
```

## Ejecutar la demostración

Desde `backend/`:

```bash
python -m demos.shamir_demo
```

La demo crea un secreto ficticio en memoria, verifica todas las combinaciones
de 3 fragmentos entre 5, prueba el rechazo de 2 fragmentos, serializa sin
escribir archivos y verifica el caso 4 de 4. No imprime claves ni coordenadas y.

Para ejecutar solamente las pruebas de Shamir:

```bash
python -m pytest tests/crypto/shamir -v
```

## Documentación

- [Organización modular](../docs/development/backend-architecture.md)
- [Diseño de Shamir](../docs/crypto/shamir.md)

Las funciones criptográficas no realizan consultas a Supabase ni importan
FastAPI. Los routers reciben solicitudes; los servicios funcionales coordinan
operaciones; los repositorios y adaptadores se añadirán al integrar persistencia.
