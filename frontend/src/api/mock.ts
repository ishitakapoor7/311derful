/**
 * Offline backend for the frontend.
 *
 * /api/ask now serves the four REAL fixtures committed at frontend/fixtures/ --
 * every outcome split, count and median in them came out of the 22.1M-row cube.
 * Only the advice prose there is illustrative.
 *
 * Still estimated, and marked "est." in the UI:
 *   - the long tail of /api/explore rows beyond the six in the README
 *   - all per-board map shares (there is no /api/explore/boards endpoint yet)
 *
 * Delete this file once VITE_USE_MOCK is off for good.
 */

import { routeToFixture } from './fixtures'
import { TOTAL_RECORDS } from '../lib/constants'
import type {
  AskRequest,
  AskResponse,
  BoardShare,
  BoardsResponse,
  ConfigResponse,
  ExploreResponse,
  ExploreRow,
  Forecast,
  OutcomeShare,
} from '../types/api'

const latency = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** PLACEHOLDER: distributions are invented; only the resolved total is verified. */
function outcomes(rows: Array<[OutcomeShare['outcome'], number, number | null]>, n: number): OutcomeShare[] {
  return rows
    .map(([outcome, share, medianDays]) => ({
      outcome,
      share,
      count: Math.round(share * n),
      median_days_to_close: medianDays,
    }))
    .sort((a, b) => b.share - a.share)
}

interface Scenario {
  keywords: string[]
  complaint_type: string
  descriptor: string | null
  agency: string
  /** VERIFIED */
  sample_size: number
  /** VERIFIED */
  resolved_share: number
  /** VERIFIED -- citywide share for the same complaint type */
  baseline_resolved_share: number
  /**
   * PLACEHOLDER: how much a single community board differs from the citywide
   * share. Only the citywide figure is verified, so anything local has to be
   * invented -- which is exactly why the local path renders behind the
   * placeholder marker.
   */
  local_delta: number
  /** PLACEHOLDER */
  rows: Array<[OutcomeShare['outcome'], number, number | null]>
  /** PLACEHOLDER */
  tips: Array<{ targets_outcome: OutcomeShare['outcome']; text: string }>
}

/**
 * Rescales a distribution so its resolved outcomes sum to `target`, keeping the
 * proportions within the resolved and unresolved groups intact. Shares still sum
 * to 1, so the bars stay internally consistent.
 */
function rescaleToResolved(
  rows: Array<[OutcomeShare['outcome'], number, number | null]>,
  target: number,
): Array<[OutcomeShare['outcome'], number, number | null]> {
  const resolvedNow = rows
    .filter(([outcome]) => outcome === 'VERIFIED_FIXED' || outcome === 'ACTION_TAKEN')
    .reduce((sum, [, share]) => sum + share, 0)
  if (resolvedNow <= 0 || resolvedNow >= 1) return rows

  const up = target / resolvedNow
  const down = (1 - target) / (1 - resolvedNow)

  return rows.map(([outcome, share, medianDays]) => {
    const resolved = outcome === 'VERIFIED_FIXED' || outcome === 'ACTION_TAKEN'
    return [outcome, share * (resolved ? up : down), medianDays]
  })
}

