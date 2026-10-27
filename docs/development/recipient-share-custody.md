> **Etapa siguiente disponible:** la recuperación entre cuentas ya está implementada
> en [recuperación colaborativa](collaborative-note-recovery.md). Esta guía conserva
> los contratos y el flujo de claves/custodia del incremento anterior.

# Custodia individual de fragmentos

Este incremento continúa Notas de grupo + Storage. Las notas nuevas usan
`custody_mode=individual-v1`; las existentes conservan `portable`. No implementa
solicitudes de recuperación, aportaciones temporales ni Realtime. No modifica las
primitivas existentes de AES-GCM, Shamir, RSA-OAEP o RSA-PSS.

## Flujo de uso

1. Cada participante entra con su cuenta y abre **Mis claves → Mis claves de
   cifrado → Nueva clave de cifrado**. No necesita permiso de firma.
2. Define nombre y contraseña (12–256 caracteres, máximo 1024 bytes UTF-8).
   El backend genera un par RSA-2048/e=65537 nuevo y devuelve la privada PKCS8 DER
   cifrada con contraseña dentro de un archivo `.stckey.json`. La pública es SPKI
   DER/Base64 y su huella es SHA-256 de esos bytes. Se persiste únicamente la pública.
3. Guarda el archivo, vuelve a seleccionarlo e introduce su contraseña. El backend
   abre la privada y comprueba que corresponde a la pública del perfil antes de
   activar la clave. Descargar por sí solo no activa nada. El navegador no puede
   demostrar que un archivo quedó físicamente guardado: reabrirlo prueba posesión
   de una copia utilizable en ese momento.
4. Un miembro con `documents.create` crea la nota para su grupo. Debe haber 2–20
   integrantes activos, vinculados a una cuenta, con clave de cifrado activa.
   La interfaz identifica quién falta y deshabilita la acción; el servidor vuelve
   a comprobarlo dentro de la transacción de reserva.
5. Se conserva el snapshot original: identidades, nombres, papel en el grupo,
   índices y clave pública concreta elegida para cada participante.
6. Se cifra el archivo con el módulo AES-256-GCM existente y Shamir divide su clave
   con n de n. Cada fragmento se protege en un sobre híbrido independiente.
7. Storage recibe solo el ciphertext del documento. Una transacción valida y guarda
   todos los sobres y publica la nota. El creador recibe metadatos, nunca todos los
   fragmentos, las claves AES ni un resguardo completo.
8. Cada participante original puede descargar **Mi fragmento cifrado** desde su
   propia cuenta. También puede comprobar que su privada abre y autentica ese
   fragmento. La respuesta de esa comprobación es solo `valid`, nota, clave e índice;
   no devuelve el fragmento en claro ni reconstruye el documento.

Las personas no necesitan estar conectadas simultáneamente para la entrega:
las públicas ya registradas permiten proteger sus fragmentos mientras están fuera.

## Sobre híbrido v1

Un fragmento serializado incluye una coordenada de hasta 521 bits y metadatos.
Puede superar los 190 bytes admitidos por RSA-2048/OAEP-SHA256. Por eso no se
cifra directamente el JSON con RSA ni se modifica el wrapper existente de 32 bytes.

- `seal_share` genera una clave AES de 32 bytes independiente **por fragmento**.
- AES-256-GCM cifra el fragmento serializado con nonce aleatorio de 12 bytes y tag
  de 16. El módulo existente genera el nonce.
- RSA-OAEP con SHA-256/MGF1-SHA256 y label=None protege únicamente esa clave AES,
  usando la pública del destinatario. Se reutiliza `rsa_oaep.wrap_key`.
- El contexto es JSON canónico (`sort_keys=True`, separadores compactos, ASCII)
  autenticado como AAD. Incluye formato, versión, algoritmo, UUID de la nota,
  set_id de Shamir, UUID del destinatario, UUID/huella de su clave, índice y n/n.
- `open_share` exige el contexto esperado obtenido de la asignación persistida,
  desenvuelve la clave con la privada, verifica GCM y comprueba que los valores del
  fragmento corresponden al conjunto, índice y umbral esperados.

Formato de transporte:

```json
{
  "context": {
    "format": "stc-share-envelope",
    "version": 1,
    "algorithm": "RSA-OAEP-256+A256GCM",
    "note_id": "<UUID nota>",
    "set_id": "<32 hex>",
    "recipient_id": "<UUID perfil>",
    "key_id": "<UUID clave>",
    "fingerprint": "<SHA-256 SPKI, 64 hex>",
    "share_index": 1,
    "share_count": 3,
    "threshold": 3
  },
  "wrapped_key_base64": "<256 bytes cifrados con RSA>",
  "nonce_base64": "<12 bytes>",
  "ciphertext_base64": "<fragmento cifrado>",
  "tag_base64": "<16 bytes>"
}
```

