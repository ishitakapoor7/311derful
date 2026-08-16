# Frontend brief — 311derful

Everything you need to build the UI. The backend is done and pushed.

---

## What the product does

Describe a problem in your own words — by voice or text — and find out **what actually happens to complaints like yours**, based on all 22,145,244 NYC 311 records from 2020 to 2026. Plus what changes the odds, and a complaint draft ready to submit.

**The one idea to hold onto while designing:** this is a *data tool that happens to talk*, not a chatbot. Every number comes from the dataset; the model only maps language and phrases results. **The UI should look like evidence, not like a chat window.**

### The finding, in case it helps you decide what to make big

`resolution_description` is a templated field in the 311 data that almost nobody parses. Classified, it shows that a complaint being *closed* is not the same as the problem being *fixed*:

| Complaint | n | Ends with the problem addressed |
|---|---:|---:|
| PLUMBING (HPD) | 214,581 | **24.2%** |
| UNSANITARY CONDITION (HPD) | 369,538 | **27.6%** |
| Noise - Residential (NYPD) | 1,191,255 | **32.2%** |
| HEAT/HOT WATER (HPD) | 897,690 | **36.2%** |

Three of every four plumbing complaints to HPD end without the problem being addressed. That number is the product.

---

## Getting a working API — two options

### Option A (fast): build against fixtures, no data needed

`frontend/fixtures/sample-responses.json` holds four **real** `/api/ask` responses pulled from the actual cube. Build the entire UI against these; you don't need to run the backend at all.

| Fixture | What it exercises |
|---|---|
| `high_confidence` | Normal case. n=7,855, `HIGH`, resolved locally in the user's own district |
| `clarifying_question` | `intake` only, **no forecast** — the model wasn't sure enough to answer |
| `low_confidence` | n=20, `LOW`, ladder exhausted to citywide + full history. Must render differently |
| `citywide_approx_location` | Spanish, `location_exact: false`, answer is citywide not local |

The `advice` prose in them is illustrative — the live API writes it per request, in the caller's language. Every *number* is real.

### Option B: run the whole thing

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY

PYTHONPATH=. .venv/bin/python -m app.data.ingest      # ~45 min, resumable
PYTHONPATH=. .venv/bin/python -m app.data.aggregate   # ~10 min
PYTHONPATH=. .venv/bin/uvicorn app.main:app
```

The data is **not** in the repo (it's ~2GB, gitignored), hence the ingest. It's resumable — killing it mid-run costs nothing.

`localhost:8000` serves the API *and* the UI. Keep it same-origin: it avoids CORS, and browsers treat `localhost` as a secure context, which is what the microphone needs — so voice works with no HTTPS setup. If you use a dev server, proxy `/api` to `:8000`.

`localhost:8000/docs` gives you live, clickable OpenAPI. **`backend/app/models.py` is the source of truth** for every field.

---

## The API

```
GET  /api/config    -> {voice_mode, vapi_public_key?, vapi_assistant_id?, languages, llm_configured}
POST /api/ask       {text, lang?, address?, month?, channel?, source, session_id?}
                    -> {intake, forecast, advice, community_board, location_exact}
