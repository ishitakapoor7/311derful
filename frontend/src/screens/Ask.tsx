import { useCallback, useEffect, useRef, useState } from 'react'
import type { AskRequest, AskResponse, HistoryEntry, InputSource } from '../types/api'
import {
  ApiError,
  ask,
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  recordLocalHistory,
  USE_MOCK,
} from '../api/client'
import { getSessionId } from '../lib/session'
import { useConfig } from '../lib/useConfig'
import {
  cacheResult,
  clearResultCache,
  dropCachedResult,
  readCachedResult,
} from '../lib/resultCache'
import { AskInput } from '../components/AskInput'
import { ExampleChips } from '../components/ExampleChips'
import { ReportView } from '../components/ReportView'
import { ChatView, type Turn } from '../components/ChatView'
import { HistorySidebar } from '../components/HistorySidebar'
import { StoredResult } from '../components/StoredResult'
import { ErrorState, Loading } from '../components/States'

/**
 * `#/ask?demo=noise` runs a known-good query on load, so the pitch survives a
 * dead wifi connection or a hand that will not type straight on stage.
 */
const DEMO_QUERIES: Record<string, { text: string; address: string | null }> = {
  // The money shot: HEAT/HOT WATER in Bronx CB7, n=7,855, HIGH, resolved locally.
  heat: { text: 'my radiator has been cold for three days', address: '10457' },
  // Spanish in, citywide answer, location_exact false.
  trash: { text: 'hay basura acumulada en la acera frente a mi edificio', address: null },
  // n=20, LOW, ladder exhausted to citywide + full history.
  thin: { text: 'the recycling baskets on my corner are overflowing', address: '10011' },
  // Intake only — the model was not sure enough to forecast.
  clarify: { text: 'there is a noise problem near me', address: '10032' },
}

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '')
}

/**
 * The query a URL can arrive carrying: `?demo=` for the rehearsed pitch, and
 * `?q=` from a ShareResult permalink.
 *
 * A permalink carries the complaint text and nothing else -- no board, because
 * the geocoder takes "lat,lon" or a ZIP and not a community district -- so a
 * shared link answers citywide and the scope note under the result says so.
 */
function urlQuery(): Omit<AskRequest, 'session_id'> | null {
  const params = hashParams()
  const demoKey = params.get('demo')
  const demo = demoKey ? DEMO_QUERIES[demoKey] : null
  if (demo) return { text: demo.text, source: 'text', address: demo.address, lang: 'en-US' }

  const text = params.get('q')?.trim()
  if (!text) return null
  return { text, source: 'text', address: null, lang: null }
}

