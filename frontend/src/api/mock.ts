/**
 * Offline backend, for a demo with no API running. Opt in with VITE_USE_MOCK=true.
 *
 * The rule here is that nothing is invented. Everything below is either a real
 * response committed at frontend/fixtures/, or a figure published in the repo
 * README and measured over the 22.1M-row cube. Where this client cannot compute
 * something -- the long tail of complaint types, per-board map shares -- it
 * returns what it has and leaves the rest empty, and the UI says the live API is
 * needed. An estimate that looks like a measurement is worse than a gap.
 *
 * Only the `advice` prose in the fixtures is illustrative; the live API writes it
 * per request, in the caller's language.
 *
 * Delete this file once the demo never runs offline.
 */

import { routeToFixture } from './fixtures'
import { TOTAL_RECORDS } from '../lib/constants'
import type {
  AskRequest,
  AskResponse,
  BoardsResponse,
  ConfigResponse,
  ExploreResponse,
  ExploreRow,
  OutcomeClass,
} from '../types/api'

const latency = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Mirrors the defaults in backend/app/config.py. */
export async function mockConfig(): Promise<ConfigResponse> {
  await latency(120)
  return {
    voice_mode: 'webspeech',
    llm_configured: true,
    languages: [
      { tag: 'en-US', label: 'English' },
      { tag: 'es-ES', label: 'Español' },
      { tag: 'zh-CN', label: '中文' },
      { tag: 'bn-BD', label: 'বাংলা' },
      { tag: 'ru-RU', label: 'Русский' },
      { tag: 'ht-HT', label: 'Kreyòl Ayisyen' },
      { tag: 'ar-SA', label: 'العربية' },
      { tag: 'fr-FR', label: 'Français' },
    ],
  }
}

export async function mockAsk(_req: AskRequest): Promise<AskResponse> {
  await latency(900)
  return routeToFixture(_req.text)
}

export async function mockHistoryDelete(): Promise<void> {
  await latency(80)
}

// ---------------------------------------------------------------------------
// Explore
// ---------------------------------------------------------------------------

function r(
  complaint_type: string,
  agency: string,
  total: number,
  resolved_share: number,
  dominant_failure: OutcomeClass,
  dominant_failure_share: number,
): ExploreRow {
  return { complaint_type, agency, total, resolved_share, dominant_failure, dominant_failure_share }
}

/**
 * The six complaint types measured in the repo README: all 22,145,244 records,
 * citywide, trailing three years, classified records only. The live endpoint
 * returns the full table; offline we serve only what has been verified.
 */
export async function mockExplore(): Promise<ExploreResponse> {
  await latency(300)
  return {
    rows: [
      r('PLUMBING', 'HPD', 214_581, 0.242, 'NOTHING_FOUND', 0.34),
      r('UNSANITARY CONDITION', 'HPD', 369_538, 0.276, 'NOTHING_FOUND', 0.42),
      r('PAINT/PLASTER', 'HPD', 187_960, 0.3, 'NOTHING_FOUND', 0.43),
      r('Noise - Residential', 'NYPD', 1_191_255, 0.322, 'NOTHING_FOUND', 0.43),
      r('HEAT/HOT WATER', 'HPD', 897_690, 0.362, 'DUPLICATE', 0.28),
      r('Illegal Parking', 'NYPD', 1_665_502, 0.421, 'NOTHING_FOUND', 0.23),
    ],
    total_records: TOTAL_RECORDS,
    // VERIFIED: classifier coverage is 92.9-94.4% in every year 2020-2026.
    classified_share: 0.929,
  }
}

/**
 * No rows, deliberately. Per-board shares are a cube query and there is no cube
 * offline; the previous build spread the citywide figure across 59 districts
 * with deterministic jitter, which drew a map of nothing. Explore renders the
 * empty result as "this needs the live API" instead.
 */
export async function mockBoards(complaintType: string): Promise<BoardsResponse> {
  await latency(120)
  return { complaint_type: complaintType, rows: [] }
}
