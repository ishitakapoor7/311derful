import type { Forecast } from '../types/api'
import { count, geoPhrase, timePhrase } from '../lib/format'

interface Props {
  forecast: Forecast
  communityBoard: string | null
  locationExact: boolean
}

/**
 * Sample size, breadth, and confidence, welded to the figure above it.
 *
 * This component is the enforcement point for the project's first invariant: a
 * percentage without its denominator is not a valid thing to show. Every screen
 * that renders a share renders this directly beneath it.
 */
export function ProvenanceChip({ forecast, communityBoard, locationExact }: Props) {
  const geo = geoPhrase(forecast.geo_level, communityBoard)

  return (
    <div className="chip">
      {count(forecast.sample_size)} complaints
      {' · '}
      {geo}
      {!locationExact && forecast.geo_level === 'COMMUNITY_BOARD' ? ' (approximate)' : ''}
      {' · '}
      {timePhrase(forecast.time_window)}
      {' · '}
      <span className={`tier-${forecast.confidence_tier}`}>
        {forecast.confidence_tier} confidence
      </span>
    </div>
  )
}

/**
 * The scope and coverage sentences that must never be implied away.
 * States 3, 4 and 5 of the frontend plan.
 */
export function ScopeNote({ forecast, communityBoard, locationExact }: Props) {
  const notes: string[] = []

  // State 5: never imply a citywide number is their district. Two different
  // reasons land here and they should not read the same -- "we couldn't narrow
  // it" is a data limitation, "you didn't say where" is not.
  if (forecast.geo_level === 'CITYWIDE' && communityBoard === null) {
    notes.push(
      'This is a citywide number. Add an address or ZIP above to see how your own area compares.',
    )
  } else if (forecast.geo_level === 'CITYWIDE') {
    notes.push(
      'There was not enough data for your area, so this is a citywide number — not one for your district.',
    )
  } else if (forecast.geo_level === 'BOROUGH') {
    notes.push(
      'There was not enough data for your community board, so this covers your whole borough.',
    )
  }

  // Time fallback is always surfaced.
  if (forecast.time_window === 'FULL_HISTORY') {
    notes.push('It also had to reach back across every year on record, not just recent ones.')
  }

  // State 3: approximate location.
  if (!locationExact && communityBoard) {
    notes.push(`Your location was estimated as ${communityBoard}, not confirmed exactly.`)
  }

  // State 4: coverage honesty.
  if (forecast.unclassified_count > 0) {
    notes.push(
      `${count(forecast.unclassified_count)} more complaints couldn't be classified from the agency's own resolution text and are excluded.`,
    )
  }

  if (notes.length === 0) return null

  return (
    <div className="note">
      {notes.map((n, i) => (
        <div key={i} style={{ marginTop: i ? 6 : 0 }}>
          {n}
        </div>
      ))}
    </div>
  )
}
