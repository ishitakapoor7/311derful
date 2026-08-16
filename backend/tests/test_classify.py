"""Tests for the outcome classifier.

The fixture ``resolution_corpus.json`` holds the real top-60 resolution
templates per agency pulled from NYC Open Data, with row counts and the date
range each template was in use. Coverage is asserted against those weights so
a rule that only matches a rare template cannot mask a miss on a common one.
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from app.data.classify import RULES, classify, normalize, sql_case_expression
from app.models import OutcomeClass

FIXTURE = Path(__file__).parent / "fixtures" / "resolution_corpus.json"


@pytest.fixture(scope="module")
def corpus() -> dict[str, list[dict]]:
    return json.loads(FIXTURE.read_text())


# ---------------------------------------------------------------------------
# Template drift: the same outcome, written differently across eras.
# ---------------------------------------------------------------------------

ERA_PAIRS = [
    pytest.param(
        "HPD",
        "The Department of Housing Preservation and Development was not able to gain "
        "access to inspect the following conditions. The complaint has been closed.",
        "An HPD Inspector was not able to gain access to inspect this complaint. The "
        "Inspector left a card at the time of the inspection.",
        OutcomeClass.NO_ACCESS,
        id="hpd-no-access-2020-vs-2023",
    ),
    pytest.param(
        "HPD",
        "The complaint you filed is a duplicate of a condition already reported by "
        "another tenant for a building-wide condition.",
        "This complaint is a duplicate of a building-wide condition already reported "
        "by another tenant.",
        OutcomeClass.DUPLICATE,
        id="hpd-duplicate-2020-vs-2024",
    ),
    pytest.param(
        "HPD",
        "The Department of Housing Preservation and Development inspected the "
        "following conditions. Violations were issued.",
        "HPD inspected this condition so the complaint has been closed. Violations "
        "were issued. The law provides the property owner time to correct.",
        OutcomeClass.ACTION_TAKEN,
        id="hpd-violations-2020-vs-2023",
    ),
    pytest.param(
        "NYPD",
        "The Police Department responded to the complaint and with the information "
        "available observed no evidence of the violation at that time.",
        "The New York City Police Department responded to the complaint and with the "
        "information available observed no evidence of a criminal violation at that "
        "time. If the problem persists, please contact 311.",
        OutcomeClass.NOTHING_FOUND,
        id="nypd-no-evidence-pre-vs-post-nov2025",
    ),
    pytest.param(
        "NYPD",
        "The Police Department responded to the complaint and determined that police "
        "action was not necessary.",
        "The New York City Police Department responded to the complaint and their "
        "investigation determined that police action was not necessary. If the "
        "problem persists, please contact 311.",
        OutcomeClass.NO_ACTION_NEEDED,
        id="nypd-no-action-pre-vs-post-nov2025",
    ),
]


@pytest.mark.parametrize("agency,old_text,new_text,expected", ERA_PAIRS)
def test_same_outcome_across_template_eras(agency, old_text, new_text, expected):
    """A rewrite of the canned text must not change the classification.

    This is the whole reason rules match invariant fragments rather than
    template prefixes.
    """
    assert classify(old_text, "Closed", agency) is expected
    assert classify(new_text, "Closed", agency) is expected


# ---------------------------------------------------------------------------
# Ordering: negatives that contain positives as substrings.
# ---------------------------------------------------------------------------


def test_no_violations_issued_is_not_read_as_violations_issued():
    """'No violations were issued' contains 'violations were issued'.

    If rule order regresses, this silently reclassifies HPD's single largest
    template (1.0M rows, 23% of HPD) from NOTHING_FOUND to ACTION_TAKEN --
    inflating the headline resolved-share.
    """
    text = (
        "The Department of Housing Preservation and Development inspected the "
        "following conditions. No violations were issued. The complaint has been closed."
    )
    assert classify(text, "Closed", "HPD") is OutcomeClass.NOTHING_FOUND


def test_corrected_without_summons_beats_no_criminal_violation():
    """Both phrases appear in one NYPD template; the correction is the outcome."""
    text = (
        "The New York City Police Department responded to the complaint and their "
        "investigation determined that no criminal violation existed. The condition "
        "was corrected without the need to issue a summons or effect an arrest."
    )
    assert classify(text, "Closed", "NYPD") is OutcomeClass.ACTION_TAKEN


def test_rule_order_puts_negatives_before_their_substring_positives():
    """Guard the invariant directly, not just its observable effect."""
    phrases = [r.phrase for r in RULES]
    for negative, positive in [("no violations were issued", "violations were issued")]:
        assert phrases.index(negative) < phrases.index(positive)


# ---------------------------------------------------------------------------
# Silence is an outcome, not a classifier failure.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("empty", [None, "", "N/A", "  ", "n/a"])
def test_empty_resolution_on_closed_request_is_no_outcome_given(empty):
    """DSNY leaves this null on 23% of records. That is a finding."""
    assert classify(empty, "Closed", "DSNY") is OutcomeClass.NO_OUTCOME_GIVEN


@pytest.mark.parametrize("empty", [None, "", "N/A"])
def test_empty_resolution_on_open_request_is_pending(empty):
    assert classify(empty, "In Progress", "DSNY") is OutcomeClass.PENDING


def test_dot_link_to_website_is_no_outcome_given():
    """DOT's most common resolution (34%) tells you nothing."""
    text = (
        "Service Request status for this request is available on the Department of "
        "Transportation's website. Please click the \"Learn More\" link below."
    )
    assert classify(text, "Closed", "DOT") is OutcomeClass.NO_OUTCOME_GIVEN


