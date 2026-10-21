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
Los memorándums integran Storage privado y firmas con usuarios. Siguen pendientes la distribución de fragmentos y los otros flujos documentales. Ver [autenticación](authentication.md) y
[contrato documental](special-notes-backend.md).

## Integración de memorándums

`modules/memoranda/` reúne contratos, router y servicio; coordina identidad, asignación individual, Storage y firma. `crypto/signatures/key_files.py` serializa claves sin acceder a HTTP ni BD. El gateway distingue el JWT del usuario de las operaciones confiables del servidor; no se admiten firmas verificadas declaradas por clientes. Consulta [contratos y arquitectura RSA-PSS](memoranda-signatures.md).

La entrega se autoriza en PostgreSQL y en FastAPI: el documento cargado no se comparte con destinatarios finales hasta un envío explícito, verificado y auditado. Firma de emisión y aprobación institucional tienen permisos y etapas distintos.
