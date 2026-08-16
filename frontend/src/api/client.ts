import type {
  AskRequest,
  AskResponse,
  BoardShare,
  BoardsResponse,
  ConfigResponse,
  ExploreResponse,
  Forecast,
  HistoryEntry,
  HistoryResponse,
  Reminder,
} from '../types/api'
import { mockAsk, mockBoards, mockConfig, mockExplore, mockHistoryDelete } from './mock'

/**
 * The real backend is the default. `VITE_USE_MOCK=true` in frontend/.env.local
 * switches to the offline client, which serves only the committed fixtures --
 * real responses out of the cube, with the parts it cannot compute left empty
 * rather than invented.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const NO_API = "Can't reach the API. Is the backend running on localhost:8000?"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    // State 8: the API is local. If it is down, say so plainly.
    throw new ApiError(NO_API)
  }
  if (!response.ok) {
    // The backend says this when the DuckDB cube has not been built yet, which
    // is a different problem from a crash and has a different fix.
    if (response.status === 503) {
      throw new ApiError(
        'The backend is running but has no data cube built yet, so it has nothing to answer with.',
        503,
      )
    }
    throw new ApiError(`The API returned ${response.status}.`, response.status)
  }
  // With the backend down, the dev server answers /api/* with its own index.html
  // rather than failing, so a 200 is not proof that an API replied. Checking the
  // content type turns "Unexpected token '<'" into something actionable.
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new ApiError(NO_API)
  }
  return (await response.json()) as T
}

/** DELETE endpoints return 204 with no body, so there is nothing to parse. */
async function requestVoid(path: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(path, { method: 'DELETE' })
  } catch {
    throw new ApiError("Can't reach the API. Is the backend running on localhost:8000?")
  }
  if (!response.ok && response.status !== 404) {
    throw new ApiError(`The API returned ${response.status}.`, response.status)
  }
}

// ---------------------------------------------------------------------------
// Local history store -- mirrors the backend's shape when running offline.
// ---------------------------------------------------------------------------

const HISTORY_KEY = '311derful.history'

function readLocalHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function writeLocalHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 50)))
  } catch {
    // Storage unavailable: history is simply not persisted.
  }
}

/**
 * Mirrors what the backend's history table stores, so the mock sidebar behaves
 * identically to the live one -- including the fact that an entry carries no
 * `outcomes[]` and therefore cannot rebuild a full report on its own.
 */
