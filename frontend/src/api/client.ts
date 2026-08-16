import type {
  AskRequest,
  AskResponse,
  BoardsResponse,
  ConfigResponse,
  ExploreResponse,
  HistoryEntry,
  HistoryResponse,
  Reminder,
} from '../types/api'
import { mockAsk, mockBoards, mockConfig, mockExplore, mockHistoryDelete } from './mock'

/**
 * Set VITE_USE_MOCK=false in frontend/.env.local once the backend answers.
 * Defaults to mock so the app runs standalone with no backend at all.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    // State 8: the API is local. If it is down, say so plainly.
    throw new ApiError("Can't reach the API. Is the backend running on localhost:8000?")
  }
  if (!response.ok) {
    throw new ApiError(`The API returned ${response.status}.`, response.status)
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

export function getBoards(complaintType: string): Promise<BoardsResponse> {
  return USE_MOCK
    ? mockBoards(complaintType)
    : request<BoardsResponse>(
        `/api/explore/boards?complaint_type=${encodeURIComponent(complaintType)}`,
      )
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
