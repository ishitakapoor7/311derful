"""Recover the questions 311 asks, from the 311 data itself.

NYC has no Open311 endpoint (the standard `/services.json` discovery paths all
404) and the intake portal is a Dynamics app with hundreds of branching flows,
so the obvious way to learn what a complaint form asks for -- read the form --
is not available.

It does not have to be. The published dataset has 48 columns, and most of them
exist *because* the intake form collects them. Which ones are populated depends
entirely on the complaint type, so the fill pattern is a fingerprint of the
form:

    HEAT/HOT WATER   descriptor + descriptor_2 + location_type, address_type
                     ADDRESS, no cross streets -> an exact address is required
    Street Condition address_type BLOCKFACE with cross_street_1 -> it asks for
                     a block between two streets, not an address
    Taxi Complaint   taxi_pick_up_location on 98% of rows -> it asks where the
                     passenger got in

And the distinct values of each categorical column are the dropdown options
themselves. So the form can be reconstructed by measuring the data, which is a
use of the open data rather than a scrape of the city's website -- it cannot
break when their markup changes, and it needs no permission.

Sampled rather than aggregated on purpose: `count(col)` over 22M rows for a
dozen columns times a few dozen complaint types times out on Socrata, while a
few thousand recent rows per complaint type settle the structural question
("does this complaint type use this field at all?") and surface every option
common enough to be worth showing. Rare options are missed by design.

Run:  PYTHONPATH=. .venv/bin/python -m app.data.formmap
"""

from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass

import duckdb

from app.config import DUCKDB_PATH, REFERENCE_DIR, SOCRATA_APP_TOKEN

log = logging.getLogger(__name__)

SOCRATA_URL = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"

# Only recent rows: the form changes over time and the current shape is the one
# a person filing today will meet.
SINCE = "2024-01-01T00:00:00"

SAMPLE_SIZE = 2000

# How often a field must be populated before we claim the form asks for it.
# Well above the noise floor of stray values on the wrong complaint type, well
# below the ~50% of genuinely conditional fields like Street Condition's
# location_type.
PRESENT_THRESHOLD = 0.20

# An option has to appear this often in the sample to be worth showing. Below
# this it is likely a legacy value or a mis-file rather than a live choice.
OPTION_THRESHOLD = 0.01


@dataclass(frozen=True)
class Field:
    """One question on the form."""

    column: str
    question: str
    #: True when the answer is chosen from a list, so the options are worth
    #: collecting. False for free text (an address, a plate) where only the
    #: fact that it is asked for is useful.
    categorical: bool


# Order matters: this is the order the questions get asked in, and it is the
# order a person would naturally answer them.
FIELDS: tuple[Field, ...] = (
    Field("descriptor", "What kind of problem is it?", True),
    Field("descriptor_2", "Which part of it?", True),
    Field("location_type", "Where is it?", True),
    Field("address_type", "How will you identify the location?", True),
    Field("incident_address", "The street address", False),
    Field("cross_street_1", "The nearest cross street", False),
    Field("facility_type", "What kind of facility?", True),
    Field("vehicle_type", "What kind of vehicle?", True),
    Field("bridge_highway_name", "Which bridge or highway?", True),
    Field("taxi_pick_up_location", "Where were you picked up?", False),
)

# Placeholders the city writes into columns that do not apply. They are not
# answers to anything, and left in they would dominate every option list --
# park_facility_name is literally "Unspecified" on 100% of rows.
SENTINELS = {"", "n/a", "na", "unspecified", "unknown", "none", "other (explain below)"}


def _is_sentinel(value: object) -> bool:
    return not isinstance(value, str) or value.strip().lower() in SENTINELS


def _sample(complaint_type: str) -> list[dict]:
    params = {
        "$select": ",".join(f.column for f in FIELDS),
        "$where": f"complaint_type='{complaint_type}' AND created_date > '{SINCE}'",
        "$limit": SAMPLE_SIZE,
    }
    url = f"{SOCRATA_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url)
    if SOCRATA_APP_TOKEN:
        req.add_header("X-App-Token", SOCRATA_APP_TOKEN)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def _profile(rows: list[dict]) -> list[dict]:
    """Which fields this complaint type uses, and their live options."""
    n = len(rows)
    out: list[dict] = []

    for field in FIELDS:
        values = [r.get(field.column) for r in rows]
        present = [v for v in values if not _is_sentinel(v)]
        if len(present) / n < PRESENT_THRESHOLD:
            continue

        entry: dict = {
            "column": field.column,
            "question": field.question,
            # Below ~95% the field is conditional on an earlier answer, which is
            # worth saying rather than presenting it as always required.
            "always": len(present) / n >= 0.95,
            "fill_rate": round(len(present) / n, 3),
        }

        if field.categorical:
            counts = Counter(present)
            # Sorted by how often people actually choose them, so the UI can
            # show the realistic answers first rather than an alphabetical dump.
            entry["options"] = [
                {"value": v, "share": round(c / len(present), 3)}
                for v, c in counts.most_common(24)
                if c / len(present) >= OPTION_THRESHOLD
            ]
            # A "dropdown" with one option is not a question the user answers.
            if len(entry.get("options", [])) < 2:
                entry.pop("options", None)

        out.append(entry)

    return out


def _complaint_types(limit: int) -> list[str]:
    """The busiest complaint types, from the cube we already built."""
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    try:
        rows = con.execute(
            """
            SELECT complaint_type FROM cube
            WHERE geo_level = 'CITYWIDE' AND time_window = 'RECENT'
              AND descriptor = 'ALL' AND month = 'ALL' AND channel = 'ALL'
            GROUP BY complaint_type
            ORDER BY sum(n) DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
    finally:
        con.close()
    return [r[0] for r in rows]


def build(limit: int = 60) -> dict:
    out: dict[str, list[dict]] = {}
    for i, ct in enumerate(_complaint_types(limit), 1):
        try:
            rows = _sample(ct)
        except Exception:  # noqa: BLE001
            # One complaint type failing must not cost the whole map; a missing
            # entry degrades to "we don't know the form", which is honest.
            log.exception("sampling failed for %s", ct)
            continue
        if not rows:
            continue
        out[ct] = _profile(rows)
        log.info("[%2d/%d] %-42s %d fields", i, limit, ct, len(out[ct]))
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    path = REFERENCE_DIR / "formmap.json"
    data = build()
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    log.info("wrote %s (%d complaint types)", path, len(data))


if __name__ == "__main__":
    main()
