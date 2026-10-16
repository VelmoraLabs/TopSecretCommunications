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
| `app/infrastructure/supabase.py` | Cliente de Auth y PostgREST con JWT de usuario. |
| `../supabase/` | Migraciones de perfiles, roles, permisos, RLS y auditoría. |
| `tests/crypto/shamir/` | Pruebas matemáticas, de validación y de formato. |
| `demos/shamir_demo.py` | Demostración local con datos ficticios. |

## Módulos previstos para el equipo

| Ruta futura | Responsable y función |
| --- | --- |
| `crypto/signatures/` | Axel: SHA-256 y RSA-PSS. |
| `crypto/key_wrapping/` | Roberto: RSA-OAEP. |
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

`documents/workflows/` contendrá los procedimientos de memorandos, expedientes,
notas diplomáticas y notas especiales. Los workflows llaman a los algoritmos;
no copian sus implementaciones. Los fragmentos Shamir se identifican por índice
y conjunto; la identidad del participante se resolverá en el módulo de acceso.

## Alcance actual

AES-GCM y Shamir permanecen separados y sin dependencia de HTTP o usuarios. El
servicio documental coordina su formato portable. Las rutas documentales exigen
sesión y permisos aunque el flag de registro local esté habilitado.

El módulo auth verifica el JWT con Supabase Auth, consulta permisos actuales por
PostgREST y expone administración con las RPC de la BD. El frontend integra Google,
sesión y perfiles. Grupos, distribución protegida de fragmentos, Storage y firmas
siguen pendientes. Ver [autenticación](authentication.md) y [contrato documental](special-notes-backend.md).
