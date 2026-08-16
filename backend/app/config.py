"""Configuration and shared constants."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", BACKEND_DIR / "data"))
DUCKDB_PATH = DATA_DIR / "nyc311.duckdb"
RAW_CACHE_DIR = DATA_DIR / "raw"

# NYC Open Data: "311 Service Requests from 2020 to Present".
# Verified 2026-08-15: 22,145,244 rows, updated daily.
SOCRATA_DOMAIN = "data.cityofnewyork.us"
DATASET_ID = "erm2-nwe9"
SOCRATA_APP_TOKEN = os.getenv("SOCRATA_APP_TOKEN")  # unauthenticated gets throttled

# Ingest window. A parameter, not a constant: the pre-2020 archive is a
# separate dataset whose inclusion is gated on a measured classifier-coverage
# test (>=85%), because resolution templates drift as agencies rewrite them.
INGEST_START = os.getenv("INGEST_START", "2020-01-01")

# Columns worth keeping. The source has 48; the rest are geometry duplicates
# and agency-specific fields we never query.
INGEST_COLUMNS = [
    "unique_key",
    "created_date",
    "closed_date",
    "agency",
    "complaint_type",
    "descriptor",
    "status",
    "resolution_description",
    "community_board",
    "borough",
    "incident_zip",
    "open_data_channel_type",
    "latitude",
    "longitude",
]

# Agencies the classifier covers first, by complaint volume.
PRIORITY_AGENCIES = ["HPD", "NYPD", "DSNY", "DOT"]

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5")

# Session history. Deliberately its own SQLite file rather than a table in the
# DuckDB cube: the cube is opened read-only on the request path and is dropped
# and rebuilt wholesale by `app.data.aggregate`, which would take user history
# with it. Row-level writes are also not what a columnar store is for.
HISTORY_DB_PATH = DATA_DIR / "history.sqlite3"

# --------------------------------------------------------------------------
# Voice
#
# Which speech path is live is a backend decision, not a user-facing toggle --
# it can be switched and debugged from .env without touching the frontend.
#
#   webspeech  browser SpeechRecognition. No keys, no cost. Cannot detect the
#              spoken language, so the UI must show a language picker.
#   vapi       Vapi web SDK in the browser (no phone number). Better accuracy
#              and real voices, and its transcriber auto-detects language, so
#              the UI hides the picker.
#   off        no microphone at all; text only.
# --------------------------------------------------------------------------
VOICE_MODE = os.getenv("VOICE_MODE", "webspeech").strip().lower()
VALID_VOICE_MODES = {"webspeech", "vapi", "off"}

# Safe to ship to the browser -- Vapi's public key is designed for client-side
# use. The private key must never appear here.
VAPI_PUBLIC_KEY = os.getenv("VAPI_PUBLIC_KEY")
VAPI_ASSISTANT_ID = os.getenv("VAPI_ASSISTANT_ID")

#: Offered in the language picker under `webspeech`. Roughly the most spoken
#: languages in NYC households after English. BCP-47 tags, because that is what
#: SpeechRecognition.lang expects.
SPEECH_LANGUAGES = [
    {"tag": "en-US", "label": "English"},
    {"tag": "es-ES", "label": "Español"},
    {"tag": "zh-CN", "label": "中文"},
    {"tag": "bn-BD", "label": "বাংলা"},
    {"tag": "ru-RU", "label": "Русский"},
    {"tag": "ht-HT", "label": "Kreyòl Ayisyen"},
    {"tag": "ar-SA", "label": "العربية"},
    {"tag": "fr-FR", "label": "Français"},
]


def resolved_voice_mode() -> str:
    """The voice mode actually in effect.

    Degrades rather than failing: an unknown value or a `vapi` setting with no
    key configured falls back to `webspeech`, which needs nothing. Getting a
    working mic instead of a stack trace is the right outcome on demo day.
    """
    if VOICE_MODE not in VALID_VOICE_MODES:
        return "webspeech"
    if VOICE_MODE == "vapi" and not (VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID):
        return "webspeech"
    return VOICE_MODE