GET  /api/history?session_id=…      -> {entries: […]}
DELETE /api/history/{entry_id}?session_id=…
DELETE /api/history?session_id=…    (clear all)
GET  /api/explore   -> citywide outcome breakdowns
```

`/api/ask` is the one to use — it runs intake → geocode → forecast → advise in a single call. The individual steps exist for debugging.

`address` takes `"lat,lon"` straight from browser geolocation, or a ZIP. Both resolve server-side; there's no geocoding service to configure.

`session_id` is a UUID you generate once and keep in `localStorage`. It's what history is keyed on. **It is not identity** — anyone holding it can read that history, so don't put anything sensitive near it.

### Fields you'll render

- `forecast.resolved_share` — the headline number
- `forecast.baseline_resolved_share` — citywide average, for "better/worse than average"
- `forecast.outcomes[]` — `outcome`, `share`, `count`, `median_days_to_close`
- `forecast.sample_size`, `.unclassified_count`, `.confidence_tier`, `.geo_level`, `.time_window`
- `advice.narrative`, `.tips[]`, `.draft_text`, `.caveat`
- `intake.complaint_type`, `.descriptor`, `.agency`, `.detected_lang`, `.clarifying_question`

**`VERIFIED_FIXED` and `ACTION_TAKEN` are the only outcomes that count as resolved.** Everything else is a failure mode and should read as one — that contrast is the whole point.

---

## Views

### Landing

One screen. Its job is to make someone believe there's a real finding here before they type anything.

- Hero: the product line plus one damning statistic (`24.2%` of HPD plumbing complaints end with the problem addressed)
- Short "how it works": describe it → we check 22M records → you get the odds and a draft
- CTA into the tool; secondary link to the explorer
- Trust line: *"22,145,244 complaints, 2020–2026, from NYC Open Data. Updated daily."*

### Ask (the main view)

**Input** — text area and mic side by side. **The text box is always visible, never hidden behind the mic.** Voice is a way in, not the way in, and typing is what saves the demo when the mic misbehaves.

Voice behaviour comes from `GET /api/config` — **there is no user-facing voice toggle**, it's a backend setting:

| `voice_mode` | What you do |
|---|---|
| `webspeech` | `SpeechRecognition`. **Show the language picker** — Web Speech can't detect the spoken language, so it must be told. Use the `languages` array from `/api/config`. |
| `vapi` | Vapi web SDK. **Hide the picker** — its transcriber auto-detects. |
| `off` | Hide the mic entirely. Text only. |

Show the interim transcript live while someone speaks — that's what makes the wait feel like nothing.

**If you wire up Vapi, one thing will bite you.** Its `final` transcript does *not* mean the person finished talking — the transcriber emits one at every pause, so a single sentence arrives in pieces ("Okay. Um." / "He." / "Do."). Submitting on the first `final` asks the backend about the first two words. Accumulate the finals and submit after ~1.8s of silence; a `partial` means they're still going, so it cancels the pending submit. `reference.html` does exactly this. Web Speech doesn't have this problem — its `isFinal` is genuinely final.

**Result** — behind a **Report ↔ Chat** toggle, defaulting to **Report**:

- **Report** (default): headline resolved-%, local-vs-citywide comparison, outcome bars colour-coded resolved vs failure with per-outcome median days, "what changes the odds" tips, and the draft with a copy button. This is the anti-chatbot view and the one that should be on screen when judges are watching.
- **Chat**: running transcript of turns. Same data, conversational framing.

**History sidebar** — collapsible, with a show/hide toggle. Past complaints newest first: date, complaint type, resolved-%, a colour dot for confidence tier. Clicking one re-renders its stored values — **no re-run, no model call**. Per-entry delete plus clear-all.

---

## States you must handle

Not edge cases. Several of these will happen during the demo.

1. **Clarifying question** — `intake.clarifying_question` is set and `forecast` is `null`. Show the question, let them answer, resubmit. Don't render an empty result shell.
2. **`confidence_tier: "LOW"`** — must *look* different (border/colour), not just say so, and `advice.caveat` must be shown **and spoken**. A thin-sample number presented as a prediction is the worst thing this app can do.
3. **`location_exact: false`** — say the location is approximate. Don't imply precision we don't have.
4. **`unclassified_count > 0`** — footnote it ("N more couldn't be classified and are excluded"). Being honest about coverage is part of the pitch.
5. **`geo_level` isn't `COMMUNITY_BOARD`** — say "citywide" or "in your borough". Never imply it's their district when it isn't.
6. **No `SpeechRecognition` in the browser** — hide the mic, keep everything else. Never block on voice.
6b. **Microphone blocked** — check `navigator.permissions.query({name:"microphone"})`. If it's `denied`, Chrome shows no prompt and the mic silently hears nothing, which is indistinguishable from a broken app. Say so and tell them how to unblock. Note the permission is per-origin *including the port*, so `:5173` and `:8000` have separate settings.
7. **Loading** — name the work ("checking 22 million records…"). Two model calls means a few seconds; a bare spinner feels broken.
8. **`llm_configured: false`** — no API key is set, so `/api/ask` will fail. Say so up front rather than on submit.

---

## Design direction

Evidence, not chat. Big numbers, honest bars, generous whitespace, one accent colour plus a clear resolved/failure pair. Dark mode via `prefers-color-scheme`.

Please avoid the default-AI-app look — no purple gradients, no chat bubbles in the primary view. **The outcome bars are the hero element**; they're what makes "closing isn't fixing" legible in one glance.

`frontend/reference.html` is a working reference implementation — one file, no build step. It proves the flow end to end and shows the voice wiring, the history sidebar, and every state above. **Port the logic, ignore the styling.** It is not the product.

---

## Suggested order

1. Landing page + text-only ask against the fixtures
2. Result rendering: outcome bars, `LOW` treatment, tips, draft + copy
3. History sidebar with the collapse toggle
4. Web Speech voice path
5. Report ↔ Chat toggle
6. Vapi path (only fires when the backend says `voice_mode: vapi`)

**Steps 1–3 are the demo.** Everything after that is upside.

---

## Things we can't do, so don't imply we can

- **We cannot file complaints.** NYC has no public write API for 311. The output is a draft the user submits themselves. This has to stay honest in the UI copy.
- **History is device-bound.** There are no accounts; it follows the `session_id` in that browser's `localStorage`. If cross-device matters, it needs a `?session=<uuid>` share link — don't promise more than that.
- **Channel comparisons are correlation, not causation.** Phone-filed heat complaints fail on access more often than app-filed ones, but that's almost certainly who files which way. Don't present it as advice.