export function recordLocalHistory(text: string, response: AskResponse): HistoryEntry | null {
  if (!response.forecast) return null
  const entry: HistoryEntry = {
    id: `h_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    created_at: new Date().toISOString(),
    text,
    complaint_type: response.intake.complaint_type,
    descriptor: response.intake.descriptor,
    agency: response.intake.agency,
    community_board: response.community_board,
    resolved_share: response.forecast.resolved_share,
    sample_size: response.forecast.sample_size,
    confidence_tier: response.forecast.confidence_tier,
    narrative: response.advice?.narrative ?? null,
    draft_text: response.advice?.draft_text ?? null,
  }
  writeLocalHistory([entry, ...readLocalHistory()])
  return entry
}

export function clearLocalHistory(): void {
  writeLocalHistory([])
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export function getConfig(): Promise<ConfigResponse> {
  return USE_MOCK ? mockConfig() : request<ConfigResponse>('/api/config')
}

export function ask(body: AskRequest): Promise<AskResponse> {
  return USE_MOCK
    ? mockAsk(body)
    : request<AskResponse>('/api/ask', { method: 'POST', body: JSON.stringify(body) })
}

export async function getHistory(sessionId: string): Promise<HistoryResponse> {
  if (USE_MOCK) return { entries: readLocalHistory() }
  return request<HistoryResponse>(`/api/history?session_id=${encodeURIComponent(sessionId)}`)
}

/** `session_id` is the backend's authorization check, not an optional extra. */
export async function deleteHistoryEntry(entryId: string, sessionId: string): Promise<void> {
  if (USE_MOCK) {
    writeLocalHistory(readLocalHistory().filter((e) => e.id !== entryId))
    return mockHistoryDelete()
  }
  await requestVoid(
    `/api/history/${encodeURIComponent(entryId)}?session_id=${encodeURIComponent(sessionId)}`,
  )
}

export async function clearHistory(sessionId: string): Promise<void> {
  if (USE_MOCK) {
    clearLocalHistory()
    return mockHistoryDelete()
  }
  await requestVoid(`/api/history?session_id=${encodeURIComponent(sessionId)}`)
}

export function getExplore(limit = 40): Promise<ExploreResponse> {
  return USE_MOCK ? mockExplore() : request<ExploreResponse>(`/api/explore?limit=${limit}`)
}

// ---------------------------------------------------------------------------
// Per-board shares for the Explore map.
//
// The backend has no /api/explore/boards yet. Rather than invent the numbers,
// the map is built out of /api/forecast -- one call per community district --
// so every figure on it is the same cube lookup that powers a personal
// forecast. Two consequences the UI states rather than hides:
//
//   * /api/forecast always applies a month filter at board level, so these are
//     figures for one month, not the whole year. `month` travels with them.
//   * a thin district makes the forecast ladder widen to borough or citywide.
//     Those answers are about a different geography, so they are dropped --
//     painting them onto the district that asked would be a fabrication.
//
// If the endpoint ever ships, the probe below finds it once and this whole
// fan-out stops being used.
// ---------------------------------------------------------------------------

/** Matches MIN_SAMPLE in backend/app/forecast.py -- below this, a share is noise. */
const MIN_BOARD_SAMPLE = 30

/** Enough to fill the map quickly without opening 59 sockets at once. */
const BOARD_CONCURRENCY = 8

let boardsEndpointLive: boolean | null = null
let districts: Promise<string[]> | null = null
/** Flicking through the type dropdown must not re-run 59 forecasts per pick. */
const boardCache = new Map<string, BoardsResponse>()

/**
 * The 59 real community districts, read from the same GeoJSON the map draws, so
 * there is no hand-maintained list of board names to drift out of sync with it.
 * Joint interest areas (parks, airports, cemeteries) are excluded: nobody lives
 * there and 311 reports nothing against them.
 */
function communityDistricts(): Promise<string[]> {
  if (!districts) {
    districts = fetch('community-districts.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject(new ApiError('map geometry missing'))))
      .then((g: { features: Array<{ properties: { board: string; park?: number } }> }) =>
        g.features.filter((f) => !f.properties.park).map((f) => f.properties.board),
      )
      .catch((err) => {
        districts = null // a failed load must not poison every later attempt
        throw err
      })
  }
  return districts
}

async function boardForecast(
  complaintType: string,
  board: string,
  signal?: AbortSignal,
): Promise<BoardShare | null> {
  try {
    const f = await request<Forecast>('/api/forecast', {
      method: 'POST',
      body: JSON.stringify({ complaint_type: complaintType, community_board: board }),
      signal,
    })
    // The ladder widened past this district, so the number is not about it.
    if (f.geo_level !== 'COMMUNITY_BOARD') return null
    if (f.sample_size < MIN_BOARD_SAMPLE) return null
    return { board, resolved_share: f.resolved_share, total: f.sample_size }
  } catch {
    // One district failing is not a reason to lose the other 58.
    return null
  }
}

interface BoardsOptions {
  signal?: AbortSignal
  /**
   * Called after each batch. Fifty-nine round trips take a few seconds, and a
   * map that paints district by district is both better to watch and a fair
   * picture of what is happening -- unlike a spinner over a blank rectangle.
   */
  onPartial?: (partial: BoardsResponse) => void
}

export async function getBoards(
  complaintType: string,
  { signal, onPartial }: BoardsOptions = {},
): Promise<BoardsResponse> {
  if (USE_MOCK) return mockBoards(complaintType)

  const cached = boardCache.get(complaintType)
  if (cached) return cached

  if (boardsEndpointLive !== false) {
    try {
      const served = await request<BoardsResponse>(
        `/api/explore/boards?complaint_type=${encodeURIComponent(complaintType)}`,
        { signal },
      )
      boardsEndpointLive = true
      boardCache.set(complaintType, served)
      return served
    } catch (err) {
      // A cancelled probe says nothing about whether the endpoint exists.
      if (signal?.aborted) throw err
      boardsEndpointLive = false // probe once per page load, then stop asking
    }
  }

  const boards = await communityDistricts()
  const rows: BoardShare[] = []
  const snapshot = (): BoardsResponse => ({
    complaint_type: complaintType,
    rows: [...rows],
    month: new Date().getMonth() + 1,
    min_sample: MIN_BOARD_SAMPLE,
  })

  for (let i = 0; i < boards.length; i += BOARD_CONCURRENCY) {
    if (signal?.aborted) throw new ApiError('cancelled')
    const batch = await Promise.all(
      boards.slice(i, i + BOARD_CONCURRENCY).map((b) => boardForecast(complaintType, b, signal)),
    )
    for (const row of batch) if (row) rows.push(row)
    if (!signal?.aborted && rows.length) onPartial?.(snapshot())
  }

  const result = snapshot()
  // An empty fan-out means every district failed, which in practice means the
  // backend was down -- a fact about this moment, not about this complaint type.
  // Caching it would keep the map blank for the rest of the page's life, long
  // after the API came back.
  if (rows.length) boardCache.set(complaintType, result)
  return result
}

// ---------------------------------------------------------------------------
// Follow-up reminders. Local only -- there is no account and nothing is sent.
// ---------------------------------------------------------------------------

const REMINDER_KEY = '311derful.reminders'

export function getReminders(): Reminder[] {
  try {
    const raw = window.localStorage.getItem(REMINDER_KEY)
    return raw ? (JSON.parse(raw) as Reminder[]) : []
  } catch {
    return []
  }
}

export function addReminder(complaintType: string, agency: string, dueDays: number): Reminder {
  const now = new Date()
  const due = new Date(now.getTime() + dueDays * 86400000)
  const reminder: Reminder = {
    id: `r_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    complaint_type: complaintType,
    agency,
    created_at: now.toISOString(),
    due_days: dueDays,
    due_at: due.toISOString(),
  }
  try {
    window.localStorage.setItem(REMINDER_KEY, JSON.stringify([reminder, ...getReminders()]))
  } catch {
    // Storage unavailable: the confirmation still shows, it just will not persist.
  }
  return reminder
}
