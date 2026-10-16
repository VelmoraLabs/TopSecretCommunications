# Integración de notas especiales con el frontend

Esta entrega requiere tener aplicado el backend `STC_Backend_AES_Shamir_v1`.
Conecta su contrato definitivo con la nueva ruta `/notas-especiales`.
Conserva la identidad visual aprobada. La sección de incorporación describe la entrega
original; la versión actual añade sesión y permisos según [autenticación](authentication.md).

## Incorporar los cambios

Si el backend anterior sigue sin commit, continuar en esa misma rama. No cambiar
a `develop` ni descartar los cambios. Si ya se integró, crear una rama de tarea
desde `develop` actualizado antes de aplicar este paquete.

Desde la raíz:

```bash
git branch --show-current
git status
unzip -n "$HOME/Downloads/STC_Frontend_Notas_Especiales_v1.zip" -d "$HOME/Downloads/STC_Frontend_Notas_Especiales_v1"
git apply --check "$HOME/Downloads/STC_Frontend_Notas_Especiales_v1/frontend-notas-especiales.patch" && git apply "$HOME/Downloads/STC_Frontend_Notas_Especiales_v1/frontend-notas-especiales.patch"
```

El parche comprueba compatibilidad antes de aplicar todos los archivos. Si un
archivo ya existe o hay conflicto, comparar y conservar el trabajo existente.
No copiar también los archivos manualmente ni extraer sobre el proyecto con
sobrescritura. El ZIP contiene fuentes para revisión y el parche de integración.

## Ejecutar

Primera terminal, desde la raíz con el entorno Python existente activo:

```bash
python -m uvicorn app.main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000 --reload
```

Configurar primero los dos archivos de entorno y `STC_ENABLE_LOCAL_WORKFLOW=1`
como indica [la guía de autenticación](authentication.md).

Segunda terminal, desde la raíz:

```bash
cd frontend
npm ci
npm run lint
npm run build
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Abrir [Notas especiales](http://localhost:5173/notas-especiales).
También se accede por el menú lateral y la tarjeta correspondiente del dashboard.
Se requiere una sesión de Google autorizada, el SDK Supabase y las variables de
entorno del frontend y backend. Las dependencias se instalan con sus lockfiles.

Vite reenvía `/api` al backend en `127.0.0.1:8000`. El cliente utiliza rutas
relativas y no depende de CORS en desarrollo. Para un despliegue se deberá
configurar un proxy HTTP equivalente hacia el backend;
el servidor de Vite no es un servidor de producción.

## Flujo disponible

1. Cargar un archivo de hasta 5 MiB.
2. Elegir entre 2 y 20 participantes. La política siempre requiere a todo el grupo.
3. Proteger: la interfaz envía el contenido al servicio AES-GCM + Shamir.
4. Descargar el paquete cifrado y cada fragmento por separado.
5. Preparar la recuperación en la misma pantalla, o recargar e importar descargas.
6. Elegir los fragmentos que se aportarán y solicitar la recuperación.
7. Descargar el archivo original después de que el backend verifique su integridad.

La interfaz admite archivos vacíos y contenido binario. El paquete conserva
`nonce_base64`, `ciphertext_base64` y `tag_base64` separados. Los fragmentos
conservan `y` como texto decimal; nunca se convierte a un número de JavaScript.
Importar un paquete solo comprueba su estructura: la autenticidad se valida
al recuperar, en el backend.

El selector de aportaciones permite comprobar el rechazo real cuando faltan
fragmentos. Cada casilla representa un fragmento, no a una persona distinta.
El operador tiene una sesión autenticada; la coordinación entre integrantes sigue
pendiente. El backend valida los permisos y también
el umbral, conjunto, índices repetidos y autenticidad aunque se manipule la interfaz.

## Organización

| Archivo | Responsabilidad |
| --- | --- |
| `pages/SpecialNotes/SpecialNotesPage.tsx` | Formularios, estados y composición de pantalla. |
| `pages/SpecialNotes/special-notes.css` | Estilos de la pantalla sobre los tokens existentes. |
| `features/documents/specialNotes.ts` | Tipos, llamadas HTTP, lectura y descarga de archivos. |
| `app/AppRoutes.tsx` y `RouteEffects.tsx` | Ruta y título de página. |
| Layout, sidebar y dashboard | Entrada al flujo portable y contexto de sesión. |
| `vite.config.ts` | Proxy de desarrollo hacia la API. |

La criptografía permanece en Python. No se duplican AES ni Shamir en el navegador.
Los archivos y fragmentos se mantienen en estado de React; no se escriben en
localStorage, sessionStorage ni una base de datos. Recargar o salir de la pantalla
descarta los resultados no descargados. El servidor tampoco mantiene el documento.

## Verificación manual

- Caso 4 de 4: proteger, descargar paquete y fragmentos, reconstruir y comparar
  el original recuperado.
- Desmarcar un fragmento: solicitar recuperación y comprobar el rechazo.
- Recargar, importar las descargas y recuperar otra vez.
- Aportar un fragmento repetido o perteneciente a otra nota: comprobar el error.
- Alterar un carácter válido del tag Base64: comprobar fallo de integridad.
- Seleccionar un archivo mayor a 5 MiB o un JSON inválido: comprobar validación.
- Revisar el menú y la ausencia de desbordamiento horizontal en móvil.

El login con Google y los permisos de operaciones están integrados. La asociación
de fragmentos a personas y las sesiones de recuperación conjunta son la etapa
siguiente. Las rutas portables siguen siendo optativas y requieren sesión.

## Validación de la entrega original

ESLint y compilación TypeScript/Vite correctos. El flujo se comprobó con Chromium
contra la API real: protección, descargas, rechazo por umbral insuficiente o índices
repetidos, recuperación binaria exacta, reapertura con importación, alteración del
tag y revisión de tamaños 1440, 768, 390 y 320 px sin desbordamiento horizontal.
También se comprobaron archivo vacío, JSON inválido, fragmentos de otra nota y
servicio detenido. El backend es el paquete anterior; no se modifica su código.
