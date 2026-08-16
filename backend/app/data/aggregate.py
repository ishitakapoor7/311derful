"""Precompute the outcome cube the forecast reads from.

The request path never queries Socrata and never scans the 22M-row fact table.
It does a single indexed lookup against ``cube``, which is built once here.

The cube is denormalised across three axes so the fallback ladder in
``forecast.py`` is a lookup rather than a re-aggregation:

* ``geo_level`` / ``geo_key`` -- community board, borough, or citywide.
* ``time_window`` -- a trailing recent window, or all of history.
* ``descriptor`` / ``month`` / ``channel`` -- each either a concrete value or
  the literal ``'ALL'``, generated with GROUPING SETS so a query that omits a
  filter still hits one row per outcome instead of summing many.

Closure time is stored per outcome, never pooled. Pooling it is what produces
the vanity metric this project exists to debunk: heat complaints average about
a day to close, because the fastest closures are the ones where nobody
inspected anything.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import duckdb

from app.config import DUCKDB_PATH
from app.data.classify import sql_case_expression

#: Trailing window treated as "recent". Agency behaviour drifts, so a 2013
#: outcome rate is weak evidence about today even when it parses cleanly.
RECENT_YEARS = 3

_ALL = "ALL"


def build_cube(db_path: Path = DUCKDB_PATH) -> dict[str, int]:
    """Build ``outcomes`` (fact) and ``cube`` (aggregate). Returns row counts."""
    con = duckdb.connect(str(db_path))

    case_expr = sql_case_expression()

    # Fact table: one row per request, with its outcome and closure time.
    # Materialised rather than inlined so the classifier runs once over 22M
    # rows instead of once per grouping set.
    con.execute("DROP TABLE IF EXISTS outcomes")
    con.execute(
        f"""
        CREATE TABLE outcomes AS
        SELECT
            complaint_type,
            coalesce(nullif(trim(descriptor), ''), 'UNSPECIFIED') AS descriptor,
            agency,
            coalesce(nullif(trim(community_board), ''), 'UNKNOWN') AS community_board,
            upper(coalesce(nullif(trim(borough), ''), 'UNKNOWN'))  AS borough,
            month(created_date)                                     AS month,
            coalesce(nullif(trim(open_data_channel_type), ''), 'UNKNOWN') AS channel,
            created_date,
            {case_expr} AS outcome,
            CASE
                WHEN closed_date IS NOT NULL AND closed_date >= created_date
                THEN date_diff('hour', created_date, closed_date) / 24.0
            END AS days_to_close
        FROM requests
        WHERE complaint_type IS NOT NULL
        """
    )

    (max_date,) = con.execute("SELECT max(created_date) FROM outcomes").fetchone()
    recent_cutoff = f"{max_date.year - RECENT_YEARS}-{max_date.month:02d}-01"

    # One aggregate table covering both time windows and all three geo levels.
    # GROUPING SETS generate the 'ALL' variants of descriptor/month/channel in
    # the same pass, so an unfiltered query is still a single-row lookup.
    con.execute("DROP TABLE IF EXISTS cube")
    con.execute(
        f"""
        CREATE TABLE cube AS
        WITH windowed AS (
            SELECT *, 'FULL_HISTORY' AS time_window FROM outcomes
            UNION ALL
            SELECT *, 'RECENT' AS time_window FROM outcomes
            WHERE created_date >= DATE '{recent_cutoff}'
        ),
        levelled AS (
            SELECT 'COMMUNITY_BOARD' AS geo_level, community_board AS geo_key, *
            FROM windowed
            UNION ALL
            SELECT 'BOROUGH' AS geo_level, borough AS geo_key, * FROM windowed
            UNION ALL
            SELECT 'CITYWIDE' AS geo_level, 'NYC' AS geo_key, * FROM windowed
        )
        SELECT
            geo_level,
            geo_key,
            time_window,
            complaint_type,
            any_value(agency)                          AS agency,
            coalesce(descriptor, '{_ALL}')             AS descriptor,
            coalesce(CAST(month AS VARCHAR), '{_ALL}') AS month,
            coalesce(channel, '{_ALL}')                AS channel,
            outcome,
            count(*)                                   AS n,
            median(days_to_close)                      AS median_days_to_close
        FROM levelled
        GROUP BY GROUPING SETS (
            (geo_level, geo_key, time_window, complaint_type, outcome,
             descriptor, month, channel),
            (geo_level, geo_key, time_window, complaint_type, outcome,
             descriptor, month),
            (geo_level, geo_key, time_window, complaint_type, outcome, descriptor),
            (geo_level, geo_key, time_window, complaint_type, outcome, month),
            (geo_level, geo_key, time_window, complaint_type, outcome)
        )
        """
    )

    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cube_lookup
        ON cube(complaint_type, geo_level, geo_key, time_window, descriptor, month, channel)
        """
    )

    counts = {
        "outcomes": con.execute("SELECT count(*) FROM outcomes").fetchone()[0],
        "cube": con.execute("SELECT count(*) FROM cube").fetchone()[0],
    }
    con.close()
    return counts


def coverage_by_year(db_path: Path = DUCKDB_PATH) -> list[tuple]:
    """Classifier coverage per year -- the acceptance check for the ingest.

    Reported per year, never globally: a global 91% can hide 99% on recent
    rows and 40% on rows whose templates were retired.
    """
    con = duckdb.connect(str(db_path), read_only=True)
    rows = con.execute(
        """
        SELECT
            year(created_date) AS yr,
            count(*)           AS total,
            1 - (count(*) FILTER (WHERE outcome = 'UNCLASSIFIED')) / count(*)::DOUBLE
                               AS coverage
        FROM outcomes
        GROUP BY yr ORDER BY yr
        """
    ).fetchall()
    con.close()
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DUCKDB_PATH))
    args = parser.parse_args()

    counts = build_cube(Path(args.db))
    print(f"outcomes: {counts['outcomes']:,} rows")
    print(f"cube:     {counts['cube']:,} rows")
    print("\nclassifier coverage by year:")
    for yr, total, cov in coverage_by_year(Path(args.db)):
        flag = "" if cov >= 0.90 else "   <-- BELOW 90%"
        print(f"  {yr}  {total:>10,}  {cov:6.1%}{flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
