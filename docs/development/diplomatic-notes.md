# Notas diplomáticas y comunicados: punto 2.8

## Estado y alcance del primer bloque

Base de este paquete: `bf1957a`, rama `feature/personnel-files`, con expedientes,
avisos y dashboard ya incorporados. El desarrollo nuevo se separa en
`feature/diplomatic-notes` para conservar el alcance del PR de expedientes.

El enunciado de Top Secret Communications exige confidencialidad y firma digital
para notas diplomáticas y comunicados. La categoría `nota` y sus textos existen
en el catálogo y en el frontend, pero eso no implementa la creación, el cifrado
ni la recuperación de esos documentos. La ruta de creación existente genera
memorándums y conserva sus bytes originales en Storage privado: no debe usarse
para almacenar primero una nota en claro y cifrarla después.

Este bloque añade exclusivamente contratos y un servicio síncrono en memoria.
No añade rutas, tablas, migraciones, botones, avisos ni registros al dashboard.
Después de instalarlo, la web y `/docs` conservan su funcionalidad anterior.
Sus pruebas no necesitan `.env`, conexión a Supabase ni cuentas reales.

| Documento | Política del servicio |
| --- | --- |
| Nota diplomática (`diplomatic_note`) | Firma RSA-PSS del emisor y cifrado AES-GCM; acceso individual por destinatario mediante RSA-OAEP. |
| Comunicado (`communique`) | Misma protección; el tipo forma parte de los datos firmados y autenticados. |
| Nota especial | Conserva el módulo de grupos y recuperación colaborativa existente. |
| Memorándum | Conserva el flujo de firma, aprobación y envío existente. |
| Expediente de personal | Conserva su flujo de cifrado individual, sin exigir firma. |

La primera versión de notas contempla una firma de emisión del creador. No
presupone una aprobación institucional adicional ni múltiples firmantes; esos
flujos requieren contratos propios si el equipo decide incorporarlos. La firma
del emisor no concede aprobación de un embajador.

## Archivos e interfaces

| Archivo | Contenido |
| --- | --- |
| `backend/app/modules/diplomatic_notes/__init__.py` | Identificación del módulo. |
| `backend/app/modules/diplomatic_notes/schemas.py` | Petición de creación, snapshot de firma, cabecera, paquete interno y credenciales de apertura. |
| `backend/app/modules/diplomatic_notes/service.py` | `protect_note`, `open_note`, representación canónica y comprobación de claves. |
| `backend/tests/diplomatic_notes/test_diplomatic_service.py` | Pruebas reales de cifrado, firma, aislamiento y rechazo de alteraciones. |
| `docs/development/diplomatic-notes.md` | Alcance, decisiones e instrucciones de integración. |

`CreateDiplomaticNote` recibe tipo, título, archivo en Base64, destinatarios,
identificador de clave de firma y privada cifrada con su contraseña. Los dos
últimos secretos reutilizan `PrivateKeyInput`; la contraseña no se recorta.
No admite un emisor elegido, clave pública, firma ya fabricada ni umbral Shamir.

`RegisteredSigningKey` es un snapshot interno, con identificador, perfil dueño,
pública, huella e indicador de vigencia. No sustituye una consulta autorizada a
`stc_signing_keys`. `EncryptionKey` también procede del servidor, por cada perfil
original. Ningún endpoint futuro debe aceptar estos snapshots del navegador.

`protect_note(principal, body, recipient_keys, signing_key, *, document_id,
version_id)` devuelve `ProtectedDiplomaticNote`. Los identificadores de documento
y versión serán reservados por el servidor antes de firmar; no se toman de la
petición pública. El resultado contiene cabecera, firma, nonce, ciphertext y tag.

`open_note(principal, protected, encryption_key, signing_key, body)` devuelve
los bytes originales únicamente después de autenticar GCM y verificar RSA-PSS.
`OpenDiplomaticNote` incluye versión, identificador de clave de cifrado y privada
cifrada con contraseña. El destinatario no necesita una privada de firma.

## Protección y comprobación

1. Verificar que el emisor está activo y tiene `documents.create`,
   `documents.read_assigned` y `documents.sign`.