const SCENARIOS: Scenario[] = [
  {
    keywords: ['plumb', 'leak', 'pipe', 'water damage', 'drip', 'faucet', 'sink'],
    complaint_type: 'PLUMBING',
    descriptor: 'LEAK',
    agency: 'HPD',
    sample_size: 214_581,
    resolved_share: 0.242,
    baseline_resolved_share: 0.242,
    local_delta: -0.031,
    rows: [
      ['NO_ACCESS', 0.314, 6.2],
      ['NOTHING_FOUND', 0.182, 4.8],
      ['ACTION_TAKEN', 0.151, 19.4],
      ['DUPLICATE', 0.127, 1.9],
      ['VERIFIED_FIXED', 0.091, 27.1],
      ['NO_OUTCOME_GIVEN', 0.089, 8.3],
      ['REFERRED', 0.024, 11.0],
      ['PENDING', 0.022, null],
    ],
    tips: [
      {
        targets_outcome: 'NO_ACCESS',
        text: 'Give a phone number and a window when someone will definitely be home.',
      },
      {
        targets_outcome: 'DUPLICATE',
        text: 'Check whether a neighbour has already filed for the same line before you file.',
      },
    ],
  },
  {
    keywords: ['heat', 'hot water', 'radiator', 'cold', 'boiler', 'freezing'],
    complaint_type: 'HEAT/HOT WATER',
    descriptor: 'ENTIRE BUILDING',
    agency: 'HPD',
    sample_size: 897_690,
    resolved_share: 0.362,
    baseline_resolved_share: 0.362,
    local_delta: 0.048,
    rows: [
      ['NO_ACCESS', 0.226, 5.4],
      ['ACTION_TAKEN', 0.214, 12.7],
      ['NOTHING_FOUND', 0.191, 3.9],
      ['VERIFIED_FIXED', 0.148, 16.2],
      ['DUPLICATE', 0.113, 1.4],
      ['NO_OUTCOME_GIVEN', 0.067, 7.1],
      ['PENDING', 0.041, null],
    ],
    tips: [
      {
        targets_outcome: 'NOTHING_FOUND',
        text: 'Log the indoor temperature with a timestamp before you call.',
      },
      {
        targets_outcome: 'NO_ACCESS',
        text: 'Name a reachable contact for the building, not just your own unit.',
      },
    ],
  },
  {
    keywords: ['noise', 'music', 'loud', 'party', 'neighbour', 'neighbor', 'upstairs', 'bass'],
    complaint_type: 'Noise - Residential',
    descriptor: 'Loud Music/Party',
    agency: 'NYPD',
    sample_size: 1_191_255,
    resolved_share: 0.322,
    baseline_resolved_share: 0.322,
    local_delta: -0.057,
    rows: [
      ['GONE_ON_ARRIVAL', 0.413, 0.3],
      ['ACTION_TAKEN', 0.287, 0.6],
      ['NOTHING_FOUND', 0.158, 0.4],
      ['DUPLICATE', 0.061, 0.2],
      ['VERIFIED_FIXED', 0.035, 1.1],
      ['NO_OUTCOME_GIVEN', 0.034, 0.5],
      ['PENDING', 0.012, null],
    ],
    tips: [
      {
        targets_outcome: 'GONE_ON_ARRIVAL',
        text: 'Call while it is happening, not the next morning.',
      },
      {
        targets_outcome: 'DUPLICATE',
        text: 'One complaint per household — extra reports on the same night close as duplicates.',
      },
    ],
  },
  {
    keywords: ['unsanitary', 'roach', 'mold', 'mould', 'garbage', 'trash', 'rat', 'rodent', 'pest'],
    complaint_type: 'UNSANITARY CONDITION',
    descriptor: 'PESTS',
    agency: 'HPD',
    sample_size: 369_538,
    resolved_share: 0.276,
    baseline_resolved_share: 0.276,
    local_delta: -0.022,
    rows: [
      ['NO_ACCESS', 0.288, 5.9],
      ['NOTHING_FOUND', 0.214, 4.1],
      ['ACTION_TAKEN', 0.189, 17.8],
      ['DUPLICATE', 0.122, 1.7],
      ['VERIFIED_FIXED', 0.087, 24.6],
      ['NO_OUTCOME_GIVEN', 0.071, 7.9],
      ['PENDING', 0.029, null],
    ],
    tips: [
      {
        targets_outcome: 'NOTHING_FOUND',
        text: 'Photograph the condition and say where in the unit it is.',
      },
      {
        targets_outcome: 'NO_ACCESS',
        text: 'Confirm someone over 18 can let the inspector in.',
      },
    ],
  },
]

/** PLACEHOLDER: entire scenario, including the sample size. */
const LOW_CONFIDENCE: Scenario = {
  keywords: ['peacock', 'beehive', 'sinkhole', 'obscure'],
  complaint_type: 'Unsanitary Animal Pvt Property',
  descriptor: null,
  agency: 'DOHMH',
  sample_size: 17,
  resolved_share: 0.235,
  baseline_resolved_share: 0.31,
  local_delta: -0.075,
  rows: [
    ['NOTHING_FOUND', 0.412, 6.0],
    ['ACTION_TAKEN', 0.176, 14.0],
    ['NO_ACCESS', 0.176, 9.0],
    ['VERIFIED_FIXED', 0.059, 21.0],
    ['NO_OUTCOME_GIVEN', 0.118, 8.0],
    ['PENDING', 0.059, null],
  ],
  tips: [
    {
      targets_outcome: 'NOTHING_FOUND',
      text: 'Describe exactly what is visible and when.',
    },
  ],
}

const VAGUE = ['help', 'problem', 'issue', 'hi', 'hello', 'something wrong', 'bad']

function pickScenario(text: string): Scenario | null {
  const q = text.toLowerCase()
  const hit = SCENARIOS.find((s) => s.keywords.some((k) => q.includes(k)))
  if (hit) return hit
  if (LOW_CONFIDENCE.keywords.some((k) => q.includes(k))) return LOW_CONFIDENCE
  return null
}

