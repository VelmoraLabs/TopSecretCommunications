# Frontend de Top Secret Communications

React, TypeScript, Vite y Tailwind 4, con la identidad visual basada en ITHERA
`develop`: navegación morada, superficies claras, Plus Jakarta Sans, DM Sans e
iconos Lucide. La criptografía se ejecuta exclusivamente en el backend.

## Preparación

Desde la raíz del repositorio:

```bash
cp -n frontend/.env.example frontend/.env.local
cd frontend
npm ci
```

En `frontend/.env.local` coloca `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY` del mismo proyecto configurado en FastAPI.
Las variables `VITE_` son públicas: no colocar secretos OAuth, secret keys,
service_role, contraseñas ni claves criptográficas.

La base de datos debe tener aplicada la [configuración de acceso](../supabase/README.md)
y Google debe estar habilitado. Consultar la
[guía de autenticación](../docs/development/authentication.md).

## Ejecutar

Desde `frontend/`:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Abrir `http://localhost:5173` para coincidir con el origen OAuth configurado.
FastAPI debe estar iniciado en `127.0.0.1:8000`. Vite reenvía las rutas `/api`
a ese servidor, por lo que no se necesita abrir CORS en desarrollo. En producción
se requiere un proxy equivalente y configurar el dominio HTTPS real de la app.
Reiniciar Vite después de modificar variables de entorno.

## Rutas

| Ruta | Comportamiento |
| --- | --- |
| `/` | Presentación pública del proyecto. |
| `/login` | Acceso con la cuenta de Google autorizada. |
| `/auth/callback` | Canje PKCE, verificación de acceso y retorno a una ruta interna. |
| `/dashboard` | Resumen real de documentos autorizados, contadores y últimas actualizaciones. |
| `/documentos` | Catálogo real, destinatarios, firma y verificación de memorándums. |
| `/notas-especiales` | Cifrado y recuperación reales, con sesión y permisos. |
| `/administracion` | Perfiles, roles, alta y edición reales. Requiere `profiles.manage`. |
| `/claves` | Claves de firma propias, generación/exportación y retirada. |
| `/grupos` | Grupos e integrantes reales, responsables, archivo y permisos por grupo. Requiere `groups.read`. |
| Otras | Página 404. |

El proveedor de sesión verifica el acceso antes de mostrar rutas internas. El
header muestra nombre y rol del perfil real. El menú lateral muestra la
administración únicamente a usuarios con permiso; FastAPI y PostgreSQL vuelven
a comprobarlo al realizar operaciones.

## Sesión

El SDK de Supabase conserva y renueva la sesión en el navegador. Google utiliza
OAuth con PKCE; el callback procesa el código una sola vez incluso con
React StrictMode y limpia los parámetros de la URL. No hay formulario público
de registro ni contraseña de aplicación.

Los cambios de acceso se consultan al volver al foco y periódicamente. El cierre
de sesión desmonta las rutas internas y descarta los resultados en memoria.
Los errores de red muestran reintento; las cuentas no autorizadas muestran el
estado de acceso restringido. Verificar el JWT solo en la interfaz sería
insuficiente: la API es quien autoriza cada operación.

## Administración

El administrador puede buscar perfiles por correo, filtrar por estado, paginar,
autorizar un correo de Google y editar nombre, rol y estado. El primer login
vincula la identidad con el perfil previamente autorizado. La pantalla consulta
el catálogo real de roles y sus permisos.

Los mensajes de éxito solo aparecen después de una escritura confirmada por la
API. La BD impide retirar el acceso al último administrador activo vinculado.
Desactivar una persona conserva su historial. El rol general no concede acceso
automático a documentos o fragmentos de otros grupos.

## Memorándums y claves

Dashboard y Documentos consumen FastAPI. Los memorándums tienen emisor autenticado, destinatarios propios y aprobación opcional del Embajador. Se guardan como borradores privados, se firman y se entregan solo mediante el envío explícito; no exigen grupos. Se almacenan versiones inmutables, firmas Base64 y claves públicas por perfil. La clave privada se descarga cifrada en un archivo separado y se usa únicamente durante la firma; no se conserva en el navegador ni en la base de datos.

La verificación puede utilizar el archivo almacenado o una copia seleccionada. Los otros tipos documentales muestran el catálogo real vacío hasta incorporar sus flujos; no se crean ejemplos automáticamente.

Consulta [configuración y prueba de RSA-PSS](../docs/development/memoranda-signatures.md), incluida la nueva migración y la clave exclusiva del backend.

## Notas especiales

El flujo portable mantiene AES-GCM, Shamir n de n, límite de 5 MiB, descarga e
importación del paquete y sus fragmentos. El tag permanece separado en el formato
v1 y las coordenadas de Shamir se conservan como cadenas decimales.

Para proteger se requiere `documents.create`; los miembros sin ese permiso
acceden a recuperación. El backend verifica los permisos aunque se manipule un
botón. Todavía no se entrega cada fragmento a una cuenta distinta ni existe una
sesión de recuperación colaborativa. Los resultados permanecen en memoria hasta
abandonar la página y se pueden guardar mediante las descargas.

## Organización modular

| Carpeta en `src/` | Uso |
| --- | --- |
| `app/` | Rutas, títulos y navegación. |
| `components/ui/` | Controles compartidos sin lógica de Supabase. |
| `components/layout/` | Marca, navegación, panel y layout de acceso. |
| `features/auth/` | Contexto, sesión, PKCE y comprobaciones de acceso. |
| `features/admin/` | Contratos y peticiones administrativas. |
| `features/documents/` | Contratos, API, formularios de memorándums y flujo portable separado. |
| `lib/` | Cliente Supabase y HTTP autenticado de la aplicación. |
| `pages/` | Composición de pantallas y estilos específicos. |
| `styles/` | Tema, fuentes, layouts y primitivas globales. |

Los tipos visuales no son modelos de autorización. Los componentes
visuales reutilizables reciben datos y eventos; no deciden permisos ni duplican
AES o Shamir.

## Comprobar

```bash
npm run lint
npm run build
```

Probar además login, recarga, cierre de sesión, perfil sin permiso y operaciones
de administración con otro perfil de navegador. Las pestañas del mismo perfil
comparten la sesión. Revisar escritorio, móvil y navegación por teclado.

- [Guía de sesión y administración](../docs/development/authentication.md).
- [Arquitectura del frontend](../docs/development/frontend-architecture.md).
- [Referencia de estilo](../docs/development/frontend-design.md).

## Validación y orientación en formularios

Los formularios muestran los requisitos pendientes, errores junto al campo y
acciones visiblemente deshabilitadas hasta completar datos válidos. Consulta
[las reglas y el recorrido de revisión](../docs/development/form-validation.md).
Desde esta carpeta, `npm test` ejecuta las pruebas de validación sin instalar
nuevas dependencias. FastAPI conserva la validación y autorización definitivas.
