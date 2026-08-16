"""Build the slim database that actually gets deployed.

The full build is ~2.1GB, almost all of it the 22M-row ``requests`` and
``outcomes`` tables. Those are the *inputs* to aggregation, not something the
API reads -- the serving path only touches ``cube``, which is 117MB on its own.
Shipping the whole file would mean moving eighteen times more data than the app
can use.

One thing did read the raw table at request time: ``geocode.from_zip`` scanned
all 22M ``outcomes`` rows to find the modal community board for a ZIP. That is
both slow on the request path and the only reason the raw data would have had
to be deployed. Precomputing it into ``zip_board`` -- a couple of hundred rows
-- removes both problems at once.

Run:
    PYTHONPATH=. .venv/bin/python -m app.data.export
    PYTHONPATH=. .venv/bin/python -m app.data.export --out /tmp/slim.duckdb
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import duckdb

from app.config import DATA_DIR, DUCKDB_PATH

#: Tables the API reads. Anything not listed here stays out of the deployed file.
SERVING_TABLES = ("cube", "zip_board")

SLIM_PATH = DATA_DIR / "nyc311-slim.duckdb"


def build_zip_board(con: duckdb.DuckDBPyConnection) -> int:
    """Modal community board per ZIP, precomputed.

    ZIPs and community districts do not nest, so this is approximate by
    construction and callers surface that -- but "approximate" is no reason to
    recompute it from 22M rows on every request.

    Built from ``requests`` rather than ``outcomes``: ``incident_zip`` is
    dropped during aggregation, so the original query in ``from_zip`` -- which
    selected it from ``outcomes`` -- raised a BinderException every time a ZIP
    was submitted. Nothing exercised that path, so it went unnoticed.
    """
    con.execute("DROP TABLE IF EXISTS zip_board")
    con.execute(
        """
        CREATE TABLE zip_board AS
        WITH counts AS (
            SELECT incident_zip AS zip, community_board, count(*) AS n
            FROM requests
            WHERE community_board <> 'UNKNOWN'
              AND incident_zip IS NOT NULL AND incident_zip <> ''
            GROUP BY 1, 2
        ),
        ranked AS (
            SELECT *, row_number() OVER (PARTITION BY zip ORDER BY n DESC) AS rk
            FROM counts
        )
        SELECT zip, community_board, n FROM ranked WHERE rk = 1
        """
    )
    return con.execute("SELECT count(*) FROM zip_board").fetchone()[0]


def export(src: Path = DUCKDB_PATH, dst: Path = SLIM_PATH) -> dict[str, int]:
    if not src.exists():
        raise SystemExit(f"no source database at {src} (run ingest + aggregate first)")

    # zip_board is written back into the source too, so local development and
    # the deployed build resolve ZIPs through exactly the same table rather
    # than through two code paths that can drift apart.
    with duckdb.connect(str(src)) as con:
        zips = build_zip_board(con)

    dst.unlink(missing_ok=True)
    with duckdb.connect(str(dst)) as out:
        out.execute(f"ATTACH '{src}' AS src (READ_ONLY)")
        for table in SERVING_TABLES:
            out.execute(f"CREATE TABLE {table} AS SELECT * FROM src.{table}")
        out.execute("DETACH src")
        out.execute("CHECKPOINT")

    return {"zip_board": zips, "bytes": dst.stat().st_size}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DUCKDB_PATH))
    parser.add_argument("--out", default=str(SLIM_PATH))
    args = parser.parse_args()

    result = export(Path(args.db), Path(args.out))
    print(f"zip_board: {result['zip_board']:,} ZIPs")
    print(f"wrote {args.out}  ({result['bytes'] / 1e6:.1f} MB)")
    print(f"  from {Path(args.db).stat().st_size / 1e6:.0f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
