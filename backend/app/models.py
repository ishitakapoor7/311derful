"""API contract for 311 Reality Check.

These schemas are the boundary between backend and frontend. They are defined
before the implementation so the frontend can mock against them immediately.

Two invariants run through this file and should not be relaxed:

1. Every forecast carries its ``sample_size`` and ``confidence_tier``. A
   percentage without a sample size behind it is not a valid response, because
   "82% of complaints like yours fail" computed from 8 records is the worst
   failure mode this project has.
2. Every forecast reports the ``geo_level`` and ``time_window`` it actually
   used. The fallback ladder widens the query when a cell is thin, and the
   caller is entitled to know it is looking at a citywide number rather than
   one for their own district.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class OutcomeClass(str, Enum):
    """What actually happened to a complaint.

    Derived from ``resolution_description``, a templated per-agency field that
    almost nobody parses. This taxonomy is the project's core contribution:
    it converts 311 from a complaint-volume dataset into a service-
    effectiveness one.
    """

    VERIFIED_FIXED = "VERIFIED_FIXED"  # condition confirmed corrected
    ACTION_TAKEN = "ACTION_TAKEN"  # agency acted (summons, repair)
    NO_ACCESS = "NO_ACCESS"  # inspector could not get in
    DUPLICATE = "DUPLICATE"  # closed against another tenant's report
    NOTHING_FOUND = "NOTHING_FOUND"  # responded, saw no violation
    NO_ACTION_NEEDED = "NO_ACTION_NEEDED"  # responded, judged no action required
    GONE_ON_ARRIVAL = "GONE_ON_ARRIVAL"  # responsible party had left
    REFERRED = "REFERRED"  # handed to another agency
    PENDING = "PENDING"  # still open
    NO_OUTCOME_GIVEN = "NO_OUTCOME_GIVEN"  # closed, but the agency never said what happened
    UNCLASSIFIED = "UNCLASSIFIED"  # no rule matched; counted, never hidden


#: Outcomes where the reported problem was actually addressed. Everything else
#: closed without the complainant's condition being resolved -- the distinction
#: the whole product rests on.
RESOLVED_OUTCOMES = frozenset(
    {OutcomeClass.VERIFIED_FIXED, OutcomeClass.ACTION_TAKEN}
)

#: Outcomes that represent a controllable failure -- ones where the person who
#: filed can change the odds next time. These drive the advice rules.
ACTIONABLE_FAILURES = frozenset(
    {OutcomeClass.NO_ACCESS, OutcomeClass.DUPLICATE, OutcomeClass.GONE_ON_ARRIVAL}
)


class ConfidenceTier(str, Enum):
    """How much weight a forecast can bear.

    Thresholds live in ``forecast.py``; this enum only names the bands. LOW
    must render differently in the UI and be spoken aloud in the voice path,
    never buried in a tooltip.
    """

    HIGH = "HIGH"  # n >= 300
    MEDIUM = "MEDIUM"  # 30 <= n < 300
    LOW = "LOW"  # n < 30 -- directional only, not a prediction


class GeoLevel(str, Enum):
    """Geographic breadth the forecast fell back to."""

    COMMUNITY_BOARD = "COMMUNITY_BOARD"
    BOROUGH = "BOROUGH"
    CITYWIDE = "CITYWIDE"


class TimeWindow(str, Enum):
    """Time breadth the forecast fell back to.

    Geography widens before time: agency behaviour is more stable across space
    than across a decade, so a citywide recent number is better evidence about
    today than a local number from 2013.
    """

    RECENT = "RECENT"  # trailing recent years, the default
    FULL_HISTORY = "FULL_HISTORY"  # last resort; always surfaced to the user


class InputSource(str, Enum):
    """Which front door a request came through.

    Voice and text are equal paths into the same endpoint. This field exists
    for logging only and must never change the response.
    """

    VOICE = "voice"
    TEXT = "text"


# --------------------------------------------------------------------------
# POST /api/intake
# --------------------------------------------------------------------------


class IntakeRequest(BaseModel):
    text: str = Field(..., description="What the person said or typed, any language.")
    lang: str | None = Field(
        None, description="BCP-47 tag. Omit to let the backend detect it."
    )
    address: str | None = Field(None, description="Free-form NYC address, optional.")
    source: InputSource = InputSource.TEXT


class IntakeResponse(BaseModel):
    """Result of mapping free text onto the real 311 taxonomy.

    ``complaint_type`` and ``descriptor`` are always drawn from the values that
    actually occur in the dataset -- never invented by the model -- so they can
    be used directly as cube keys.
    """

    complaint_type: str
    descriptor: str | None
    agency: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    detected_lang: str
    clarifying_question: str | None = Field(
        None,
        description=(
            "Set when confidence is low. The caller should ask this and "
            "resubmit rather than proceeding on a weak match."
        ),
    )


# --------------------------------------------------------------------------
# POST /api/forecast
# --------------------------------------------------------------------------


class ForecastRequest(BaseModel):
    complaint_type: str
    descriptor: str | None = None
    community_board: str | None = Field(
        None, description="e.g. '12 MANHATTAN'. Supply this or `address`."
    )
    address: str | None = None
    month: int | None = Field(
        None, ge=1, le=12, description="Defaults to the current month."
    )
    channel: str | None = Field(
        None, description="ONLINE | PHONE | MOBILE. Omit to pool all channels."
    )


class OutcomeShare(BaseModel):
    outcome: OutcomeClass
    share: float = Field(..., ge=0.0, le=1.0)
    count: int
    median_days_to_close: float | None = Field(
        None,
        description=(
            "Closure time for this outcome specifically. Reported per outcome "
            "because the overall average is a vanity metric -- complaints "
            "closed as duplicates or for no access close fastest."
        ),
    )


class ForecastResponse(BaseModel):
    complaint_type: str
    descriptor: str | None
    agency: str

    outcomes: list[OutcomeShare] = Field(..., description="Descending by share.")
    resolved_share: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Combined share of RESOLVED_OUTCOMES. The headline number.",
    )

    sample_size: int = Field(
        ...,
        description=(
            "Records the shares are computed over -- classified records only. "
            "UNCLASSIFIED rows are excluded here and reported separately, "
            "because 'our rules did not match this' is a fact about our "
            "coverage, not something that happened to the complainant. "
            "Leaving them in would put a measurement artifact in the "
            "denominator of every percentage."
        ),
    )
    unclassified_count: int = Field(
        0,
        description=(
            "Records in the same cell that no rule matched. Reported, never "
            "hidden -- but never shown as an outcome either."
        ),
    )
    confidence_tier: ConfidenceTier
    geo_level: GeoLevel
    time_window: TimeWindow

    baseline_resolved_share: float | None = Field(
        None, description="Citywide resolved share for the same complaint type."
    )

    @property
    def is_directional_only(self) -> bool:
        """True when this must not be presented as a prediction."""
        return self.confidence_tier is ConfidenceTier.LOW


# --------------------------------------------------------------------------
# POST /api/advise
# --------------------------------------------------------------------------


class Tip(BaseModel):
    """A concrete action derived from the dominant failure mode.

    Tips come from a rules table keyed on outcome class, not from the model.
    The model only translates and phrases them.
    """

    targets_outcome: OutcomeClass
    text: str


class AdviseRequest(BaseModel):
    forecast: ForecastResponse
    description: str = Field(
        ...,
        description=(
            "What the person actually said, in their own words. This is what "
            "goes into the draft complaint -- the taxonomy label ('HEAT/HOT "
            "WATER') describes the category, not the problem, and a 311 "
            "operator reading only the category learns nothing."
        ),
    )
    lang: str = "en"


class AskRequest(BaseModel):
    """One call for the whole flow: describe a problem, get an answer.

    The step-by-step endpoints stay for the explorer UI and for debugging, but
    a conversational client should use this. Three round trips is two too many
    when someone is waiting to hear a reply.
    """

    text: str
    lang: str | None = None
    address: str | None = None
    month: int | None = None
    channel: str | None = None
    source: InputSource = InputSource.TEXT
    session_id: str | None = Field(
        None,
        description=(
            "Opaque browser-generated UUID. When present the result is saved "
            "to that session's history. There are no accounts -- this is not "
            "identity, and anyone holding the id can read that history."
        ),
    )


class FormOption(BaseModel):
    """One choice on a 311 dropdown, with how often people pick it."""

    value: str
    share: float = Field(..., ge=0.0, le=1.0)


class FormField(BaseModel):
    """A question 311's intake form asks for this complaint type."""

    column: str = Field(..., description="The dataset column it was recovered from.")
    question: str
    always: bool = Field(
        ...,
        description=(
            "False when the field is conditional on an earlier answer, so the "
            "UI can say 'may ask' rather than presenting it as required."
        ),
    )
    fill_rate: float = Field(..., ge=0.0, le=1.0)
    options: list[FormOption] | None = Field(
        None, description="Present for dropdowns, ordered by how often chosen."
    )


