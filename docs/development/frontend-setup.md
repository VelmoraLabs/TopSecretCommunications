# Integrar y revisar la base visual del frontend

Entrega preparada sobre `develop` de TopSecretCommunications, commit
`7aba7dfa7e5c3aa5f0a39cc855245f95d99df8d2`. La referencia visual es ITHERA
`develop`, commit `5ef2774f486297fed1c27de7d010921a29a93748`.

## Preparar la rama

Desde la raíz del proyecto, revisar primero:

```bash
git status
```

Continuar cuando no haya cambios pendientes. Si los hay, conservarlos en su rama
antes de cambiar; no utilizar reset ni descartar archivos para limpiar el árbol.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/frontend-base
```

Si esta rama ya existe, usar `git switch feature/frontend-base` y comprobar que es
la rama de esta tarea. La entrega modifica la base visual y su documentación; no
cambia el backend, Supabase, workflows ni protecciones de GitHub.

## Aplicar la entrega completa

Descargar `STC_Frontend_Base_v2.zip` en `~/Downloads`. El ZIP conserva los archivos
fuente para inspección e incluye `frontend-base.patch`, que incorpora todos los
archivos nuevos, las modificaciones y la retirada de cuatro recursos de plantilla.
No incluye `node_modules`, `dist`, archivos `.env`, backend ni workflows.

Desde la raíz del repositorio y en `feature/frontend-base`, ejecutar:

```bash
unzip -n "$HOME/Downloads/STC_Frontend_Base_v2.zip" -d "$HOME/Downloads/STC_Frontend_Base_v2"
git apply --check "$HOME/Downloads/STC_Frontend_Base_v2/frontend-base.patch" && git apply "$HOME/Downloads/STC_Frontend_Base_v2/frontend-base.patch"
```

El primer comando extrae la entrega fuera del repositorio. El segundo valida el
parche y aplica todos sus cambios juntos. Git mantiene las ediciones compatibles
y rechaza conflictos antes de modificar archivos; no usar `--reject`, `--force`
ni extraer con `unzip -o` sobre el proyecto. Si indica que un archivo ya existe o
que un parche no aplica, detenerse y comparar: puede haber trabajo previo o una
base distinta. No descartar ese trabajo para instalar esta entrega.

Este paso no crea commits ni prepara archivos en el índice. No ejecutar además
una copia manual del ZIP: el parche ya incorpora todo lo necesario. Los cuatro
recursos retirados son `frontend/src/App.css`, `frontend/src/assets/react.svg`,
`frontend/src/assets/vite.svg` y `frontend/src/assets/hero.png`.

## Instalar y verificar

```bash
cd frontend
npm ci
npm run lint
npm run build
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Node.js 24 y npm son los requisitos. `npm ci` utiliza el lockfile entregado.
Abrir [http://127.0.0.1:5173](http://127.0.0.1:5173). No requiere `.env` ni backend.

## Revisión manual

| Vista | Comprobar |
| --- | --- |
| Inicio | Enlaces al login/dashboard y sección de categorías. |
| Login | Campos requeridos, formato de correo, mostrar/ocultar contraseña, aviso al enviar y acceso separado al dashboard de ejemplo. |
| Dashboard | Cuatro indicadores, documentos recientes, detalle, enlaces por categoría y enlace a pendientes. |
| Documentos | Búsqueda por nombre/folio/área sin distinguir acentos, filtros, orden A–Z/fecha y lista/tarjetas. |
| Sin resultados | Mensaje claro y botón para restablecer los filtros. |
| Detalle | Apertura, cierre por botón/Escape/fondo y regreso del foco al control que abrió la ventana. |
| Móvil | Header compacto, apertura/cierre del menú, navegación y ausencia de scroll horizontal. |
| Ruta desconocida | Página 404 y regreso al dashboard. |

Los documentos, estados, destinatarios y movimientos son ficticios. El login no
inicia sesión. El checkbox de recordar acceso no guarda una preferencia; las
credenciales no se envían ni se persisten. La pantalla Shamir y la conexión con
FastAPI/Supabase no forman parte de esta entrega.

Las capturas en `previews/` documentan la apariencia inicial, no son assets de la
aplicación. La revisión anterior dejó capturas de las cuatro vistas en escritorio y móvil y
registró comprobaciones en Chromium a 1440, 768, 390 y 320 px, junto con navegación,
filtros y detalle. En la reanudación se conservaron esos archivos, se inspeccionaron
las capturas y se repitieron ESLint y la compilación TypeScript/Vite: ambas pasaron.
También se comprobó la aplicación del parche sobre el commit base y su rechazo
ante cambios en conflicto. No se repitió la prueba interactiva del navegador en
esta reanudación: la descarga de Chromium no estuvo disponible. Revisar las
interacciones anteriores en el navegador local antes de integrar el PR.

## Preparar el PR después de revisar el diseño

Detener Vite, regresar a la raíz y comprobar los cambios:

```bash
cd ..
git status
git diff --check
git diff --stat
git add frontend docs/development README.md
git diff --cached --stat
git commit -m "feat: add modular frontend base and initial screens"
git push -u origin feature/frontend-base
```

Abrir el PR con base `develop`, esperar los checks y solicitar revisión al líder.
No enviar commits directamente a `main` o `develop`. Este paquete no ejecuta
ninguno de estos comandos ni publica cambios de manera automática.
