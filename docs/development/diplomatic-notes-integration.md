# Notas y comunicados: bloque 5, avisos y dashboard

Base del usuario: `feature/diplomatic-notes`, bloque 4 guardado en `f3d8fcc`.
Este paquete complementa `diplomatic-notes.md` sin reemplazar la documentación
ni los componentes de creación y recuperación del bloque 4.

## Comportamiento

| Elemento | Regla |
| --- | --- |
| Total documental | Suma catálogo autorizado, expedientes disponibles, notas especiales disponibles y notas/comunicados publicados. |
| Firmados | Suma documentos del catálogo con sus firmas completas y notas/comunicados publicados con firma del emisor. No significa que el lector ya haya recuperado o verificado cada archivo. |
| Notas especiales | Conserva su contador de notas de grupo; no incluye notas diplomáticas ni comunicados. |
| Notas y comunicados | Acceso propio a `/notas-diplomaticas`, con total completo de ambos tipos. |
| Recientes | Hasta seis entradas de todos los módulos autorizados; cada una dirige a su detalle exacto. El límite no altera los totales. |
| Pendientes | Las cargas de notas/comunicados en `staging` son tareas exclusivas de su creador con permiso de creación y lectura. No cuentan como disponibles ni firmados. Cancelarlas retira el pendiente. |
| Catálogo anterior | Sus notas siguen contando y conservan un enlace separado a `/documentos?tipo=nota` cuando existen registros anteriores. |
| Avisos | Solo una publicación confirmada notifica a destinatarios originales activos con lectura. El emisor no recibe un aviso de su propia publicación. |

La integración usa `target_kind=diplomatic_note` para ambos tipos, con eventos
`diplomatic_note_shared` y `communique_shared`. Las rutas se construyen localmente
con un UUID válido: `/notas-diplomaticas?nota=UUID`. Ningún aviso abre una URL
arbitraria del servidor. Leerlo marca lectura y abre el detalle; no descarga,
firma ni aporta claves automáticamente.

Los avisos se generan mediante un trigger sobre la auditoría de publicación,
dentro de la misma transacción. Una publicación fallida no deja un aviso parcial;
un reintento idempotente no duplica el evento. Reservas, cancelaciones y descargas
no anuncian una comunicación nueva. Se conserva el trigger de expedientes.

Los títulos se capturan en `stc_private.notification_context`. La tabla publicada
en Realtime conserva textos genéricos, sin título, nombre de archivo, firma,
sobres ni claves. La bandeja vuelve a comprobar el acceso actual antes de mostrar
el título. Perder lectura enmascara los nombres; fecha, UUID y estado de lectura
se conservan. Una cuenta ajena, incluso administradora, no obtiene documentos
por aparecer en un contador o por conocer su URL.

Retirar una clave de cifrado o firma no oculta las asignaciones históricas. La
recuperación sigue usando la privada original y comprobando GCM y RSA-PSS en el
backend antes de entregar los bytes. Esta integración no modifica el cifrado,
el contenido de Storage, los respaldos ni las asignaciones.

## Archivos del paquete

- Dos contratos de API: dashboard y notificaciones.
- Fixture agregado del dashboard y 18 pruebas nuevas de API.
- Helpers de destinos, pantalla del dashboard y cuatro pruebas nuevas del frontend.
- Una migración nueva, su inventario de solo lectura y pruebas SQL transaccionales.
- Este documento. En total son 14 archivos; no cambia dependencias.

La migración es `supabase/migrations/20261031000000_diplomatic_notifications_dashboard.sql`.
Se aplica una vez después de las doce anteriores, incluida
`20261030180000_diplomatic_notes.sql`. Sustituye las funciones agregadas de avisos
y resumen y añade el trigger del módulo nuevo. No modifica migraciones anteriores.

Las comunicaciones ya publicadas entran inmediatamente al dashboard autorizado.
**No se generan avisos retroactivos** para ellas. Los avisos nuevos se comprobarán
creando otra nota o comunicado después de instalar la migración.

## Validación y límites

Antes de recuperar el entorno de trabajo, la batería completa con los bloques
1–4 e integración aprobó 779 pruebas de backend y 73 de frontend, junto con Ruff,
mypy, ESLint y TypeScript/Vite. Chromium con HTTP simulado comprobó contadores,
enlaces de categoría y catálogo anterior, recientes, cargas pendientes propias,
miembro sin pendientes de otro creador, apertura del comunicado exacto desde su
aviso y vistas de 1440 y 390 píxeles sin desbordamiento horizontal.

