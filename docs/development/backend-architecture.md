# Organización modular del backend

## Estructura implementada

| Ruta | Responsabilidad |
| --- | --- |
| `app/main.py` | Crear FastAPI y registrar el router agregado. |
| `app/api/router.py` | Reunir las rutas de la aplicación. |
| `app/modules/health/router.py` | Mantener el endpoint `/health`. |
| `app/crypto/shamir/` | Dividir, reconstruir y serializar secretos de 32 bytes. |
| `app/crypto/encryption/` | Claves AES-256 y cifrado/descifrado GCM con nonce, ciphertext y tag. |
| `app/modules/documents/` | Contratos, servicio y rutas de notas especiales. |
| `app/core/request_limits.py` | Límite del cuerpo HTTP antes de procesar JSON/Base64. |
| `app/core/config.py` y `errors.py` | Configuración y errores públicos de servicio. |
| `app/modules/auth/` | Identidad, permisos y administración con contratos HTTP. |
| `app/infrastructure/supabase.py` | Auth/PostgREST con JWT y canal privado para Storage/RPC confiables. |
| `app/crypto/signatures/` | SHA-256, RSA-PSS y formatos de claves. |
| `app/crypto/key_wrapping/` | Primitivas RSA-OAEP. |
| `app/modules/memoranda/` | Documentos persistidos, destinatarios y firmas. |
| `../supabase/` | Migraciones de perfiles, roles, permisos, RLS y auditoría. |
| `tests/crypto/shamir/` | Pruebas matemáticas, de validación y de formato. |
| `demos/shamir_demo.py` | Demostración local con datos ficticios. |

## Módulos previstos para el equipo

| Ruta futura | Responsable y función |
| --- | --- |
| `modules/access/` | Yael: permisos y coordinación del acceso conjunto. |
| `modules/documents/` | Equipo: ampliar el flujo existente a las demás categorías. |
| `modules/keys/` | Equipo: claves públicas y sobres de claves. |
| `infrastructure/storage.py` | Equipo: futuro adaptador de archivos cifrados en Storage. |

No crear módulos vacíos para representar funcionalidad pendiente. Cada paquete
Python implementado lleva `__init__.py`.

## Convenciones

Cada módulo funcional puede reunir `router.py`, `schemas.py`, `service.py` y,
si utiliza persistencia, `repository.py`. Solo crear los archivos necesarios.

El router valida el contrato HTTP y llama al servicio. Los modelos Pydantic
describen solicitudes y respuestas. El servicio coordina políticas, algoritmos
y repositorios. El motor criptográfico recibe datos como argumentos y no conoce
HTTP, usuarios, Supabase ni la interfaz. Los adaptadores concentran las llamadas
a servicios externos. Las tablas de Supabase se definen mediante migraciones versionadas.

Las futuras rutas funcionales utilizarán `/api/v1`; `/health` conserva su URL.

Los nuevos flujos documentales coordinarán los procedimientos de expedientes,
notas diplomáticas y notas especiales. Los workflows llaman a los algoritmos;
no copian sus implementaciones. Los fragmentos Shamir se identifican por índice
y conjunto; la identidad del participante se resolverá en el módulo de acceso.

## Alcance actual

AES-GCM y Shamir permanecen separados y sin dependencia de HTTP o usuarios. El
servicio documental coordina su formato portable. Las rutas documentales exigen
sesión y permisos aunque el flag de registro local esté habilitado.

El módulo auth verifica el JWT con Supabase Auth, consulta permisos actuales por
PostgREST y expone administración con las RPC de la BD. El frontend integra Google,
sesión y perfiles. El módulo de [grupos](groups.md) añade organización, integrantes,
responsables, RLS y auditoría, sin modificar las primitivas criptográficas.
Los memorándums integran Storage privado y firmas con usuarios. Las notas especiales distribuyen fragmentos cifrados por cuenta e integran solicitudes, aportaciones y recuperación colaborativa. Ver [autenticación](authentication.md) y
[contrato documental](special-notes-backend.md).

## Integración de memorándums

`modules/memoranda/` reúne contratos, router y servicio; coordina identidad, asignación individual, Storage y firma. `crypto/signatures/key_files.py` serializa claves sin acceder a HTTP ni BD. El gateway distingue el JWT del usuario de las operaciones confiables del servidor; no se admiten firmas verificadas declaradas por clientes. Consulta [contratos y arquitectura RSA-PSS](memoranda-signatures.md).

La entrega se autoriza en PostgreSQL y en FastAPI: el documento cargado no se comparte con destinatarios finales hasta un envío explícito, verificado y auditado. Firma de emisión y aprobación institucional tienen permisos y etapas distintos.

## Notas especiales persistentes por grupo

`modules/group_notes/` coordina snapshot y persistencia, conserva notas portables
anteriores y usa custodia individual para las notas nuevas.
Reutiliza `documents.service.protect_note`, los contratos v1 del paquete, las
utilidades HTTP documentales y el gateway privado de Supabase. Las primitivas
en `crypto/` no cambian. El router persistente no depende del flag del flujo
portable; su recuperación manual utiliza los endpoints portables ya existentes.

PostgreSQL fija participantes en una transacción y revalida identidad, permisos,
versión del grupo y estado. Storage recibe solo ciphertext, bajo el prefijo
`special-notes/`. En las notas portables anteriores la confirmación de resguardo publica la nota;
no representa una aportación colaborativa. Las notas nuevas se publican tras
guardar todos sus sobres individuales. Consulta `group-notes-storage.md` para las garantías,
los fallos de red y el procedimiento de conciliación.

## Custodia individual de Shamir

`modules/encryption_keys` coordina generación, activación mediante PKCS8 cifrado y
retiro por perfil. `crypto/key_wrapping/share_envelope.py` compone AES-GCM y
RSA-OAEP existentes para proteger cada fragmento, autenticando su contexto.
`modules/group_notes` persiste los sobres y publica la nota atómicamente; sus
endpoints de lectura nunca exponen sobres ajenos. La comprobación individual no
reconstruye documentos. Detalles: `recipient-share-custody.md`.

## Solicitudes de recuperación

`modules/note_recovery` coordina aportaciones cifradas para la clave del solicitante,
autorización y reconstrucción n de n usando `documents.service.recover_note`.
`recovery_envelope.py` amplía el contexto híbrido con solicitud/autor. El material
temporal queda cifrado en un esquema privado; `main` gestiona su limpieza periódica.
La autorización se revalida después de descifrar y antes de devolver el archivo.
Consulta `collaborative-note-recovery.md`.

## Notificaciones generales y recorrido simplificado

Centro de avisos persistentes por destinatario, enlaces directos a las operaciones,
recuperación con fragmentos cifrados de la base de datos y verificación de firmas
antes de descargar. Conserva las claves y documentos existentes.

Guía: [Notificaciones y flujo](notifications-and-workflow.md).

## Dashboard y avisos específicos

Resumen autorizado de documentos/notas, tareas propias y contexto histórico de
notificaciones. Los selectores de claves conservan el nombre del archivo válido.
Guía: [Dashboard y contexto](dashboard-and-notification-context.md).
