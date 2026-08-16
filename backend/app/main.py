"""FastAPI app exposing the 311 Reality Check API.

Voice and text are equal front doors into the same endpoints. `source` is
recorded for logging and never changes a response -- the text path is not a
degraded fallback, it is the path that must never break.
"""

from __future__ import annotations

import logging
from pathlib import Path

import duckdb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import history
from app.advise import advise
from app.config import (
    ANTHROPIC_API_KEY,
    DUCKDB_PATH,
    SPEECH_LANGUAGES,
    VAPI_ASSISTANT_ID,
    VAPI_PUBLIC_KEY,
    resolved_voice_mode,
)
from app.forecast import forecast as run_forecast
from app.formmap import fields_for
from app.geocode import from_latlon, from_zip
from app.models import (
    RESOLVED_OUTCOMES,
    AdviseRequest,
    AdviseResponse,
    AskRequest,
    AskResponse,
    ConfigResponse,
    ExploreResponse,
    ExploreRow,
    ForecastRequest,
    ForecastResponse,
    HistoryResponse,
    IntakeRequest,
    IntakeResponse,
    OutcomeClass,
    SpeechLanguage,
)

log = logging.getLogger(__name__)
from app.taxonomy import map_to_taxonomy

app = FastAPI(title="311 Reality Check", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon demo; tighten before any real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)

_con: duckdb.DuckDBPyConnection | None = None


def cube() -> duckdb.DuckDBPyConnection:
    """One shared read-only connection.

    The cube is immutable at runtime, so a single connection is reused rather
    than reopening the database per request.
    """
    global _con
    if _con is None:
        if not DUCKDB_PATH.exists():
            raise HTTPException(
                503, f"cube not built: {DUCKDB_PATH} missing (run ingest + aggregate)"
            )
        _con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    return _con


@app.on_event("startup")
def _startup() -> None:
    history.init()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "cube_present": DUCKDB_PATH.exists()}


@app.get("/api/config", response_model=ConfigResponse)
def get_config() -> ConfigResponse:
    """Everything the frontend needs before it renders.

    Voice mode lives here rather than in the UI so it can be switched from
    `.env` and debugged without a frontend change.
    """
    mode = resolved_voice_mode()
    return ConfigResponse(
        voice_mode=mode,
        # Only ship the key when it is actually going to be used.
        vapi_public_key=VAPI_PUBLIC_KEY if mode == "vapi" else None,
        vapi_assistant_id=VAPI_ASSISTANT_ID if mode == "vapi" else None,
        # Vapi's transcriber auto-detects language; Web Speech cannot, so only
        # that mode needs a picker.
        languages=[SpeechLanguage(**lang) for lang in SPEECH_LANGUAGES]
        if mode == "webspeech"
        else [],
        llm_configured=bool(ANTHROPIC_API_KEY),
    )


@app.get("/api/history", response_model=HistoryResponse)
def get_history(session_id: str, limit: int = 50) -> HistoryResponse:
    return HistoryResponse(entries=history.list_for_session(session_id, limit=limit))


@app.delete("/api/history/{entry_id}", status_code=204)
def delete_history_entry(entry_id: str, session_id: str) -> None:
    """Delete one entry. `session_id` is the authorization check.

    404 rather than 403 on a mismatch: whether an entry exists in someone
    else's session is not this caller's business.
    """
    if not history.delete_entry(session_id, entry_id):
        raise HTTPException(404, "no such entry in this session")


@app.delete("/api/history", status_code=204)
def clear_history(session_id: str) -> None:
    history.clear_session(session_id)


