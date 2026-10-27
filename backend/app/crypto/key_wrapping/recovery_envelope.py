"""Aportaciones híbridas ligadas a una solicitud; reutiliza el sobre existente."""

from typing import Literal
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric import rsa

from app.crypto.key_wrapping.share_envelope import (
    EnvelopeContext,
    ShareEnvelope,
    open_share,
    seal_share,
)
from app.crypto.shamir import Share


class ContributionContext(EnvelopeContext):
    purpose: Literal["recovery-contribution"] = "recovery-contribution"
    request_id: UUID
    contributor_id: UUID


class ContributionEnvelope(ShareEnvelope):
    context: ContributionContext


def seal_contribution(
    share: Share, public: rsa.RSAPublicKey, context: ContributionContext
) -> ContributionEnvelope:
    sealed = seal_share(share, public, context)
    # Serializar con el tipo derivado conserva request_id, purpose y contributor_id.
    return ContributionEnvelope(
        context=context, **sealed.model_dump(exclude={"context"})
    )


def open_contribution(
    envelope: ContributionEnvelope,
    private: rsa.RSAPrivateKey,
    expected: ContributionContext,
) -> Share:
    return open_share(envelope, private, expected)
