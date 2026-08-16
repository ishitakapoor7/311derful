"""Per-session record of past complaints.

Stored in its own SQLite file rather than in the DuckDB cube. Three reasons,
in order of how badly each would bite:

1. `app.data.aggregate` drops and rebuilds the cube wholesale. History living
   there would be destroyed by a routine re-ingest.
2. The cube is opened read-only on the request path.
3. DuckDB is columnar and built for scans; this is single-row writes and
   point lookups, which is what SQLite is for.

**There are no accounts.** `session_id` is an opaque UUID the browser mints
once and keeps. It is a bearer token in the weakest sense: anyone holding it
can read that history. That is an acceptable trade for a tool with nothing
sensitive in it and no sign-in, but it means two things must stay true --
every read and delete is scoped by `session_id`, and we never treat a session
as evidence of identity.
"""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from app.config import HISTORY_DB_PATH
from app.models import AskResponse, HistoryEntry

SCHEMA = """
CREATE TABLE IF NOT EXISTS history (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    text              TEXT NOT NULL,
    complaint_type    TEXT NOT NULL,
    descriptor        TEXT,
    agency            TEXT NOT NULL,
    community_board   TEXT,
    resolved_share    REAL,
    sample_size       INTEGER,
    confidence_tier   TEXT,
    narrative         TEXT,
    draft_text        TEXT
);
-- Every query is "this session, newest first", so index exactly that.
CREATE INDEX IF NOT EXISTS idx_history_session
    ON history(session_id, created_at DESC);
"""


@contextmanager
def _connect(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    path = db_path or HISTORY_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init(db_path: Path | None = None) -> None:
    """Create the table if it doesn't exist. Safe to call on every startup."""
    with _connect(db_path) as con:
        con.executescript(SCHEMA)


def record(
    session_id: str, text: str, result: AskResponse, db_path: Path | None = None
) -> HistoryEntry | None:
    """Save a completed ask. Returns None when there is nothing to save.

    A clarifying-question response has no forecast attached, and storing it
    would put a row in the sidebar that cannot be re-rendered. Those are
    skipped rather than half-saved.
    """
    if result.forecast is None:
        return None

    entry = HistoryEntry(
        id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc),
        text=text,
        complaint_type=result.forecast.complaint_type,
        descriptor=result.forecast.descriptor,
        agency=result.forecast.agency,
        community_board=result.community_board,
        resolved_share=result.forecast.resolved_share,
        sample_size=result.forecast.sample_size,
        confidence_tier=result.forecast.confidence_tier,
        narrative=result.advice.narrative if result.advice else None,
        draft_text=result.advice.draft_text if result.advice else None,
    )

    with _connect(db_path) as con:
        con.execute(
            """
            INSERT INTO history (id, session_id, created_at, text, complaint_type,
                                 descriptor, agency, community_board, resolved_share,
                                 sample_size, confidence_tier, narrative, draft_text)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                entry.id,
                session_id,
                entry.created_at.isoformat(),
                entry.text,
                entry.complaint_type,
                entry.descriptor,
                entry.agency,
                entry.community_board,
                entry.resolved_share,
                entry.sample_size,
                entry.confidence_tier.value,
                entry.narrative,
                entry.draft_text,
            ),
        )
    return entry


def list_for_session(
    session_id: str, limit: int = 50, db_path: Path | None = None
) -> list[HistoryEntry]:
    """Newest first. Scoped to one session -- never returns another's rows."""
    with _connect(db_path) as con:
        rows = con.execute(
            "SELECT * FROM history WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
    return [_to_entry(r) for r in rows]


def delete_entry(session_id: str, entry_id: str, db_path: Path | None = None) -> bool:
    """Delete one entry. Returns False if it isn't this session's to delete.

    The `session_id` in the WHERE clause is the authorization check -- knowing
    an entry id is not enough to remove it.
    """
    with _connect(db_path) as con:
        cur = con.execute(
            "DELETE FROM history WHERE id = ? AND session_id = ?", (entry_id, session_id)
        )
        return cur.rowcount > 0


def clear_session(session_id: str, db_path: Path | None = None) -> int:
    """Delete everything for one session. Returns how many rows went."""
    with _connect(db_path) as con:
        return con.execute(
            "DELETE FROM history WHERE session_id = ?", (session_id,)
        ).rowcount


def _to_entry(row: sqlite3.Row) -> HistoryEntry:
    return HistoryEntry(
        id=row["id"],
        created_at=datetime.fromisoformat(row["created_at"]),
        text=row["text"],
        complaint_type=row["complaint_type"],
        descriptor=row["descriptor"],
        agency=row["agency"],
        community_board=row["community_board"],
        resolved_share=row["resolved_share"],
        sample_size=row["sample_size"],
        confidence_tier=row["confidence_tier"],
        narrative=row["narrative"],
        draft_text=row["draft_text"],
    )
