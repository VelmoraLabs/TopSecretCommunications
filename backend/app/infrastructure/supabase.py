"""Auth y PostgREST con la identidad del usuario; sin saltarse las políticas RLS."""

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
