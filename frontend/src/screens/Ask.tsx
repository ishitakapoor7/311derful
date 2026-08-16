import { useCallback, useEffect, useRef, useState } from 'react'
import type { AskRequest, AskResponse, ConfigResponse, HistoryEntry, InputSource } from '../types/api'
import {
  ApiError,
  ask,
  clearHistory,
  deleteHistoryEntry,
  getConfig,
  getHistory,
  recordLocalHistory,
  USE_MOCK,
} from '../api/client'
import { getSessionId } from '../lib/session'
import {
  cacheResult,
  clearResultCache,
  dropCachedResult,
  readCachedResult,
} from '../lib/resultCache'
import { AskInput } from '../components/AskInput'
import { ReportView } from '../components/ReportView'
import { ChatView, type Turn } from '../components/ChatView'
import { HistorySidebar } from '../components/HistorySidebar'
import { StoredResult } from '../components/StoredResult'
import { ClarifyingQuestion, ErrorState, Loading } from '../components/States'

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

/** Transcript keys only — never sent anywhere, never used as an entry id. */
function turnId(): string {
  return `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

type ResultView = 'report' | 'chat'

export function Ask() {
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<AskResponse | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [lastRequest, setLastRequest] = useState<AskRequest | null>(null)
  // Report is the default and the one that should be on screen when judges are
  // watching. Chat is the same data, conversational framing.
  const [view, setView] = useState<ResultView>('report')
  const [turns, setTurns] = useState<Turn[]>([])
  // Set only when a history entry is opened whose full response is not cached.
  const [stored, setStored] = useState<HistoryEntry | null>(null)

  const sessionId = getSessionId()

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
    getConfig()
      .then(setConfig)
      .catch(() =>
        // Voice is optional; a missing config must not block the text path.
        setConfig({
          voice_mode: 'off',
          languages: [{ tag: 'en-US', label: 'English' }],
          llm_configured: true,
        }),
      )
    void refreshHistory()
  }, [refreshHistory])

  const run = useCallback(
    async (request: AskRequest) => {
      setBusy(true)
      setError(null)
      setStored(null)
      setLastRequest(request)

      try {
        const result = await ask(request)
        setResponse(result)
        setTurns((t) => [...t, { id: turnId(), text: request.text, response: result }])

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

  // Fire a demo or a shared query once, after config lands so voice_mode is
  // settled. `?q=` is what ShareResult's permalink carries: the complaint type,
  // re-asked as free text. It deliberately carries no location -- the geocoder
  // takes "lat,lon" or a ZIP, not a community board, so a shared link answers
  // citywide and the scope note under the result says so.
  const autoFired = useRef(false)
  useEffect(() => {
    if (autoFired.current || !config) return
    const params = hashParams()
    const demoKey = params.get('demo')
    const demo = demoKey ? DEMO_QUERIES[demoKey] : null
    const shared = params.get('q')?.trim()
    if (!demo && !shared) return
    autoFired.current = true
    void run({
      text: demo ? demo.text : (shared as string),
      source: 'text',
      address: demo ? demo.address : null,
      lang: demo ? 'en-US' : null,
      session_id: sessionId,
    })
  }, [config, run, sessionId])

  function handleSubmit(
    text: string,
    source: InputSource,
    address: string | null,
    lang: string,
  ) {
    setResponse(null)
    void run({ text, source, address, lang, session_id: sessionId })
  }

  // State 1: resubmit with the clarifying answer appended rather than replacing it.
  function handleClarify(answer: string) {
    if (!lastRequest) return
    setResponse(null)
    void run({ ...lastRequest, text: `${lastRequest.text}. ${answer}` })
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

  const needsClarification = Boolean(response?.intake.clarifying_question) && !response?.forecast

  return (
    <div className="wrap">
      <div className={`ask${sidebarOpen ? ' with-sidebar' : ''}`}>
        <div className="ask-main stack">
          <div>
            <p className="label">Describe the problem</p>
            <AskInput config={config} busy={busy} onSubmit={handleSubmit} />
          </div>

          {/* Fail loudly and early rather than at the first /api/ask call. */}
          {config && !config.llm_configured && (
            <div className="note">
              No <code>ANTHROPIC_API_KEY</code> is set on the backend, so requests will fail. Add
              one to <code>backend/.env</code> and restart uvicorn.
            </div>
          )}

          {busy && <Loading />}

          {error && (
            <ErrorState
              message={error}
              onRetry={lastRequest ? () => void run(lastRequest) : undefined}
            />
          )}

          {/* State 1: clarifying question only — never an empty result shell. */}
          {!busy && needsClarification && response?.intake.clarifying_question && (
            <ClarifyingQuestion
              question={response.intake.clarifying_question}
              onAnswer={handleClarify}
            />
          )}

          {!busy && response?.forecast && (
            <div>
              <div className="result-head">
                <div className="toggle" role="group" aria-label="Result view">
                  <button aria-pressed={view === 'report'} onClick={() => setView('report')}>
                    Report
                  </button>
                  <button aria-pressed={view === 'chat'} onClick={() => setView('chat')}>
                    Chat
                  </button>
                </div>
              </div>

              {view === 'report' ? (
                <ReportView response={response} />
              ) : (
                <ChatView turns={turns} />
              )}
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