Después de recuperar el entorno se repitieron las 18 pruebas nuevas de API, los
checks de Python y los tests/lint/build del frontend sobre la base local disponible
hasta el bloque 2. No se entregan versiones reconstruidas de los bloques 3 y 4:
se conservan los archivos ya instalados por Roberto. La base recuperada aprobó
725 pruebas Python y 55 del frontend. En su copia completa deben
repetirse las baterías, esperando 779 pruebas del backend y 73 del frontend.

Las pruebas SQL se ejecutan con datos sintéticos en PostgreSQL embebido/PGlite,
con los roles y esquemas mínimos de Auth y Storage simulados. No equivalen a una
prueba de Auth, Storage ni de transporte Realtime contra el Supabase compartido.
La revisión final aplicó las trece migraciones y aprobó las doce baterías SQL
(678 comprobaciones en total, 62 nuevas). El inventario mostró nueve filas en true.
El nuevo fixture comprueba eventos, conteos globales, permisos, historial,
privacidad, cancelación y rollback transaccional. Las pruebas criptográficas
continúan en los módulos Python de notas.

El archivo `supabase/tests/diplomatic_notifications_dashboard.sql` contiene
fixtures con una guardia de base vacía y termina en rollback. **No se ejecuta en
el proyecto compartido.** Para instalar allí se usa únicamente la migración y
el inventario de `supabase/scripts/check_diplomatic_integration_setup.sql`.

## Instalación en Windows

1. Conservar `feature/diplomatic-notes` y el commit `f3d8fcc`; comprobar carpeta
   limpia. Detener backend y frontend con Ctrl+C, confirmando S si CMD lo pregunta.
2. Descargar el ZIP en Descargas y extraerlo en la raíz del proyecto:

```bat
cd /d "%USERPROFILE%\Desktop\TopSecretCommunications"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%USERPROFILE%\Downloads\DiplomaticNotes_Bloque_5_Notificaciones_Dashboard.zip' -DestinationPath '%USERPROFILE%\Desktop\TopSecretCommunications' -Force"
backend\.venv\Scripts\activate.bat
cd backend
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest -q
cd ..
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
git --no-pager diff --check
git --no-pager status --short --untracked-files=all
```

3. Abrir la migración nueva en el editor, copiar su contenido completo y ejecutarlo
   una sola vez como `postgres` en una consulta nueva del SQL Editor de Supabase.
   Debe terminar con `Success. No rows returned`.
4. En otra consulta nueva ejecutar el contenido del inventario
   `supabase/scripts/check_diplomatic_integration_setup.sql`. Son nueve filas,
   todas con `correcto = true`.
5. Reiniciar los servidores en sus consolas. Backend:

```bat
cd /d "%USERPROFILE%\Desktop\TopSecretCommunications"
backend\.venv\Scripts\activate.bat
python -m uvicorn app.main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```bat
cd /d "%USERPROFILE%\Desktop\TopSecretCommunications"
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

## Pruebas reales con Roberto y Moralitos

1. En cada cuenta abrir Dashboard y pulsar Actualizar resumen. Las comunicaciones
   publicadas anteriores deben contar junto con sus expedientes y otros documentos.
   Notas y comunicados también deben sumar a Firmados; Notas especiales conserva
   su cuenta de grupo independiente.
2. En Moralitos, si solo conserva tres expedientes y las dos comunicaciones
   compartidas, deben aparecer cinco Documentos y dos Firmados. La nota privada
   de Roberto debe quedar fuera. Usar los datos reales si se añadieron registros.
3. Abrir una nota o comunicado desde Recientes y comprobar que dirige al detalle
   de ese recurso en Notas y comunicados. La categoría homónima abre su listado.
4. Desde Roberto crear una nota nueva titulada Nota de integración 01 para Moralitos,
   usando sus claves existentes. En Moralitos comprobar un aviso nuevo con su
   título en la categoría Documentos. Abrirlo: debe llevar al detalle exacto y
   marcarse leído, sin descargar hasta pedir la recuperación con su propia privada.
5. Repetir la publicación como Comunicado; comprobar el aviso de ese tipo. Volver
   a descargar no debe producir otro aviso de publicación.
6. Crear una comunicación únicamente para Roberto y comprobar que Moralitos no
   recibe aviso ni la cuenta o ve en recientes. La URL directa debe seguir
   rechazándose. Comparar resultados con la lista del módulo propio.
7. Registrar resultados antes de hacer el commit del bloque 5. Revisión, PR y merge
   corresponden al flujo del equipo; este ZIP no los publica automáticamente.

## Evidencia manual previa: bloque 4

Roberto confirmó creación de nota y comunicado, recuperación del original por
Roberto y Moralitos, rechazos de contraseña incorrecta, respaldo ajeno y generación
anterior, nueva recuperación válida, filtros de tipo y búsqueda, y una nota propia
que Moralitos no ve ni puede abrir por URL. El bloque quedó guardado en `f3d8fcc`.
