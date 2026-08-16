# 311derful

We parse the outcome field to convert 311 from a complaint-volume dataset into a service-effectiveness dataset, then use it to tell a person what will actually happen to their complaint and what makes it fail.

**Describe a problem in any language. Find out what actually happens to complaints like yours — from 22 million real 311 records.**

NYC Hackathon (NYPL) · main track + Best Use of NYC Open Data

---

## The finding this is built on

`resolution_description` is a templated, agency-specific field in the 311 dataset that almost nobody parses. Classified, it shows that closing a complaint is not the same as fixing the problem.

**Measured over all 22,145,244 records** (Jan 2020 – Aug 2026), citywide, trailing three years, classified records only:

| Complaint type | Agency | n | Ends with the problem addressed | Most common failure |
|---|---|---:|---:|---|
| PLUMBING | HPD | 214,581 | **24.2%** | nothing found 34% |
| UNSANITARY CONDITION | HPD | 369,538 | **27.6%** | nothing found 42% |
| PAINT/PLASTER | HPD | 187,960 | **30.0%** | nothing found 43% |
| Noise - Residential | NYPD | 1,191,255 | **32.2%** | nothing found 43% |
| HEAT/HOT WATER | HPD | 897,690 | **36.2%** | closed as duplicate 28% |
| Illegal Parking | NYPD | 1,665,502 | **42.1%** | nothing found 23% |

Three of every four plumbing complaints to HPD end without the problem being addressed.

**Classifier coverage is 92.9–94.4% in every year from 2020 to 2026** — deliberately reported per year, never as a single average, because a global figure can hide a collapse on retired templates. Unclassified records are counted and surfaced, never folded into an outcome.

**Average closure time is a vanity metric.** Heat complaints in Bronx CB7 in January (n=7,855):

```
53.0%  VERIFIED_FIXED     median 1.3 days
23.4%  DUPLICATE          median 1.7 days
 8.9%  NO_ACCESS          median 2.0 days
 8.5%  NO_OUTCOME_GIVEN   median 0.4 days   ← the fastest closures fixed nothing
```

Pool those and you get a reassuring ~1.5 days. Split them by outcome and the number stops being reassuring. Closure time is therefore stored and reported **per outcome**, never pooled.

## Why the intake is voice + multilingual

311's taxonomy is unusable by a normal person — a cold radiator is `HEAT/HOT WATER` → `ENTIRE BUILDING` under HPD. Speaking your problem in your own language and having it mapped correctly is the delivery mechanism. **The forecast is the product.**

---

## Architecture

```
Offline (once):   ingest → classify → aggregate → cube (DuckDB)
Request path:     intake → taxonomy_map → geocode → forecast → advise → draft
                             (LLM)                  (pure fn)   (LLM phrasing only)
```

**The LLM never produces a number.** It has exactly two jobs: mapping free text onto the 311 taxonomy, and phrasing results in the user's language. Every statistic is a precomputed aggregate over 22M records, interpolated into the prompt as a finished figure. That split is the hallucination guard — and the answer to "isn't this a GPT wrapper?"

### Modules

| Module | Role |
|---|---|
| `app/data/ingest.py` | Socrata → DuckDB, month-chunked, resumable, cached |
| `app/data/classify.py` | `resolution_description` → outcome class. The crown jewel. |
| `app/data/aggregate.py` | Builds the stats cube; per-year coverage report |
| `app/forecast.py` | Pure function: cube → outcome distribution + confidence |
| `app/taxonomy.py` | Free text (any language) → validated taxonomy entry |
| `app/geocode.py` | lat/lon → community board, point-in-polygon, offline |
| `app/advise.py` | Rules table decides *what*; the model phrases *how* |

### Two things the classifier had to get right

**Templates drift.** NYPD switched from *"The Police Department responded…"* to *"The New York City Police Department responded…"* in **Nov 2025**; HPD replaced its duplicate template in Sept 2024 and its violation template in Jan 2023. Rules therefore match short invariant fragments (`"not able to gain access"`), never template prefixes — and coverage is asserted **per year**, because a global 91% can hide 99% recent and 40% old.

**Order is load-bearing.** `"No violations were issued"` contains `"violations were issued"`. Get the order wrong and HPD's single largest template (1.0M rows) silently flips from `NOTHING_FOUND` to `ACTION_TAKEN`, inflating the headline number. A test pins it.

### Never overstating

