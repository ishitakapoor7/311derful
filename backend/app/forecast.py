"""Turn a classified complaint into what is likely to happen to it.

This is the product, and it is a pure function over the precomputed cube: no
LLM, no network, fully testable. The model's job elsewhere is to phrase these
numbers, never to produce them.

The hard part is not the lookup, it is refusing to overstate. A rare complaint
type, in one community board, in one month, filed through one channel can be
eight records -- and eight records is noise. So the query widens until it has
enough rows, and the response always reports how far it had to widen and how
many records it ended up with.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import duckdb

from app.config import DUCKDB_PATH
from app.models import (
    RESOLVED_OUTCOMES,
    ConfidenceTier,
    ForecastResponse,
    GeoLevel,
    OutcomeClass,
    OutcomeShare,
    TimeWindow,
)

#: Below this, a share is not reportable as a rate at any breadth.
MIN_SAMPLE = 30

#: Confidence bands. HIGH needs enough rows that a few percent of movement is
#: not sampling noise; LOW is explicitly not a prediction.
HIGH_SAMPLE = 300

_ALL = "ALL"


@dataclass(frozen=True)
class _Step:
    """One rung of the fallback ladder."""

    geo_level: GeoLevel
    time_window: TimeWindow
    use_channel: bool
    use_month: bool


#: The ladder, in order. Two principles decide the sequence:
#:
#: 1. Drop ``channel`` first. It is the least informative dimension and the
#:    one whose association with outcome is most likely confounded by who
#:    files which way, so it is the cheapest thing to give up.
#: 2. Widen geography before time. Agency behaviour is more stable across the
#:    city than across a decade, so a citywide recent rate is better evidence
#:    about today than a local rate from years ago. Month is dropped only at
#:    the very end, because seasonality is real and large.
LADDER: tuple[_Step, ...] = (
    _Step(GeoLevel.COMMUNITY_BOARD, TimeWindow.RECENT, use_channel=True, use_month=True),
    _Step(GeoLevel.COMMUNITY_BOARD, TimeWindow.RECENT, use_channel=False, use_month=True),
    _Step(GeoLevel.BOROUGH, TimeWindow.RECENT, use_channel=False, use_month=True),
    _Step(GeoLevel.CITYWIDE, TimeWindow.RECENT, use_channel=False, use_month=True),
    _Step(GeoLevel.CITYWIDE, TimeWindow.FULL_HISTORY, use_channel=False, use_month=True),
    _Step(GeoLevel.CITYWIDE, TimeWindow.FULL_HISTORY, use_channel=False, use_month=False),
)


def confidence_tier(sample_size: int) -> ConfidenceTier:
    """Band a sample size. Boundaries are inclusive at the lower edge."""
    if sample_size >= HIGH_SAMPLE:
        return ConfidenceTier.HIGH
    if sample_size >= MIN_SAMPLE:
        return ConfidenceTier.MEDIUM
    return ConfidenceTier.LOW


def _geo_key(step: _Step, community_board: str | None) -> str:
    """Resolve the cube key for a rung.

    Community board values look like '12 MANHATTAN', so the borough is the
    trailing word.
    """
    if step.geo_level is GeoLevel.CITYWIDE:
        return "NYC"
    cb = (community_board or "").strip().upper()
    if step.geo_level is GeoLevel.BOROUGH:
        return cb.split(" ", 1)[1].strip() if " " in cb else "UNKNOWN"
    return cb or "UNKNOWN"


def _query(
    con: duckdb.DuckDBPyConnection,
    step: _Step,
    complaint_type: str,
    descriptor: str | None,
    community_board: str | None,
    month: int,
    channel: str | None,
) -> list[tuple]:
    return con.execute(
        """
        SELECT outcome, n, median_days_to_close, agency
        FROM cube
        WHERE complaint_type = ?
          AND geo_level = ? AND geo_key = ? AND time_window = ?
          AND descriptor = ? AND month = ? AND channel = ?
        """,
        [
            complaint_type,
            step.geo_level.value,
            _geo_key(step, community_board),
            step.time_window.value,
            descriptor or _ALL,
            str(month) if step.use_month else _ALL,
            (channel or _ALL) if step.use_channel else _ALL,
        ],
    ).fetchall()


def forecast(
    complaint_type: str,
    descriptor: str | None = None,
    community_board: str | None = None,
    month: int | None = None,
    channel: str | None = None,
    db_path: Path = DUCKDB_PATH,
    con: duckdb.DuckDBPyConnection | None = None,
) -> ForecastResponse:
    """Return the outcome distribution for a complaint, with its confidence.

    Walks ``LADDER`` until a rung has at least ``MIN_SAMPLE`` records. If no
    rung does, the widest result is returned as-is with a LOW tier rather than
    being suppressed -- a caveated number beats a blank screen, provided the
    caveat travels with it.
    """
    owned = con is None
    con = con or duckdb.connect(str(db_path), read_only=True)
    month = month or date.today().month

    try:
        rows: list[tuple] = []
        used = LADDER[-1]
        for step in LADDER:
            candidate = _query(
                con, step, complaint_type, descriptor, community_board, month, channel
            )
            # Rungs are judged on classified records only. A cell that looks
            # thick but is mostly unmatched text is not evidence, so it must
            # not stop the ladder early.
            classified = sum(
                r[1] for r in candidate if r[0] != OutcomeClass.UNCLASSIFIED.value
            )
            if candidate:
                rows, used = candidate, step
            if classified >= MIN_SAMPLE:
                break

        agency = rows[0][3] if rows else "UNKNOWN"
        unclassified = sum(
            n for outcome, n, _, _ in rows if outcome == OutcomeClass.UNCLASSIFIED.value
        )
        classified_rows = [
            r for r in rows if r[0] != OutcomeClass.UNCLASSIFIED.value
        ]
        total = sum(r[1] for r in classified_rows)

        outcomes = sorted(
            (
                OutcomeShare(
                    outcome=OutcomeClass(outcome),
                    share=n / total if total else 0.0,
                    count=n,
                    # Rounded at the boundary: the underlying value is an hour
                    # count divided by 24, and shipping 1.3333333333333333 to a
                    # UI invites it to be reformatted somewhere downstream.
                    median_days_to_close=(
                        round(median_days, 1) if median_days is not None else None
                    ),
                )
                for outcome, n, median_days, _ in classified_rows
            ),
            key=lambda o: o.count,
            reverse=True,
        )

        resolved = sum(o.count for o in outcomes if o.outcome in RESOLVED_OUTCOMES)

        return ForecastResponse(
            complaint_type=complaint_type,
            descriptor=descriptor,
            agency=agency,
            outcomes=outcomes,
            resolved_share=resolved / total if total else 0.0,
            sample_size=total,
            unclassified_count=unclassified,
            confidence_tier=confidence_tier(total),
            geo_level=used.geo_level,
            time_window=used.time_window,
            baseline_resolved_share=_citywide_resolved_share(con, complaint_type),
        )
    finally:
        if owned:
            con.close()


def _citywide_resolved_share(
    con: duckdb.DuckDBPyConnection, complaint_type: str
) -> float | None:
    """Citywide recent resolved share, for 'better or worse than average'."""
    rows = con.execute(
        """
        SELECT outcome, n FROM cube
        WHERE complaint_type = ? AND geo_level = 'CITYWIDE'
          AND geo_key = 'NYC' AND time_window = 'RECENT'
          AND descriptor = ? AND month = ? AND channel = ?
        """,
        [complaint_type, _ALL, _ALL, _ALL],
    ).fetchall()
    # Same exclusion as the main path -- the baseline has to be computed the
    # same way as the number it is compared against, or the comparison lies.
    classified = [
        (outcome, n) for outcome, n in rows if outcome != OutcomeClass.UNCLASSIFIED.value
    ]
    total = sum(n for _, n in classified)
    if not total:
        return None
    resolved = sum(
        n for outcome, n in classified if OutcomeClass(outcome) in RESOLVED_OUTCOMES
    )
    return resolved / total
