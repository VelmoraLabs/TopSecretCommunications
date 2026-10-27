# Dashboard, selección de claves y contexto de notificaciones

Incremento posterior a Notificaciones y Flujo Claro v1. Su alcance es la presentación
y el resumen autorizado de información. No modifica los algoritmos ni las reglas de
Shamir, las aportaciones, la custodia, los plazos o la descarga ya aceptados.

## Dashboard con datos de los módulos reales

GET `/api/v1/dashboard` usa el JWT actual y la RPC `stc_dashboard()`. Cuenta los
registros completos antes de limitar a seis recientes y seis tareas. No usa el tamaño
de una página del listado ni depende de datos ficticios.

| Indicador | Regla |
| --- | --- |
| Documentos | Documentos visibles con versión lista más notas de grupo ready visibles |
| Notas especiales | Notas de grupo ready autorizadas para la cuenta |
| Firmados | Documentos con todas sus firmas previstas registradas; no incluye notas por estar cifradas |
| Pendientes | Documentos con acción propia disponible, recuperaciones con aportación/recuperación propia disponible, más preparaciones de nota propias |

Una persona que ya aportó y espera al resto no tiene otra aportación pendiente.
Al llegar a n/n, el solicitante sí tiene una tarea de recuperación. Una recuperación
completada con ventana de reintento no aumenta pendientes. Las canceladas, vencidas
o bloqueadas por falta de acceso no se presentan como acciones disponibles.
Las preparaciones staging/awaiting_backup aparecen como tarea solo del creador;
no aumentan notas disponibles. Las canceladas no se cuentan como archivos listos.

Se reutilizan los helpers de autorización y capacidades existentes. El dashboard no
cambia estados, no limpia aportaciones, no autoriza una descarga y no concede acceso
por ser administrador. Un administrador ajeno tiene ceros para esos documentos.

Los recientes y pendientes guardan el tipo del recurso y abren su pantalla concreta.
El acceso «Notas especiales» va al módulo real, no al filtro especial del listado de
memorándums. Si existen documentos antiguos con esa categoría en el listado anterior,
se ofrece un acceso separado y se conservan en el total documental.
«Revisar pendientes» lleva al bloque de tareas de la misma pantalla.

El resumen se actualiza con el ciclo del proveedor de notificaciones (Realtime y
conciliación cada diez segundos mientras la pestaña esté visible), al recuperar foco
y con «Actualizar resumen». Una actualización fallida muestra el error y conserva
el último resultado; no inventa ceros. Cada nueva lectura vuelve a comprobar permisos.
El contador «Firmados» representa el estado registrado; la verificación criptográfica
de los bytes sigue ocurriendo al descargar o comprobar el documento.

## Nombre de la clave seleccionada

Los selectores de aportación, recuperación y activación conservan el valor nativo
cuando el archivo pasa las validaciones locales. También muestran su nombre como
estado visible, con ajuste de línea para nombres largos. Se mantiene el contenido
solo en memoria como antes.

Un archivo inválido se limpia y muestra el motivo junto al campo, permitiendo volver
a seleccionar el mismo archivo corregido. El nombre visible no se confunde con una
validación criptográfica: la privada y contraseña se comprueban en el backend al
continuar. No cambia el formato `.stckey.json` ni el cuerpo de las peticiones.
Los formularios de documentos/firmas que ya conservaban el nombre siguen funcionando.

## Avisos específicos con memoria del evento

Ejemplo de presentación:

- «Solicitud de recuperación de “Acuerdo presupuestario”».
- «Solicitante: Camila. Grupo: Comité de coordinación…».
- «Te agregaron al grupo “Comité de coordinación”».
- «Te compartieron “Circular de coordinación”».

Una tabla privada `stc_private.notification_context` captura nombre del recurso,
grupo y solicitante al crear el aviso. No almacena contenidos del documento, motivos
de recuperación, contraseñas, fragmentos o claves privadas. Las claves solo aportan
su etiqueta; los cambios de perfil, el nombre del rol al emitir el aviso.
La captura es inmutable: renombrar después un grupo no reescribe avisos anteriores.

La tabla pública `stc_notifications`, utilizada por Realtime, conserva sus mensajes
genéricos. Solo la RPC de la bandeja compone los mensajes específicos tras comprobar
el dueño y el acceso documental actual. La tabla privada tiene RLS, revocaciones y
no se publica en Realtime; ni JWT ni service_role la consultan directamente.
Se conserva el contrato HTTP: mismos campos title/body, UUID, categoría y destino.
React muestra estos nombres como texto, sin insertar HTML.

Si se pierde el permiso documental, las notificaciones permanecen pero su presentación
vuelve al mensaje genérico, sin los nombres documentales. Los avisos de pertenencia
a grupos son recibos personales: su nombre histórico puede seguir viéndose con el
permiso groups.read, aunque la persona ya no pertenezca al grupo; el aviso de retiro
conserva su enlace al directorio, sin conceder acceso al grupo anterior.

Al instalar, los avisos existentes se enriquecen con los nombres disponibles en ese
momento y se marcan internamente como backfilled. No se afirma reconstruir nombres
históricos que ya habían cambiado. Desde la instalación se captura el contexto al
ocurrir el evento. No se crean avisos duplicados ni se cambia su UUID, fecha, lectura,
contador o enlace. La bandeja continúa siendo persistente y propia de cada cuenta.

## Instalación

Aplicar sobre la misma rama que ya contiene las cuatro entregas anteriores, incluida
`STC_Notificaciones_Flujo_Claro_v1.zip`. El instalador compara archivos reales,
admite esas entregas todavía sin commit y se detiene ante contenido incompatible.
No regresar a develop, hacer reset ni volver a instalar paquetes anteriores.

Ejecutar una sola vez la migración nueva:
`supabase/migrations/20261026180000_dashboard_notification_context.sql`.
Requiere las ocho anteriores, incluida `20261026120000_notifications.sql`.
No repetirlas. No ejecutar SQL de pruebas en Supabase remoto. No se requieren
nuevos buckets, claves, dependencias, variables `.env` ni configuración de Realtime.
Reiniciar backend y frontend.

## Validación

Pruebas de contrato HTTP, conteos SQL completos con más de veinte notas, aislamiento
por cuenta, capacidades pendientes, captura histórica de nombres y enmascaramiento
al retirar permisos. La demostración en navegador utiliza cuentas independientes,
selector nativo de archivos, recuperación real y comprobación de escritorio/móvil.
Auth y Storage remotos se sustituyen por contratos locales. No se modifica el
Supabase del usuario ni se afirma probar Google OAuth o el WebSocket del proveedor.

Comprobaciones de esta entrega: 470 pruebas de backend; 33 de frontend; 423
comprobaciones SQL, incluidas 44 nuevas; y 53 verificaciones de navegador.
Ruff, formato, mypy, ESLint y build correctos. Python local 3.12.14; la versión
configurada en CI se conserva.
