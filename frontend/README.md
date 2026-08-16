# 311derful — frontend

React + Vite + TypeScript. No UI framework, no router dependency, no CSS framework —
the whole design system is tokens in `src/styles.css`.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Runs against a mock backend by default, so it works with nothing else running.
`/api` is proxied to `http://localhost:8000` in dev.

## Switching to the real backend

```bash
cp .env.example .env.local
# set VITE_USE_MOCK=false
```

Nothing else changes — `src/api/client.ts` is the only file that knows.

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

`/api/ask` in mock mode serves the four **real** responses committed at
`frontend/fixtures/sample-responses.json` — every outcome split, count, median and
sample size in them came out of the 22.1M-row cube. Only the `advice` prose is
illustrative; the live API writes it per request in the caller's language.

Still invented, and marked `[placeholder- replace with real data]` wherever it
renders:

- `/api/explore` rows beyond the six verified complaint types
- every per-board share on the Explore map (there is no `/api/explore/boards`)

A provenance banner sits under any estimated figure for as long as
`VITE_USE_MOCK` is on. `src/api/mock.ts` can be deleted once the backend is the
only source — nothing outside `src/api/` imports from it.

## Backend status

Everything this app calls exists in `backend/app/models.py` and answers, with one
exception:

- `GET /api/explore/boards?complaint_type=…` — powers the Explore map. Marked
  `BACKEND-PENDING` in `src/types/api.ts`; the mock estimates it.

`/api/ask`, `/api/config`, `/api/history` (GET and both DELETEs),
`forecast.unclassified_count` and `session_id` on the ask request are all live.

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
  api/        client.ts (fetch + mock switch), fixtures.ts (the real four), mock.ts
  components/ AskInput, OutcomeBars, ReportView, ChatView, HistorySidebar, …
  lib/        router, speech, outcomes, format, session, constants, resultCache
  screens/    Landing, Ask, Explore
  types/      api.ts — the contract
```
