import raw from '../../fixtures/sample-responses.json'
import type { AskResponse } from '../types/api'

/**
 * The four real /api/ask responses committed at frontend/fixtures/.
 *
 * Every number in these came out of the 22.1M-row cube. Only the `advice` prose
 * is illustrative -- the live API writes that per request, in the caller's
 * language. This is what the mock client serves, so the offline demo shows real
 * outcome splits and real medians rather than invented ones.
 */
interface FixtureFile {
  _README: string
  high_confidence: AskResponse
  clarifying_question: AskResponse
  low_confidence: AskResponse
  citywide_approx_location: AskResponse
}

const fixtures = raw as unknown as FixtureFile

export const FIXTURE_NOTE = fixtures._README

export const FIXTURES: Record<string, AskResponse> = {
  high_confidence: fixtures.high_confidence,
  clarifying_question: fixtures.clarifying_question,
  low_confidence: fixtures.low_confidence,
  citywide_approx_location: fixtures.citywide_approx_location,
}

/**
 * Which fixture a phrase maps to. The live backend does this properly with the
 * taxonomy model; offline we keyword-match so the demo is steerable.
 */
const ROUTES: Array<[string[], keyof typeof FIXTURES]> = [
  [
    ['heat', 'hot water', 'radiator', 'cold', 'boiler', 'freezing', 'calefacción'],
    'high_confidence',
  ],
  [['trash', 'garbage', 'dirty', 'basura', 'litter', 'rubbish'], 'citywide_approx_location'],
  [['recycling', 'basket', 'overflowing', 'bin'], 'low_confidence'],
  [['noise', 'music', 'loud', 'party', 'upstairs', 'neighbour', 'neighbor'], 'clarifying_question'],
]

export function routeToFixture(text: string): AskResponse {
  const q = text.toLowerCase()
  for (const [keywords, key] of ROUTES) {
    if (keywords.some((k) => q.includes(k))) return FIXTURES[key]
  }
  // Anything unrecognised gets the clarifying question, which is what the real
  // backend does when the taxonomy match is too weak.
  return FIXTURES.clarifying_question
}
