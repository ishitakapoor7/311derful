"""Tests for the forecast ladder and confidence banding.

These build a synthetic cube in memory rather than reading the real one, so
they pin the *policy* -- when to widen, in what order, and how to band the
result -- independently of whatever the current ingest happens to contain.
"""

from __future__ import annotations

import duckdb
import pytest

from app.forecast import (
    HIGH_SAMPLE,
    LADDER,
    MIN_SAMPLE,
    confidence_tier,
    forecast,
)
from app.models import ConfidenceTier, GeoLevel, OutcomeClass, TimeWindow

CUBE_COLUMNS = (
    "geo_level VARCHAR, geo_key VARCHAR, time_window VARCHAR, complaint_type VARCHAR, "
    "agency VARCHAR, descriptor VARCHAR, month VARCHAR, channel VARCHAR, "
    "outcome VARCHAR, n BIGINT, median_days_to_close DOUBLE"
)


def make_cube(rows: list[tuple]) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute(f"CREATE TABLE cube ({CUBE_COLUMNS})")
    if rows:
        con.executemany(
            "INSERT INTO cube VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows
        )
    return con


def row(
    *,
    geo_level="COMMUNITY_BOARD",
    geo_key="12 MANHATTAN",
    time_window="RECENT",
    complaint_type="HEAT/HOT WATER",
    agency="HPD",
    descriptor="ALL",
    month="1",
    channel="ALL",
    outcome="NO_ACCESS",
    n=100,
    median_days=1.5,
):
    return (
        geo_level, geo_key, time_window, complaint_type, agency,
        descriptor, month, channel, outcome, n, median_days,
    )


# ---------------------------------------------------------------------------
# Confidence banding.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "n,expected",
    [
        (0, ConfidenceTier.LOW),
        (8, ConfidenceTier.LOW),
        (MIN_SAMPLE - 1, ConfidenceTier.LOW),
        (MIN_SAMPLE, ConfidenceTier.MEDIUM),
        (HIGH_SAMPLE - 1, ConfidenceTier.MEDIUM),
        (HIGH_SAMPLE, ConfidenceTier.HIGH),
        (10_000, ConfidenceTier.HIGH),
    ],
)
def test_confidence_tier_boundaries(n, expected):
    """Boundaries are inclusive at the lower edge -- 300 is HIGH, 299 is not."""
    assert confidence_tier(n) is expected


def test_low_tier_marks_response_as_directional_only():
    con = make_cube([row(n=8)])
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.confidence_tier is ConfidenceTier.LOW
    assert result.is_directional_only is True


# ---------------------------------------------------------------------------
# The ladder: when to widen, and in what order.
# ---------------------------------------------------------------------------


def test_stays_local_when_the_local_cell_is_thick_enough():
    con = make_cube([row(n=500)])
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.geo_level is GeoLevel.COMMUNITY_BOARD
    assert result.time_window is TimeWindow.RECENT
    assert result.sample_size == 500


def test_drops_channel_before_widening_geography():
    """Channel is the cheapest dimension to give up.

    Its association with outcome is the most likely to be confounded by who
    files which way, so it goes before we stop answering about the user's own
    neighbourhood.
    """
    con = make_cube(
        [
            row(channel="PHONE", n=5),  # too thin with the channel filter
            row(channel="ALL", n=400),  # plenty without it
            row(geo_level="BOROUGH", geo_key="MANHATTAN", channel="ALL", n=9000),
        ]
    )
    result = forecast(
        "HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", channel="PHONE", con=con
    )
    assert result.geo_level is GeoLevel.COMMUNITY_BOARD, "should not have left the district"
    assert result.sample_size == 400


