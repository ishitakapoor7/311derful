import type { ConfidenceTier, GeoLevel, TimeWindow } from '../types/api'

export function pct(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`
}

/** Whole-percent variant for dense table cells. */
export function pctShort(share: number): string {
  return `${Math.round(share * 100)}%`
}

export function count(n: number): string {
  return n.toLocaleString('en-US')
}

export function days(d: number | null): string {
  if (d === null) return '—'
  if (d < 1) return `${d.toFixed(1)}d`
  return `${Math.round(d)}d`
}

/**
 * "About 1 in 4." Plain-language framing next to the percentage, because a share
 * stated two ways is harder to misread than a share stated once.
 */
export function asFraction(share: number): string {
  if (share <= 0) return 'almost none'
  if (share >= 1) return 'effectively all'
  const denominator = Math.round(1 / share)
  if (denominator <= 1) return 'nearly all'
  if (denominator > 50) return 'fewer than 1 in 50'
  return `about 1 in ${denominator}`
}

export function tierLabel(tier: ConfidenceTier): string {
  return `${tier} confidence`
}

/**
 * Plain-language geography. Never implies the number is local when it isn't --
 * state 5 of the frontend plan.
 */
export function geoPhrase(geo: GeoLevel, communityBoard: string | null): string {
  switch (geo) {
    case 'COMMUNITY_BOARD':
      return communityBoard ? `Community Board ${communityBoard}` : 'your community board'
    case 'BOROUGH':
      return 'your borough'
    case 'CITYWIDE':
      return 'citywide'
  }
}

export function timePhrase(window: TimeWindow): string {
  return window === 'RECENT' ? 'recent years' : 'all years on record'
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
