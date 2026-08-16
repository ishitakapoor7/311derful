"""Tests for advice selection and fact assembly.

These cover the half of `advise.py` that decides *what* to say -- rules, facts,
caveats, and the draft. That half is pure Python and must be correct
independent of the model, which only decides *how* to say it.

The division matters: if fact assembly is wrong, the model faithfully phrases a
wrong number and nothing downstream catches it.
"""

from __future__ import annotations

import pytest

from app.advise import (
    ADVICE_RULES,
    LOW_CONFIDENCE_CAVEAT,
    build_draft,
    build_facts,
    dominant_failure,
)
from app.models import (
    RESOLVED_OUTCOMES,
    ConfidenceTier,
    ForecastResponse,
    GeoLevel,
    OutcomeClass,
    OutcomeShare,
    TimeWindow,
)


def make_forecast(
    outcomes: list[tuple[OutcomeClass, int]],
    *,
    complaint_type="HEAT/HOT WATER",
    agency="HPD",
    geo_level=GeoLevel.COMMUNITY_BOARD,
    baseline=None,
) -> ForecastResponse:
    total = sum(n for _, n in outcomes)
    resolved = sum(n for o, n in outcomes if o in RESOLVED_OUTCOMES)
    from app.forecast import confidence_tier

    return ForecastResponse(
        complaint_type=complaint_type,
        descriptor=None,
        agency=agency,
        outcomes=[
            OutcomeShare(outcome=o, share=n / total, count=n, median_days_to_close=1.0)
            for o, n in sorted(outcomes, key=lambda x: -x[1])
        ],
        resolved_share=resolved / total,
        sample_size=total,
        confidence_tier=confidence_tier(total),
        geo_level=geo_level,
        time_window=TimeWindow.RECENT,
        baseline_resolved_share=baseline,
    )


# ---------------------------------------------------------------------------
# Which failure mode drives the advice.
# ---------------------------------------------------------------------------


def test_dominant_failure_is_the_top_actionable_non_resolution():
    forecast = make_forecast(
        [
            (OutcomeClass.ACTION_TAKEN, 500),  # largest, but not a failure
            (OutcomeClass.NO_ACCESS, 300),
            (OutcomeClass.DUPLICATE, 100),
        ]
    )
    assert dominant_failure(forecast) is OutcomeClass.NO_ACCESS


def test_resolutions_are_never_treated_as_a_failure_mode():
    """A complaint type that mostly succeeds should yield no failure advice."""
    forecast = make_forecast(
        [(OutcomeClass.VERIFIED_FIXED, 900), (OutcomeClass.ACTION_TAKEN, 100)]
    )
    assert dominant_failure(forecast) is None


def test_no_advice_invented_for_failure_modes_a_person_cannot_influence():
    """PENDING has no tip, because there is nothing useful to tell someone."""
    forecast = make_forecast([(OutcomeClass.PENDING, 900)])
    assert dominant_failure(forecast) is None
    assert OutcomeClass.PENDING not in ADVICE_RULES


@pytest.mark.parametrize("outcome", sorted(ADVICE_RULES, key=lambda o: o.value))
def test_every_rule_is_reachable_and_names_its_own_outcome(outcome):
    forecast = make_forecast([(outcome, 500), (OutcomeClass.ACTION_TAKEN, 100)])
    assert dominant_failure(forecast) is outcome
    assert ADVICE_RULES[outcome].outcome is outcome
    assert ADVICE_RULES[outcome].tip.strip()


# ---------------------------------------------------------------------------
# Facts: every number the narrative may contain.
# ---------------------------------------------------------------------------


def test_facts_carry_finished_percentages_not_raw_shares():
    """The model must never be handed a number it has to convert."""
    forecast = make_forecast(
        [
            (OutcomeClass.NO_ACCESS, 400),
            (OutcomeClass.VERIFIED_FIXED, 300),
            (OutcomeClass.DUPLICATE, 300),
        ],
        baseline=0.42,
    )
    facts = build_facts(forecast)
    assert facts["resolved_percent"] == 30
    assert facts["citywide_resolved_percent"] == 42
    assert facts["most_common_outcome"] == OutcomeClass.NO_ACCESS.value
    assert facts["most_common_outcome_percent"] == 40
    assert facts["dominant_failure"] == OutcomeClass.NO_ACCESS.value
    assert facts["dominant_failure_percent"] == 40
    assert facts["records_analysed"] == 1000


def test_facts_describe_the_geographic_level_in_words():
    """'the whole city' must not be narrated as 'your district'."""
    local = build_facts(make_forecast([(OutcomeClass.NO_ACCESS, 500)]))
    citywide = build_facts(
        make_forecast([(OutcomeClass.NO_ACCESS, 500)], geo_level=GeoLevel.CITYWIDE)
    )
    assert local["area"] == "your community district"
    assert citywide["area"] == "the whole city"


def test_missing_baseline_is_null_rather_than_zero():
    """A null baseline means unknown; zero would read as 'nothing ever works'."""
    facts = build_facts(make_forecast([(OutcomeClass.NO_ACCESS, 500)], baseline=None))
    assert facts["citywide_resolved_percent"] is None


def test_facts_contain_no_unrounded_floats():
    """Anything left as a raw share invites the model to reformat it."""
    facts = build_facts(
        make_forecast([(OutcomeClass.NO_ACCESS, 333), (OutcomeClass.ACTION_TAKEN, 667)])
    )
    assert not [v for v in facts.values() if isinstance(v, float)]


# ---------------------------------------------------------------------------
# The caveat on thin data.
# ---------------------------------------------------------------------------


def test_low_confidence_forecast_produces_a_caveat_naming_the_sample_size():
    forecast = make_forecast([(OutcomeClass.NO_ACCESS, 8)])
    assert forecast.confidence_tier is ConfidenceTier.LOW
    caveat = LOW_CONFIDENCE_CAVEAT.format(n=forecast.sample_size)
    assert "8" in caveat
    assert "prediction" in caveat


def test_high_confidence_forecast_needs_no_caveat():
    forecast = make_forecast([(OutcomeClass.NO_ACCESS, 5000)])
    assert forecast.confidence_tier is ConfidenceTier.HIGH


# ---------------------------------------------------------------------------
# The draft. NYC has no public write API for 311.
# ---------------------------------------------------------------------------


def test_draft_tells_the_user_to_submit_it_themselves():
    """We must never imply the complaint was filed."""
    draft = build_draft(
        make_forecast([(OutcomeClass.NO_ACCESS, 500)]), "No heat for three days."
    )
    assert "Submit at" in draft
    lowered = draft.lower()
    for claim in ("we have filed", "has been filed", "we submitted", "your complaint was filed"):
        assert claim not in lowered


def test_draft_includes_the_taxonomy_and_the_users_own_words():
    draft = build_draft(
        make_forecast([(OutcomeClass.NO_ACCESS, 500)]), "No heat for three days."
    )
    assert "HEAT/HOT WATER" in draft
    assert "HPD" in draft
    assert "No heat for three days." in draft
