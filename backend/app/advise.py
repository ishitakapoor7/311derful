"""Turn a forecast into plain-language guidance and a filled-in complaint.

This is the model's second job. The division of labour is strict and load-
bearing:

* **The rules table decides what to say.** Which failure mode dominates, and
  what a person can actually do about it, is determined here in Python from
  the forecast -- not by the model.
* **The model decides how to say it**, in the user's language, and nothing
  else. Every number is interpolated from the forecast before the model sees
  it. The model is never asked to compute, round, or recall a statistic.

That split is what makes the numbers trustworthy, and it is the answer to
"isn't this just a GPT wrapper?" -- the model is a translator, and the
statistics come from 22 million records it never sees.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from anthropic import Anthropic

from app.config import ANTHROPIC_API_KEY, LLM_MODEL
from app.models import (
    AdviseResponse,
    ConfidenceTier,
    ForecastResponse,
    OutcomeClass,
    Tip,
)


@dataclass(frozen=True)
class AdviceRule:
    """What a person can do about one failure mode.

    ``tip`` is written in English as the canonical text; the model translates
    it. Keeping the canonical wording here rather than in the prompt means the
    advice is reviewable and testable independent of the model.
    """

    outcome: OutcomeClass
    tip: str


#: Keyed on the dominant *failure* outcome. Only failure modes a person can
#: actually influence get a tip -- inventing advice for the ones they cannot
#: change would be filler dressed up as help.
ADVICE_RULES: dict[OutcomeClass, AdviceRule] = {
    OutcomeClass.NO_ACCESS: AdviceRule(
        OutcomeClass.NO_ACCESS,
        "The most common reason complaints like yours close without a fix is "
        "that the inspector could not get in. Give a phone number you will "
        "actually answer, and if you can, say when someone will be home. If "
        "you miss the visit, file again -- a closed complaint does not mean "
        "the case is settled.",
    ),
    OutcomeClass.DUPLICATE: AdviceRule(
        OutcomeClass.DUPLICATE,
        "Complaints like yours are often closed as duplicates of a "
        "building-wide report someone else filed. Describe what is happening "
        "in your specific apartment, not just the building, so yours is not "
        "folded into someone else's case and closed with it.",
    ),
    OutcomeClass.GONE_ON_ARRIVAL: AdviceRule(
        OutcomeClass.GONE_ON_ARRIVAL,
        "Most complaints like yours close because whoever caused it was gone "
        "before anyone arrived. Report it while it is still happening rather "
        "than afterwards, and say how long it has been going on.",
    ),
    OutcomeClass.NOTHING_FOUND: AdviceRule(
        OutcomeClass.NOTHING_FOUND,
        "Complaints like yours most often close with the agency finding no "
        "violation. Be specific about what you saw and when -- exact location, "
        "time of day, how often it happens -- so an inspector knows what to "
        "look for and when to look.",
    ),
    OutcomeClass.NO_OUTCOME_GIVEN: AdviceRule(
        OutcomeClass.NO_OUTCOME_GIVEN,
        "Complaints like yours usually close without the agency stating what "
        "happened. Keep your complaint number, and follow up through 311 "
        "rather than assuming the case was resolved.",
    ),
}

SYSTEM = """You explain to a New Yorker what is likely to happen to the 311 \
complaint they are about to file.

You will be given a set of facts and a piece of advice, both already decided. \
Your job is to put them into clear, plain language in the person's own \
language. You are translating and phrasing, nothing else.

Hard rules:
- Use only the numbers you are given. Never calculate, round, estimate, or \
introduce a figure that is not in the facts.
- Do not soften the numbers. If most complaints like theirs close without being \
fixed, say so plainly. This is the point of the tool.
- Do not add advice of your own beyond the tip you are given.
- Write the way a knowledgeable neighbour would talk, not the way a government \
form reads. Short sentences. No bureaucratic vocabulary.
- If a caveat is given, it is not optional and not a footnote -- work it into \
the narrative so someone hearing it aloud cannot miss it.

