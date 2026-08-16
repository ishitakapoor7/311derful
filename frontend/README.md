# 311derful — frontend

React + Vite + TypeScript. No UI framework, no router dependency, no CSS framework —
the whole design system is tokens in `src/styles.css`.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

**The backend must be running on `http://localhost:8000`**, which `/api` is proxied
to in dev. Every figure on screen is a query against it; nothing is invented
locally. With the backend down, each screen says so — the landing page falls back
to the last measured figures in `src/lib/constants.ts` and the map goes blank
rather than drawing something plausible.

## Running with no backend at all

```bash
cp .env.example .env.local
# set VITE_USE_MOCK=true
```

`src/api/client.ts` is the only file that knows. The offline client serves the
committed fixtures — real responses out of the cube — and returns nothing for the
things it cannot compute, so the Explore table shows only the six verified
complaint types and the map is replaced by a note.

Serving it from the backend needs a build first:

```bash
npm run build        # writes frontend/dist
```

`backend/app/main.py` mounts `frontend/dist` at `/` when that build exists, and
falls back to `frontend/reference.html` when it doesn't — so before the first
build, `localhost:8000` serves the dependency-free reference UI, not this app.

Same-origin on localhost matters: it avoids CORS and satisfies the browser's
secure-context requirement for microphone access with no HTTPS setup.

## Where the numbers come from

Nothing on screen is estimated. Every share, count and median is a cube lookup
served by the backend; the model writes only prose, and the provenance footer on
each screen names which is which.

| On screen | Source |
|---|---|
| The report — split, counts, medians, tier | `POST /api/ask` |
| Narrative, tips, draft complaint | `POST /api/ask`, phrased by the model from those numbers |
| Explore table, record count, coverage | `GET /api/explore` |
| Landing hero and totals | `GET /api/explore`; falls back to `src/lib/constants.ts` when the API is down |
| Explore map, per district | `POST /api/forecast`, once per community district (see below) |

The two things this app will not do: put a number on screen that the backend did
not produce, and imply a figure is about a place or period it is not.

## The map, until `/api/explore/boards` exists

The backend serves no per-board endpoint, so `getBoards` in `src/api/client.ts`
builds the map out of one real `POST /api/forecast` per community district — 59
calls, batched, painted as they land, cached per complaint type. Two consequences
are printed under the map rather than hidden:

- a board-level forecast always carries a month filter, so the map is **one
  month**, not the whole window
- a district whose cell is thin makes the forecast ladder widen to borough or
  citywide. Those answers are about a different geography, so they are dropped and
  the district is **left blank** — as are districts under 30 classified records

`getBoards` probes `GET /api/explore/boards?complaint_type=…` once per page load
first. When the backend ships it — returning `{complaint_type, rows[{board,
resolved_share, total}], month, min_sample}` — the fan-out stops being used, the
map covers all months, and no frontend change is needed.

## Backend status

Everything else this app calls exists in `backend/app/models.py` and answers:
`/api/ask`, `/api/config`, `/api/forecast`, `/api/explore`, `/api/history` (GET
and both DELETEs), `forecast.unclassified_count`, and `session_id` on the ask
request.

## Voice

`voice_mode` comes from `/api/config`:

| mode | behaviour |
|---|---|
| `webspeech` | `SpeechRecognition` + a language picker (Web Speech cannot auto-detect the spoken language) |
| `vapi` | **not wired up** — the mic is hidden rather than shown and broken. Needs the Vapi web SDK. |
| `off` | mic hidden, text only |

The mic is also hidden when the browser has no `SpeechRecognition` (Firefox). Voice
never blocks the text path.

## History

`session_id` is a UUID in `localStorage`; the backend keys history on it. It is not
identity — anyone holding it can read that history.

Opening a past complaint costs **no model call**. The backend stores history
denormalised (headline share, sample size, tier, narrative, draft — no
`outcomes[]`), so the full `/api/ask` response is cached in `localStorage` against
its entry id by `src/lib/resultCache.ts` and reopening is a local read. An entry
this browser has never seen — a session opened on another device — falls back to
`StoredResult`, which shows what the entry stores and offers an explicit re-run.

## Layout

```
src/
  api/        client.ts (fetch, map fan-out), fixtures.ts (the real four), mock.ts (offline)
  components/ AskInput, OutcomeBars, ReportView, ChatView, HistorySidebar, …
  lib/        router, speech, outcomes, format, session, constants, resultCache
  screens/    Landing, Ask, Explore
  types/      api.ts — the contract
```
