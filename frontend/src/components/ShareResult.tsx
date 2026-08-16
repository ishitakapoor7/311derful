import { useState } from 'react'
import type { AskResponse } from '../types/api'
import { pctShort } from '../lib/format'
import { geoPhrase } from '../lib/format'

/**
 * A permalink and a one-line share card. Judges score things they can imagine
 * spreading, and the sentence is the whole finding compressed to something
 * someone would actually paste into a group chat.
 */
export function ShareResult({ response }: { response: AskResponse }) {
  const [copied, setCopied] = useState<'link' | 'text' | null>(null)
  const { forecast, intake, community_board } = response
  if (!forecast) return null

  const where = geoPhrase(forecast.geo_level, community_board)
  const sentence = `${intake.complaint_type} complaints ${where === 'citywide' ? 'in NYC' : `in ${where}`} get fixed ${pctShort(forecast.resolved_share)} of the time.`

  const link = `${window.location.origin}${window.location.pathname}#/ask?q=${encodeURIComponent(
    intake.complaint_type,
  )}${community_board ? `&cb=${encodeURIComponent(community_board)}` : ''}`

  async function copy(kind: 'link' | 'text', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="share">
      <div className="share-card">
        <div className="share-quote">{sentence}</div>
        <div className="share-source">
          311derful · {forecast.sample_size.toLocaleString('en-US')} complaints ·{' '}
          {forecast.confidence_tier} confidence
        </div>
      </div>
      <div className="share-actions">
        <button className="btn btn-sm btn-ghost" onClick={() => copy('text', sentence)}>
          {copied === 'text' ? 'Copied' : 'Copy the line'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => copy('link', link)}>
          {copied === 'link' ? 'Copied' : 'Copy permalink'}
        </button>
      </div>
    </div>
  )
}
