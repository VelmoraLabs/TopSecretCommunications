# Validación y prevención de errores en la interfaz

Esta entrega conserva el diseño, los contratos de FastAPI, el flujo de emisión,
aprobación y envío y los módulos criptográficos. No requiere migraciones SQL ni
variables de entorno nuevas. El backend sigue comprobando identidad, permisos,
versiones, tamaños, formatos y validez criptográfica en cada operación.

## Comportamiento compartido

- Los botones nativos usan `disabled`: fondo neutro, opacidad reducida, sin sombra
  ni efecto de hover. No basta con impedir el clic mediante JavaScript.
- El bloque **Para continuar** enumera las condiciones pendientes. Cada entrada
  lleva el foco al campo o apartado correspondiente. Al completar los datos se
  muestra **Todo listo para continuar** y se habilita la acción.
- Los campos vacíos sin tocar no aparecen en rojo al abrir el formulario. Al
  salir de un campo inválido se muestra borde rojo, icono y texto de corrección.
  Los archivos seleccionados con tamaño inválido se señalan inmediatamente.
- `TextField` enlaza etiqueta, ayuda y error por `id`, `aria-invalid` y
  `aria-describedby`; no depende únicamente del color. Los avisos de estado
  utilizan regiones accesibles. Los mensajes no repiten contraseñas ni claves.
- Los manejadores vuelven a comprobar los requisitos antes de llamar a la API,
  incluso si el evento no procede del botón. Durante una operación se evita el
  reenvío y los modales no se cierran por Escape, fondo o botón de cierre.
- Se conservan los datos al fallar una solicitud para permitir corregir y
  reintentar; los secretos solo viven transitoriamente en el formulario actual.

`lib/validation.ts` contiene las comprobaciones de entrada reutilizables;
`lib/useFormValidation.ts` gestiona campos visitados, pendientes y foco;
`components/ui/FormFeedback.tsx` presenta errores y orientación. No hay otro
módulo criptográfico ni validación de permisos duplicada en el cliente.

## Cobertura

| Pantalla | Prevención y ayuda |
| --- | --- |
| Mis claves de firma | Nombre, archivos sin rutas, nombres distintos, contraseña de 12–256 caracteres Unicode y máximo 1024 bytes, confirmación coincidente. |
| Firmar emisión o aprobación | Clave activa, archivo privado no vacío de hasta 16 KiB, Base64 antes de enviar, contraseña con formato correcto. Si falla la apertura, se orienta a revisar archivo, contraseña y clave registrada; no se afirma que siempre sea la contraseña. |
| Nuevo memorándum | Título, documento de hasta 5 MiB, destinatario final y, al pedir aprobación, Embajador seleccionado. |
| Verificación de documento | Archivo elegido y límite de 5 MiB antes de solicitar comparación; la comprobación real de firmas permanece en FastAPI. |
| Perfiles | Nombre no vacío, correo válido y rol disponible, tanto en alta como en edición. |
| Grupos | Nombre, propósito, mínimo de dos integrantes, responsable activo y perfil seleccionado al incorporar. Se explica y bloquea retirar integrantes si quedarían menos de dos, y cambiar o retirar al último responsable activo. |
| Notas especiales | Documento, número entero de 2–20 participantes, paquete, fragmentos suficientes, pertenecientes al conjunto y con índices distintos. La autenticidad se decide exclusivamente con AES-GCM en el servidor. |

La coincidencia de metadatos de fragmentos es una comprobación estructural para
orientar al usuario. No demuestra que el valor de un fragmento sea auténtico.
El flujo portable conserva su alcance actual; esta entrega no incorpora la
recuperación colaborativa entre cuentas.

## Relación con las heurísticas de Nielsen

| Heurística | Aplicación concreta |
| --- | --- |
| 1. Visibilidad del estado | Pendientes, datos listos, progreso y resultados. |
| 2. Lenguaje del usuario | Indicaciones como “selecciona el documento”, “confirma la contraseña” o “designa otro responsable”. |
| 3. Control y libertad | Corrección conservando datos, cancelación antes de enviar y confirmaciones existentes para envío/retiro. |
| 4. Consistencia | Componentes, estilos y criterios de validación comunes. |
| 5. Prevención de errores | Acciones incompletas deshabilitadas y guardas antes de la API. |
| 6. Reconocimiento | Requisitos visibles; no hay que adivinar por qué está bloqueado un botón. |
| 8. Diseño sencillo | Ayuda junto al campo y un resumen breve, sin nuevos pasos obligatorios. |
| 9. Reconocer y corregir errores | Mensajes específicos, texto además de rojo y acceso directo al campo. |
| 10. Ayuda contextual | Límites de archivos, contraseña, claves y reglas de grupos junto a la operación. |

Son mejoras concretas basadas en las heurísticas; no equivalen a una certificación
integral de usabilidad o accesibilidad. La evaluación con usuarios y lectores de
pantalla sigue siendo una revisión adicional.

Fuentes: [Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/),
[WAI: validación de formularios](https://www.w3.org/WAI/tutorials/forms/validation/) y
[WAI: aria-invalid](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA21).

## Comprobación reproducible

Desde `frontend`:

```bash
npm test
npm run lint
npm run build
```

Las pruebas unitarias cubren campos vacíos, controles, Unicode, límites de
contraseña, nombres de archivo, tamaño del documento y correo. Se ejecutan con
Node y TypeScript ya incluidos en el proyecto, sin dependencias nuevas.

Recorrido manual con cuentas de prueba y archivos sin información real:

1. En **Mis claves**, escribir una contraseña corta y salir del campo: rojo y
   mensaje. Probar confirmación distinta y nombres de archivo iguales; no debe
   poder generarse. Corregir y comprobar que el botón recupera su estado activo.
2. Abrir un memorándum vacío, seguir los pendientes, seleccionar un archivo mayor
   de 5 MiB y sustituirlo por uno permitido. Al pedir aprobación, exigir Embajador.
3. Firmar con un archivo que no contenga Base64 y luego con contraseña incorrecta:
   error local o del servidor según corresponda, con posibilidad de corregir.
4. Completar emisión, aprobación opcional, envío y verificación como antes.
5. En perfiles, probar espacios y correo incompleto. En grupos, exigir responsable
   y comprobar la ayuda antes de retirar al último responsable o a un integrante
   de un grupo de dos.
6. En notas, probar participantes fuera de rango, paquete ilegible, fragmentos
   repetidos o de otra nota y umbral incompleto. Corregir y recuperar el original.
7. Repetir con teclado y pantalla estrecha. Los pendientes deben llevar el foco
   al control y los mensajes deben caber sin desplazamiento horizontal.
