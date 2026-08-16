"""Resolve a location to the community board key the cube is indexed by.

Deliberately has no external dependency. The NYC Geoclient API would give
better address parsing, but it needs a key, rate-limits, and fails closed --
none of which belong on the demo path. Instead:

* **lat/lon** (browser geolocation, the primary path) is resolved by
  point-in-polygon against the Community Districts boundary file from NYC Open
  Data. Exact, offline, no key.
* **ZIP code** falls back to the community board that most 311 requests from
  that ZIP were filed under. ZIPs and community districts do not nest, so this
  is genuinely approximate and the caller is told so.

The cube keys on 311's own ``community_board`` spelling -- ``'12 MANHATTAN'``,
zero-padded -- while the boundary file keys on ``boro_cd`` (``'112'``). The
translation between the two lives here and nowhere else.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from app.config import DATA_DIR

GEOJSON_PATH = DATA_DIR / "reference" / "community_districts.geojson"

#: First digit of ``boro_cd``.
BOROUGH_BY_CODE = {
    "1": "MANHATTAN",
    "2": "BRONX",
    "3": "BROOKLYN",
    "4": "QUEENS",
    "5": "STATEN ISLAND",
}

# Districts numbered 19 and above are joint interest areas -- parks, airports,
# cemeteries -- rather than residential community boards. They are NOT filtered
# out: 311 files against them for real ('64 MANHATTAN' is Central Park, 18k
# requests; '83 QUEENS' is 17k), they are genuine cube keys, and their low
# volumes are already handled correctly by the confidence ladder, which widens
# to borough when a cell is thin. Dropping them here would discard ~2% of the
# city's requests and silently return nothing for anyone standing in a park.


@dataclass(frozen=True)
class GeoResult:
    community_board: str | None
    borough: str | None
    method: str
    exact: bool


def boro_cd_to_community_board(boro_cd: str) -> str | None:
    """'112' -> '12 MANHATTAN', matching 311's own zero-padded spelling."""
    code = str(boro_cd).strip()
    if len(code) != 3 or code[0] not in BOROUGH_BY_CODE or not code[1:].isdigit():
        return None
    return f"{int(code[1:]):02d} {BOROUGH_BY_CODE[code[0]]}"


@lru_cache(maxsize=1)
def _index() -> tuple[STRtree, list[str]]:
    """Build an R-tree over the district polygons.

    Cached: parsing 71 multipolygons on every request would dominate the
    latency of an otherwise single-lookup endpoint.
    """
    if not GEOJSON_PATH.exists():
        raise FileNotFoundError(
            f"{GEOJSON_PATH} missing. Download Community Districts (5crt-au7u) "
            "from NYC Open Data as GeoJSON."
        )
    data = json.loads(GEOJSON_PATH.read_text())
    geoms, keys = [], []
    for feature in data["features"]:
        cb = boro_cd_to_community_board(feature["properties"].get("boro_cd", ""))
        if cb is None:
            continue
        geoms.append(shape(feature["geometry"]))
        keys.append(cb)
    return STRtree(geoms), keys


def from_latlon(lat: float, lon: float) -> GeoResult:
    """Point-in-polygon against the community district boundaries."""
    tree, keys = _index()
    point = Point(lon, lat)
    for idx in tree.query(point):
        if tree.geometries.take(idx).contains(point):
            cb = keys[idx]
            return GeoResult(
                community_board=cb,
                borough=cb.split(" ", 1)[1],
                method="point_in_polygon",
                exact=True,
            )
    return GeoResult(None, None, "point_in_polygon", exact=False)


def from_zip(zip_code: str, con) -> GeoResult:
    """Most common community board for a ZIP, learned from 311 itself.

    ZIP codes and community districts do not nest, so this is approximate by
    construction -- ``exact`` is False and callers should surface that.
    """
    # Reads the precomputed table rather than aggregating 22M raw rows on every
    # request. That was slow, and it was also the only thing keeping the raw
    # data on the serving path at all -- see app/data/export.py.
    row = con.execute(
        "SELECT community_board FROM zip_board WHERE zip = ?",
        [str(zip_code).strip()[:5]],
    ).fetchone()
    if not row:
        return GeoResult(None, None, "zip_modal", exact=False)
    cb = row[0]
    return GeoResult(
        community_board=cb,
        borough=cb.split(" ", 1)[1] if " " in cb else None,
        method="zip_modal",
        exact=False,
    )