Los valores entre `<...>` son documentación del formato, no un archivo importable.
Se valida Base64 canónico y límites de longitud en Python. La BD comprueba cantidad,
contexto exacto y correspondencia de cada sobre antes de publicar. La apertura de
GCM detecta modificaciones criptográficas; el JSON estructural por sí solo no prueba
integridad ni la identidad del emisor.

Referencias: [RSA en cryptography](https://cryptography.io/en/latest/hazmat/primitives/asymmetric/rsa/),
[AES-GCM en cryptography](https://cryptography.io/en/latest/hazmat/primitives/aead/),
[capacidad OAEP en Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt#rsa-oaep).

## Modelo de confianza y custodia

El backend es de confianza: ya recibe el original para cifrarlo. Genera las claves
RSA y maneja la privada/contraseña temporalmente al activarla o comprobar un
fragmento, siguiendo el modelo de las firmas existente. Usa HTTPS en despliegue.
Esto **no es cifrado de extremo a extremo frente al servidor**. La generación no
persiste la privada cifrada, su contraseña, el documento original ni claves AES.
No hay caché, localStorage o IndexedDB de privadas/fragmentos en esta funcionalidad.
La sesión de Supabase mantiene su almacenamiento habitual, sin cambios.

El snapshot y los sobres cifrados sí se conservan en la BD. Los secretos manejados
en memoria no se escriben a logs ni se incluyen en excepciones HTTP. Python/JS no
ofrecen borrado garantizado de todas sus copias de memoria; no se promete zeroization.

La generación entrega el archivo privado cifrado una sola vez. Si se pierde la
respuesta o se cierra sin guardarlo, la clave queda pendiente: retírala y genera otra.
Todavía no se utiliza para notas, así que no deja documentos nuevos irrecuperables.

Si se pierde una privada **que ya recibió fragmentos**, generar otra no permite
abrir esos sobres. El respaldo del usuario es necesario; no existe recuperación
administrativa de privadas. Una clave retirada deja de recibir notas nuevas, pero
no revoca copias ya descargadas ni cambia documentos anteriores. Para un documento
nuevo con otros destinatarios o claves hay que crear una nota nueva.

## Estados, rotación y permisos

- Claves: `pending → active → retired`; también `pending → retired`.
- Una activa por perfil. Activar otra retira la anterior en la misma transacción.
  La activación repetida de una clave aún activa es idempotente; las retiradas no
  se reactivan. Se conserva su pública y su historial.
- Máximo 3 preparaciones pendientes y 100 claves históricas por perfil. Retirar una
  pendiente libera un lugar de preparación, pero conserva el registro histórico.
- Notas nuevas: `staging → ready` o `staging → cancelled`.
- Notas portables anteriores mantienen sus estados, recibo y recuperación manual.
  No se recrean ni se migran silenciosamente a custodia individual.
- El rol administrador no concede acceso automático a claves privadas, sobres
  ajenos o documentos de grupos a los que no pertenece.
- Cambiar el grupo después no modifica la asignación documental original.
  Desactivar un perfil sí bloquea nuevas lecturas desde su cuenta; no puede revocar
  material que la persona ya hubiera descargado.
- Claves de firma y cifrado son registros, pares y archivos distintos. La generación
  de cifrado usa `rsa_oaep.generate_key_pair`, no una clave de firma del usuario.
  Se reutilizan los lectores DER/Base64 existentes, sin alterar RSA-PSS.

Las tres tablas nuevas tienen RLS y revocaciones de escritura. Los JWT solo pueden
leer sus propias claves/sobres y pedir el retiro de sus claves. Registro, activación
y publicación están reservados a RPC del servidor, tras verificar la sesión y hacer
las operaciones criptográficas. Los RPC SECURITY DEFINER fijan `search_path=''`.
La autorización de grupo, perfiles y clave se vuelve a comprobar al publicar bajo
el bloqueo transaccional compartido con la administración de perfiles/grupos.

## Persistencia y fallos de red

`server_begin_distributed_note` reutiliza la reserva/snapshot existente, comprueba
que todos tengan clave activa y fija cada key_id. Si falta una clave, la transacción
completa se revierte y no deja notas o snapshots parciales.

Después de cargar el ciphertext privado, `server_commit_distributed_note` comprueba
los n sobres, perfiles, claves todavía activas, pertenencia del emisor y grupo activo.
Publicación y sobres se guardan juntos: un fallo revierte los sobres parciales.
Se permite repetir exactamente la confirmación ya guardada sin duplicar auditoría.
El POST completo no duplica una reserva con el mismo request_id: devuelve conflicto.
La UI bloquea envíos repetidos y pide revisar la lista si pierde la respuesta.

Ante un fallo previo a publicar se intenta cancelar la preparación y borrar su
objeto privado. Si la publicación sí llegó a confirmarse, la cancelación interna
`staging_only=true` devuelve false y **no borra** la nota ni su ciphertext.
Una caída total puede dejar una preparación privada pendiente; el creador puede
cancelarla desde el detalle, después de confirmar que la carga ya terminó.

No hay transacción distribuida entre PostgreSQL y Storage. La conciliación descrita
en `group-notes-storage.md` sigue aplicando: nunca borrar objetos de notas `ready`
por antigüedad o por asumir que un timeout equivale a una transacción fallida.

## API añadida y contrato actualizado

| Ruta | Resultado |
| --- | --- |
| GET `/api/v1/encryption-keys` | Públicas propias y sus estados |
| POST `/api/v1/encryption-keys` | Clave pública pendiente + privada cifrada, una sola vez |
| POST `/api/v1/encryption-keys/{id}/activate` | Verifica privada/contraseña y activa |
| POST `/api/v1/encryption-keys/{id}/retire` | Retira para notas nuevas |
| GET `/api/v1/group-notes/{id}/my-share` | Único sobre del usuario actual |
| POST `/api/v1/group-notes/{id}/my-share/check` | Abre y autentica el sobre propio; no devuelve el secreto |
| POST `/api/v1/group-notes` | Ahora devuelve NoteDetail, sin resguardo ni fragmentos |

El formato público del paquete de documento sigue siendo v1, compatible con
AES-GCM/Shamir existentes. Los `.stcshare.json` son sobres cifrados, **no** los JSON
en claro del flujo portable; no deben importarse en el selector de fragmentos de
recuperación manual. Esa recuperación sigue disponible para resguardos anteriores.

## Instalación

Aplicar el ZIP sobre la misma rama que ya tiene Notas de grupo + Storage. No cambiar
a develop ni repetir el ZIP anterior. Revisar los comandos de LEEME.md.

En Supabase ejecutar **una sola vez** la migración nueva:
`supabase/migrations/20261025000000_recipient_share_custody.sql`.
Requiere las cinco anteriores, ya aplicadas. No ejecutar archivos de `supabase/tests`
en el proyecto real. No hacen falta buckets, variables de entorno ni dependencias
nuevas. Reiniciar backend y frontend después de aplicar código y SQL.

La advertencia del editor sobre operaciones destructivas puede aparecer por
`DROP CONSTRAINT`: la migración reemplaza restricciones para admitir el nuevo modo,
no elimina tablas ni documentos. Todo está dentro de una transacción. Los nombres
de las restricciones corresponden a las migraciones entregadas previamente.

## Validación y siguiente incremento

La suite incluye cifrado real, apertura con privadas correctas/incorrectas, GCM
con Base64 válido alterado, contexto de otra nota/usuario/clave, umbral incompleto,
rotación, permisos HTTP, aislamiento RLS y publicación atómica. SQL se prueba en una
BD local vacía y transaccional; navegador usa contratos locales para Auth/Storage,
PostgreSQL real embebido, FastAPI real y los módulos criptográficos reales. No se
modifica Supabase remoto ni se prueba el proveedor Google real durante estas pruebas.

Pendiente: solicitudes de recuperación por participante original, aprobación y
aportaciones asociadas a cada solicitud, caducidad/cancelación, almacenamiento
transitorio protegido, reconstrucción n de n y descarga para el solicitante,
limpieza de material temporal y progreso con Realtime. Se reutilizarán los sobres,
key_id históricos y `open_share`; comprobar el fragmento hoy no cuenta como aportar
a una solicitud futura.

Comprobaciones realizadas en este incremento:

- 405 pruebas de backend, con Python 3.12.14 local; CI mantiene su versión de Python.
- Ruff, formato y mypy correctos.
- 18 pruebas de frontend; ESLint y build TypeScript/Vite correctos.
- 279 comprobaciones SQL: 224 anteriores y 55 de custodia individual.
- 132 comprobaciones de navegador: 45 del flujo nuevo y 87 de regresión
  (memorándums, grupos y validaciones).
- Revisión visual de claves y fragmentos en escritorio y móvil.

Los SQL de prueba pueden ejecutarse con `psql` o SQL Editor **solo en una BD local
de pruebas vacía**, después de las seis migraciones. Cada archivo revierte sus
fixtures y exige que no existan perfiles. La suite de navegador local del desarrollo
no sustituye la comprobación de tu proyecto Supabase después de aplicar la migración.