@app.post("/api/intake", response_model=IntakeResponse)
def intake(req: IntakeRequest) -> IntakeResponse:
    """Free text in any language -> a validated 311 taxonomy entry."""
    try:
        match = map_to_taxonomy(req.text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    return IntakeResponse(
        complaint_type=match.complaint_type,
        descriptor=match.descriptor,
        agency=match.agency,
        confidence=match.confidence,
        detected_lang=match.detected_lang,
        # Surfaced only when the match is too weak to forecast on. A confident
        # forecast built on the wrong complaint type is worse than a question.
        clarifying_question=(
            match.clarifying_question if match.needs_clarification else None
        ),
    )


@app.post("/api/forecast", response_model=ForecastResponse)
def forecast_endpoint(req: ForecastRequest) -> ForecastResponse:
    """What actually happens to complaints like this one."""
    # `address` carries "lat,lon" from browser geolocation, or a ZIP. Both
    # resolve locally -- no geocoding service on the request path.
    community_board = req.community_board or _resolve_location(req.address)[0]

    return run_forecast(
        complaint_type=req.complaint_type,
        descriptor=req.descriptor,
        community_board=community_board,
        month=req.month,
        channel=req.channel,
        con=cube(),
    )


@app.post("/api/advise", response_model=AdviseResponse)
def advise_endpoint(req: AdviseRequest) -> AdviseResponse:
    """Phrase a forecast in the caller's language, with a submittable draft."""
    return advise(req.forecast, description=req.description, lang=req.lang)


@app.post("/api/ask", response_model=AskResponse)
def ask(req: AskRequest) -> AskResponse:
    """Describe a problem, get the whole answer in one call.

    Intake -> geocode -> forecast -> advise, collapsed. A voice client wants a
    single target and cannot afford three sequential round trips; this is that
    target. The individual endpoints remain for the explorer UI and debugging.

    Returns early with only `intake` when the taxonomy match is too weak to
    forecast on -- the caller should ask the clarifying question rather than
    forecast against a complaint type the person did not mean.
    """
    intake_result = intake(IntakeRequest(text=req.text, lang=req.lang, source=req.source))

    if intake_result.clarifying_question:
        return AskResponse(intake=intake_result)

    location = _resolve_location(req.address)

    forecast_result = run_forecast(
        complaint_type=intake_result.complaint_type,
        descriptor=intake_result.descriptor,
        community_board=location[0],
        month=req.month,
        channel=req.channel,
        con=cube(),
    )

    advice = advise(
        forecast_result,
        description=req.text,  # the person's own words reach the draft
        lang=req.lang or intake_result.detected_lang,
    )

    result = AskResponse(
        intake=intake_result,
        forecast=forecast_result,
        advice=advice,
        community_board=location[0],
        location_exact=location[1],
        # What 311 will actually ask when they go to file it. Recovered from
        # which columns this complaint type populates, not scraped.
        form_fields=fields_for(intake_result.complaint_type),
    )

    # History is a side effect, never a reason to fail the request: the person
    # asked a question and we have the answer. A broken sidebar is worth far
    # less than a working forecast.
    if req.session_id:
        try:
            history.record(req.session_id, req.text, result)
        except Exception:  # noqa: BLE001
            log.exception("failed to record history for session %s", req.session_id)

    return result


def _resolve_location(address: str | None) -> tuple[str | None, bool]:
    """Resolve `"lat,lon"` or a ZIP to a community board, offline.

    Returns the board and whether the result is exact -- a ZIP is a modal
    guess, not a location, and the caller has to be able to say so.
    """
    if not address:
        return None, False
    raw = address.strip()
    if "," in raw:
        try:
            lat, lon = (float(p) for p in raw.split(",", 1))
        except ValueError:
            return None, False
        result = from_latlon(lat, lon)
        return result.community_board, result.exact
    if raw[:5].isdigit():
        result = from_zip(raw, cube())
        return result.community_board, result.exact
    return None, False


@app.get("/api/explore", response_model=ExploreResponse)
def explore(limit: int = 40) -> ExploreResponse:
    """Citywide findings -- where complaints go to die.

    The personal forecast is the product; this is the evidence that the
    pattern is systemic rather than one unlucky neighbourhood.
    """
    con = cube()
    resolved = ", ".join(f"'{o.value}'" for o in RESOLVED_OUTCOMES)

    rows = con.execute(
        f"""
        WITH totals AS (
            SELECT complaint_type, any_value(agency) AS agency,
                   sum(n) AS total,
                   sum(n) FILTER (WHERE outcome IN ({resolved})) AS resolved
            FROM cube
            WHERE geo_level = 'CITYWIDE' AND time_window = 'RECENT'
              AND descriptor = 'ALL' AND month = 'ALL' AND channel = 'ALL'
            GROUP BY complaint_type
        ),
        failures AS (
            SELECT complaint_type, outcome, n,
                   row_number() OVER (PARTITION BY complaint_type ORDER BY n DESC) AS rk
            FROM cube
            WHERE geo_level = 'CITYWIDE' AND time_window = 'RECENT'
              AND descriptor = 'ALL' AND month = 'ALL' AND channel = 'ALL'
              AND outcome NOT IN ({resolved})
              AND outcome NOT IN ('PENDING', 'UNCLASSIFIED')
        )
        SELECT t.complaint_type, t.agency, t.total,
               t.resolved / t.total::DOUBLE AS resolved_share,
               f.outcome, f.n / t.total::DOUBLE AS failure_share
        FROM totals t LEFT JOIN failures f
          ON f.complaint_type = t.complaint_type AND f.rk = 1
        ORDER BY t.total DESC LIMIT ?
        """,
        [limit],
    ).fetchall()

    total_records, classified = con.execute(
        """
        SELECT sum(n),
               sum(n) FILTER (WHERE outcome <> 'UNCLASSIFIED') / sum(n)::DOUBLE
        FROM cube
        WHERE geo_level = 'CITYWIDE' AND time_window = 'FULL_HISTORY'
          AND descriptor = 'ALL' AND month = 'ALL' AND channel = 'ALL'
        """
    ).fetchone()

    return ExploreResponse(
        rows=[
            ExploreRow(
                complaint_type=ct,
                agency=agency,
                total=total,
                resolved_share=share,
                dominant_failure=OutcomeClass(failure) if failure else None,
                dominant_failure_share=failure_share,
            )
            for ct, agency, total, share, failure, failure_share in rows
        ],
        total_records=int(total_records or 0),
        classified_share=float(classified or 0.0),
    )


# Serve the UI from the API itself. Two reasons beyond convenience: it makes
# the page same-origin so CORS never enters the picture, and browsers treat
# localhost as a secure context, which is what the microphone requires -- so
# speech input works with no HTTPS setup at all.
#
# Mounted last so it cannot shadow any /api route.
#
# The real UI is a Vite app in frontend/, which compiles to frontend/dist -- that
# is what gets served once someone has run `npm run build`. Before then we fall
# back to frontend/reference.html, the dependency-free reference implementation,
# so a fresh clone still has a working page at / without needing Node.
_ROOT = Path(__file__).resolve().parent.parent.parent / "frontend"
_DIST = _ROOT / "dist"

if (_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="ui")
elif (_ROOT / "reference.html").is_file():

    @app.get("/", include_in_schema=False)
    def _reference_ui() -> FileResponse:
        return FileResponse(_ROOT / "reference.html")
