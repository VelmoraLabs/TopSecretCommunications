"""El sobre existente se liga a una solicitud y al autor de la aportación."""

from uuid import uuid4

import pytest

from app.crypto.key_wrapping import rsa_oaep
from app.crypto.key_wrapping.recovery_envelope import (
    ContributionContext,
    ContributionEnvelope,
    open_contribution,
    seal_contribution,
)
from app.crypto.key_wrapping.share_envelope import public_fingerprint
from app.crypto.shamir import split_secret


@pytest.fixture(scope="module")
def material():
    private, public = rsa_oaep.generate_key_pair()
    share = split_secret(b"s" * 32, 2, 2)[0]
    context = ContributionContext(
        note_id=uuid4(),
        request_id=uuid4(),
        contributor_id=uuid4(),
        recipient_id=uuid4(),
        key_id=uuid4(),
        fingerprint=public_fingerprint(public),
        set_id=share.set_id,
        share_index=share.x,
        share_count=2,
        threshold=2,
    )
    return private, public, share, context


def test_contribution_roundtrip_preserves_request_context_in_json(material):
    private, public, share, context = material
    sealed = seal_contribution(share, public, context)
    data = sealed.model_dump(mode="json")
    assert data["context"]["purpose"] == "recovery-contribution"
    assert data["context"]["request_id"] == str(context.request_id)
    assert data["context"]["contributor_id"] == str(context.contributor_id)
    assert str(share.y) not in sealed.model_dump_json()
    copy = ContributionEnvelope.model_validate_json(sealed.model_dump_json())
    assert open_contribution(copy, private, context) == share


@pytest.mark.parametrize(
    "field", ["request_id", "contributor_id", "note_id", "recipient_id", "key_id"]
)
def test_replay_to_another_request_or_actor_fails(material, field):
    private, public, share, context = material
    sealed = seal_contribution(share, public, context)
    changed = context.model_copy(update={field: uuid4()})
    with pytest.raises(ValueError):
        open_contribution(sealed, private, changed)
    # Alterar también el sobre no evita la autenticación del contexto por GCM.
    with pytest.raises(ValueError):
        open_contribution(
            sealed.model_copy(update={"context": changed}), private, changed
        )
