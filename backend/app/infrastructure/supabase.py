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