def test_widens_geography_before_time():
    """A citywide recent rate beats a local rate from years ago.

    Agency behaviour is more stable across the city than across a decade, so
    breadth in space costs less validity than breadth in time.
    """
    con = make_cube(
        [
            row(n=5),
            row(geo_level="BOROUGH", geo_key="MANHATTAN", n=800),
            row(geo_level="CITYWIDE", geo_key="NYC", time_window="FULL_HISTORY", n=99_999),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.geo_level is GeoLevel.BOROUGH
    assert result.time_window is TimeWindow.RECENT, "must not reach for old data first"


def test_falls_back_to_full_history_only_as_last_resort():
    con = make_cube(
        [
            row(n=2),
            row(geo_level="BOROUGH", geo_key="MANHATTAN", n=3),
            row(geo_level="CITYWIDE", geo_key="NYC", n=4),
            row(geo_level="CITYWIDE", geo_key="NYC", time_window="FULL_HISTORY", n=5_000),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.geo_level is GeoLevel.CITYWIDE
    assert result.time_window is TimeWindow.FULL_HISTORY
    assert result.confidence_tier is ConfidenceTier.HIGH


def test_ladder_never_widens_time_before_geography():
    """Guard the ordering invariant directly, not just one instance of it."""
    seen_citywide = False
    for step in LADDER:
        if step.time_window is TimeWindow.FULL_HISTORY:
            assert seen_citywide, "reached full history before exhausting geography"
        if step.geo_level is GeoLevel.CITYWIDE:
            seen_citywide = True


def test_returns_thin_result_rather_than_nothing_when_no_rung_qualifies():
    """A caveated number beats a blank screen, as long as the caveat travels."""
    con = make_cube([row(n=3)])
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.sample_size == 3
    assert result.confidence_tier is ConfidenceTier.LOW
    assert result.outcomes


# ---------------------------------------------------------------------------
# Shares and the headline number.
# ---------------------------------------------------------------------------


def test_resolved_share_counts_only_verified_fixed_and_action_taken():
    """The distinction the whole product rests on.

    Closed-as-duplicate and closed-for-no-access are closures, not
    resolutions, and must never be counted as the problem being addressed.
    """
    con = make_cube(
        [
            row(outcome="VERIFIED_FIXED", n=100),
            row(outcome="ACTION_TAKEN", n=100),
            row(outcome="NO_ACCESS", n=400),
            row(outcome="DUPLICATE", n=400),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.sample_size == 1000
    assert result.resolved_share == pytest.approx(0.2)


def test_outcomes_are_ordered_by_count_descending():
    con = make_cube(
        [
            row(outcome="DUPLICATE", n=50),
            row(outcome="NO_ACCESS", n=300),
            row(outcome="VERIFIED_FIXED", n=120),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert [o.outcome for o in result.outcomes] == [
        OutcomeClass.NO_ACCESS,
        OutcomeClass.VERIFIED_FIXED,
        OutcomeClass.DUPLICATE,
    ]
    assert [o.count for o in result.outcomes] == [300, 120, 50]


def test_median_days_is_reported_per_outcome_not_pooled():
    """Pooled closure time is the vanity metric.

    Heat complaints close in about a day on average precisely because the
    fastest closures are the ones where nobody inspected anything -- so the
    per-outcome split has to survive to the response.
    """
    con = make_cube(
        [
            row(outcome="NO_ACCESS", n=400, median_days=0.9),
            row(outcome="VERIFIED_FIXED", n=400, median_days=11.0),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    by_outcome = {o.outcome: o.median_days_to_close for o in result.outcomes}
    assert by_outcome[OutcomeClass.NO_ACCESS] == pytest.approx(0.9)
    assert by_outcome[OutcomeClass.VERIFIED_FIXED] == pytest.approx(11.0)


def test_borough_is_derived_from_the_community_board_label():
    """Cube keys look like '12 MANHATTAN'; the borough is the trailing word."""
    con = make_cube(
        [
            row(n=1),
            row(geo_level="BOROUGH", geo_key="MANHATTAN", n=900),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.geo_level is GeoLevel.BOROUGH
    assert result.sample_size == 900


# ---------------------------------------------------------------------------
# UNCLASSIFIED is a fact about our coverage, not an outcome.
# ---------------------------------------------------------------------------


def test_unclassified_is_excluded_from_outcomes_and_reported_separately():
    """It must never be shown to a user as something that happened.

    Real data surfaced this: a thin cell came back with UNCLASSIFIED as the
    single largest 'outcome' at 47%, which is meaningless to the person asking
    and silently deflates every other share.
    """
    con = make_cube(
        [
            row(outcome="ACTION_TAKEN", n=300),
            row(outcome="NO_ACCESS", n=100),
            row(outcome="UNCLASSIFIED", n=600),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)

    assert all(o.outcome is not OutcomeClass.UNCLASSIFIED for o in result.outcomes)
    assert result.unclassified_count == 600
    # Shares are over classified records only: 300 of 400, not 300 of 1000.
    assert result.sample_size == 400
    assert result.resolved_share == pytest.approx(0.75)


def test_ladder_does_not_stop_on_a_cell_that_is_mostly_unclassified():
    """A cell padded with unmatched text is not evidence.

    Without this, 29 classified rows hiding behind 1000 unclassified ones
    would look like a thick local cell and stop the ladder early.
    """
    con = make_cube(
        [
            row(outcome="ACTION_TAKEN", n=29),
            row(outcome="UNCLASSIFIED", n=1000),
            row(geo_level="BOROUGH", geo_key="MANHATTAN", outcome="ACTION_TAKEN", n=800),
        ]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.geo_level is GeoLevel.BOROUGH
    assert result.sample_size == 800


def test_confidence_tier_is_banded_on_classified_records_only():
    con = make_cube(
        [row(outcome="ACTION_TAKEN", n=10), row(outcome="UNCLASSIFIED", n=5000)]
    )
    result = forecast("HEAT/HOT WATER", month=1, community_board="12 MANHATTAN", con=con)
    assert result.confidence_tier is ConfidenceTier.LOW
    assert result.sample_size == 10


def test_unknown_complaint_type_returns_empty_low_confidence_not_an_error():
    con = make_cube([row(n=500)])
    result = forecast("NOT A REAL TYPE", month=1, community_board="12 MANHATTAN", con=con)
    assert result.sample_size == 0
    assert result.confidence_tier is ConfidenceTier.LOW
    assert result.resolved_share == 0.0
