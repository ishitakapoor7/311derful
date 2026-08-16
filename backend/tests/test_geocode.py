"""Tests for location resolution.

Landmark coordinates are checked against their real community districts, so a
regression in the boundary file or the ``boro_cd`` translation shows up as a
wrong neighbourhood rather than a silent failure.
"""

from __future__ import annotations

import pytest

from app.geocode import boro_cd_to_community_board, from_latlon


@pytest.mark.parametrize(
    "boro_cd,expected",
    [
        ("112", "12 MANHATTAN"),
        ("105", "05 MANHATTAN"),
        ("201", "01 BRONX"),
        ("305", "05 BROOKLYN"),
        ("410", "10 QUEENS"),
        ("502", "02 STATEN ISLAND"),
        # Joint interest areas are real 311 keys, not junk to be filtered.
        ("164", "64 MANHATTAN"),
        ("483", "83 QUEENS"),
        ("226", "26 BRONX"),
    ],
)
def test_boro_cd_translates_to_311_spelling(boro_cd, expected):
    assert boro_cd_to_community_board(boro_cd) == expected


@pytest.mark.parametrize("bad", ["", "9", "1234", "X12", "abc", "1XX"])
def test_malformed_boro_cd_returns_none(bad):
    assert boro_cd_to_community_board(bad) is None


@pytest.mark.parametrize(
    "name,lat,lon,expected",
    [
        ("NYPL Schwarzman Building", 40.7532, -73.9822, "05 MANHATTAN"),
        ("Times Square", 40.7580, -73.9855, "05 MANHATTAN"),
        ("Coney Island", 40.5755, -73.9707, "13 BROOKLYN"),
        ("Staten Island Ferry terminal", 40.6437, -74.0739, "01 STATEN ISLAND"),
    ],
)
def test_known_landmarks_resolve_to_their_district(name, lat, lon, expected):
    result = from_latlon(lat, lon)
    assert result.community_board == expected, name
    assert result.exact is True


def test_joint_interest_area_resolves_rather_than_returning_nothing():
    """Central Park is '64 MANHATTAN' in 311, with ~18k real requests.

    Someone standing in a park must still get an answer; the thin-cell problem
    is the confidence ladder's job, not the geocoder's.
    """
    result = from_latlon(40.7812, -73.9665)
    assert result.community_board is not None
    assert result.borough == "MANHATTAN"


def test_point_outside_the_city_is_reported_as_not_found():
    result = from_latlon(40.5, -73.5)  # Atlantic Ocean
    assert result.community_board is None
    assert result.exact is False


def test_borough_is_populated_alongside_the_board():
    result = from_latlon(40.7532, -73.9822)
    assert result.borough == "MANHATTAN"