class AskResponse(BaseModel):
    intake: IntakeResponse
    forecast: ForecastResponse | None = Field(
        None, description="Omitted when intake needs clarification first."
    )
    advice: AdviseResponse | None = None
    community_board: str | None = None
    location_exact: bool = Field(
        False,
        description=(
            "False when the location was approximated (ZIP fallback) or "
            "unknown, so the caller can say so rather than implying precision."
        ),
    )
    form_fields: list[FormField] = Field(
        default_factory=list,
        description=(
            "What 311 will ask when this complaint is filed, recovered from "
            "which dataset columns this complaint type populates. Empty when "
            "the complaint type is not in the form map -- absence means "
            "unknown, never 'nothing is asked'."
        ),
    )


class AdviseResponse(BaseModel):
    narrative: str = Field(
        ...,
        description=(
            "Plain-language summary in `lang`. Every number in it is injected "
            "from the forecast; the model is never asked to produce one."
        ),
    )
    tips: list[Tip]
    draft_text: str = Field(
        ...,
        description=(
            "A filled-in complaint the user submits themselves. NYC has no "
            "public write API for 311, so this is a draft and must never be "
            "presented as a filed complaint."
        ),
    )
    caveat: str | None = Field(
        None,
        description="Required when confidence_tier is LOW. Spoken, not hidden.",
    )


