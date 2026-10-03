# Referencia visual del frontend — Top Secret Communications

Referencia: [ITHERAADS/ITHERA](https://github.com/ITHERAADS/ITHERA).
Análisis realizado el 3 de octubre de 2026 a partir del código del frontend.

Este documento conserva los criterios visuales que se utilizarán al desarrollar
Top Secret Communications. Distingue los elementos observados en ITHERA de las
decisiones utilizadas en su adaptación. Es la referencia para las pantallas actuales y futuras.

## 1. Fuente y alcance de la revisión

Se revisaron la configuración de Tailwind, los estilos globales, el registro de
rutas, los componentes de interfaz, los layouts, las páginas de autenticación,
la portada, las pantallas de viajes y grupos, los paneles de documentos y los
patrones de formularios, tablas, avisos y ventanas de confirmación.

Se compararon estas versiones:

| Rama | Commit observado | Características relevantes |
| --- | --- | --- |
| `main` | `87e50eb55c433f83eda8c074e97f9c021f30e94c` | Misma paleta y fuentes; layout interno con sidebar de 240 px y presentación más sencilla. |
| `develop` | `5ef2774f486297fed1c27de7d010921a29a93748` | Sidebar de 256 px, navegación activa más elaborada, degradados y módulos adicionales, incluida la bóveda documental. |

La referencia principal para los componentes y las pantallas es `develop`.
Los elementos comunes a ambas ramas establecen la identidad visual. Esta
revisión describe el código; no certifica el funcionamiento de las integraciones
de ITHERA ni una correspondencia exacta con su despliegue público.

## 2. Identidad visual identificada

ITHERA combina una estructura oscura para la navegación con superficies claras
para trabajar. El morado profundo define la marca, el azul destaca las acciones
y los verdes indican resultados o estados favorables. Las tarjetas redondeadas,
los bordes discretos y la tipografía sans serif dan continuidad entre pantallas.

Hay dos familias de presentación:

- **Portada y autenticación:** zonas de marca oscuras, titulares grandes,
  degradados, transparencias y detalles luminosos.
- **Aplicación interna:** barra superior y sidebar oscuros, área de trabajo
  clara, tarjetas blancas, acciones visibles y ayuda contextual opcional.

Para Top Secret Communications se conserva esta combinación y se adapta el
contenido a documentos, destinatarios, firmas, cifrado y acceso conjunto.

## 3. Paleta de referencia

Los siguientes valores están definidos en `frontend/tailwind.config.js` o
utilizados de forma recurrente en los componentes de ITHERA:

| Color | Valor | Uso observado | Uso en Top Secret Communications |
| --- | --- | --- | --- |
| Morado profundo | `#1E0A4E` | Navegación y títulos. | Barra superior, sidebar y títulos. |
| Morado principal | `#4B2FA3` | Variante de botón y color primario. | Acciones de marca y énfasis. |
| Morado medio | `#7A4FD6` | Acentos, enlaces y degradados. | Selección, detalles y acciones secundarias. |
| Azul principal | `#1E6FD9` | Acciones, foco e información. | Acciones principales, enlaces y controles. |
| Azul claro | `#2C8BE6` | Hover de acciones azules. | Estados de interacción. |
| Verde | `#35C56A` | Estados positivos y acentos. | Indicadores de éxito y progreso. |
| Fondo neutro | `#F4F6F8` | Páginas y formularios. | Fondos de autenticación y vistas generales. |
| Fondo lavanda | `#F0EEF8` | Área principal del layout. | Área de trabajo del panel. |
| Superficie suave | `#FAF9FD` | Panel de ayuda. | Ayuda y contenido secundario. |
| Blanco | `#FFFFFF` | Tarjetas y formularios. | Superficies de lectura y operación. |
| Borde | `#E2E8F0` | Divisiones y tarjetas. | Separaciones y contornos. |
| Texto principal | `#3D4A5C` | Texto de contenido. | Descripciones y valores. |
| Texto secundario | `#7A8799` | Etiquetas y contexto. | Detalles secundarios, sujeto a contraste. |
| Error | `#EF4444` | Indicadores y errores. | Acentos de error y validación. |
| Advertencia | `#F59E0B` | Avisos y estados pendientes. | Indicadores de espera o atención. |

Los colores de marca se mantienen. Los colores de texto de éxito, advertencia
y error pueden usar variantes más oscuras para asegurar legibilidad sobre
superficies claras. Por ejemplo, texto blanco sobre `#35C56A` tiene un contraste
aproximado de 2.25:1; ese verde se utiliza como acento o acompañado de texto oscuro.

El criterio de contraste para texto normal es al menos 4.5:1 y para texto grande
al menos 3:1, conforme a [WCAG 2.2, criterio 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Estos valores son criterios de implementación; el cálculo anterior no es una
auditoría completa de accesibilidad de ITHERA.

### Degradados observados

- Barra superior interna: `#24105E` → `#2B1163` → `#5B2BC0`.
- Sidebar de `develop`: `#24105E` → `#1E0A4E` → `#34106F`.
- Panel de autenticación: `#0D0820` → `#1E0A4E` → `#31136F`.
- Acciones de autenticación: degradado entre morados medios.
- Acentos de producto: combinaciones de azul y morado.

La adaptación utiliza degradados en navegación y encabezados de marca. Las zonas
con documentos, formularios y resultados mantienen superficies claras y estables.

## 4. Tipografía, geometría y movimiento

### Tipografía

- **Plus Jakarta Sans:** fuente definida para encabezados en el tema de ITHERA.
- **DM Sans:** fuente del cuerpo, controles, etiquetas y navegación.
- ITHERA también utiliza encabezados de autenticación que heredan la fuente del
  cuerpo; la adaptación unifica los títulos con la fuente de encabezados.

Escala propuesta para el nuevo proyecto:

| Elemento | Tamaño de referencia |
| --- | --- |
| Título principal del panel | 28–32 px. |
| Título de sección | 18–20 px. |
| Texto y formularios | 14–16 px. |
| Ayuda y metadatos secundarios | 12–13 px. |

Cargar los pesos de fuente que se utilicen. Mantener nombres de archivos y valores
técnicos legibles cuando sean largos; no reducir el tamaño para hacerlos caber.

### Geometría

ITHERA usa radios de 12, 14, 16 y 24 px, además de ventanas con radios mayores.
Los badges y algunos botones usan forma de píldora. Sus controles genéricos tienen
alturas de 32, 40 y 48 px; las páginas de autenticación incluyen botones de 54 px.

La adaptación normaliza radios de 12 px para controles, 16 px para tarjetas y
24 px para ventanas destacadas, con una escala de separación de 4, 8, 12, 16,
24 y 32 px. Son decisiones de adaptación, no una transcripción de cada página.

Se conservan bordes finos y sombras suaves. Las sombras más amplias se reservan
para ventanas y elementos elevados.

### Interacciones

ITHERA incluye transiciones de 150–300 ms, estados hover, foco visible, botones
deshabilitados, spinners y skeletons. La portada añade animaciones de flotación
y brillo.

La adaptación prioriza transiciones breves en controles y navegación. Las
animaciones respetan `prefers-reduced-motion` y no distraen de una operación.

## 5. Layouts que se adaptarán

### Panel de aplicación

Referencia observada en `components/layout/AppLayout/AppLayout.tsx`:

- Barra superior de 80 px con marca, contexto y menú de usuario.
- Sidebar de 256 px en `develop`, con posibilidad de ocultarse.
- Contenido central flexible sobre fondo lavanda claro.
- Panel derecho opcional de 280 px, visible en pantallas grandes.

Adaptación propuesta:

- Marca de Top Secret Communications y contexto de la pantalla en la barra.
- Navegación por funcionalidades implementadas.
- Encabezado de página, acción principal y área de contenido.
- Ayuda contextual que explica la operación y sus requisitos.

Las secciones futuras pueden figurar en la documentación del producto; la
navegación inicial solo ofrece pantallas útiles y disponibles.

### Autenticación

Las páginas de ITHERA utilizan una distribución de 45 % para el panel de marca
y 55 % para el formulario en pantallas grandes. En tamaños pequeños muestran
el formulario en una sola columna y ocultan el panel decorativo.

Esta composición se reutilizará cuando se implemente autenticación. Los textos
y los mecanismos de ingreso se ajustarán a los requisitos de este proyecto.

### Documentos

La bóveda de `develop` ofrece una referencia directa: encabezado, acción para
cargar, filtros por categoría, conteo de resultados, estados vacíos y filas con
nombre, metadatos y acciones.

Top Secret Communications adapta ese patrón a memorándums, expedientes, notas
diplomáticas y notas especiales. Los estados de firma, cifrado y acceso se muestran
con texto e iconos además del color, según los resultados del backend.

## 6. Componentes y organización del frontend

Componentes observados que sirven como referencia:

| Componente | Patrón visual y de interacción |
| --- | --- |
| `Button` | Variantes primary, secondary, outline y ghost; tamaños; iconos; carga y deshabilitado. |
| `Input` | Etiqueta, ayuda, iconos, foco y validación vinculada al campo. |
| `Card` | Superficie blanca, borde, cabecera, cuerpo y pie opcionales. |
| `Badge` | Estados informativos, de éxito, advertencia y error. |
| `Table` | Encabezado diferenciado, filas, carga, estado vacío y desbordamiento controlado. |
| `ConfirmDialog` | Confirmación con variantes, descripción y acciones. |
| `ToastContainer` | Notificaciones breves y cierre. |
| `Navbar` y `AppLayout` | Estructura compartida entre pantallas. |
| `RightPanelHelp` | Ayuda contextual específica de la operación. |

ITHERA usa principalmente iconos SVG de trazo, con detalles en azul, morado o
verde. La adaptación utiliza una familia consistente de iconos para documentos,
participantes, candados, firmas y claves.

Organización propuesta para Top Secret Communications, creando cada carpeta
cuando su funcionalidad se implemente:

| Ruta en `frontend/src/` | Responsabilidad |
| --- | --- |
| `components/ui/` | Controles y componentes visuales compartidos. |
| `components/layout/` | Barra, sidebar y layout de la aplicación. |
| `app/` | Registro de rutas y efectos de navegación. |
| `pages/` | Inicio, acceso, dashboard y documentos. |
| `features/documents/` | Tipos, datos ficticios, presentación y componentes documentales. |
| `features/shamir/` | Futuro: piezas y comportamiento de la demostración criptográfica. |
| `services/` | Cliente HTTP y llamadas a FastAPI. |
| `hooks/` | Lógica reutilizable de interacción. |
| `types/` | Contratos TypeScript compartidos. |
| `styles/` | Tema visual y reglas comunes. |
| `assets/` | Marca y recursos del proyecto. |

Las páginas coordinan la interfaz; los servicios concentran las llamadas HTTP.
Los componentes visuales reciben datos y eventos mediante props. La criptografía
se ejecuta en el backend.

ITHERA utiliza Tailwind 3 y un archivo de configuración JavaScript. La adaptación
mantiene la integración existente de Top Secret Communications con Tailwind y Vite,
y define los valores de diseño en el mecanismo de tema correspondiente. En
Tailwind 4, las variables de tema permiten generar utilidades desde colores,
fuentes y otros valores; consultar [Theme variables](https://tailwindcss.com/docs/theme)
y [Tailwind con Vite](https://tailwindcss.com/docs/installation/using-vite).

## 7. Primera entrega visual

La base inicial incluye cuatro vistas. Utiliza componentes originales y contenido
propio de Top Secret Communications, con la identidad visual de ITHERA `develop`.

| Ruta | Pantalla | Comportamiento actual |
| --- | --- | --- |
| `/` | Inicio | Presentación del proyecto y sus categorías; navegación al acceso y dashboard. |
| `/login` | Acceso | Validación nativa, visibilidad de contraseña y aviso de autenticación pendiente. |
| `/dashboard` | Panel | Resumen documental, actividad ficticia y enlaces por categoría o pendientes. |
| `/documentos` | Documentos | Búsqueda, filtros, orden, vistas de lista/tarjetas y detalle en ventana modal. |

Las rutas del panel son públicas durante esta revisión visual. No representan
usuarios autenticados ni permisos concedidos. La navegación de ejemplo se ofrece
mediante una acción separada del formulario de inicio de sesión.

No se envían credenciales ni se almacenan en `localStorage` o `sessionStorage`.
El checkbox de recordar acceso solo permite revisar el control visual; no persiste
una preferencia. El formulario no inicia sesión. Todos los documentos y estados
son ficticios y están identificados como ejemplos.

La pantalla de Shamir, las llamadas a FastAPI y Supabase quedan para una entrega
posterior. Su diseño reutilizará estos layouts, botones, formularios y tarjetas;
los contratos y estados de carga/error se definirán junto con la integración.

### Implementación del estilo

- `src/styles/theme.css`: paleta, variables semánticas, tema Tailwind 4 y fuentes locales.
- `src/styles/base.css`: reglas globales, foco visible y reducción de movimiento.
- `src/styles/components.css`: botones, campos, tarjetas, etiquetas y ventanas modales.
- `src/styles/layouts.css`: marca, navegación pública, panel y layout de acceso.
- Los estilos de una página permanecen junto a esa página; los componentes del
  dominio documental comparten `features/documents/components/documents.css`.

Las fuentes variables se distribuyen desde paquetes npm de Fontsource. El CSS
incluye solamente los archivos latinos necesarios; no solicita Google Fonts.
Los iconos provienen de Lucide React mediante imports explícitos.

## 8. Criterios para conservar el estilo

1. Mantener la paleta morada y azul y las dos fuentes de referencia.
2. Usar navegación oscura y superficies claras para trabajar.
3. Unificar variantes de botones, tarjetas, formularios y estados.
4. Adaptar marca, textos, iconos y contenido al contexto documental.
5. Identificar los datos ficticios; al integrar, mostrar estados respaldados por resultados reales.
6. Asegurar foco visible, etiquetas de campos y mensajes vinculados a errores.
7. Implementar navegación móvil con contenido útil en una sola columna.
8. Gestionar foco, cierre y retorno al control de origen en ventanas modales.
9. Mantener legibilidad de documentos y valores largos en pantallas pequeñas.
10. Documentar nuevas rutas y componentes al implementarlos.

## 9. Fuentes del repositorio

Enlaces fijados al commit de `develop` utilizado en la revisión:

- [Tema y paleta](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/tailwind.config.js).
- [Fuentes y estilos globales](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/index.css).
- [Layout de aplicación](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/components/layout/AppLayout/AppLayout.tsx).
- [Navegación superior](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/components/layout/Navbar/Navbar.tsx).
- [Componentes UI](https://github.com/ITHERAADS/ITHERA/tree/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/components/ui).
- [Inicio de sesión](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/pages/Login/LoginPage.tsx).
- [Portada](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/pages/Landing/LandingPage.tsx).
- [Bóveda de documentos](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/frontend/src/components/documents/DocumentVaultPanel.tsx).
- [Convenciones del frontend](https://github.com/ITHERAADS/ITHERA/blob/5ef2774f486297fed1c27de7d010921a29a93748/docs/frontend-ui/README.md).
