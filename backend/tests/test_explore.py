"""The findings endpoint must survive complaint types nobody ever resolves.

Some agencies close every record without ever saying what happened: DOT does it
for traffic signals and street lights, EDC refers every helicopter complaint on.
Those types have zero records in RESOLVED_OUTCOMES, so `sum(n) FILTER (...)`
aggregates over an empty set and returns NULL rather than 0 -- and a NULL share
fails validation on the way out, taking the whole citywide view down with it.

0.0 is the honest reading, not a papered-over null. RESOLVED_OUTCOMES is
{VERIFIED_FIXED, ACTION_TAKEN} and everything else closed without the
complainant's condition being resolved, so a type with no records in either
resolved exactly none of them.

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


def test_explore_returns_the_whole_top_40(client: TestClient) -> None:
    """The default the UI actually requests. Regression: this used to 500."""
    r = client.get("/api/explore", params={"limit": 40})
    assert r.status_code == 200, r.text
    assert len(r.json()["rows"]) == 40


def test_every_row_carries_a_usable_share(client: TestClient) -> None:
    """No nulls: the table renders a percentage for every row it is given."""
    rows = client.get("/api/explore", params={"limit": 40}).json()["rows"]

    for row in rows:
        share = row["resolved_share"]
        assert share is not None, f"{row['complaint_type']} has no resolved_share"
        assert 0.0 <= share <= 1.0, f"{row['complaint_type']} share {share} off-scale"


def test_never_resolved_types_report_zero(client: TestClient) -> None:
    """A type an agency never resolves is 0%, and is still listed.

    Dropping these would be worse than the crash: 'DOT closed 148k traffic
    signal complaints without once saying it fixed one' is the finding, not an
    edge case to filter out of the evidence table.
    """
    rows = client.get("/api/explore", params={"limit": 40}).json()["rows"]
    by_type = {r["complaint_type"]: r for r in rows}

    zeroed = [r for r in rows if r["resolved_share"] == 0.0]
    assert zeroed, "expected at least one never-resolved type in the top 40"

    # Present in every year of the dataset; if this ever drops out, the test
    # above still holds the line and this one should be repointed.
    if "Traffic Signal Condition" in by_type:
        assert by_type["Traffic Signal Condition"]["resolved_share"] == 0.0
