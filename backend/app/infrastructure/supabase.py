"""Canal de usuario con JWT/RLS y canal privado para operaciones del servidor."""

from typing import Any

import httpx

from app.core.config import SupabaseSettings
from app.core.errors import ServiceError


class SupabaseGateway:
    def __init__(
        self, settings: SupabaseSettings, client: httpx.AsyncClient | None = None
    ) -> None:
        self.settings = settings
        self.client = client or httpx.AsyncClient(timeout=10, follow_redirects=False)

    async def close(self) -> None:
        await self.client.aclose()

    async def server_request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        content: bytes | None = None,
    ) -> httpx.Response:
        """Canal reservado al servidor; no adjunta el JWT del usuario."""
        if self.settings.secret_key is None:
            raise ServiceError(
                503,
                "documents_not_configured",
                "Servicio documental no configurado. Contacta al administrador.",
            )
        if not path.startswith(("/rest/v1/rpc/", "/storage/v1/object/stc-documents/")):
            raise ValueError("Ruta de servidor no permitida.")
        headers = {"apikey": self.settings.secret_key}
        if content is not None:
            headers.update(
                {"Content-Type": "application/octet-stream", "x-upsert": "false"}
            )
        try:
            response = await self.client.request(
                method,
                self.settings.url + path,
                headers=headers,
                json=body,
                content=content,
            )
        except httpx.HTTPError as exc:
            raise ServiceError(
                503,
                "documents_unavailable",
                "No se pudo contactar al almacenamiento documental.",
            ) from exc
        if response.status_code == 401:
            raise ServiceError(
                503,
                "documents_not_configured",
                "No se pudo autenticar el servicio documental.",
            )
        if response.is_error or response.is_redirect:
            if path.startswith("/rest/") and 400 <= response.status_code < 500:
                self._raise_error(response, auth=False)
            raise ServiceError(
                503,
                "documents_unavailable",
                "No se pudo completar la operación documental.",
            )
        return response

    async def request(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        count: bool = False,
    ) -> httpx.Response:
        headers = {
            "apikey": self.settings.publishable_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if count:
            headers["Prefer"] = "count=exact"
        try:
            response = await self.client.request(
                method,
                self.settings.url + path,
                headers=headers,
                params=params,
                json=body,
            )
        except httpx.HTTPError as exc:
            raise ServiceError(
                503,
                "identity_unavailable",
                "No se pudo contactar al servicio de acceso.",
            ) from exc
        if response.status_code == 429 or response.status_code >= 500:
            raise ServiceError(
                503, "identity_unavailable", "El servicio de acceso no está disponible."
            )
        if 300 <= response.status_code < 400:
            raise ServiceError(
                503, "identity_unavailable", "No se pudo verificar el acceso."
            )
        if response.is_error:
            self._raise_error(response, auth=path.startswith("/auth/"))
        return response

    @staticmethod
    def _raise_error(response: httpx.Response, *, auth: bool) -> None:
        if auth or response.status_code == 401:
            raise ServiceError(
                401, "invalid_session", "Tu sesión no es válida o ha vencido."
            )
        try:
            data = response.json()
        except ValueError:
            data = {}
        code = data.get("code") if isinstance(data, dict) else None
        personnel_errors = {
            "PF403": (
                403,
                "personnel_permission_denied",
                "Sin permiso para expedientes.",
            ),
            "PF404": (
                404,
                "personnel_file_not_found",
                "El expediente no está disponible.",
            ),
            "PF409": (
                409,
                "personnel_conflict",
                "Cambió el expediente, una cuenta o su clave. "
                "Actualiza su información.",
            ),
            "PF422": (
                422,
                "invalid_personnel_request",
                "Revisa los datos del expediente.",
            ),
            "PF428": (
                409,
                "personnel_keys_required",
                "El creador y cada destinatario deben activar una clave de protección.",
            ),
        }
        if code in personnel_errors:
            status, error_code, message = personnel_errors[code]
            raise ServiceError(status, error_code, message)
        if code == "DA403":
            raise ServiceError(
                403,
                "dashboard_permission_denied",
                "Tu perfil no puede consultar este resumen.",
            )
        notification_errors = {
            "NT403": (
                403,
                "notification_permission_denied",
                "Tu perfil no puede consultar esta bandeja.",
            ),
            "NT404": (
                404,
                "notification_not_found",
                "El aviso no está disponible para tu cuenta.",
            ),
            "NT422": (
                422,
                "invalid_notification_request",
                "Revisa los filtros o la fecha de lectura de los avisos.",
            ),
        }
        if code in notification_errors:
            status, error_code, message = notification_errors[code]
            raise ServiceError(status, error_code, message)
        recovery_errors = {
            "PR403": (
                403,
                "recovery_permission_denied",
                "Tu cuenta no puede realizar esta acción de recuperación.",
            ),
            "PR404": (
                404,
                "recovery_not_found",
                "La nota o la solicitud no está disponible para tu cuenta.",
            ),
            "PR409": (
                409,
                "recovery_conflict",
                "Ya existe una solicitud abierta o su estado cambió. "
                "Actualiza las solicitudes.",
            ),
            "PR410": (
                409,
                "recovery_closed",
                "La solicitud no está lista, se cerró o terminó su plazo de descarga. "
                "Actualiza su estado.",
            ),
            "PR412": (
                409,
                "recovery_participant_blocked",
                "Hay participantes desactivados o sin permiso para aportar. "
                "Deben conservarse todos los participantes originales.",
            ),
            "PR422": (
                422,
                "invalid_recovery",
                "Revisa el motivo, el plazo y la correspondencia de la aportación.",
            ),
            "PR428": (
                409,
                "recovery_key_required",
                "Activa tu clave de protección de fragmentos en Mis claves "
                "antes de solicitar la recuperación.",
            ),
        }
        if code in recovery_errors:
            status, error_code, message = recovery_errors[code]
            raise ServiceError(status, error_code, message)
        key_errors = {
            "PK403": (
                403,
                "key_permission_denied",
                "Tu perfil no puede administrar estas claves.",
            ),
            "PK404": (
                404,
                "encryption_key_not_found",
                "La clave de cifrado no está disponible para tu cuenta.",
            ),
            "PK409": (
                409,
                "encryption_key_conflict",
                "Revisa el estado de la clave y retira preparaciones pendientes. "
                "Se permiten 3 pendientes y 100 históricas.",
            ),
            "PK422": (
                422,
                "invalid_encryption_key",
                "Usa una clave de cifrado distinta de las claves de firma.",
            ),
            "PN428": (
                409,
                "participant_keys_required",
                "Cada integrante debe iniciar sesión y activar su clave de cifrado "
                "antes de crear la nota.",
            ),
        }
        if code in key_errors:
            status, error_code, message = key_errors[code]
            raise ServiceError(status, error_code, message)
        note_errors = {
            "PN403": (
                403,
                "note_permission_denied",
                "No tienes permiso para esta operación de nota especial.",
            ),
            "PN404": (
                404,
                "note_not_found",
                "La nota o el grupo no está disponible para tu cuenta.",
            ),
            "PN409": (
                409,
                "note_conflict",
                "El grupo o la nota cambió. "
                "Actualiza su información antes de reintentar.",
            ),
            "PN422": (
                422,
                "invalid_group_note",
                "Revisa los integrantes activos del grupo y el resguardo de esta nota.",
            ),
        }
        if code in note_errors:
            status, error_code, message = note_errors[code]
            raise ServiceError(status, error_code, message)
        document_errors = {
            "PD403": (
                403,
                "document_permission_denied",
                "No tienes permiso para esta operación documental.",
            ),
            "PD404": (
                404,
                "document_not_found",
                "El documento no está disponible para tu cuenta.",
            ),
            "PD409": (
                409,
                "document_conflict",
                "Revisa la etapa, firmas, participantes y claves. "
                "Actualiza el documento antes de reintentar.",
            ),
            "PD422": (
                422,
                "invalid_document",
                "Revisa los destinatarios y el Embajador aprobador seleccionado.",
            ),
        }
        if code in document_errors:
            status, error_code, message = document_errors[code]
            raise ServiceError(status, error_code, message)
        group_errors = {
            "PT403": (
                403,
                "group_permission_denied",
                "No tienes permiso para administrar este grupo.",
            ),
            "PT404": (
                404,
                "group_not_found",
                "El grupo o integrante no está disponible.",
            ),
            "PT409": (
                409,
                "group_conflict",
                "El grupo cambió. Actualiza su información y vuelve a intentarlo.",
            ),
            "PT422": (
                422,
                "invalid_group",
                "Se requieren 2 a 255 integrantes y un responsable activo.",
            ),
        }
        if code in group_errors:
            status, error_code, message = group_errors[code]
            raise ServiceError(status, error_code, message)
        if code == "42501" or response.status_code == 403:
            raise ServiceError(
                403, "access_denied", "Tu perfil no tiene acceso a esta operación."
            )
        if code == "23505":
            raise ServiceError(
                409, "profile_exists", "Ese correo ya tiene un perfil autorizado."
            )
        if code == "23514":
            message = data.get("message", "")
            if isinstance(message, str) and message.startswith(
                "Debe permanecer un administrador"
            ):
                raise ServiceError(409, "last_admin", message)
            raise ServiceError(422, "invalid_profile", "Revisa los datos del perfil.")
        if code == "23503":
            raise ServiceError(422, "invalid_role", "El rol seleccionado no existe.")
        if code == "P0002":
            raise ServiceError(404, "profile_not_found", "El perfil no existe.")
        raise ServiceError(
            503, "access_not_ready", "No se pudo completar la operación de acceso."
        )

    @staticmethod
    def json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError as exc:
            raise ServiceError(
                503, "invalid_identity_response", "No se pudo verificar el acceso."
            ) from exc