Return JSON: narrative (2-4 sentences), tips (array of strings, translated), \
and caveat (translated, or null if none was given)."""

SCHEMA = {
    "type": "object",
    "properties": {
        "narrative": {"type": "string"},
        "tips": {"type": "array", "items": {"type": "string"}},
        "caveat": {"type": ["string", "null"]},
    },
    "required": ["narrative", "tips", "caveat"],
    "additionalProperties": False,
}

#: Spoken aloud on the voice path and rendered distinctly in the UI. A LOW-tier
#: number presented as a prediction is the worst failure this project has.
LOW_CONFIDENCE_CAVEAT = (
    "Only {n} similar complaints are on record for this, so treat these numbers "
    "as a rough direction rather than a prediction."
)


def dominant_failure(forecast: ForecastResponse) -> OutcomeClass | None:
    """The most common outcome that is not a resolution."""
    for outcome in forecast.outcomes:
        if outcome.outcome in ADVICE_RULES:
            return outcome.outcome
    return None


def build_facts(forecast: ForecastResponse) -> dict:
    """Assemble every number the narrative may contain.

    Constructed here so the model receives finished figures and has nothing to
    compute. If a number is not in this dict, it must not appear in the output.
    """
    top = forecast.outcomes[0] if forecast.outcomes else None
    failure = dominant_failure(forecast)
    failure_share = next(
        (o.share for o in forecast.outcomes if o.outcome is failure), None
    )
    return {
        "complaint": forecast.complaint_type,
        "agency": forecast.agency,
        "records_analysed": forecast.sample_size,
        "area": (
            "your community district"
            if forecast.geo_level.value == "COMMUNITY_BOARD"
            else "your borough"
            if forecast.geo_level.value == "BOROUGH"
            else "the whole city"
        ),
        "resolved_percent": round(forecast.resolved_share * 100),
        "citywide_resolved_percent": (
            round(forecast.baseline_resolved_share * 100)
            if forecast.baseline_resolved_share is not None
            else None
        ),
        "most_common_outcome": top.outcome.value if top else None,
        "most_common_outcome_percent": round(top.share * 100) if top else None,
        "dominant_failure": failure.value if failure else None,
        "dominant_failure_percent": (
            round(failure_share * 100) if failure_share is not None else None
        ),
    }


def build_draft(forecast: ForecastResponse, description: str) -> str:
    """A complaint the person submits themselves.

    NYC has no public write API for 311, so this is explicitly a draft. Saying
    otherwise on stage -- or in the UI -- would be a lie about what the product
    does.
    """
    descriptor = f" / {forecast.descriptor}" if forecast.descriptor else ""
    return (
        f"311 complaint draft ({forecast.agency})\n"
        f"Category: {forecast.complaint_type}{descriptor}\n\n"
        f"{description.strip()}\n\n"
        "Submit at portal.311.nyc.gov or by calling 311. "
        "Keep the complaint number you are given."
    )


def advise(
    forecast: ForecastResponse,
    description: str,
    lang: str = "en",
    client: Anthropic | None = None,
) -> AdviseResponse:
    """Phrase a forecast for a person, in their language."""
    client = client or Anthropic(api_key=ANTHROPIC_API_KEY)

    failure = dominant_failure(forecast)
    rule = ADVICE_RULES.get(failure) if failure else None
    caveat = (
        LOW_CONFIDENCE_CAVEAT.format(n=forecast.sample_size)
        if forecast.confidence_tier is ConfidenceTier.LOW
        else None
    )

    payload = {
        "language": lang,
        "facts": build_facts(forecast),
        "advice": rule.tip if rule else None,
        "caveat": caveat,
    }

    response = client.messages.create(
        model=LLM_MODEL,
        max_tokens=2048,
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": json.dumps(payload, indent=1)}],
    )

    if response.stop_reason == "refusal":
        raise RuntimeError("advice generation refused")

    out = json.loads(next(b.text for b in response.content if b.type == "text"))

    return AdviseResponse(
        narrative=out["narrative"],
        tips=[Tip(targets_outcome=failure, text=t) for t in out["tips"]] if rule else [],
        draft_text=build_draft(forecast, description),
        # Never let a missing translation drop the caveat -- fall back to the
        # English text rather than shipping an uncaveated LOW-tier number.
        caveat=(out.get("caveat") or caveat) if caveat else None,
    )
