import type { OutcomeClass, OutcomeShare } from '../types/api'
import { isActionableFailure, outcomeBlurb, outcomeGroup, outcomeLabel } from '../lib/outcomes'
import { count, days, pct } from '../lib/format'

interface Props {
  outcomes: OutcomeShare[]
  /** Outcomes a tip targets — highlighted so advice ties back to the evidence. */
  targeted?: OutcomeClass[]
}

/**
 * The hero element. This is what makes "closing isn't fixing" legible in a glance.
 *
 * Each row carries its own median days to close, because the overall average is a
 * vanity metric — the complaints that fail close fastest, and putting those two
 * facts on the same line is the whole argument.
 */
export function OutcomeBars({ outcomes, targeted = [] }: Props) {
  const rows = [...outcomes].sort((a, b) => b.share - a.share)
  const max = Math.max(...rows.map((r) => r.share), 0.0001)

  return (
    <div>
      <div className="bars">
        {rows.map((row) => {
          const group = outcomeGroup(row.outcome)
          const actionable = isActionableFailure(row.outcome)
          return (
            <div
              key={row.outcome}
              className={`bar-row${targeted.includes(row.outcome) ? ' is-targeted' : ''}`}
            >
              <div className="bar-name">{outcomeLabel(row.outcome)}</div>
              <div className="bar-figs">
                <span className="pct">{pct(row.share)}</span>
                <br />
                {count(row.count)} · {days(row.median_days_to_close)}
              </div>
              <div className="bar-blurb">{outcomeBlurb(row.outcome)}</div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  data-group={group}
                  data-actionable={actionable}
                  style={{ width: `${(row.share / max) * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'var(--resolved)' }} /> problem addressed
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--failure)' }} /> closed without fixing it
        </span>
        <span>
          <i
            className="swatch"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-45deg, rgba(255,255,255,.5) 0 3px, transparent 3px 7px)',
              backgroundColor: 'var(--failure)',
            }}
          />{' '}
          hatched = you can change these odds
        </span>
        <span>
          <i
            className="swatch"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--neutral) 0 4px, transparent 4px 8px)',
              border: '1px solid var(--neutral)',
            }}
          />{' '}
          still open / unclassified
        </span>
      </div>

      <div className="mono muted" style={{ marginTop: 10 }}>
        Each row shows its own median time to close. Note which ones close fastest.
      </div>
    </div>
  )
}