2. Verificar que la clave de firma es del emisor, coincide con la seleccionada y
   está activa. Validar pública y huella usando el módulo de Axel.
3. Resolver exactamente una clave activa de cifrado por destinatario y por
   creador, sin duplicados. Si se selecciona al propio creador, se incluye una vez.
   No reutilizar el mismo material RSA para firma y cifrado.
4. Validar los bytes originales, hasta 5 MiB. Generar una AES nueva de 32 bytes y
   protegerla con RSA-OAEP para cada perfil. Ordenar los sobres por UUID de perfil.
5. Construir la cabecera definitiva y firmar el mensaje especificado abajo con
   RSA-PSS. Reutilizar `memoranda.service.make_signature`: abre la privada de firma,
   comprueba que corresponde a la pública confiable y verifica la firma generada.
6. Cifrar el archivo original con AES-GCM, usando cabecera y firma como AAD.
   La firma se conserva separada en material privado, no dentro del ciphertext.
   El ciphertext tiene el mismo tamaño que el original y cabe en el límite de
   5 MiB existente; nonce, tag y firma se persistirán fuera del objeto de Storage.
7. Para abrir, comprobar perfil, asignación original, versión y claves originales.
   Recuperar AES con la privada RSA-OAEP del destinatario, validar GCM y comprobar
   la firma RSA-PSS del emisor antes de devolver el archivo.

Las primitivas se conservan: AES-256-GCM con nonce de 12 bytes y tag de 16;
RSA-OAEP/MGF1 con SHA-256 y RSA-2048; RSA-PSS con RSA-2048, exponente 65537,
SHA-256, MGF1-SHA-256 y salt de 32 bytes. No se modifican archivos de
`app/crypto/`, memorándums ni expedientes.

### Mensaje de firma v1

No se firma un digest previamente calculado. Se entrega a RSA-PSS este mensaje:

```text
b"STC:DIPLOMATIC:SIGNED-CONTENT:v1\x00"
+ longitud_cabecera_json_en_8_bytes_big_endian
+ cabecera_json_canónica_ascii
+ bytes_originales_del_archivo
```

La cabecera usa `model_dump(mode="json")` y JSON con claves ordenadas,
separadores `,` y `:`, y `ensure_ascii=True`. Vincula formato, versión de formato,
algoritmos, tipo de documento, documento, versión, creador, título, nombre,
tipo MIME, tamaño, clave de firma, huella y todos los sobres RSA-OAEP.

El AAD de GCM es la misma cabecera canónica, un byte nulo y la firma Base64 ASCII.
La firma tiene 256 bytes. La estructura distingue una nota de un comunicado y
evita trasladar su firma a otro documento, versión o conjunto de destinatarios.

Este es un contrato nuevo de mensaje firmado: no es intercambiable con la firma
de memorándums sobre los bytes del archivo a solas. La primitiva de Axel es la
misma. Su futura pantalla de verificación debe reconstruir este mensaje v1.

La firma separada es necesaria incluso con GCM: un destinatario legítimo obtiene
la AES y podría volver a cifrar contenido modificado con un tag válido. No puede
generar la firma original del emisor sobre ese nuevo mensaje. Las pruebas
incluyen ese intento y exigen el rechazo antes de entregar bytes.

## Claves históricas y límites

- Una clave de cifrado retirada abre notas anteriores que la usaron. Una clave
  de firma desactivada sigue verificando sus firmas anteriores; no firma notas
  nuevas. No se reemplaza automáticamente ninguna por la clave nueva activa.
- Un lector no necesita `documents.sign`; un administrador no asignado tampoco
  puede abrir. La futura capa SQL revalidará participantes activos y permisos de
  lectura, además de pertenencia y vigencia de las claves, en reserva y publicación.
- El servicio actual presupone snapshots confiables. No implementa todavía RLS,
  autenticación HTTP, concurrencia, conciliación de cargas, auditoría ni entrega
  con revalidación final. Sus pruebas no demuestran esas garantías de integración.
