"""Contrato agregado: notas y comunicados publicados cuentan como firmados."""

from copy import deepcopy

import pytest

from tests.dashboard.test_dashboard import DATA, ID, dashboard_client
from tests.dashboard.test_dashboard import material as material
from tests.memoranda.test_memoranda import HEADERS, NOW


def aggregate():
    data = deepcopy(DATA)
    data["stats"].update(
        documents_total=31,
        diplomatic_total=4,
        signed_total=5,
        pending_total=2,
        pending_diplomatic=1,
    )
    data["category_counts"]["nota"] = 4
    entry = {
        "id": ID,
        "target_kind": "diplomatic_note",
        "target_id": ID,
        "related_id": None,
        "title": "Nota confidencial",
        "category": "nota",
        "status": "Firmado y cifrado · acceso individual",
        "subtitle": "Nota diplomática · Creador",
        "occurred_at": NOW,
    }
    data["recent"].append(entry)
    data["pending"].append({**entry, "status": "Carga incompleta"})
    return data


def test_diplomatic_counts_and_links_survive_authenticated_dashboard(material):
    with dashboard_client(material, data=aggregate()) as (client, _):
        response = client.get("/api/v1/dashboard", headers=HEADERS)
        assert response.status_code == 200
        result = response.json()
        assert result["stats"]["diplomatic_total"] == 4
        assert result["stats"]["pending_diplomatic"] == 1
        assert result["stats"]["signed_total"] == 5
        assert result["recent"][-1]["target_kind"] == "diplomatic_note"
        assert result["pending"][-1]["target_id"] == ID
        assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("field", ["diplomatic_total", "pending_diplomatic"])
@pytest.mark.parametrize("value", [None, -1, True])
def test_missing_or_invalid_diplomatic_totals_are_not_silently_zero(
    material, field, value
):
    data = aggregate()
    if value is None:
        del data["stats"][field]
    else:
        data["stats"][field] = value
    with dashboard_client(material, data=data) as (client, _):
        response = client.get("/api/v1/dashboard", headers=HEADERS)
        assert response.status_code == 503
        assert "stats" not in response.json()


@pytest.mark.parametrize(
    "changes",
    [
        {"category": "memorandum"},
        {"related_id": ID},
        {"target_id": "90000000-0000-4000-8000-000000000099"},
        {"header": {"private_key_base64": "must-not-leak"}},
    ],
)
def test_misdirected_or_private_diplomatic_entries_are_rejected(material, changes):
    data = aggregate()
    data["recent"][-1].update(changes)
    with dashboard_client(material, data=data) as (client, _):
        response = client.get("/api/v1/dashboard", headers=HEADERS)
        assert response.status_code == 503
        assert "must-not-leak" not in response.text
