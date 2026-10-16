"""Configuración de la conexión pública de Supabase; nunca una clave administrativa."""

import os
import re
from dataclasses import dataclass, field
from typing import Self
from urllib.parse import urlsplit


@dataclass(frozen=True)
class SupabaseSettings:
    url: str
    publishable_key: str = field(repr=False)

    def __post_init__(self) -> None:
        parsed = urlsplit(self.url)
        # Fuerza a validar también un puerto escrito incorrectamente.
        _ = parsed.port
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (
            not parsed.hostname
            or (parsed.scheme != "https" and not (local and parsed.scheme == "http"))
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise ValueError("SUPABASE_URL debe ser la URL base HTTPS del proyecto.")
        if re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", self.publishable_key) is None:
            raise ValueError("Usa SUPABASE_PUBLISHABLE_KEY; no secret ni service_role.")
        object.__setattr__(self, "url", self.url.rstrip("/"))

    @classmethod
    def from_env(cls) -> Self | None:
        url = os.getenv("SUPABASE_URL", "").strip()
        key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        if not url and not key:
            return None
        return cls(url=url, publishable_key=key)
