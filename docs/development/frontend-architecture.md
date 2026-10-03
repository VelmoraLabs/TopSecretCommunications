# Organización modular del frontend

La aplicación conserva React, TypeScript, Vite y Tailwind 4. Se adapta la
organización por componentes y funcionalidades de ITHERA `develop` al dominio
criptográfico documental de Top Secret Communications.

## Dependencias entre capas

| Capa | Puede utilizar | Responsabilidad |
| --- | --- | --- |
| `app/` | layouts y páginas | Registrar las rutas; no contiene casos de uso. |
| `pages/` | UI, features y datos del módulo | Componer vistas y coordinar interacción local. |
| `features/documents/` | tipos propios y UI | Representar documentos y sus estados; entregar componentes reutilizables. |
| `components/layout/` | UI y navegación | Estructura común de las pantallas. |
| `components/ui/` | React e iconos | Controles genéricos que reciben datos/eventos por props. |
| `styles/` | tokens propios y fuentes | Identidad visual global; sin lógica de negocio. |

Las páginas pueden consumir el módulo documental. Ese módulo no importa páginas.
Un control genérico no conoce Supabase, FastAPI, un documento concreto ni las reglas
criptográficas. `App.tsx` monta las rutas y no se convierte en una pantalla gigante.

## Archivos de la base actual

| Ruta | Contenido |
| --- | --- |
| `src/app/AppRoutes.tsx` | `/`, `/login`, `/dashboard`, `/documentos` y 404. |
| `src/app/RouteEffects.tsx` | Título por ruta y desplazamiento al cambiar de página. |
| `src/components/layout/AppLayout.tsx` | Header, sidebar, menú móvil y contenido de rutas internas. |
| `src/components/layout/AuthLayout.tsx` | Panel de marca 45 % y formulario 55 %; adaptación móvil. |
| `src/components/layout/Brand.tsx` | Marca del proyecto, sin recursos de ITHERA. |
| `src/components/ui/` | Button, Badge, Card, TextField, Modal, PageHeader y EmptyState. |
| `src/features/documents/types.ts` | Modelo de presentación de los datos de ejemplo. |
| `src/features/documents/fixtures.ts` | Seis documentos ficticios sin contenido privado. |
| `src/features/documents/documentPresentation.ts` | Etiquetas, iconos, colores y fecha. |
| `src/features/documents/components/` | Lista, tarjetas y detalle de un documento. |
| `src/pages/` | Landing, Login, Dashboard, Documents y NotFound. |
| `src/styles/theme.css` | Variables y fuentes; punto de entrada para cambios de estilo. |

Los tipos de esta entrega son modelos de presentación. No constituyen un contrato
HTTP acordado con el backend ni se deben reutilizar como esquemas de autorización.

## Siguientes módulos

Crear las carpetas cuando haya código que las utilice:

| Carpeta futura | Uso |
| --- | --- |
| `features/auth/` | Sesión, formularios conectados y estados de autenticación. |
| `features/shamir/` | Interfaz de demostración, conforme al contrato de su futura API. |
| `features/documents/services/` | Consultas y operaciones del módulo documental. |
| `services/` | Cliente HTTP compartido y configuración de integraciones. |
| `hooks/` | Lógica reutilizable entre módulos, cuando exista. |
| `types/` | Contratos realmente compartidos, sin duplicar tipos del módulo. |
| `assets/` | Recursos propios que requieran importarse desde el código. |

Al conectar autenticación se implementarán sesión y guards. La API seguirá siendo
responsable de comprobar identidad y permisos. La criptografía existente permanece
en el backend. La UI no sustituye las validaciones ni la política de acceso conjunto.

## Añadir una pantalla

1. Crear su carpeta en `pages/` y registrar la ruta en `AppRoutes.tsx`.
2. Elegir el layout adecuado. Reutilizar UI antes de crear controles nuevos.
3. Mantener los tipos y componentes del dominio en su `features/`.
4. Utilizar el tema y las reglas de [estilo](frontend-design.md).
5. Actualizar rutas/documentación y revisar escritorio, móvil y navegación por teclado.
6. Ejecutar lint/build y abrir el PR hacia `develop`.
