import { USE_MOCK } from '../api/client'
import { count } from '../lib/format'
import { DATA_RANGE, TOTAL_RECORDS } from '../lib/constants'

/**
 * Provenance, stated once, at the foot of the screen.
 *
 * An earlier build shouted -- an orange banner plus a
 * "[placeholder- replace with real data]" chip in the middle of the result --
 * because a good deal of what it rendered was invented. Nothing is now: every
 * figure on screen is a cube lookup, and anything this app cannot compute is
 * left out rather than filled in. So the honesty that remains is a plain
 * statement of what was measured and what was written.
 */
interface FooterProps {
  /** What this particular screen computed from the dataset. */
  verified?: string[]
  /** What the model phrased, from those numbers. Never a number itself. */
  written?: string[]
  /** Overrides the dataset totals when the screen has live ones. */
  totalRecords?: number
  range?: string
}

export function ProvenanceFooter({
  verified = [],
  written = [],
  totalRecords = TOTAL_RECORDS,
  range = DATA_RANGE,
}: FooterProps) {
  return (
    <div className="provenance">
      <div className="provenance-row">
        <span className="provenance-key">Computed from the dataset</span>
        <span>
          {[`${count(totalRecords)} records`, `${range}`, ...verified].join(' · ')}
        </span>
      </div>

      {written.length > 0 && (
        <div className="provenance-row">
          <span className="provenance-key">Written by the model</span>
          <span>{written.join(' · ')}</span>
        </div>
      )}

      {USE_MOCK && (
        <div className="provenance-note">
          Offline demo: answers come from responses committed at{' '}
          <code>frontend/fixtures/</code>, measured against the same cube. Figures that need a
          live query — the full complaint-type table, the per-board map — are omitted here
          rather than estimated.
        </div>
      )}
    </div>
  )
}
