import { useState } from 'react'
import type { AskResponse } from '../types/api'
import { count, geoPhrase, pct, timePhrase } from '../lib/format'
import { isResolved, outcomeLabel } from '../lib/outcomes'

export interface Turn {
  id: string
  /** What the person said or typed. */
  text: string
  response: AskResponse
  /** True when reopened from history rather than freshly asked. */
  revisited?: boolean
}

/**
 * The conversational framing of the same data.
 *
 * Deliberately not bubbles: turns are rules-separated rows, because the numbers
 * in them are the point and a chat bubble makes evidence look like opinion. Every
 * figure here comes from the same forecast the report renders — this view
 * rephrases, it never recomputes.
 */
export function ChatView({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) return null

  return (
    <div className="chat">
      {turns.map((turn) => (
        <div key={turn.id}>
          <div className="turn">
            <div className="who">You{turn.revisited ? ' · reopened from history' : ''}</div>
            <p className="turn-said">{turn.text}</p>
          </div>
          <div className="turn">
            <div className="who">311derful</div>
            <Answer response={turn.response} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Answer({ response }: { response: AskResponse }) {
  const { forecast, advice, intake, community_board } = response

  // A clarifying question is a turn in its own right — it is what the backend
  // actually said, and pretending otherwise would leave a gap in the transcript.
  if (!forecast || !advice) {
    return (
      <p className="turn-said">
        {intake.clarifying_question ??
          'I could not match that to a 311 complaint type confidently enough to forecast on.'}
      </p>
    )
  }

  const failure = [...forecast.outcomes]
    .filter((o) => !isResolved(o.outcome) && o.outcome !== 'PENDING')
    .sort((a, b) => b.share - a.share)[0]

  return (
    <>
      {/* The caveat leads, never trails — same rule as the report. */}
      {advice.caveat && <p className="turn-caveat">{advice.caveat}</p>}

      <p className="turn-said">
        Of {count(forecast.sample_size)} {intake.complaint_type} complaints{' '}
        {geoPhrase(forecast.geo_level, community_board)},{' '}
        <strong>{pct(forecast.resolved_share)}</strong> ended with the problem actually addressed.
        {failure
          ? ` The most common ending is ${outcomeLabel(failure.outcome).toLowerCase()}, at ${pct(
              failure.share,
            )}.`
          : ''}
      </p>

      <p className="turn-said">{advice.narrative}</p>

      {advice.tips.length > 0 && (
        <ul className="turn-tips">
          {advice.tips.map((tip, i) => (
            <li key={`${tip.targets_outcome}-${i}`}>
              {tip.text}{' '}
              <span className="muted mono">→ {outcomeLabel(tip.targets_outcome)}</span>
            </li>
          ))}
        </ul>
      )}

      <details className="turn-draft">
        <summary>Draft complaint — nothing is filed until you submit it yourself</summary>
        <div className="draft-body">{advice.draft_text}</div>
        <CopyDraft text={advice.draft_text} />
      </details>

      <div className="chip">
        {count(forecast.sample_size)} complaints · {timePhrase(forecast.time_window)} ·{' '}
        <span className={`tier-${forecast.confidence_tier}`}>
          {forecast.confidence_tier} confidence
        </span>
      </div>
    </>
  )
}

function CopyDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard blocked: the draft is still selectable above.
    }
  }

  return (
    <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={copy}>
      {copied ? 'Copied' : 'Copy draft'}
    </button>
  )
}