/** Transcript keys only — never sent anywhere, never used as an entry id. */
function turnId(): string {
  return `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

type ResultView = 'report' | 'chat'

export function Ask() {
  const config = useConfig()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<AskResponse | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [lastRequest, setLastRequest] = useState<AskRequest | null>(null)
  // The answer arrives in the thread, and the report is opened from it. A
  // segmented Report/Chat control used to sit above the result, which put a
  // control between the question and its answer and moved down the page every
  // time the content changed.
  const [view, setView] = useState<ResultView>('chat')
  const [turns, setTurns] = useState<Turn[]>([])
  // Set only when a history entry is opened whose full response is not cached.
  const [stored, setStored] = useState<HistoryEntry | null>(null)

  const sessionId = getSessionId()
  // What the input mounts with. Seeded from the URL so an auto-fired query is
  // visible and editable rather than answered by an apparently empty box, then
  // replaced whenever an example chip is used. `nonce` keys the input: the
  // fields are its own state after mount, so reseeding them means remounting.
  const [seed, setSeed] = useState(() => {
    const query = urlQuery()
    return { text: query?.text ?? '', address: query?.address ?? '', nonce: 0 }
  })

  const refreshHistory = useCallback(async (): Promise<HistoryEntry[]> => {
    try {
      const h = await getHistory(sessionId)
      setHistory(h.entries)
      return h.entries
    } catch {
      setHistory([])
      return []
    }
  }, [sessionId])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  const run = useCallback(
    /**
     * `displayText` is what the transcript shows, when that differs from what
     * the request carries. Answering a clarifying question sends the original
     * complaint and the answer together -- the backend holds no conversation
     * state, so it needs both -- but the transcript should show only what was
     * just said, not the merged sentence.
     */
    async (request: AskRequest, displayText?: string) => {
      setBusy(true)
      setError(null)
      setStored(null)
      setLastRequest(request)
      // Anything newly asked is answered in the thread. Without this, asking a
      // follow-up while the report is open would drop you straight into the next
      // report and the reply itself would never be seen.
      setView('chat')

      try {
        const result = await ask(request)
        setResponse(result)
        setTurns((t) => [
          ...t,
          { id: turnId(), text: displayText ?? request.text, response: result },
        ])

        if (result.forecast) {
          // The live backend records history itself; offline we mirror its shape.
          const local = USE_MOCK ? recordLocalHistory(request.text, result) : null
          const entries = await refreshHistory()

          // Keep the full response against the row the backend just wrote, so the
          // sidebar can reopen it without a model call. /api/ask does not return
          // the entry id and history comes back newest-first, so the newest row is
          // ours -- matching on `text` too, because if the write was skipped (no
          // session_id, or a failed insert) the newest row belongs to an earlier
          // ask and caching against it would corrupt that entry.
          const newest = local ?? entries[0]
          if (newest && newest.text === request.text) cacheResult(newest.id, result)
        }
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Something went wrong reaching the API. Check that the backend is running.'
        setError(message)
      } finally {
        setBusy(false)
      }
    },
    [refreshHistory],
  )

  // Fire whatever the URL carried, once, after config lands so voice_mode is
  // settled before the first render of the input.
  const autoFired = useRef(false)
  useEffect(() => {
    if (autoFired.current || !config) return
    const query = urlQuery()
    if (!query) return
    autoFired.current = true
    void run({ ...query, session_id: sessionId })
  }, [config, run, sessionId])

  /**
   * Everything typed or spoken into the composer arrives here, including the
   * answer to a clarifying question -- there is only one input on the screen,
   * which is what lets a follow-up be answered by voice.
   */
  function handleSubmit(
    text: string,
    source: InputSource,
    address: string | null,
    lang: string | null,
  ) {
    if (awaitingAnswer && lastRequest) {
      handleClarify(text)
      return
    }
    setResponse(null)
    void run({ text, source, address, lang, session_id: sessionId })
  }

  // A chip is an explicit request to ask this instead, so it overwrites the box
  // rather than appending, and runs without a second click -- the whole point is
  // that it takes one tap to see a real forecast.
  function handleExample(text: string, address: string | null) {
    setSeed((s) => ({ text, address: address ?? '', nonce: s.nonce + 1 }))
    setResponse(null)
    void run({ text, source: 'text', address, lang: null, session_id: sessionId })
  }

  // State 1: resubmit with the clarifying answer appended rather than replacing
  // it. The transcript shows the answer on its own -- see `displayText` in run.
  function handleClarify(answer: string) {
    if (!lastRequest) return
    setResponse(null)
    void run({ ...lastRequest, text: `${lastRequest.text}. ${answer}` }, answer)
  }

  function handleOpenEntry(entry: HistoryEntry) {
    setError(null)
    window.scrollTo(0, 0)

    const cached = readCachedResult(entry.id)
    if (cached) {
      // No re-run and no model call: the whole response was kept when it was first
      // fetched, so reopening a past complaint is a localStorage read.
      setStored(null)
      setResponse(cached)
      setTurns((t) => [
        ...t,
        { id: turnId(), text: entry.text, response: cached, revisited: true },
      ])
      return
    }

    // Nothing cached -- a session opened on another device, or an evicted cache.
    // Show what the entry itself stores and let them ask for the rest explicitly.
    setResponse(null)
    setStored(entry)
  }

  async function handleDelete(entryId: string) {
    try {
      await deleteHistoryEntry(entryId, sessionId)
    } catch {
      // Non-fatal — refresh reflects whatever the server actually has.
    }
    dropCachedResult(entryId)
    if (stored?.id === entryId) setStored(null)
    void refreshHistory()
  }

  async function handleClearAll() {
    try {
      await clearHistory(sessionId)
    } catch {
      // Non-fatal, same reasoning as above.
    }
    // The cached responses belong to the entries being cleared, so they go too.
    clearResultCache()
    setStored(null)
    void refreshHistory()
  }

  // The backend asked something and is waiting on an answer. The composer takes
  // it, so the question stays in the transcript rather than owning an input.
  const awaitingAnswer = Boolean(response?.intake.clarifying_question) && !response?.forecast

  // Prior turns live in the transcript. When the report is showing, the newest
  // turn is rendered as the report instead, so it is not said twice.
  const showingReport = !busy && Boolean(response?.forecast) && view === 'report'
  const transcript = showingReport ? turns.slice(0, -1) : turns

  return (
    <div className="wrap">
      <div className={`ask${sidebarOpen ? ' with-sidebar' : ''}`}>
        <div className="ask-main stack">
          {/* Fail loudly and early rather than at the first /api/ask call. */}
          {config && !config.llm_configured && (
            <div className="note">
              No <code>ANTHROPIC_API_KEY</code> is set on the backend, so requests will fail. Add
              one to <code>backend/.env</code> and restart uvicorn.
            </div>
          )}

          {/* The conversation so far. Everything said stays on screen: a
              clarifying question and the answer to it are turns like any other,
              so the thread reads back as what actually happened. */}
          <ChatView turns={transcript} />

          {busy && <Loading />}

          {error && (
            <ErrorState
              message={error}
              onRetry={lastRequest ? () => void run(lastRequest) : undefined}
            />
          )}

          {/* The answer is already in the thread above. This offers the long
              form rather than showing it: one thing to press, in one place,
              instead of a two-state control that moved with the content. */}
          {!busy && response?.forecast && view === 'chat' && (
            <button className="report-cta" onClick={() => setView('report')}>
              <span className="report-cta-tag">Report ready</span>
              <span className="report-cta-body">
                All {response.forecast.outcomes.length} outcomes for{' '}
                {response.intake.complaint_type.toLowerCase()}, what changes the odds, and your
                draft.
              </span>
              <span className="report-cta-go" aria-hidden="true">
                →
              </span>
            </button>
          )}

          {!busy && response?.forecast && view === 'report' && (
            <div>
              <div className="result-head">
                <button className="btn btn-sm btn-ghost" onClick={() => setView('chat')}>
                  ← Back to the conversation
                </button>
              </div>
              <ReportView response={response} />
            </div>
          )}

          {/* A past complaint whose full response this browser no longer holds. */}
          {!busy && stored && (
            <StoredResult
              entry={stored}
              onRerun={() =>
                void run({
                  text: stored.text,
                  source: 'text',
                  // A community board ("07 BRONX") is not an address the geocoder
                  // accepts -- it takes "lat,lon" or a ZIP -- so sending it would
                  // silently resolve to nothing. Re-running answers citywide, and
                  // StoredResult says so before the button is pressed.
                  address: null,
                  lang: null,
                  session_id: sessionId,
                })
              }
            />
          )}

          {/* The composer sits under the thread, where the next thing you say
              goes. One input for the whole conversation: the first complaint and
              every follow-up are typed or spoken into the same box. */}
          <div className="composer">
            {/* No heading above these: the placeholder in the box says what to
                do, and saying it twice in two type styles was the denser half of
                the problem. Only before the first turn -- once there is a
                thread, the chips would be offering to throw it away. */}
            {turns.length === 0 && <ExampleChips disabled={busy} onPick={handleExample} />}

            <AskInput
              key={seed.nonce}
              config={config}
              busy={busy}
              awaitingAnswer={awaitingAnswer}
              initialText={seed.text}
              initialAddress={seed.address}
              onSubmit={handleSubmit}
            />
          </div>
        </div>

        <HistorySidebar
          entries={history}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((s) => !s)}
          onOpenEntry={handleOpenEntry}
          onDelete={handleDelete}
          onClearAll={handleClearAll}
        />
      </div>
    </div>
  )
}
