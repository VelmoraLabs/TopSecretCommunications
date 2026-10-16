# Organización modular del frontend

La aplicación conserva React, TypeScript, Vite y Tailwind 4. Se adapta la
organización por componentes y funcionalidades de ITHERA `develop` al dominio
criptográfico documental de Top Secret Communications.

## Dependencias entre capas

| Capa | Puede utilizar | Responsabilidad |
| --- | --- | --- |
| `app/` | layouts y páginas | Registrar las rutas; no contiene casos de uso. |
| `pages/` | UI, features y datos del módulo | Componer vistas y coordinar interacción local. |
| `features/documents/` | tipos propios, lib y UI | Documentos y flujo portable; sin algoritmos criptográficos. |
| `features/auth/` | lib y React | Sesión, callback PKCE y guards de interfaz. |
| `features/admin/` | lib y tipos de acceso | Contratos y operaciones administrativas. |
| `lib/` | SDK y fetch | Integración Supabase y HTTP autenticado. |
| `components/layout/` | UI y navegación | Estructura común de las pantallas. |
| `components/ui/` | React e iconos | Controles genéricos que reciben datos/eventos por props. |
| `styles/` | tokens propios y fuentes | Identidad visual global; sin lógica de negocio. |

Las páginas pueden consumir el módulo documental. Ese módulo no importa páginas.
Un control genérico no conoce Supabase, FastAPI, un documento concreto ni las reglas
criptográficas. `App.tsx` monta el proveedor de sesión y las rutas; no contiene los casos de uso.

## Archivos de la base actual

| Ruta | Contenido |
| --- | --- |
| `src/app/AppRoutes.tsx` | `/`, `/login`, callback, dashboard, documentos, notas especiales, administración y 404. |
| `src/app/RouteEffects.tsx` | Título por ruta y desplazamiento al cambiar de página. |
| `src/components/layout/AppLayout.tsx` | Header, sidebar, menú móvil y contenido de rutas internas. |
| `src/components/layout/AuthLayout.tsx` | Panel de marca 45 % y formulario 55 %; adaptación móvil. |
| `src/components/layout/Brand.tsx` | Marca del proyecto, sin recursos de ITHERA. |
| `src/components/ui/` | Button, Badge, Card, TextField, Modal, PageHeader y EmptyState. |
| `src/features/documents/types.ts` | Modelo de presentación de los datos de ejemplo. |
| `src/features/documents/fixtures.ts` | Seis documentos ficticios sin contenido privado. |
| `src/features/documents/specialNotes.ts` | Contratos, solicitudes al backend y archivos portables de notas especiales. |
| `src/pages/SpecialNotes/` | Protección y recuperación portables mediante API autenticada. |
| `src/features/documents/documentPresentation.ts` | Etiquetas, iconos, colores y fecha. |
| `src/features/documents/components/` | Lista, tarjetas y detalle de un documento. |
| `src/pages/` | Landing, Login, AuthCallback, Dashboard, Documents, SpecialNotes, Admin y NotFound. |
| `src/features/auth/` | Contexto de sesión, PKCE y guards. |
| `src/features/admin/` | Modelos de perfiles y llamadas administrativas. |
| `src/lib/` | SDK Supabase y HTTP con token Bearer. |
| `src/styles/theme.css` | Variables y fuentes; punto de entrada para cambios de estilo. |

Los tipos de documentos ficticios son modelos de presentación, no esquemas de autorización.
Los contratos de acceso y administración se mantienen en sus features y corresponden
a la API de FastAPI y las RPC de Supabase.

La ruta `/notas-especiales` reutiliza el layout existente y mantiene los estados
del flujo en memoria. Las solicitudes usan el proxy de Vite hacia el backend.
La sesión es obligatoria y las solicitudes incluyen el JWT. Consultar la
[guía de autenticación](authentication.md) y el [flujo portable](special-notes-frontend.md).

## Siguientes módulos

Crear las carpetas cuando haya código que las utilice:

| Carpeta futura | Uso |
| --- | --- |
| `features/documents/services/` | Consultas y operaciones del módulo documental. |
| `hooks/` | Lógica reutilizable entre módulos, cuando exista. |
| `types/` | Contratos realmente compartidos, sin duplicar tipos del módulo. |
| `assets/` | Recursos propios que requieran importarse desde el código. |

La sesión y los guards están implementados. La API verifica identidad y permisos en
cada operación. La UI no sustituye estas comprobaciones ni la futura política de
asignación de documentos y acceso conjunto entre usuarios.

## Añadir una pantalla

1. Crear su carpeta en `pages/` y registrar la ruta en `AppRoutes.tsx`.
2. Elegir el layout adecuado. Reutilizar UI antes de crear controles nuevos.
3. Mantener los tipos y componentes del dominio en su `features/`.
4. Utilizar el tema y las reglas de [estilo](frontend-design.md).
5. Actualizar rutas/documentación y revisar escritorio, móvil y navegación por teclado.
6. Ejecutar lint/build y abrir el PR hacia `develop`.

La interfaz de Shamir se utiliza dentro del dominio de notas especiales en
`features/documents/`; no se necesita duplicar el algoritmo en un módulo frontend.