- No se persisten originales, AES en claro, privadas ni contraseñas en el
  resultado. La operación procesa secretos temporalmente en el backend; no es
  cifrado de extremo a extremo frente al servidor ni garantiza borrado de memoria.
- El paquete y su cabecera son internos. La persistencia debe separar detalle
  público autorizado de material privado; no exponer sobres, firma ni ciphertext
  mediante listados o eventos Realtime.
- Crear una nota nueva exige claves de cifrado activas de todos los perfiles
  originales. La rotación no redistribuye ni modifica documentos ya publicados.

## Orden de los siguientes bloques

| Bloque | Trabajo pendiente y prueba principal |
| --- | --- |
| 1. Contratos y servicio | Este paquete: firmar, cifrar y recuperar en memoria; rechazar alteraciones y claves ajenas. |
| 2. Supabase y Storage | Reserva de versión y asignaciones, snapshot de firma confiable, material privado, RLS, carga solo cifrada, publicación y cancelación seguras. |
| 3. API autenticada | Listado, detalle, creación, recuperación verificada y cancelación; threadpool y comprobación final antes de entregar. |
| 4. Frontend | Seleccionar nota/comunicado, destinatarios y privada de firma para crear; privada de cifrado para recuperar; mostrar verificación del emisor. |
| 5. Avisos y resumen | Notificar publicación y dirigir al detalle; contar documentos firmados y cifrados sin duplicarlos con el catálogo anterior. |
| 6. Integración y entrega | Dos cuentas, claves históricas, permisos, firma y GCM alterados, errores de carga, documentación y revisión del equipo. |

La interfaz futura aprovechará Mis claves de firma y Mis claves de cifrado;
no requiere generar un par nuevo por documento. Moralitos puede seguir como
Miembro receptor. Roberto necesita su clave de firma y su clave de cifrado
separadas para emitir; sus claves actuales pueden reutilizarse si están vigentes.

## Instalación local y validación

Con la rama de expedientes limpia en `bf1957a`, crear `feature/diplomatic-notes`
y extraer el paquete en la raíz del proyecto. No ejecutar SQL para este bloque.
Los cambios nuevos son cinco archivos; no necesitan instalar dependencias nuevas.

Desde CMD:

```bat
cd /d "%USERPROFILE%\Desktop\TopSecretCommunications"
backend\.venv\Scripts\activate.bat
cd backend
python -m pytest tests/diplomatic_notes -q
python -m ruff check .
python -m ruff format --check .
python -m mypy
python -m pytest -q
cd ..
git --no-pager status --short --untracked-files=all
```

Resultados locales con los requisitos fijados y Python 3.12.14:

- 82 pruebas específicas del módulo y 667 pruebas totales aprobadas.
- Ruff aprobado; 100 archivos Python con formato correcto.
- Mypy sin errores en 71 archivos fuente.
- Solo persiste el warning conocido de FastAPI TestClient sobre httpx.
- El equipo de Roberto usa Python 3.14.5; debe ejecutar los mismos controles.
- Sin cambios en frontend, dependencias, configuración ni migraciones. No se
  modificó el Supabase compartido durante la implementación o las pruebas.

Los casos cubren ambos tipos, bytes binarios y vacíos, serialización JSON,
emisor y destinatario independientes, claves y propósitos separados, permisos,
versiones y claves históricas, claves ajenas y contraseña incorrecta, pública o
huella inconsistente, límite de archivo, alteración de cada componente, y una
recodificación maliciosa con AES legítima que GCM acepta pero la firma rechaza.

## Git y revisión

Mantener el PR #16 centrado en expedientes. La rama nueva parte de su último
commit porque necesita ese servicio y sus contratos. Mientras el PR siga abierto,
una comparación contra `develop` también incluirá los commits de expedientes.
No abrir otro PR general hacia `develop` sin revisar esa base.

Después de que Yael integre expedientes, revisar cómo se hizo el merge y actualizar
la base de notas conservando solo sus commits nuevos. Si se usó squash, no asumir
que un fast-forward incorporará la nueva base. El commit del bloque de notas debe
contener únicamente los cinco archivos de esta entrega.
