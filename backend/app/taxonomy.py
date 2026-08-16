"""Map a person's own words onto 311's internal taxonomy.

This is the model's first of two jobs (the second is phrasing, in `advise.py`).
It never produces a statistic -- it produces a cube key.

Why the model is needed at all: 311's taxonomy is not something a person can be
expected to navigate. A cold radiator is ``HEAT/HOT WATER`` -> ``ENTIRE
BUILDING`` under HPD; a neighbour's party is ``Noise - Residential`` ->
``Loud Music/Party`` under NYPD. Someone describing their problem in Bengali at
11pm cannot be asked to know that.

Design: the full taxonomy is small enough (276 complaint types, 1347
type+descriptor pairs) to put in the prompt, cached, rather than building an
embedding index. That removes a dependency, makes the candidate set exhaustive
instead of approximate, and means a wrong answer is a prompt problem rather
than a retrieval problem. Structured output constrains the response shape; we
then validate against the real taxonomy so a hallucinated pair can never reach
the cube.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from anthropic import Anthropic

from app.config import ANTHROPIC_API_KEY, DATA_DIR, LLM_MODEL

TAXONOMY_PATH = DATA_DIR / "reference" / "taxonomy.json"

#: Below this the caller should ask the clarifying question instead of
#: forecasting. A confidently wrong complaint type produces a confidently wrong
#: forecast, which is worse than one extra question.
MIN_CONFIDENCE = 0.55

SYSTEM = """You map a New Yorker's description of a problem onto NYC 311's \
internal complaint taxonomy.

The person may write or speak in any language. Do not translate for them and do \
not answer their question -- your only job is to choose the taxonomy entry a 311 \
operator would file this under.

Rules:
- Choose only from the taxonomy provided. Never invent a complaint_type or \
descriptor.
- The descriptor must be one listed under the complaint_type you chose.
- Judge confidence on whether the taxonomy entry matches what they described, \
not on how clearly they wrote it. Someone can describe a problem vaguely and \
still leave only one plausible category.
- When two categories are genuinely plausible and they lead somewhere different \
(a different agency, or a different likely outcome), set a low confidence and \
write clarifying_question -- one short question, in the same language they used, \
that would separate the two. Otherwise leave it null.
- detected_lang is the BCP-47 tag of the language they actually used."""

SCHEMA = {
    "type": "object",
    "properties": {
        "complaint_type": {"type": "string"},
        "descriptor": {"type": ["string", "null"]},
        "confidence": {"type": "number"},
        "detected_lang": {"type": "string"},
        "clarifying_question": {"type": ["string", "null"]},
    },
    "required": [
        "complaint_type",
        "descriptor",
        "confidence",
        "detected_lang",
        "clarifying_question",
    ],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class TaxonomyMatch:
    complaint_type: str
    descriptor: str | None
    agency: str
    confidence: float
    detected_lang: str
    clarifying_question: str | None

    @property
    def needs_clarification(self) -> bool:
        return self.confidence < MIN_CONFIDENCE


@lru_cache(maxsize=1)
def load_taxonomy() -> dict[tuple[str, str | None], str]:
    """Return ``{(complaint_type, descriptor): agency}`` for every real pair.

    This is the validation set: a model answer outside these keys is rejected
    rather than passed to the cube, where it would silently return nothing.
    """
    if not TAXONOMY_PATH.exists():
        raise FileNotFoundError(
            f"{TAXONOMY_PATH} missing. Generate it from the 311 dataset "
            "(complaint_type, descriptor, agency grouped by volume)."
        )
    rows = json.loads(TAXONOMY_PATH.read_text())
    out: dict[tuple[str, str | None], str] = {}
    for row in rows:
        descriptor = (row.get("descriptor") or "").strip() or None
        out[(row["complaint_type"], descriptor)] = row["agency"]
    return out


@lru_cache(maxsize=1)
def taxonomy_prompt_block() -> str:
    """Render the taxonomy compactly, ordered by real complaint volume.

    Volume order matters: it is a prior. When a description is ambiguous
    between a type with two million records and one with two hundred, the
    common one is nearly always what the person means.
    """
    rows = json.loads(TAXONOMY_PATH.read_text())
    by_type: dict[str, dict] = {}
    for row in rows:
        entry = by_type.setdefault(
            row["complaint_type"],
            {"agency": row["agency"], "descriptors": [], "n": 0},
        )
        descriptor = (row.get("descriptor") or "").strip()
        if descriptor and descriptor not in entry["descriptors"]:
            entry["descriptors"].append(descriptor)
        entry["n"] += int(row["n"])

    lines = []
    for ctype, entry in sorted(by_type.items(), key=lambda kv: -kv[1]["n"]):
        descriptors = " | ".join(entry["descriptors"]) or "(none)"
        lines.append(f"{ctype} [{entry['agency']}] :: {descriptors}")
    return "\n".join(lines)


def _client() -> Anthropic:
    return Anthropic(api_key=ANTHROPIC_API_KEY)


def map_to_taxonomy(text: str, client: Anthropic | None = None) -> TaxonomyMatch:
    """Map free text in any language to a validated taxonomy entry.

    The taxonomy block is marked for caching: it is identical on every request
    and is by far the largest part of the prompt, so it should be written to
    cache once and read thereafter rather than re-billed per call.
    """
    client = client or _client()

    response = client.messages.create(
        model=LLM_MODEL,
        max_tokens=1024,
        system=[
            {"type": "text", "text": SYSTEM},
            {
                "type": "text",
                "text": "TAXONOMY (complaint_type [agency] :: descriptors), "
                "most common first:\n\n" + taxonomy_prompt_block(),
                "cache_control": {"type": "ephemeral"},
            },
        ],
        # Low effort: this is a classification against a fixed list, not a
        # reasoning task. Latency matters -- someone is waiting on a phone.
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": text}],
    )

    if response.stop_reason == "refusal":
        raise RuntimeError("taxonomy mapping refused; check the input")

    payload = json.loads(next(b.text for b in response.content if b.type == "text"))
    return _validate(payload)


def _validate(payload: dict) -> TaxonomyMatch:
    """Force the model's answer onto a real taxonomy key, or fail loudly.

    Two recoveries before giving up, because a near-miss is common and cheap to
    fix: an invented descriptor under a real complaint type collapses to the
    type alone, and only a wholly unknown complaint type is an error.
    """
    taxonomy = load_taxonomy()
    complaint_type = (payload.get("complaint_type") or "").strip()
    descriptor = (payload.get("descriptor") or "").strip() or None

    agency = taxonomy.get((complaint_type, descriptor))
    confidence = float(payload.get("confidence", 0.0))

    if agency is None:
        # Descriptor may be wrong while the type is right -- fall back to the
        # type alone and take the confidence down accordingly.
        matches = {a for (ct, _), a in taxonomy.items() if ct == complaint_type}
        if not matches:
            raise ValueError(
                f"model returned unknown complaint_type {complaint_type!r}"
            )
        agency = next(iter(matches))
        descriptor = None
        confidence = min(confidence, MIN_CONFIDENCE)

    return TaxonomyMatch(
        complaint_type=complaint_type,
        descriptor=descriptor,
        agency=agency,
        confidence=confidence,
        detected_lang=payload.get("detected_lang") or "en",
        clarifying_question=payload.get("clarifying_question") or None,
    )