function buildForecast(s: Scenario, geoKnown: boolean): Forecast {
  const low = s.sample_size < 30

  // Without a location we answer citywide, and the citywide figures are the
  // verified ones. With a location we have to narrow to a single community
  // board -- and nothing about that subset is verified, so both the sample size
  // and the share are invented. That is the difference the placeholder marker
  // is there to make visible.
  const local = geoKnown && !low
  const sampleSize = local ? Math.max(30, Math.round(s.sample_size * 0.017)) : s.sample_size
  const resolvedShare = local
    ? Math.min(0.95, Math.max(0.02, s.resolved_share + s.local_delta))
    : s.resolved_share

  return {
    complaint_type: s.complaint_type,
    descriptor: s.descriptor,
    agency: s.agency,
    outcomes: outcomes(local ? rescaleToResolved(s.rows, resolvedShare) : s.rows, sampleSize),
    resolved_share: resolvedShare,
    sample_size: sampleSize,
    // PLACEHOLDER
    unclassified_count: low ? 3 : Math.round(sampleSize * 0.041),
    confidence_tier: low ? 'LOW' : sampleSize >= 300 ? 'HIGH' : 'MEDIUM',
    geo_level: low ? 'CITYWIDE' : local ? 'COMMUNITY_BOARD' : 'CITYWIDE',
    time_window: low ? 'FULL_HISTORY' : 'RECENT',
    // Only meaningful as a comparison when the headline is a local number.
    baseline_resolved_share: local ? s.baseline_resolved_share : null,
  }
}

export async function mockConfig(): Promise<ConfigResponse> {
  await latency(120)
  return {
    voice_mode: 'webspeech',
    llm_configured: true,
    languages: [
      { tag: 'en-US', label: 'English' },
      { tag: 'es-US', label: 'Español' },
      { tag: 'zh-CN', label: '中文' },
      { tag: 'bn-IN', label: 'বাংলা' },
      { tag: 'ru-RU', label: 'Русский' },
      { tag: 'ht-HT', label: 'Kreyòl' },
    ],
  }
}

export async function mockAsk(req: AskRequest): Promise<AskResponse> {
  await latency(900)
  return routeToFixture(req.text)
}

/** The complaint types whose totals and resolved shares are published in the README. */
export const VERIFIED_TYPES = new Set([
  'PLUMBING',
  'UNSANITARY CONDITION',
  'PAINT/PLASTER',
  'Noise - Residential',
  'HEAT/HOT WATER',
  'Illegal Parking',
])

function r(
  complaint_type: string,
  agency: string,
  total: number,
  resolved_share: number,
  dominant_failure: OutcomeShare['outcome'],
  dominant_failure_share: number,
): ExploreRow {
  return { complaint_type, agency, total, resolved_share, dominant_failure, dominant_failure_share }
}

export async function mockExplore(): Promise<ExploreResponse> {
  await latency(300)
  // VERIFIED -- published in the repo README, measured over all 22,145,244
  // records, citywide, trailing three years, classified records only.
  const verified: ExploreRow[] = [
    r('PLUMBING', 'HPD', 214_581, 0.242, 'NOTHING_FOUND', 0.34),
    r('UNSANITARY CONDITION', 'HPD', 369_538, 0.276, 'NOTHING_FOUND', 0.42),
    r('PAINT/PLASTER', 'HPD', 187_960, 0.3, 'NOTHING_FOUND', 0.43),
    r('Noise - Residential', 'NYPD', 1_191_255, 0.322, 'NOTHING_FOUND', 0.43),
    r('HEAT/HOT WATER', 'HPD', 897_690, 0.362, 'DUPLICATE', 0.28),
    r('Illegal Parking', 'NYPD', 1_665_502, 0.421, 'NOTHING_FOUND', 0.23),
  ]

  const estimated: ExploreRow[] = MORE_ROWS.map(
    ([complaint_type, agency, total, resolved_share, dominant_failure, dominant_failure_share]) => ({
      complaint_type,
      agency,
      total,
      resolved_share,
      dominant_failure,
      dominant_failure_share,
    }),
  )

  return {
    rows: [...verified, ...estimated],
    total_records: TOTAL_RECORDS,
    // VERIFIED: classifier coverage is 92.9-94.4% in every year 2020-2026.
    classified_share: 0.929,
  }
}

export async function mockHistoryDelete(): Promise<void> {
  await latency(80)
}

// ---------------------------------------------------------------------------
// Explore: the long tail. Only the four types above are verified; the rest are
// ESTIMATED and the UI labels them so.
// ---------------------------------------------------------------------------