A rare complaint type, in one district, in one month can be eight records — and eight records is noise. The forecast widens until it has enough data, along the axis that costs the least validity:

1. drop `channel` (least informative, most confounded)
2. → borough
3. → citywide
4. → full history *(last resort, labeled)*

Geography widens **before** time: agency behavior is more stable across the city than across a decade. Every response reports its sample size, the level it reached, and a confidence tier — `HIGH` ≥300, `MEDIUM` 30–299, `LOW` <30. A `LOW` result is rendered distinctly and **spoken aloud**, never buried.

---

## Setup

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY (+ SOCRATA_APP_TOKEN)

PYTHONPATH=. .venv/bin/python -m app.data.ingest      # ~45 min, resumable
PYTHONPATH=. .venv/bin/python -m app.data.aggregate   # builds cube + coverage report
PYTHONPATH=. .venv/bin/python -m pytest tests/ -q
PYTHONPATH=. .venv/bin/uvicorn app.main:app --reload
```

The ingest caches each month as gzipped CSV, so re-runs are free and it can be interrupted freely.

## API

**`POST /api/ask` is the one a client should call** — describe a problem, get the whole answer:

```
POST /api/ask       {text, lang?, address?, month?, channel?, source}
                 -> {intake, forecast, advice, community_board, location_exact}
```

It runs intake → geocode → forecast → advise in a single call, and returns early with just `intake` when the taxonomy match is too weak — the caller should ask the clarifying question rather than forecast against a complaint type the person didn't mean.

The individual steps remain, for the explorer UI and for debugging:

```
POST /api/intake    {text, lang?, address?, source}
                 -> {complaint_type, descriptor, agency, confidence,
                     detected_lang, clarifying_question?}
POST /api/forecast  {complaint_type, descriptor?, community_board?|address?, month?, channel?}
                 -> {outcomes[], resolved_share, sample_size, unclassified_count,
                     confidence_tier, geo_level, time_window, baseline_resolved_share}
POST /api/advise    {forecast, description, lang}
                 -> {narrative, tips[], draft_text, caveat?}
GET  /api/explore   -> citywide outcome breakdowns ("where complaints go to die")
```

`address` accepts `"lat,lon"` (browser geolocation) or a ZIP. Both resolve locally — no geocoding service on the request path. A ZIP is a modal guess rather than a location, so responses carry `location_exact` and the UI should say so.

## Voice

Speech in and speech out, in the browser — `SpeechRecognition` for input, `SpeechSynthesis` for reading the answer back. No API keys, no service, no cost. `frontend/index.html` is a self-contained reference implementation (no build step, no framework) served by the backend itself at `/`, which makes it same-origin and — because browsers treat `localhost` as a secure context — gives the microphone permission without any HTTPS setup.

Two things there are product decisions rather than styling:

- **The text box is always present**, never hidden behind the mic. Voice is *a* way in, not *the* way in, and typing is what keeps a demo alive when the mic, the browser, or the wifi misbehaves.
- **A `LOW`-confidence result renders differently and is spoken aloud.** Someone listening rather than reading must still hear that the sample was thin.

**Known limitation:** the Web Speech API cannot detect the spoken language — it has to be told before it listens, hence the language picker. (Whisper auto-detects; that's the reason to switch later.) The *backend* detects language from the resulting text either way, so the spoken reply follows the caller's language automatically.

Latency is a few seconds, dominated by two LLM calls. That's fine in a UI, where the transcript appears live and progress is visible — it would not be fine on a phone call, where silence reads as a dropped line.

## Honest limits

- **We do not file complaints.** NYC has no public write API for 311, so the output is a draft the user submits. This must not be implied otherwise on stage.
- **Channel correlation is not causation.** Phone-filed heat complaints hit `NO_ACCESS` 19.7% of the time vs 12.6% by mobile app — almost certainly who files which way, not the channel itself. Presented as association only.
- **Coverage is reported, not hidden.** Unclassified rows are counted and surfaced per year.
- **Demo `Noise - Residential`, not heat.** Heat is at its annual minimum in August (2.9k/mo vs 67k in January), and the 23%-action stat is more damning anyway.

## Data

- [311 Service Requests, 2020–present](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9) (`erm2-nwe9`) — 22,145,244 rows, updated daily
- [Community Districts](https://data.cityofnewyork.us/City-Government/Community-Districts/5crt-au7u) (`5crt-au7u`) — boundary polygons
