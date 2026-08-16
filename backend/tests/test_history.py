"""Tests for per-session complaint history.

The important property here is isolation. There are no accounts, so
`session_id` is the only thing standing between one person's history and
another's — every read and every delete must be scoped by it, and knowing an
entry id must not be enough to reach it.
"""

from __future__ import annotations

import pytest

from app import history
from app.models import (
    AdviseResponse,
    AskResponse,
    ConfidenceTier,
    ForecastResponse,
    GeoLevel,
    IntakeResponse,
    OutcomeClass,
    OutcomeShare,
    TimeWindow,
)


@pytest.fixture
def db(tmp_path):
    """A throwaway history database per test."""
    path = tmp_path / "history.sqlite3"
    history.init(path)
    return path


def make_result(
    *, complaint_type="HEAT/HOT WATER", with_forecast=True, clarifying=None
) -> AskResponse:
    intake = IntakeResponse(
        complaint_type=complaint_type,
        descriptor="ENTIRE BUILDING",
        agency="HPD",
        confidence=0.9,
        detected_lang="en",
        clarifying_question=clarifying,
    )
    if not with_forecast:
        return AskResponse(intake=intake)

    forecast = ForecastResponse(
        complaint_type=complaint_type,
        descriptor="ENTIRE BUILDING",
        agency="HPD",
        outcomes=[
            OutcomeShare(
                outcome=OutcomeClass.VERIFIED_FIXED,
                share=0.4,
                count=400,
                median_days_to_close=1.3,
            ),
            OutcomeShare(
                outcome=OutcomeClass.NO_ACCESS, share=0.6, count=600, median_days_to_close=2.0
            ),
        ],
        resolved_share=0.4,
        sample_size=1000,
        confidence_tier=ConfidenceTier.HIGH,
        geo_level=GeoLevel.COMMUNITY_BOARD,
        time_window=TimeWindow.RECENT,
    )
    return AskResponse(
        intake=intake,
        forecast=forecast,
        advice=AdviseResponse(
            narrative="Most complaints like yours close without a fix.",
            tips=[],
            draft_text="311 complaint draft…",
        ),
        community_board="07 BRONX",
        location_exact=True,
    )


# ---------------------------------------------------------------------------
# Writing.
# ---------------------------------------------------------------------------


def test_recording_stores_everything_needed_to_redraw_the_card(db):
    """Denormalised on purpose: replaying a past entry costs no model call."""
    entry = history.record("sess-a", "my radiator is cold", make_result(), db_path=db)

    assert entry is not None
    stored = history.list_for_session("sess-a", db_path=db)[0]
    assert stored.text == "my radiator is cold"
    assert stored.complaint_type == "HEAT/HOT WATER"
    assert stored.agency == "HPD"
    assert stored.community_board == "07 BRONX"
    assert stored.resolved_share == pytest.approx(0.4)
    assert stored.sample_size == 1000
    assert stored.confidence_tier is ConfidenceTier.HIGH
    assert stored.narrative
    assert stored.draft_text


def test_clarifying_question_response_is_not_stored(db):
    """It has no forecast, so a sidebar entry for it could not be re-rendered."""
    result = make_result(with_forecast=False, clarifying="Inside or outside?")
    assert history.record("sess-a", "it's loud", result, db_path=db) is None
    assert history.list_for_session("sess-a", db_path=db) == []


def test_entries_come_back_newest_first(db):
    for i in range(3):
        history.record("sess-a", f"complaint {i}", make_result(), db_path=db)
    texts = [e.text for e in history.list_for_session("sess-a", db_path=db)]
    assert texts == ["complaint 2", "complaint 1", "complaint 0"]


def test_limit_is_respected(db):
    for i in range(10):
        history.record("sess-a", f"complaint {i}", make_result(), db_path=db)
    assert len(history.list_for_session("sess-a", limit=4, db_path=db)) == 4


# ---------------------------------------------------------------------------
# Isolation. The security property, such as it is.
# ---------------------------------------------------------------------------


def test_one_session_cannot_read_another(db):
    history.record("sess-a", "mine", make_result(), db_path=db)
    history.record("sess-b", "theirs", make_result(), db_path=db)

    assert [e.text for e in history.list_for_session("sess-a", db_path=db)] == ["mine"]
    assert [e.text for e in history.list_for_session("sess-b", db_path=db)] == ["theirs"]


def test_knowing_an_entry_id_is_not_enough_to_delete_it(db):
    entry = history.record("sess-a", "mine", make_result(), db_path=db)

    assert history.delete_entry("sess-b", entry.id, db_path=db) is False
    assert len(history.list_for_session("sess-a", db_path=db)) == 1

    assert history.delete_entry("sess-a", entry.id, db_path=db) is True
    assert history.list_for_session("sess-a", db_path=db) == []


def test_clearing_a_session_leaves_other_sessions_alone(db):
    history.record("sess-a", "mine", make_result(), db_path=db)
    history.record("sess-b", "theirs", make_result(), db_path=db)

    assert history.clear_session("sess-a", db_path=db) == 1
    assert history.list_for_session("sess-a", db_path=db) == []
    assert len(history.list_for_session("sess-b", db_path=db)) == 1


def test_unknown_session_is_empty_not_an_error(db):
    assert history.list_for_session("never-seen", db_path=db) == []


def test_init_is_idempotent(db):
    history.init(db)
    history.init(db)
    history.record("sess-a", "still works", make_result(), db_path=db)
    assert len(history.list_for_session("sess-a", db_path=db)) == 1