/** PLACEHOLDER: every row below except the four verified ones. */
const MORE_ROWS: Array<[string, string, number, number, OutcomeShare['outcome'], number]> = [
  ['Noise - Street/Sidewalk', 'NYPD', 412_883, 0.141, 'GONE_ON_ARRIVAL', 0.512],
  ['Blocked Driveway', 'NYPD', 341_774, 0.203, 'GONE_ON_ARRIVAL', 0.446],
  ['Noise - Commercial', 'NYPD', 196_412, 0.229, 'GONE_ON_ARRIVAL', 0.408],
  ['Derelict Vehicle', 'NYPD', 84_336, 0.244, 'NOTHING_FOUND', 0.331],
  ['Street Condition', 'DOT', 271_558, 0.512, 'NO_ACTION_NEEDED', 0.201],
  ['Street Light Condition', 'DOT', 218_904, 0.564, 'NOTHING_FOUND', 0.163],
  ['Traffic Signal Condition', 'DOT', 141_226, 0.611, 'NO_ACTION_NEEDED', 0.148],
  ['Damaged Tree', 'DPR', 96_812, 0.428, 'NO_ACTION_NEEDED', 0.244],
  ['Sewer', 'DEP', 88_447, 0.583, 'NOTHING_FOUND', 0.177],
  ['Water System', 'DEP', 74_112, 0.627, 'NO_ACTION_NEEDED', 0.191],
  ['Air Quality', 'DEP', 41_206, 0.318, 'NOTHING_FOUND', 0.362],
  ['Rodent', 'DOHMH', 96_447, 0.307, 'NOTHING_FOUND', 0.384],
  ['Food Establishment', 'DOHMH', 52_119, 0.401, 'NOTHING_FOUND', 0.288],
  ['Indoor Air Quality', 'DOHMH', 22_884, 0.264, 'NO_ACCESS', 0.341],
  ['Dirty Conditions', 'DSNY', 187_663, 0.472, 'NOTHING_FOUND', 0.243],
  ['Missed Collection', 'DSNY', 143_921, 0.556, 'NOTHING_FOUND', 0.194],
  ['Graffiti', 'DSNY', 38_772, 0.229, 'NO_ACCESS', 0.297],
  ['DOOR/WINDOW', 'HPD', 176_338, 0.271, 'NO_ACCESS', 0.294],
  ['ELECTRIC', 'HPD', 121_557, 0.283, 'NO_ACCESS', 0.288],
  ['APPLIANCE', 'HPD', 74_209, 0.246, 'NO_ACCESS', 0.311],
  ['General Construction', 'DOB', 112_886, 0.334, 'NOTHING_FOUND', 0.276],
  ['Elevator', 'DOB', 31_442, 0.478, 'NO_ACCESS', 0.219],
  ['Homeless Person Assistance', 'DHS', 118_275, 0.169, 'GONE_ON_ARRIVAL', 0.487],
  ['Consumer Complaint', 'DCA', 27_331, 0.352, 'REFERRED', 0.261],
]

/** Stable pseudo-random in [0,1) from a string — deterministic across reloads. */
function hashUnit(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

const BOROUGH_DISTRICTS: Array<[string, number]> = [
  ['MANHATTAN', 12],
  ['BRONX', 12],
  ['BROOKLYN', 18],
  ['QUEENS', 14],
  ['STATEN ISLAND', 3],
]

/**
 * PLACEHOLDER: per-board shares are estimated by spreading the verified citywide
 * figure across boards. Deterministic, so the map looks the same every reload.
 */
export async function mockBoards(complaintType: string): Promise<BoardsResponse> {
  await latency(220)

  const base =
    SCENARIOS.find((s) => s.complaint_type === complaintType)?.resolved_share ??
    MORE_ROWS.find((r) => r[0] === complaintType)?.[3] ??
    0.3
  const totalCitywide =
    SCENARIOS.find((s) => s.complaint_type === complaintType)?.sample_size ??
    MORE_ROWS.find((r) => r[0] === complaintType)?.[2] ??
    100_000

  const rows: BoardShare[] = []
  for (const [boro, n] of BOROUGH_DISTRICTS) {
    for (let d = 1; d <= n; d += 1) {
      const board = `${String(d).padStart(2, '0')} ${boro}`
      const jitter = (hashUnit(board + complaintType) - 0.5) * 0.34
      rows.push({
        board,
        resolved_share: Math.min(0.92, Math.max(0.04, base + jitter)),
        total: Math.round((totalCitywide / 59) * (0.5 + hashUnit(board) * 1.4)),
      })
    }
  }
  return { complaint_type: complaintType, rows, verified: false }
}
