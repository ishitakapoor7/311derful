import type { HistoryEntry } from '../types/api'
import { count, pct, relativeTime } from '../lib/format'

/**
 * A past complaint drawn from what the history entry itself stores.
 *
 * The normal path never reaches this: reopening an entry reads the cached
 * response and redraws the full report with no network call at all. This is the
 * fallback for an entry whose response is not in this browser — a session opened
 * on another device, or a cache the browser evicted.
 *
 * It shows exactly what the backend stored and no more. The bars genuinely cannot
 * be reconstructed without `outcomes[]`, so the re-run is offered as a button
 * rather than fired silently: a model call the user did not ask for is not a
 * detail to hide from them.
 */
export function StoredResult({
  entry,
  onRerun,
}: {
  entry: HistoryEntry
  onRerun: () => void
}) {
  return (
    <div>
      <p className="label">
        From history · {relativeTime(entry.created_at)}
        {entry.community_board ? ` · Community Board ${entry.community_board}` : ''}
      </p>

      <p className="label" style={{ marginTop: 12 }}>
        {entry.complaint_type}
        {entry.descriptor ? ` / ${entry.descriptor}` : ''} — handled by {entry.agency}
      </p>

      {entry.resolved_share !== null && (
        <div className="headline">
          <span className="n">{pct(entry.resolved_share)}</span>
          <div className="says">
            of complaints like yours ended with the problem actually addressed.
          </div>
          <div className="chip">
            {entry.sample_size !== null ? `${count(entry.sample_size)} complaints · ` : ''}
            {entry.confidence_tier && (
              <span className={`tier-${entry.confidence_tier}`}>
                {entry.confidence_tier} confidence
              </span>
            )}
          </div>
        </div>
      )}

      <div className="section">
        <p className="label">What you asked</p>
        <p className="lede">{entry.text}</p>
      </div>

      {entry.narrative && (
        <div className="section">
          <p className="label">What this means</p>
          <p className="lede">{entry.narrative}</p>
        </div>
      )}

      {entry.draft_text && (
        <div className="section">
          <p className="label">Your draft</p>
          <div className="draft-notice">
            <span aria-hidden="true">▲</span>
            <span>This is a draft. Nothing has been filed until you submit it on the 311 site.</span>
          </div>
          <div className="draft-body">{entry.draft_text}</div>
        </div>
      )}

      <div className="section">
        <div className="note">
          The stored entry keeps the headline, not the outcome breakdown. Running it again rebuilds
          the full report — it costs a model call, and without an address it answers citywide.
        </div>
        <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} onClick={onRerun}>
          Run it again for the full breakdown
        </button>
      </div>
    </div>
  )
}
