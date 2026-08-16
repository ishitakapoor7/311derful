"""Pull 311 service requests from Socrata into a local DuckDB file.

Paging strategy: by calendar month, then by offset *within* each month.
Socrata degrades badly on deep ``$offset`` values, and a naive
offset-over-22M-rows walk both slows to a crawl and risks skipping rows if the
dataset shifts mid-walk (it updates daily). Month chunks keep every offset
small, make the job resumable at month granularity, and give a natural cache
key.

Each chunk is cached as gzipped CSV on disk, so a re-run costs nothing for
months already fetched and the whole job can be interrupted freely.
"""

from __future__ import annotations

import argparse
import gzip
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import duckdb

from app.config import (
    DATASET_ID,
    DUCKDB_PATH,
    INGEST_COLUMNS,
    INGEST_START,
    RAW_CACHE_DIR,
    SOCRATA_APP_TOKEN,
    SOCRATA_DOMAIN,
)

PAGE_SIZE = 50_000
MAX_RETRIES = 4
BASE_URL = f"https://{SOCRATA_DOMAIN}/resource/{DATASET_ID}.csv"


def _month_starts(start: date, end: date) -> list[date]:
    out, cur = [], date(start.year, start.month, 1)
    while cur <= end:
        out.append(cur)
        cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
    return out


def _next_month(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


def _fetch(url: str) -> str:
    """GET with retry. Socrata throttles hard without an app token."""
    req = urllib.request.Request(url)
    if SOCRATA_APP_TOKEN:
        req.add_header("X-App-Token", SOCRATA_APP_TOKEN)
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as exc:  # noqa: PERF203
            last = exc
            time.sleep(2**attempt)
    raise RuntimeError(f"failed after {MAX_RETRIES} attempts: {url}") from last


def fetch_month(month_start: date, force: bool = False) -> Path:
    """Download one month to a gzipped CSV cache file and return its path."""
    RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_CACHE_DIR / f"311_{month_start:%Y_%m}.csv.gz"
    if path.exists() and not force:
        return path

    month_end = _next_month(month_start)
    where = (
        f"created_date >= '{month_start:%Y-%m-%d}' "
        f"AND created_date < '{month_end:%Y-%m-%d}'"
    )

    chunks: list[str] = []
    header: str | None = None
    offset = 0
    while True:
        params = {
            "$select": ",".join(INGEST_COLUMNS),
            "$where": where,
            "$order": "unique_key",
            "$limit": str(PAGE_SIZE),
            "$offset": str(offset),
        }
        body = _fetch(BASE_URL + "?" + urllib.parse.urlencode(params))
        lines = body.split("\n", 1)
        if header is None:
            header = lines[0]
        rest = lines[1] if len(lines) > 1 else ""
        if not rest.strip():
            break
        chunks.append(rest if rest.endswith("\n") else rest + "\n")
        # A short page means we reached the end of this month.
        if rest.count("\n") < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    # Write to a temp file first so an interrupted run never leaves a
    # truncated cache file that a later run would trust.
    tmp = path.with_suffix(".partial")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        fh.write((header or "") + "\n")
        fh.writelines(chunks)
    tmp.replace(path)
    return path


def load_into_duckdb(db_path: Path = DUCKDB_PATH) -> int:
    """Load every cached month into a single ``requests`` table."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(RAW_CACHE_DIR.glob("311_*.csv.gz"))
    if not files:
        raise RuntimeError(f"no cached chunks in {RAW_CACHE_DIR}; run fetch first")

    con = duckdb.connect(str(db_path))
    con.execute("DROP TABLE IF EXISTS requests")
    con.execute(
        """
        CREATE TABLE requests AS
        SELECT * FROM read_csv(
            ?,
            header = true,
            union_by_name = true,
            sample_size = -1,
            types = {'unique_key': 'VARCHAR', 'incident_zip': 'VARCHAR'}
        )
        """,
        [[str(f) for f in files]],
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_ct ON requests(complaint_type)")
    (count,) = con.execute("SELECT count(*) FROM requests").fetchone()
    con.close()
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=INGEST_START)
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--force", action="store_true", help="re-download cached months")
    parser.add_argument("--fetch-only", action="store_true")
    args = parser.parse_args()

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    months = _month_starts(start, end)
    print(f"fetching {len(months)} months: {start} -> {end}", flush=True)

    for i, m in enumerate(months, 1):
        t0 = time.time()
        path = fetch_month(m, force=args.force)
        size_mb = path.stat().st_size / 1e6
        print(
            f"  [{i:>3}/{len(months)}] {m:%Y-%m}  {size_mb:6.1f} MB  {time.time() - t0:5.1f}s",
            flush=True,
        )

    if args.fetch_only:
        return 0

    print("loading into duckdb...", flush=True)
    total = load_into_duckdb()
    print(f"done: {total:,} rows in {DUCKDB_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
