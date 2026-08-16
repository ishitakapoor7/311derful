"""Serve the recovered 311 form map.

Built offline by `app.data.formmap` and committed, because it is 92K rather
than 2GB and changes only when the city changes its form. Loaded once and held
in memory: it is small, immutable, and on the request path.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache

from app.config import REFERENCE_DIR
from app.models import FormField

log = logging.getLogger(__name__)

FORMMAP_PATH = REFERENCE_DIR / "formmap.json"


@lru_cache(maxsize=1)
def _load() -> dict[str, list[FormField]]:
    if not FORMMAP_PATH.exists():
        # The app still answers without it -- a missing form map costs the
        # "what they'll ask you" panel, not the forecast.
        log.warning("no form map at %s; /api/ask will omit form_fields", FORMMAP_PATH)
        return {}
    raw = json.loads(FORMMAP_PATH.read_text())
    return {ct: [FormField(**f) for f in fields] for ct, fields in raw.items()}


def fields_for(complaint_type: str | None) -> list[FormField]:
    """What 311 asks for this complaint type, or [] if we don't know.

    Empty means unknown, never "nothing is asked" -- only the 60 busiest
    complaint types are mapped, so the UI must not present [] as a complete
    answer.
    """
    if not complaint_type:
        return []
    return _load().get(complaint_type, [])
