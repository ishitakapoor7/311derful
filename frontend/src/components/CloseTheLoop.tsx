import { useState } from 'react'
import type { Forecast } from '../types/api'
import { addReminder } from '../api/client'
import { isResolved } from '../lib/outcomes'

interface Props {
  draftText: string
  forecast: Forecast
}

/**
 * NYC publishes no documented prefill scheme for the 311 portal, so the honest
 * deep link is the portal's own search, which lands on the right service page
 * for the complaint type. Anything else would be a URL we invented that breaks
 * the moment a judge clicks it.
 */
function nyc311Url(complaintType: string, descriptor: string | null): string {
  const term = [complaintType, descriptor].filter(Boolean).join(' ')
  return `https://portal.311.nyc.gov/search/?q=${encodeURIComponent(term)}`
}

/**
 * Median days to close among outcomes where the problem was actually addressed --
 * the honest "check back on" date. Failures close far faster, so using the
 * overall median would tell people to look before anything could have happened.
 */
function checkBackDays(forecast: Forecast): number {
  const resolved = forecast.outcomes
    .filter((o) => isResolved(o.outcome) && o.median_days_to_close !== null)
    .map((o) => o.median_days_to_close as number)
  if (resolved.length === 0) return 14
  return Math.max(3, Math.round(Math.max(...resolved)))
}

export function CloseTheLoop({ draftText, forecast }: Props) {
  const [copied, setCopied] = useState(false)
  const [reminderSet, setReminderSet] = useState<string | null>(null)

  const days = checkBackDays(forecast)
  const url = nyc311Url(forecast.complaint_type, forecast.descriptor)

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(draftText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard blocked: the draft is still selectable on screen.
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function remindMe() {
    const r = addReminder(forecast.complaint_type, forecast.agency, days)
    setReminderSet(
      new Date(r.due_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    )
  }

  return (
    <div>
      <div className="draft-notice">
        <span aria-hidden="true">▲</span>
        <span>This is a draft. Nothing has been filed until you submit it on the 311 site.</span>
      </div>
      <div className="draft-body">{draftText}</div>

      <div className="loop-actions">
        <button className="btn btn-primary" onClick={copyAndOpen}>
          {copied ? 'Copied — opening 311…' : 'Copy draft & open 311'}
        </button>
        <button className="btn btn-ghost" onClick={remindMe} disabled={Boolean(reminderSet)}>
          {reminderSet ? `Reminder set for ${reminderSet}` : `Remind me in ${days} days`}
        </button>
      </div>

      {reminderSet ? (
        <div className="loop-confirm">
          <div className="loop-confirm-head">We&apos;ll check back on {reminderSet}.</div>
          <div className="loop-confirm-body">
            Day {days} — the median close time for one that actually gets addressed. Still open
            past then and yours is already an outlier.
          </div>
        </div>
      ) : (
        <div className="loop-hint">Ones that get fixed close in about {days} days.</div>
      )}
    </div>
  )
}
