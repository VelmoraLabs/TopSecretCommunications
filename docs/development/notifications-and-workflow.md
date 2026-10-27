# Notificaciones y simplificación del flujo

Actualización: [Dashboard y contexto](dashboard-and-notification-context.md) incorpora nombres específicos mediante snapshots privados y un resumen documental integrado.

Esta entrega continúa la recuperación colaborativa ya instalada. Conserva las
notas, participantes originales, claves históricas y aportaciones existentes.
No cambia AES-GCM, Shamir, RSA-OAEP, RSA-PSS ni los formatos criptográficos.

## Recorrido de notas especiales

1. Crear una nota para un grupo con perfiles activos y claves preparadas.
2. Cada fragmento se conserva cifrado en la base de datos, protegido para su dueño.
3. Un participante original solicita recuperar e indica el motivo. El plazo por
   defecto es una hora; cambiarlo es opcional.
4. Los participantes reciben un aviso en la campana y en Notificaciones. Su enlace
   abre la nota y la solicitud exactas, con comprobación actual de permisos.
5. Cada integrante selecciona su archivo de clave privada `.stckey.json`, introduce
   su contraseña y autoriza la aportación. El backend obtiene y autentica el sobre
   asignado de la base de datos. No se pide ni se acepta un fragmento arbitrario.
6. Al reunir n/n, el solicitante recibe el aviso de que puede recuperar. Utiliza
   su privada fijada al crear la solicitud y descarga el documento autenticado.

Shamir sigue reconstruyendo la clave AES con los fragmentos reales. La contraseña
no sustituye un fragmento. Este es un modelo de custodia de sobres cifrados en el
servidor, con autorización individual mediante claves privadas personales.
El backend sigue siendo de confianza y procesa secretos temporalmente en memoria;
no se afirma cifrado de extremo a extremo frente al servidor. No se persisten las
privadas, contraseñas, clave AES reconstruida ni documento original de la nota.

No hay una nueva clave RSA por nota o solicitud. La de protección de fragmentos se
reutiliza mientras esté vigente y permanece separada de la clave de firma.
La clave AES sí es nueva por documento y se administra automáticamente. Las
asignaciones históricas no cambian al rotar una clave.

La pantalla selecciona automáticamente la solicitud activa al abrir una nota.
El historial queda plegado. Un enlace de aviso puede abrir una solicitud histórica;
si hay otra activa, se ofrece ir a ella. Se mantienen el plazo de reunión, rechazo,
cancelación, permisos, comprobación final y ventana de reintento de diez minutos.

El respaldo del fragmento y el del paquete cifrado son opcionales y quedan plegados.
No hay una comprobación del fragmento obligatoria previa al aporte: aportar ya lo
valida. La API de diagnóstico anterior se conserva para compatibilidad.
Las herramientas portables siguen disponibles mediante una entrada manual explícita.

## Eventos generales implementados

| Evento confirmado | Destinatario |
| --- | --- |
| Alta o reincorporación a un grupo | Persona incorporada |
| Cambio efectivo entre responsable e integrante | Persona afectada |
| Retiro del grupo | Persona retirada; enlace al directorio, no al grupo perdido |
| Archivo o reactivación de grupo | Miembros actuales |
| Nota especial lista | Participantes originales de la nota |
| Memorándum enviado | Destinatarios finales, salvo el propio emisor |
| Revisión institucional solicitada | Aprobador asignado |
| Firma institucional registrada | Emisor, para completar su envío |
| Recuperación solicitada | Todos los participantes originales, incluido solicitante |
| Recuperación lista n/n | Solo solicitante |
| Recuperación completada/cancelada/rechazada/vencida | Participantes originales |
| Cambio de rol o estado de perfil | Cuenta afectada, visible solo con perfil activo |
| Activación/retiro de clave de protección; retiro de firma | Dueño de la clave |

No se emiten avisos por cada aporte ni por cambios de texto del grupo. Tampoco por
iniciar una carga o preparar una clave sin terminarla. El progreso permanece en el
detalle. No hay notificaciones de funciones todavía no implementadas ni envíos de
correo, push del navegador o mensajes a servicios externos.

## Persistencia, seguridad y lectura

`public.stc_notifications` contiene destinatario, categoría, tipo, referencia,
texto predeterminado, creación y lectura. Nunca guarda contenidos, motivos de
recuperación, títulos de archivos, contraseñas, fragmentos o claves privadas.
La tabla pública mantiene texto genérico. La actualización de contexto incorpora
los nombres al consultar por API y los enmascara cuando se pierde acceso documental.
La referencia no es una autorización.

Los triggers se ejecutan sobre eventos de negocio confirmados, en la misma
transacción. La mayoría se conecta a los registros de auditoría existentes, sin
reemplazar sus funciones ni confiar en que el frontend emita un aviso. La nota se
notifica al pasar a ready, tras guardar su información cifrada. Un fallo de la
operación revierte también el aviso. La restricción `(recipient_id, source)` y las
transiciones existentes impiden duplicados por reintentos.

