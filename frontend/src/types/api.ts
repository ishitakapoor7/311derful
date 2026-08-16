/**
 * Frontend mirror of the API contract.
 *
 * `backend/app/models.py` is the source of truth, and localhost:8000/docs serves
 * live OpenAPI. Verified against the backend as of commit e1d6715 -- /api/ask,
 * /api/config, /api/history and /api/explore all exist and these shapes match.
 * To regenerate rather than hand-maintain:
 *
 *     npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts
 *
 * The one thing here the backend does NOT serve is /api/explore/boards, which
 * powers the map. It is marked BACKEND-PENDING below.
 */

// ---------------------------------------------------------------------------
// Enums (string unions -- these serialize exactly as the Python StrEnums do)
// ---------------------------------------------------------------------------

export type OutcomeClass =
  | 'VERIFIED_FIXED'
  | 'ACTION_TAKEN'
  | 'NO_ACCESS'
  | 'DUPLICATE'
  | 'NOTHING_FOUND'
  | 'NO_ACTION_NEEDED'
  | 'GONE_ON_ARRIVAL'
  | 'REFERRED'
  | 'PENDING'
  | 'NO_OUTCOME_GIVEN'
  | 'UNCLASSIFIED'

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW'
export type GeoLevel = 'COMMUNITY_BOARD' | 'BOROUGH' | 'CITYWIDE'
export type TimeWindow = 'RECENT' | 'FULL_HISTORY'
export type InputSource = 'voice' | 'text'
export type VoiceMode = 'webspeech' | 'vapi' | 'off'

/**
 * The only two outcomes where the reported problem was actually addressed.
 * Everything else closed without the complainant's condition being resolved --
 * the distinction the whole product rests on. Mirrors RESOLVED_OUTCOMES in
 * models.py.
 */
export const RESOLVED_OUTCOMES: readonly OutcomeClass[] = ['VERIFIED_FIXED', 'ACTION_TAKEN']

/** Failures the person who filed can change the odds on next time. */
export const ACTIONABLE_FAILURES: readonly OutcomeClass[] = [
  'NO_ACCESS',
  'DUPLICATE',
  'GONE_ON_ARRIVAL',
]

export function isResolved(outcome: OutcomeClass): boolean {
  return RESOLVED_OUTCOMES.includes(outcome)
}

export function isActionableFailure(outcome: OutcomeClass): boolean {
  return ACTIONABLE_FAILURES.includes(outcome)
}

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

export interface SpeechLanguage {
  /** BCP-47, as SpeechRecognition.lang expects. */
  tag: string
  label: string
}

export interface ConfigResponse {
  voice_mode: VoiceMode
  vapi_public_key?: string | null
  vapi_assistant_id?: string | null
  languages: SpeechLanguage[]
  /** False when ANTHROPIC_API_KEY is unset — /api/ask will fail. Say so early. */
  llm_configured: boolean
}

// ---------------------------------------------------------------------------
// POST /api/ask
// ---------------------------------------------------------------------------

export interface AskRequest {
  text: string
  /** BCP-47 tag. Omit to let the backend detect it. */
  lang?: string | null
  /** Free-form NYC address, a ZIP, or "lat,lon" from geolocation. */
  address?: string | null
  month?: number | null
  channel?: string | null
  source: InputSource
  session_id?: string | null
}

export interface IntakeResult {
  complaint_type: string
  descriptor: string | null
  agency: string
  confidence: number
  detected_lang: string
  /** Set when confidence is low. Ask this and resubmit rather than forecasting. */
  clarifying_question: string | null
}

export interface OutcomeShare {
  outcome: OutcomeClass
  share: number
  count: number
  /**
   * Closure time for this outcome specifically. Reported per outcome because the
   * overall average is a vanity metric -- complaints closed as duplicates or for
   * no access close fastest.
   */
  median_days_to_close: number | null
}

export interface Forecast {
  complaint_type: string
  descriptor: string | null
  agency: string

  /** Descending by share. */
  outcomes: OutcomeShare[]
  /** Combined share of RESOLVED_OUTCOMES. The headline number. */
  resolved_share: number

  sample_size: number
  /** Records in range that no rule matched. Footnoted, never hidden. */
  unclassified_count: number
  confidence_tier: ConfidenceTier
  geo_level: GeoLevel
  time_window: TimeWindow

  baseline_resolved_share: number | null
}

export interface Tip {
  targets_outcome: OutcomeClass
  text: string
}

export interface Advice {
  narrative: string
  tips: Tip[]
  /**
   * A filled-in complaint the user submits themselves. NYC has no public write API
   * for 311, so this is a draft and must never be presented as a filed complaint.
   */
  draft_text: string
  /** Required when confidence_tier is LOW. Shown and spoken, never hidden. */
  caveat: string | null
}

export interface AskResponse {
  intake: IntakeResult
  /** Null when the intake needs a clarifying question answered first. */
  forecast: Forecast | null
  advice: Advice | null
  community_board: string | null
  /** False when the location was inferred rather than resolved exactly. */
  location_exact: boolean
}

// ---------------------------------------------------------------------------
// GET /api/history, DELETE /api/history/{id}?session_id=, DELETE /api/history
// ---------------------------------------------------------------------------

/**
 * Deliberately denormalised by the backend: enough to redraw a summary card
 * without a join. Note it carries no `outcomes[]`, so the full report cannot be
 * reconstructed from an entry -- opening one re-runs `text` through /api/ask.
 */
export interface HistoryEntry {
  id: string
  created_at: string
  /** What the person originally said. */
  text: string
  complaint_type: string
  descriptor: string | null
  agency: string
  community_board: string | null
  resolved_share: number | null
  sample_size: number | null
  confidence_tier: ConfidenceTier | null
  narrative: string | null
  draft_text: string | null
}

export interface HistoryResponse {
  entries: HistoryEntry[]
}

// ---------------------------------------------------------------------------
// GET /api/explore
// ---------------------------------------------------------------------------

export interface ExploreRow {
  complaint_type: string
  agency: string
  total: number
  resolved_share: number
  dominant_failure: OutcomeClass | null
  dominant_failure_share: number | null
}

export interface ExploreResponse {
  rows: ExploreRow[]
  total_records: number
  /** Share of records a rule matched. Shown in the UI, not hidden. */
  classified_share: number
}

// ---------------------------------------------------------------------------
// GET /api/explore/boards?complaint_type=…                 (BACKEND-PENDING)
// ---------------------------------------------------------------------------

export interface BoardShare {
  /** Matches `community_board`, e.g. "12 MANHATTAN". */
  board: string
  resolved_share: number
  total: number
}

export interface BoardsResponse {
  complaint_type: string
  rows: BoardShare[]
  /** True when these are computed from the dataset rather than estimated. */
  verified: boolean
}

// ---------------------------------------------------------------------------
// Local only — the follow-up reminder. Never leaves the browser.
// ---------------------------------------------------------------------------

export interface Reminder {
  id: string
  complaint_type: string
  agency: string
  created_at: string
  /** Median days to close for this complaint type — when we check back. */
  due_days: number
  due_at: string
}
