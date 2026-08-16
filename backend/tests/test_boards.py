"""The map endpoint must not hand the UI anything it would draw wrongly.

A choropleth has nowhere to put a caveat: a district shaded deep red off nine
records reads exactly like one shaded off ninety thousand. So the filtering
that the forecast expresses as a confidence tier has to happen in the query
here, and these tests pin it.

Skipped when the cube is absent -- these assert about real data, and a version
that passes without it would be asserting nothing.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import DUCKDB_PATH
from app.main import app

pytestmark = pytest.mark.skipif(
    not DUCKDB_PATH.exists(), reason="cube not built (run ingest + aggregate)"
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def test_boards_are_drawable(client: TestClient) -> None:
    r = client.get("/api/explore/boards", params={"complaint_type": "HEAT/HOT WATER"})
    assert r.status_code == 200
    body = r.json()

    assert body["verified"] is True
    assert body["rows"], "expected at least one district"

    for row in body["rows"]:
        assert row["total"] >= 30, f"{row['board']} is too thin to colour"
        # 'Unspecified QUEENS' is a missing value, not a place.
        assert not row["board"].lower().startswith("unspecified")
        assert 0.0 <= row["resolved_share"] <= 1.0


def test_boards_show_real_local_variation(client: TestClient) -> None:
    """The map only earns its place if districts actually differ."""
    rows = client.get(
        "/api/explore/boards", params={"complaint_type": "HEAT/HOT WATER"}
    ).json()["rows"]
    shares = [r["resolved_share"] for r in rows]
    assert max(shares) - min(shares) > 0.10


def test_unknown_complaint_type_is_empty_not_an_error(client: TestClient) -> None:
    body = client.get(
        "/api/explore/boards", params={"complaint_type": "NOT A COMPLAINT TYPE"}
    ).json()
    assert body["rows"] == []
