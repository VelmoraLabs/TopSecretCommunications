# Organización modular del backend

## Estructura implementada

| Ruta | Responsabilidad |
| --- | --- |
| `app/main.py` | Crear FastAPI y registrar el router agregado. |
| `app/api/router.py` | Reunir las rutas de la aplicación. |
| `app/modules/health/router.py` | Mantener el endpoint `/health`. |
| `app/crypto/shamir/` | Dividir, reconstruir y serializar secretos de 32 bytes. |
| `tests/crypto/shamir/` | Pruebas matemáticas, de validación y de formato. |
| `demos/shamir_demo.py` | Demostración local con datos ficticios. |

## Módulos previstos para el equipo

| Ruta futura | Responsable y función |
| --- | --- |
| `crypto/signatures/` | Axel: SHA-256 y RSA-PSS. |
| `crypto/encryption/` | Roberto: AES-256-GCM. |
| `crypto/key_wrapping/` | Roberto: RSA-OAEP. |
| `modules/auth/` | Yael: sesiones y JWT de Supabase. |
| `modules/access/` | Yael: permisos y coordinación del acceso conjunto. |
| `modules/documents/` | Equipo: gestión y flujos según categoría documental. |
| `modules/keys/` | Equipo: claves públicas y sobres de claves. |
| `infrastructure/` | Equipo: adaptadores para PostgreSQL y Storage. |
| `core/` | Configuración común y manejo general de errores cuando se necesiten. |

No crear módulos vacíos para representar funcionalidad pendiente. Cada paquete
Python implementado lleva `__init__.py`.

## Convenciones

Cada módulo funcional puede reunir `router.py`, `schemas.py`, `service.py` y,
si utiliza persistencia, `repository.py`. Solo crear los archivos necesarios.

El router valida el contrato HTTP y llama al servicio. Los modelos Pydantic
describen solicitudes y respuestas. El servicio coordina políticas, algoritmos
y repositorios. El motor criptográfico recibe datos como argumentos y no conoce
HTTP, usuarios, Supabase ni la interfaz. Los adaptadores concentran las llamadas
a servicios externos. Las tablas de Supabase se definirán mediante migraciones.

Las futuras rutas funcionales utilizarán `/api/v1`; `/health` conserva su URL.

`documents/workflows/` contendrá los procedimientos de memorandos, expedientes,
notas diplomáticas y notas especiales. Los workflows llaman a los algoritmos;
no copian sus implementaciones. Los fragmentos Shamir se identifican por índice
y conjunto; la identidad del participante se resolverá en el módulo de acceso.

## Alcance de esta rama

Preparación de Shamir, división, reconstrucción y pruebas iniciales. La
reconstrucción y las pruebas adelantan tareas del calendario de octubre. AES,
firmas, JWT, persistencia y el flujo documental completo siguen pendientes.