Solo el dueño con perfil activo consulta sus filas. Ni el administrador tiene una
bandeja global. RLS protege la tabla y las escrituras directas están revocadas.
Solo RPC con el JWT actual marcan lectura. No existe endpoint público para enviar
notificaciones arbitrarias, elegir destinatarios o fabricar eventos.

Marcar una notificación como leída no aporta, firma, aprueba ni cancela nada.
La campana y el centro comparten el contador. «Marcar todas» aplica a todas las
categorías hasta el corte `snapshot_at` devuelto por el servidor; un aviso posterior
no se marca por accidente. Leer es idempotente y conserva el primer `read_at`.
El usuario puede filtrar por categoría y sin leer, y recorrer páginas de 20.

Realtime publica únicamente esta tabla de metadatos, con filtro por destinatario
más RLS. Los eventos invalidan la bandeja; no autorizan operaciones. Se renueva el
token y se cierra la suscripción al salir. Se concilia cada diez segundos mientras
la pestaña esté visible y al recuperar foco; sigue funcionando sin WebSocket.
Los avisos sobreviven a desconexiones porque están en PostgreSQL, no solo en el
canal. La expiración de recuperaciones se concilia mediante el mantenimiento
existente, sin un cron nuevo.

Al instalar se generan únicamente avisos de tareas pendientes vigentes anteriores:
aportaciones faltantes, recuperaciones listas y revisiones institucionales. No se
inventan notificaciones de todo el historial. Las operaciones posteriores se
notifican automáticamente. Los avisos no se borran automáticamente en esta versión;
no se define una política de retención sin un requisito del proyecto.

## API y frontend

- GET `/api/v1/notifications?state=all&category=all&limit=20&offset=0`.
- POST `/api/v1/notifications/{uuid}/read`.
- POST `/api/v1/notifications/read-all`, cuerpo `{"before":"<snapshot_at>"}`.

`modules/notifications` contiene contratos y rutas. La generación transaccional y
el aislamiento viven en la migración. `features/notifications` contiene contratos,
proveedor de sesión, lista y campana; `pages/Notifications` implementa el centro.
Las rutas de destino se construyen con UUID validados y destinos locales fijos,
no con URLs arbitrarias. Documentos, grupos y notas aceptan enlaces directos y
vuelven a autorizar sus datos en backend. Un destino inaccesible muestra el error;
conservar el aviso no recupera permisos perdidos.

Para añadir un evento futuro: extender el catálogo de mensajes en una migración,
emitirlo desde la transacción del hecho confirmado con una fuente estable, escoger
solo destinatarios autorizados, y probar idempotencia/aislamiento. No añadir un
`notify()` manipulable desde formularios.

## Firmas y comprobaciones

Antes de descargar un memorándum, FastAPI comprueba tamaño/SHA-256 y todas sus
firmas registradas con las públicas y huellas históricas. Para un documento enviado
exige firma del emisor y, cuando corresponda, aprobación institucional. La clave
retirada no invalida por sí sola una firma anterior. Una firma inválida bloquea
la entrega. Después del cálculo vuelve a consultar el acceso y la versión.

La respuesta indica si verificó firmas o solo integridad. Un borrador sin firmas
puede descargarse por quien tenga acceso, pero no se muestra como firmado.
La comprobación manual de un archivo externo y la exportación de evidencias
permanecen como opciones secundarias. Los valores Base64 y huellas están plegados.
Los enlaces de errores abren las secciones avanzadas que contienen el campo antes
de enfocarlo. Se conservan validaciones junto al campo y botones deshabilitados.

## Instalación

Aplicar este ZIP en la misma rama con los tres incrementos anteriores instalados.
No resetear, repetir entregas anteriores ni reemplazar la carpeta completa.
Ejecutar solo `20261026120000_notifications.sql` una vez en SQL Editor como postgres,
con las siete migraciones previas ya aplicadas. No ejecutar SQL de pruebas remoto.
No requiere nuevas dependencias, claves, bucket ni variables `.env`.
Reiniciar frontend/backend.

La migración es transaccional, añade sus propias tablas/funciones/triggers y la
publicación de metadatos. No borra documentos ni cambia sobres, notas o solicitudes.
Las privadas existentes siguen funcionando.

## Validación

La entrega incluye pruebas HTTP y criptográficas, aislamiento y eventos SQL, y
contratos del frontend. Se complementa con pruebas de integración de FastAPI y
PostgreSQL y una demostración automatizada en navegador con cuentas independientes.
Auth/Storage remotos se sustituyen por contratos locales; no se modifica el proyecto
Supabase del usuario ni se prueba Google OAuth real. La entrega requiere comprobar
la conexión real a Supabase Realtime después de instalarla.

Referencia de Realtime: https://supabase.com/docs/guides/realtime/postgres-changes.
