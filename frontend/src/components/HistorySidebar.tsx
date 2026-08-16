import type { HistoryEntry } from '../types/api'
import { pctShort, relativeTime } from '../lib/format'

interface Props {
  entries: HistoryEntry[]
  open: boolean
  onToggle: () => void
  onOpenEntry: (entry: HistoryEntry) => void
  onDelete: (entryId: string) => void
  onClearAll: () => void
}

/**
 * Past complaints, newest first. Clicking one re-renders the stored result with no
 * model call: the response was cached against the entry when it was first fetched.
 * Only an entry this browser has never seen — a session opened on another device —
 * falls back to the headline the entry itself carries.
 */
export function HistorySidebar({
  entries,
  open,
  onToggle,
  onOpenEntry,
  onDelete,
  onClearAll,
}: Props) {
  return (
    <aside className={open ? 'sidebar' : ''} style={open ? undefined : { padding: '28px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {open && <p className="label" style={{ margin: 0 }}>History</p>}
        <button className="btn btn-sm btn-ghost" onClick={onToggle} aria-expanded={open}>
          {open ? 'Hide ›' : '‹ History'}
        </button>
      </div>

      {open && (
        <>
          {entries.length === 0 ? (
            <p className="muted mono" style={{ marginTop: 14 }}>
              Nothing yet.
            </p>
          ) : (
            <>
              <div style={{ marginTop: 12 }}>
                {entries.map((entry) => (
                  <div className="hist-item" key={entry.id}>
                    <button className="open" onClick={() => onOpenEntry(entry)}>
                      <div className="t">{entry.complaint_type || 'Unclassified'}</div>
                      <div className="m">
                        {entry.confidence_tier && (
                          <i
                            className={`dot dot-${entry.confidence_tier}`}
                            title={`${entry.confidence_tier} confidence`}
                          />
                        )}
                        {entry.resolved_share !== null ? pctShort(entry.resolved_share) : '—'}
                        {' · '}
                        {relativeTime(entry.created_at)}
                      </div>
                    </button>
                    <button
                      className="hist-del"
                      onClick={() => onDelete(entry.id)}
                      aria-label={`Delete ${entry.complaint_type}`}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-sm btn-ghost"
                style={{ marginTop: 14 }}
                onClick={onClearAll}
              >
                Clear all
              </button>
            </>
          )}
        </>
      )}
    </aside>
  )
}