def test_mojibake_variant_classifies_identically():
    """The source data contains both a clean and a mangled copy of this template."""
    clean = (
        "Service Request status for this request is available on the Department of "
        "Transportation's website. Please click the \"Learn More\" link below."
    )
    mangled = (
        "Service Request status for this request is available on the Department of "
        "Transportationâs website. Please click the âLearn Moreâ link below."
    )
    assert classify(mangled, "Closed", "DOT") is classify(clean, "Closed", "DOT")
    assert classify(mangled, "Closed", "DOT") is OutcomeClass.NO_OUTCOME_GIVEN


def test_unmatched_text_on_closed_request_is_unclassified_not_guessed():
    """Never fold an unknown into a real class -- coverage must stay honest."""
    assert (
        classify("Some template nobody has written yet.", "Closed", "HPD")
        is OutcomeClass.UNCLASSIFIED
    )


# ---------------------------------------------------------------------------
# Agency scoping.
# ---------------------------------------------------------------------------


def test_agency_scoped_rule_does_not_leak_to_other_agencies():
    """'conducted or attempted to conduct an inspection' is HPD-specific."""
    text = (
        "The Department of Housing Preservation and Development conducted or "
        "attempted to conduct an inspection. More information at HPDONLINE."
    )
    assert classify(text, "Closed", "HPD") is OutcomeClass.NO_OUTCOME_GIVEN
    assert classify(text, "Closed", "DOT") is OutcomeClass.UNCLASSIFIED


# ---------------------------------------------------------------------------
# Coverage, weighted by real row counts.
# ---------------------------------------------------------------------------

#: Floors are per-agency because the agencies genuinely differ: DSNY and DOT
#: leave far more records without a stated outcome. NO_OUTCOME_GIVEN counts as
#: covered -- a rule matched and we know what it means.
COVERAGE_FLOORS = {"HPD": 0.90, "NYPD": 0.90, "DSNY": 0.85, "DOT": 0.85}


@pytest.mark.parametrize("agency", ["HPD", "NYPD", "DSNY", "DOT"])
def test_weighted_coverage_meets_floor(corpus, agency):
    rows = corpus[agency]
    total = sum(int(r["n"]) for r in rows)
    unclassified = sum(
        int(r["n"])
        for r in rows
        if classify(r.get("resolution_description"), "Closed", agency)
        is OutcomeClass.UNCLASSIFIED
    )
    covered = 1 - unclassified / total
    assert covered >= COVERAGE_FLOORS[agency], (
        f"{agency} coverage {covered:.1%} below floor "
        f"{COVERAGE_FLOORS[agency]:.0%}. Unmatched templates:\n"
        + "\n".join(
            f"  [{r['n']}] {(r.get('resolution_description') or '<NULL>')[:120]}"
            for r in rows
            if classify(r.get("resolution_description"), "Closed", agency)
            is OutcomeClass.UNCLASSIFIED
        )
    )


#: A retired-template cohort smaller than this is long-tail noise, not evidence
#: about drift. NYPD's pre-2024 cohort is 141 rows out of 9.67M (0.0015%) --
#: asserting a percentage over it tests nothing and fails on trivia. NYPD's
#: real drift event was the November 2025 rewrite, which ERA_PAIRS pins
#: directly rather than by aggregate.
MIN_COHORT_ROWS = 10_000


@pytest.mark.parametrize("agency", ["HPD", "NYPD", "DSNY", "DOT"])
def test_coverage_holds_for_templates_retired_before_2024(corpus, agency):
    """Coverage must not be carried entirely by current templates.

    A global coverage number can hide 99% on recent rows and 40% on old ones.
    This isolates templates whose last use predates 2024.
    """
    old = [r for r in corpus[agency] if (r.get("last_seen") or "") < "2024-01"]
    total = sum(int(r["n"]) for r in old)
    if total < MIN_COHORT_ROWS:
        pytest.skip(
            f"{agency} retired-template cohort is {total} rows -- below the "
            f"{MIN_COHORT_ROWS} floor for a meaningful rate"
        )
    unclassified = sum(
        int(r["n"])
        for r in old
        if classify(r.get("resolution_description"), "Closed", agency)
        is OutcomeClass.UNCLASSIFIED
    )
    assert 1 - unclassified / total >= 0.85


# ---------------------------------------------------------------------------
# Python and SQL paths must agree.
# ---------------------------------------------------------------------------


def test_sql_case_expression_matches_python_classifier(corpus):
    """The cube classifies 22M rows in DuckDB, not in Python.

    Both paths are generated from the same ordered rule list; this proves they
    stay in step. If they diverge, every published statistic is wrong.
    """
    rows = [
        (r.get("resolution_description"), "Closed", agency)
        for agency, templates in corpus.items()
        for r in templates
    ]
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE t (resolution_description VARCHAR, status VARCHAR, agency VARCHAR)"
    )
    con.executemany("INSERT INTO t VALUES (?, ?, ?)", rows)

    sql_results = con.execute(
        f"SELECT {sql_case_expression()} FROM t"
    ).fetchall()

    mismatches = [
        (agency, text, py, sql[0])
        for (text, status, agency), sql in zip(rows, sql_results)
        if (py := classify(text, status, agency).value) != sql[0]
    ]
    assert not mismatches, "Python/SQL divergence:\n" + "\n".join(
        f"  {a}: py={p} sql={s} :: {(t or '<NULL>')[:100]}"
        for a, t, p, s in mismatches[:10]
    )


def test_normalize_collapses_whitespace_and_case():
    assert normalize("  The   POLICE\nDepartment ") == "the police department"
