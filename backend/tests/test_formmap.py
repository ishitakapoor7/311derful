"""The form map is data recovered from the dataset, so the risks are data risks:
sentinels leaking into option lists, and absence being read as "nothing asked"."""

from app.data.formmap import SENTINELS, _is_sentinel, _profile
from app.formmap import fields_for


def test_sentinels_never_become_options():
    rows = [{"descriptor": "Pothole"}] * 60 + [{"descriptor": "N/A"}] * 40
    fields = _profile(rows)
    values = [o["value"] for f in fields for o in f.get("options", [])]
    assert "N/A" not in values
    assert not any(v.strip().lower() in SENTINELS for v in values)


def test_field_absent_when_rarely_populated():
    # 10% fill is below PRESENT_THRESHOLD: a stray value on the wrong complaint
    # type must not be reported as a question the form asks.
    rows = [{"descriptor": "Pothole", "vehicle_type": "Car"}] * 10 + [
        {"descriptor": "Pothole"}
    ] * 90
    assert not any(f["column"] == "vehicle_type" for f in _profile(rows))


def test_single_value_field_is_not_a_dropdown():
    rows = [{"descriptor": "Pothole", "location_type": "Street"}] * 100
    loc = next(f for f in _profile(rows) if f["column"] == "location_type")
    assert "options" not in loc


def test_conditional_field_is_flagged_not_always():
    rows = [{"descriptor": "X", "cross_street_1": "MAIN ST"}] * 50 + [
        {"descriptor": "X"}
    ] * 50
    cs = next(f for f in _profile(rows) if f["column"] == "cross_street_1")
    assert cs["always"] is False


def test_unknown_complaint_type_returns_empty_not_error():
    assert fields_for("NOT A REAL COMPLAINT TYPE") == []
    assert fields_for(None) == []


def test_heat_hot_water_recovers_the_real_dropdowns():
    fields = {f.column: f for f in fields_for("HEAT/HOT WATER")}
    if not fields:  # form map not built in this checkout
        return
    scope = {o.value for o in fields["descriptor"].options}
    assert {"ENTIRE BUILDING", "APARTMENT ONLY"} <= scope
    which = {o.value for o in fields["descriptor_2"].options}
    assert "NO HEAT" in which and "NO HOT WATER" in which
