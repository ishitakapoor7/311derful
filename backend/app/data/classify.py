"""Map ``resolution_description`` onto what actually happened to a complaint.

This module carries the project's central claim, so it is worth being precise
about how it works and why.

NYC agencies write their resolution text from a small set of canned templates.
Nobody parses them, so 311 gets used as a dataset about complaint *volume*.
Classified, the same field turns 311 into a dataset about service
*effectiveness* -- and shows that closure is not resolution.

Three properties of the real data shape the design:

**Templates drift.** Agencies rewrite their canned text periodically, and the
rewrites are not cosmetic. NYPD switched from "The Police Department
responded..." to "The New York City Police Department responded..." in November
2025; HPD replaced its duplicate-closure template in September 2024 and its
violation template in January 2023. Rules therefore match a short invariant
*fragment* ("not able to gain access") rather than a template prefix. A rule
anchored to "HPD conducted an inspection" silently misses every row before
2021.

**Order is load-bearing.** "No violations were issued" contains "violations
were issued" as a substring, so the negative must be tested first. Rules are an
ordered list and first match wins; the ordering is not incidental and the tests
pin it.

**Silence is an outcome.** DSNY leaves ``resolution_description`` null on 23% of
its records; DOT's single most common resolution is a link telling you to look
somewhere else. That is not a classifier failure, so it is not
``UNCLASSIFIED`` -- it is ``NO_OUTCOME_GIVEN``, a finding in its own right.
``UNCLASSIFIED`` is reserved for rows no rule matched, and is always counted
and reported rather than hidden.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.models import OutcomeClass

# Source data contains mojibake from a bad encoding round-trip (e.g. the DOT
# template appears both as "Department of Transportation's" and
# "Department of Transportationâs"). Normalise these away before matching.
_MOJIBAKE = {
    "â€™": "'",  # â€™ -> '
    "â€": '"',  # â€œ -> "
    "â€": '"',  # â€ -> "
    "â": "'",
    "Â": "",  # stray Â
    "’": "'",
    "‘": "'",
    "“": '"',
    "”": '"',
}

_WS = re.compile(r"\s+")

#: Values that mean "the agency wrote nothing here".
_EMPTY_MARKERS = {"", "n/a", "na", "none", "null", "-"}

#: Status values indicating the request has not reached an outcome yet.
_OPEN_STATUSES = {"open", "in progress", "pending", "assigned", "started"}


def normalize(text: str | None) -> str:
    """Lower-case, de-mojibake, and collapse whitespace for matching."""
    if text is None:
        return ""
    out = unicodedata.normalize("NFKC", text)
    for bad, good in _MOJIBAKE.items():
        out = out.replace(bad, good)
    return _WS.sub(" ", out).strip().lower()


@dataclass(frozen=True)
class Rule:
    """One phrase-to-outcome mapping.

    ``agency`` scopes the rule when a phrase is only unambiguous for one
    agency; ``None`` applies it everywhere. ``note`` records why a rule sits
    where it does, which matters because ordering encodes real precedence.
    """

    phrase: str
    outcome: OutcomeClass
    agency: str | None = None
    note: str = ""


# ---------------------------------------------------------------------------
# Rules, in priority order. First match wins.
#
# Grouped by why they sit where they do, not by agency, because the ordering
# constraints cut across agencies.
# ---------------------------------------------------------------------------

RULES: list[Rule] = [
    # -- Negatives that are substrings of positives. These MUST come first. --
    Rule(
        "no violations were issued",
        OutcomeClass.NOTHING_FOUND,
        note="Contains 'violations were issued'; must precede it.",
    ),
    Rule(
        "did not violate",
        OutcomeClass.NOTHING_FOUND,
        note="HPD's post-2021 phrasing of the same outcome.",
    ),
    Rule(
        "condition was corrected without the need to issue a summons",
        OutcomeClass.ACTION_TAKEN,
        agency="NYPD",
        note=(
            "Co-occurs with 'no criminal violation existed'. The condition was "
            "corrected, so it precedes that NOTHING_FOUND rule."
        ),
    ),
    Rule(
        "no dsny related conditions/violations were observed",
        OutcomeClass.REFERRED,
        agency="DSNY",
        note="Says referred to appropriate agency; referral is the real outcome.",
    ),
    # -- Access failures. The single most actionable failure mode. --
    Rule("not able to gain access", OutcomeClass.NO_ACCESS),
    Rule("could not gain access", OutcomeClass.NO_ACCESS),
    Rule("unable to gain entry", OutcomeClass.NO_ACCESS),
    Rule("unable to gain access", OutcomeClass.NO_ACCESS),
    Rule(
        "unable to complete the inspection",
        OutcomeClass.NO_ACCESS,
        agency="HPD",
        note="2021+ phrasing; the earlier era says 'not able to gain access'.",
    ),
    # -- Duplicates. Closed against someone else's report. --
    Rule("is a duplicate of", OutcomeClass.DUPLICATE),
    Rule("duplicate of a condition already reported", OutcomeClass.DUPLICATE),
    Rule(
        "already has a request to investigate",
        OutcomeClass.DUPLICATE,
        agency="DSNY",
        note="Abandoned-vehicle dedupe, phrased without the word 'duplicate'.",
    ),
    # -- Confirmed fixed. Someone verified the condition was resolved. --
    Rule("verified that the following conditions were corrected", OutcomeClass.VERIFIED_FIXED),
    Rule("indicated that the condition was corrected", OutcomeClass.VERIFIED_FIXED),
    Rule("had been restored", OutcomeClass.VERIFIED_FIXED),
    Rule("found that the problem was fixed", OutcomeClass.VERIFIED_FIXED),
    # -- Agency acted. Not always verified fixed, but something happened. --
    Rule("took action to fix the condition", OutcomeClass.ACTION_TAKEN),
    Rule("issued a summons", OutcomeClass.ACTION_TAKEN),
    Rule("violations were issued", OutcomeClass.ACTION_TAKEN, note="After the negatives above."),
    Rule("issued a notice of violation", OutcomeClass.ACTION_TAKEN),
    Rule("issued a notice to the responsible party", OutcomeClass.ACTION_TAKEN),
    Rule("issued a corrective action repair", OutcomeClass.ACTION_TAKEN),
    Rule("repaired the problem", OutcomeClass.ACTION_TAKEN),
    Rule("cleaned the location", OutcomeClass.ACTION_TAKEN),
    Rule("collected the requested items", OutcomeClass.ACTION_TAKEN),
    Rule("collected the e-waste", OutcomeClass.ACTION_TAKEN),
    Rule("removed the items", OutcomeClass.ACTION_TAKEN),
    Rule("removed the graffiti", OutcomeClass.ACTION_TAKEN),
    Rule("has been removed by the department of sanitation", OutcomeClass.ACTION_TAKEN),
    Rule("completed the request or corrected the condition", OutcomeClass.ACTION_TAKEN),
    Rule("investigated the complaint and addressed the issue", OutcomeClass.ACTION_TAKEN),
    # -- Responded, found nothing. --
    Rule("observed no evidence", OutcomeClass.NOTHING_FOUND),
    Rule("no criminal violation existed", OutcomeClass.NOTHING_FOUND),
    Rule("observed no criminal violation", OutcomeClass.NOTHING_FOUND),
    Rule("found no condition at the location", OutcomeClass.NOTHING_FOUND),
    Rule("found no violation at the location", OutcomeClass.NOTHING_FOUND),
    Rule("did not find the reported problem", OutcomeClass.NOTHING_FOUND),
    Rule("could not find the problem", OutcomeClass.NOTHING_FOUND),
    Rule("couldn't find the condition", OutcomeClass.NOTHING_FOUND),
    Rule("could not find the condition you reported", OutcomeClass.NOTHING_FOUND),
    Rule("no encampment was found", OutcomeClass.NOTHING_FOUND),
    Rule("no homeless street condition was found", OutcomeClass.NOTHING_FOUND),
    Rule("meets its standards", OutcomeClass.NOTHING_FOUND),
    # -- Responded, judged no action required. --
    Rule("police action was not necessary", OutcomeClass.NO_ACTION_NEEDED),
    Rule("complaint was not warranted", OutcomeClass.NO_ACTION_NEEDED),
    Rule("owner claimed the vehicle", OutcomeClass.NO_ACTION_NEEDED),
    Rule("educational outreach", OutcomeClass.NO_ACTION_NEEDED),
    # -- Responsible party gone before the agency arrived. --
    Rule("those responsible for the condition were gone", OutcomeClass.GONE_ON_ARRIVAL),
    # -- Handed off elsewhere. --
    Rule("does not fall under the police department's jurisdiction", OutcomeClass.REFERRED),
    Rule("not within its jurisdiction", OutcomeClass.REFERRED),
    Rule("does not have jurisdiction", OutcomeClass.REFERRED),
    Rule("referred to the nypd", OutcomeClass.REFERRED),
    Rule("forwarded the request to the nypd", OutcomeClass.REFERRED),
    Rule("requested the department of environmental protection", OutcomeClass.REFERRED),
    Rule("referred to the appropriate agency", OutcomeClass.REFERRED),
    Rule("not to be under department of transportation's jurisdiction", OutcomeClass.REFERRED),
    Rule("required re-assignment", OutcomeClass.REFERRED),
    # -- Still open, or action deferred to a future date. --
    Rule("conditions are still open", OutcomeClass.PENDING),
    Rule("will inspect the complaint location", OutcomeClass.PENDING),
    Rule("will inspect the condition", OutcomeClass.PENDING),
    Rule("has been scheduled", OutcomeClass.PENDING),
    Rule("re-inspection will be done", OutcomeClass.PENDING),
    Rule("will be notified by mail", OutcomeClass.PENDING),
    Rule("original complaint is being addressed", OutcomeClass.PENDING),
    Rule("has approved the sidewalk re-inspection", OutcomeClass.PENDING),
    Rule("long-term investigation may be necessary", OutcomeClass.PENDING),
    Rule("coordinating with their agency partners", OutcomeClass.REFERRED),
    Rule("will address the situation at the location", OutcomeClass.PENDING),
    Rule("has a maximum of 30 days", OutcomeClass.PENDING),
    # -----------------------------------------------------------------------
    # Second tier of agencies: DEP, DPR, DOB, DOHMH, OSE, DHS.
    #
    # Added after measuring real coverage: rules for the four biggest agencies
    # alone left overall coverage at 81-83%, because these six carry ~17% of
    # all requests and matched nothing. Ordered negatives-first within the
    # group, same as above.
    # -----------------------------------------------------------------------
    Rule(
        "the issue you reported was addressed",
        OutcomeClass.ACTION_TAKEN,
        agency="DOHMH",
        note="Template also says 'administratively closed'; the fix is the outcome.",
    ),
    Rule("did not find any violations", OutcomeClass.NOTHING_FOUND),
    Rule("didn't observe a violation", OutcomeClass.NOTHING_FOUND),
    Rule("no indication of a city sewer issue", OutcomeClass.NOTHING_FOUND),
    Rule("no sewer back up", OutcomeClass.NOTHING_FOUND),
    Rule("could not find the tree condition", OutcomeClass.NOTHING_FOUND),
    Rule("could not find the individual that you reported", OutcomeClass.NOTHING_FOUND),
    Rule("could not locate the premises", OutcomeClass.NOTHING_FOUND),
    Rule("found compliance with applicable laws", OutcomeClass.NOTHING_FOUND),
    Rule("business is allowed to be open", OutcomeClass.NOTHING_FOUND),
    Rule("do not violate reopening guidelines", OutcomeClass.NOTHING_FOUND),
    Rule("did not relate to a business", OutcomeClass.NOTHING_FOUND),
    # Access failures.
    Rule("was denied access", OutcomeClass.NO_ACCESS),
    Rule("could not access the site", OutcomeClass.NO_ACCESS),
    Rule(
        "the business was not open",
        OutcomeClass.GONE_ON_ARRIVAL,
        agency="OSE",
        note="Same actionable shape as GONE_ON_ARRIVAL: report while it's open.",
    ),
    # Duplicates.
    Rule("addressed under another service request", OutcomeClass.DUPLICATE),
    Rule("received an earlier complaint about the same location", OutcomeClass.DUPLICATE),
    Rule("found a service request already exists", OutcomeClass.DUPLICATE),
    Rule("reported under a previously inspected complaint", OutcomeClass.DUPLICATE),
    # Agency acted.
    Rule("performed the work necessary to correct the condition", OutcomeClass.ACTION_TAKEN),
    Rule("completed the requested work order and corrected the problem", OutcomeClass.ACTION_TAKEN),
    Rule("shut the running hydrant", OutcomeClass.ACTION_TAKEN),
    Rule("cleaned the catch basin", OutcomeClass.ACTION_TAKEN),
    Rule("mailed you the free lead test kit", OutcomeClass.ACTION_TAKEN),
    Rule("removed the stop work order", OutcomeClass.ACTION_TAKEN),
    Rule("trials and hearings (oath) summons", OutcomeClass.ACTION_TAKEN),
    Rule("found violations on the property", OutcomeClass.ACTION_TAKEN),
    Rule("passed with minor violations found", OutcomeClass.ACTION_TAKEN),
    Rule("sent an advisory to correct the condition", OutcomeClass.ACTION_TAKEN),
    Rule("letter was sent to the owner or manager", OutcomeClass.ACTION_TAKEN),
    Rule("issued a warning", OutcomeClass.ACTION_TAKEN),
    Rule("outreach assistance was offered", OutcomeClass.ACTION_TAKEN),
    Rule(
        "did not accept assistance",
        OutcomeClass.ACTION_TAKEN,
        agency="DHS",
        note="Outreach happened and was declined -- the agency did respond.",
    ),
    # Responded, judged no action required.
    Rule("no further action was necessary", OutcomeClass.NO_ACTION_NEEDED),
    Rule("no work is necessary at this time", OutcomeClass.NO_ACTION_NEEDED),
    Rule("inspection is not warranted", OutcomeClass.NO_ACTION_NEEDED),
    Rule("shifting their street tree planting program", OutcomeClass.NO_ACTION_NEEDED),
    # Handed off.
    Rule("out of the jurisdiction", OutcomeClass.REFERRED),
    Rule("referred this request to the new york city police department", OutcomeClass.REFERRED),
    # Deferred to a future date.
    Rule("further investigation is required", OutcomeClass.PENDING),
    Rule("will visit the location to investigate", OutcomeClass.PENDING),
    Rule("has been submitted to the department of buildings", OutcomeClass.PENDING),
    Rule("follow-up inspections will be scheduled", OutcomeClass.PENDING),
    # Closed with nothing stated.
    Rule("sufficient location or complaint information", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("did not have enough information to act", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("does not contains sufficient information", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("administratively closed", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("should now be administratively cl", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("determined that it could be closed", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("reviewed this complaint and closed it", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("will be used to inform the city", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("the city will investigate as needed", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("has responded to your service request", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("you can get the status by calling", OutcomeClass.NO_OUTCOME_GIVEN),
    # -- Closed, but the agency never said what happened. A finding, not a gap. --
    Rule("service request status for this request is available", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("provided additional information below", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("additional information in the \"notes to customer\"", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule(
        "conducted or attempted to conduct an inspection",
        OutcomeClass.NO_OUTCOME_GIVEN,
        agency="HPD",
        note="Says an inspection happened but never states the result.",
    ),
    Rule("did not have sufficient information", OutcomeClass.NO_OUTCOME_GIVEN),
    Rule("inspected the location more than six months ago", OutcomeClass.NO_OUTCOME_GIVEN),
    # Last of all: a bare "call 311 for more" with no outcome stated. Many
    # templates end with some form of "please call 311", so this sits at the
    # very bottom -- every rule that names a real outcome gets first refusal.
    Rule("call 311 for further information", OutcomeClass.NO_OUTCOME_GIVEN),
]


def classify(
    resolution_description: str | None,
    status: str | None = None,
    agency: str | None = None,
) -> OutcomeClass:
    """Return what actually happened to one complaint.

    ``status`` disambiguates empty resolution text: an open request is
    ``PENDING``, whereas a closed one with nothing written is
    ``NO_OUTCOME_GIVEN``. Rows reaching neither are ``UNCLASSIFIED`` and are
    reported, never quietly folded into another class.
    """
    text = normalize(resolution_description)
    agency_key = (agency or "").strip().upper() or None

    if text in _EMPTY_MARKERS:
        if normalize(status) in _OPEN_STATUSES:
            return OutcomeClass.PENDING
        return OutcomeClass.NO_OUTCOME_GIVEN

    for rule in RULES:
        if rule.agency and rule.agency != agency_key:
            continue
        if rule.phrase in text:
            return rule.outcome

    # An open request whose text matched nothing is still meaningfully pending.
    if normalize(status) in _OPEN_STATUSES:
        return OutcomeClass.PENDING

    return OutcomeClass.UNCLASSIFIED


def sql_case_expression(
    text_col: str = "resolution_description",
    status_col: str = "status",
    agency_col: str = "agency",
) -> str:
    """Render ``RULES`` as a DuckDB CASE expression.

    The cube classifies 22M rows, so classification runs inside the database
    rather than row-by-row in Python. Generating the SQL from the same ordered
    rule list keeps the two paths from drifting apart -- ``test_classify.py``
    asserts they agree.
    """
    norm = f"lower(trim(regexp_replace(coalesce({text_col}, ''), '\\s+', ' ', 'g')))"
    norm_status = f"lower(trim(coalesce({status_col}, '')))"
    norm_agency = f"upper(trim(coalesce({agency_col}, '')))"

    empty_list = ", ".join(f"'{m}'" for m in sorted(_EMPTY_MARKERS))
    open_list = ", ".join(f"'{s}'" for s in sorted(_OPEN_STATUSES))

    parts = [
        f"WHEN {norm} IN ({empty_list}) AND {norm_status} IN ({open_list}) "
        f"THEN '{OutcomeClass.PENDING.value}'",
        f"WHEN {norm} IN ({empty_list}) THEN '{OutcomeClass.NO_OUTCOME_GIVEN.value}'",
    ]
    for rule in RULES:
        phrase = rule.phrase.replace("'", "''")
        cond = f"contains({norm}, '{phrase}')"
        if rule.agency:
            cond = f"{norm_agency} = '{rule.agency}' AND {cond}"
        parts.append(f"WHEN {cond} THEN '{rule.outcome.value}'")

    parts.append(
        f"WHEN {norm_status} IN ({open_list}) THEN '{OutcomeClass.PENDING.value}'"
    )
    body = "\n    ".join(parts)
    return f"CASE\n    {body}\n    ELSE '{OutcomeClass.UNCLASSIFIED.value}'\nEND"
