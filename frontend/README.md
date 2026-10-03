# Frontend — Top Secret Communications

Base visual modular con React, TypeScript, Vite y Tailwind CSS 4. La referencia de
estilo es ITHERA `develop`: morados, navegación oscura, superficies claras, Plus
Jakarta Sans y DM Sans. Los componentes y textos corresponden a este proyecto.

## Ejecutar en local

Requisito: Node.js 24 y npm, igual que el CI. Desde la raíz del repositorio:

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Abrir [http://127.0.0.1:5173](http://127.0.0.1:5173). Detener con `Ctrl + C`.
No se requieren archivos `.env`, backend ni credenciales de Supabase para esta base.

## Pantallas disponibles

| Ruta | Contenido |
| --- | --- |
| `/` | Presentación de la plataforma y sus cuatro categorías documentales. |
| `/login` | Diseño del acceso, validación nativa y visibilidad de contraseña. |
| `/dashboard` | Indicadores, documentos recientes y actividad de ejemplo. |
| `/documentos` | Búsqueda, filtros, orden, lista/tarjetas y detalle de documentos ficticios. |
| Cualquier otra ruta | Página 404 con enlace al dashboard. |

El formulario no autentica y no envía ni persiste credenciales. Los documentos son
fixtures locales. Las rutas del panel son públicas para revisar el diseño; no se
implementaron guards, permisos, cargas de archivos, criptografía ni llamadas HTTP.
El control «Recordar mi acceso» solo presenta el estado visual del checkbox.

La búsqueda acepta títulos, folios y áreas; ignora mayúsculas y acentos. Los filtros
por categoría se guardan en el parámetro `tipo` de la URL. `estado=pendiente` reúne
los ejemplos de firma pendiente y acceso conjunto. Un tipo inválido muestra todos.
El orden y el término de búsqueda son estado local y se restablecen al abandonar la
ruta. El detalle es una ventana modal que cierra con el botón, Escape o el fondo.

## Organización

| Ruta dentro de `src/` | Responsabilidad |
| --- | --- |
| `app/` | Registro de rutas y título/desplazamiento al navegar. |
| `components/ui/` | Controles visuales reutilizables, independientes del dominio. |
| `components/layout/` | Marca, navegación pública, panel, sidebar y acceso. |
| `features/documents/` | Tipos, fixtures, presentación y componentes documentales. |
| `pages/` | Composición de las pantallas; una carpeta por página. |
| `styles/` | Tokens visuales, fuentes, estilos globales y layouts. |

Crear otros módulos cuando se implemente su funcionalidad. El estilo de una página
queda junto a su componente; no concentrar todas las pantallas en `App.tsx`.

## Calidad

```bash
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

`build` comprueba TypeScript y genera `dist/`. `preview` sirve esa compilación en
[http://127.0.0.1:4173](http://127.0.0.1:4173); no es un servidor de producción.
El CI conserva `npm ci`, lint y build. No se añadieron tests automatizados al
repositorio para esta entrega visual. La revisión funcional se documenta en la guía.

## Trabajar con el equipo

Crear una rama de tarea desde `develop`, hacer cambios y abrir un PR hacia
`develop`. No enviar commits directamente a `main` o `develop`. El líder revisa y
realiza el merge. El flujo completo y las comprobaciones obligatorias están en el
[README principal](../README.md).

- [Referencia visual](../docs/development/frontend-design.md)
- [Arquitectura modular](../docs/development/frontend-architecture.md)
- [Integración de esta entrega y revisión manual](../docs/development/frontend-setup.md)