# --------------------------------------------------------------------------
# GET /api/explore
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# GET/DELETE /api/history
# --------------------------------------------------------------------------


class HistoryEntry(BaseModel):
    """One past complaint, stored flat so the sidebar can re-render it.

    Deliberately denormalised: everything needed to redraw the result card is
    here, so clicking a past entry costs no model call and no cube lookup.
    """

    id: str
    created_at: datetime
    text: str = Field(..., description="What the person originally said.")

    complaint_type: str
    descriptor: str | None
    agency: str
    community_board: str | None

    resolved_share: float | None
    sample_size: int | None
    confidence_tier: ConfidenceTier | None
    narrative: str | None
    draft_text: str | None


class HistoryResponse(BaseModel):
    entries: list[HistoryEntry]


# --------------------------------------------------------------------------
# GET /api/config
# --------------------------------------------------------------------------


class SpeechLanguage(BaseModel):
    tag: str = Field(..., description="BCP-47, as SpeechRecognition.lang expects.")
    label: str


class ConfigResponse(BaseModel):
    """What the frontend needs to know before it renders anything.

    Which voice path is live is a backend decision so it can be switched and
    debugged from `.env` without a frontend change. The client reads this once
    on load and initialises accordingly.
    """

    voice_mode: str = Field(..., description="webspeech | vapi | off")
    vapi_public_key: str | None = Field(
        None, description="Browser-safe public key. Present only when voice_mode is vapi."
    )
    vapi_assistant_id: str | None = None
    languages: list[SpeechLanguage] = Field(
        default_factory=list,
        description=(
            "Populated only for webspeech, which cannot detect the spoken "
            "language and must be told. Empty for vapi -- its transcriber "
            "auto-detects, so the UI should hide the picker."
        ),
    )
    llm_configured: bool = Field(
        ...,
        description=(
            "False when no Anthropic key is set, in which case /api/ask will "
            "fail. Lets the UI say so up front instead of on submit."
        ),
    )


class ExploreRow(BaseModel):
    complaint_type: str
    agency: str
    total: int
    resolved_share: float
    dominant_failure: OutcomeClass | None
    dominant_failure_share: float | None


class ExploreResponse(BaseModel):
    """Citywide findings view -- 'where complaints go to die'.

    The personal forecast is the product; this is the evidence that the
    pattern is systemic.
    """

    rows: list[ExploreRow]
    total_records: int
    classified_share: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Share of records a rule matched. Shown in the UI, not hidden.",
    )
