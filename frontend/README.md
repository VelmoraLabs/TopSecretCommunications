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
service_role, contraseñas ni llaves criptográficas.

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
| `/claves` | Llaves de firma propias, generación/exportación y retirada. |
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

## Memorándums y llaves

Dashboard y Documentos consumen FastAPI. Los memorándums tienen emisor autenticado, destinatarios propios y aprobación opcional del Embajador. Se guardan como borradores privados, se firman y se entregan solo mediante el envío explícito; no exigen grupos. Se almacenan versiones inmutables, firmas Base64 y llaves públicas por perfil. La llave privada se descarga cifrada en un archivo separado y se usa únicamente durante la firma; no se conserva en el navegador ni en la base de datos.

La verificación puede utilizar el archivo almacenado o una copia seleccionada. Los expedientes, las notas y comunicados y las notas especiales tienen módulos propios. El catálogo conserva sus registros anteriores; los acuerdos solo se muestran como filtro cuando hay registros o se abre su enlace directo. No hay un flujo de creación de acuerdos comerciales ni documentos de ejemplo en la interfaz. La landing describe las cuatro funciones disponibles y sus enlaces requieren acceso autorizado.

Consulta [configuración y prueba de RSA-PSS](../docs/development/memoranda-signatures.md), incluida la nueva migración y la llave exclusiva del backend.

## Notas especiales

El flujo portable mantiene AES-GCM, Shamir n de n, límite de 5 MiB, descarga e
importación del paquete y sus fragmentos. El tag permanece separado en el formato
v1 y las coordenadas de Shamir se conservan como cadenas decimales.

Para proteger se requiere `documents.create`; los miembros sin ese permiso
acceden a recuperación. El backend verifica los permisos aunque se manipule un
botón. Este flujo portable conserva su manejo manual; las notas de grupo nuevas
ya distribuyen un sobre por cuenta e incorporan solicitudes de recuperación
colaborativa con aportaciones autorizadas. Los resultados portables permanecen en memoria hasta
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

## Notas especiales de grupo

`/notas-especiales` abre el archivo de grupo, con búsqueda, selección de grupo,
previsualización de participantes y persistencia cifrada. Las notas nuevas
requieren llaves activas y guardan un sobre cifrado por integrante antes de
compartirse. Las notas portables anteriores conservan confirmación de resguardo
e importación de su copia manual. Las notas y sus participantes persisten tras
recargar; los fragmentos en claro no se guardan en el servidor.
Consulta [la guía de esta etapa](../docs/development/group-notes-storage.md).

## Llaves de cifrado y fragmentos propios

`/claves` muestra llaves de cifrado y de firma por separado. Los componentes
`EncryptionKeysPanel` y `OwnSharePanel` viven en `features/group-notes`, reutilizan
las validaciones y estilos existentes y no guardan privadas/contraseñas en caché
ni almacenamiento persistente del navegador. Las notas nuevas usan entrega
individual; los resguardos anteriores siguen importándose. Consulta
`docs/development/recipient-share-custody.md`.

## Recuperación colaborativa

El detalle de notas con custodia individual incorpora `RecoveryPanel`, contratos
en `recoveries.ts` y actualizaciones en `useRecoveryUpdates.ts`. Cada persona
autoriza explícitamente su aportación. La descarga solo se ofrece al solicitante
cuando están todas; la UI distingue llave histórica del fragmento y llave fijada
en la solicitud. No se guardan privadas ni contraseñas en el navegador.

## Notificaciones generales y recorrido simplificado

Centro de avisos persistentes por destinatario, enlaces directos a las operaciones,
recuperación con fragmentos cifrados de la base de datos y verificación de firmas
antes de descargar. Conserva las llaves y documentos existentes.

Guía: [Notificaciones y flujo](../docs/development/notifications-and-workflow.md).

## Dashboard y avisos específicos

Resumen autorizado de documentos/notas, tareas propias y contexto histórico de
notificaciones. Los selectores de llaves conservan el nombre del archivo válido.
Guía: [Dashboard y contexto](../docs/development/dashboard-and-notification-context.md).

## Dependencias de desarrollo y carga de pantallas

Las páginas se importan con `React.lazy` y muestran un estado de carga mediante
`Suspense`. El layout conserva su menú mientras se descarga cada sección. Si
falla una descarga, se ofrece recargar la página. No se cambia la autorización
de las rutas ni la configuración de Supabase.

Se fija temporalmente `minimatch` en `11.0.1` para sus tres consumidores de lint:
`eslint`, `@eslint/config-array` y `@typescript-eslint/typescript-estree`. La
[alerta GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
afecta a versiones anteriores. Los overrides tienen alcance específico, y las
pruebas verifican que TS/TSX sigan analizándose y que `dist` permanezca excluido.
Revisar estos overrides cuando los consumidores adopten una versión corregida.

Comprobar cambios de dependencias con `npm ci`, `npm run lint`, `npm test`,
`npm run build`, `npm audit` y `npm audit --omit=dev`. No usar `npm audit fix
--force` como sustituto de revisar compatibilidad.

## Respaldos privados de firma y cifrado

Los nuevos respaldos RSA-PSS se descargan como `firma-<id>.stckey.json` y los de
RSA-OAEP como `cifrado-<id>.stckey.json`. El identificador es el `key_id` del
respaldo y se conserva la etiqueta elegida por el usuario dentro de la plataforma.
Los nombres privados se asignan automáticamente; el nombre de la pública de firma
puede personalizarse. Los respaldos anteriores siguen funcionando porque la
importación comprueba su contenido, sin exigir estos nombres.
Se mantiene un propósito distinto por par: firma (`stc-signing-private-key`,
`document-signing`) y cifrado (`stc-encryption-private-key`, `group-note-share-custody`).
Cada respaldo incluye versión, perfil, identificador, huella y `private_base64`.
Este último conserva el PKCS8 cifrado con contraseña: Base64 solo lo representa,
no sustituye su cifrado. El JSON no incluye la contraseña.

Memorándums (emisión y aprobación), notas diplomáticas y comunicados aceptan el
nuevo JSON de firma y los `.txt` anteriores. El lector comprueba identidad y
propósito del JSON; el backend valida siempre que la privada corresponda a la
pública registrada. Se envía el Base64 cifrado al mismo contrato de API.

No se requieren migraciones, cambios de variables ni nuevos pares de llaves.
Conserva los respaldos y contraseñas existentes. La pública de firma puede seguir
exportándose como `.txt`; no es un respaldo privado.
