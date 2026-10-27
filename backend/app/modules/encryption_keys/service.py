"""Generación, respaldo verificado y rotación; ninguna privada se persiste."""

import base64
from uuid import UUID, uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from starlette.concurrency import run_in_threadpool

from app.core.errors import ServiceError
from app.crypto.key_wrapping import rsa_oaep
from app.crypto.signatures import key_files
from app.crypto.signatures.rsa_pss import sha256
from app.infrastructure.supabase import SupabaseGateway
from app.modules.auth.service import Principal
from app.modules.encryption_keys.schemas import (
    EncryptionKey,
    GeneratedKey,
    KeyCreate,
    KeyPage,
    PrivateKeyInput,
)
from app.modules.memoranda.service import read


async def list_keys(gateway: SupabaseGateway, principal: Principal) -> KeyPage:
    return await read(gateway, principal, "list_own_encryption_keys", {}, KeyPage)


async def get_key(
    gateway: SupabaseGateway, principal: Principal, key_id: UUID
) -> EncryptionKey:
    return await read(
        gateway,
        principal,
        "get_own_encryption_key",
        {"p_key_id": str(key_id)},
        EncryptionKey,
    )


def generate_files(password: bytes) -> key_files.KeyFiles:
    private, public = rsa_oaep.generate_key_pair()
    der = key_files.public_bytes(public)
    encrypted = private.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(password),
    )
    return key_files.KeyFiles(
        base64.b64encode(der).decode(),
        base64.b64encode(encrypted).decode(),
        sha256(der).hex(),
    )


async def generate(
    gateway: SupabaseGateway, principal: Principal, body: KeyCreate
) -> GeneratedKey:
    files = await run_in_threadpool(
        generate_files, body.password.get_secret_value().encode("utf8")
    )
    key_id = uuid4()
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_register_encryption_key",
        body={
            "p_actor": str(principal.access.profile.id),
            "p_key_id": str(key_id),
            "p_label": body.label,
            "p_public_base64": files.public_base64,
            "p_fingerprint": files.fingerprint,
        },
    )
    return GeneratedKey(
        key=await get_key(gateway, principal, key_id),
        private_base64=files.private_base64,
    )


def matching_private(
    public_base64: str, fingerprint: str, body: PrivateKeyInput
) -> rsa.RSAPrivateKey:
    try:
        private = key_files.load_private(
            body.private_key_base64.get_secret_value(),
            body.password.get_secret_value().encode("utf8"),
        )
        der = key_files.public_bytes(private.public_key())
        if (
            private.key_size != 2048
            or sha256(der).hex() != fingerprint
            or base64.b64encode(der).decode() != public_base64
        ):
            raise ValueError("Clave distinta.")
        return private
    except ValueError as exc:
        raise ServiceError(
            422,
            "invalid_encryption_private_key",
            "No se pudo abrir tu clave de cifrado. Revisa el archivo y la contraseña.",
        ) from exc


async def activate(
    gateway: SupabaseGateway, principal: Principal, key_id: UUID, body: PrivateKeyInput
) -> EncryptionKey:
    key = await get_key(gateway, principal, key_id)
    await run_in_threadpool(matching_private, key.public_base64, key.fingerprint, body)
    await gateway.server_request(
        "POST",
        "/rest/v1/rpc/server_activate_encryption_key",
        body={"p_actor": str(principal.access.profile.id), "p_key_id": str(key_id)},
    )
    return await get_key(gateway, principal, key_id)
