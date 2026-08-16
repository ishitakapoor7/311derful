import type { OutcomeClass, OutcomeShare } from '../types/api'
import {
  isActionableFailure,
  isResolved,
  outcomeBlurb,
  outcomeGroup,
  outcomeLabel,
} from '../lib/outcomes'
import { count, days, pct } from '../lib/format'
import { Disclosure } from './Disclosure'

interface Props {
  outcomes: OutcomeShare[]
  /** Outcomes a tip targets — highlighted so advice ties back to the evidence. */
  targeted?: OutcomeClass[]
}

/** How many bars stand open. The rest are one click away, never dropped. */
const PREVIEW_ROWS = 4

/**
 * The hero element. This is what makes "closing isn't fixing" legible in a glance.
 *
 * Each row carries its own median days to close, because the overall average is a
 * vanity metric — the complaints that fail close fastest, and putting those two
 * facts on the same line is the whole argument.
 *
 * Eleven rows buried the argument under its own evidence, so only the largest
 * few stand open. Every outcome is still rendered; the tail is folded, not cut,
 * because a chart that silently drops its small slices is exactly the kind of
 * summary this product exists to argue against.
 */
export function OutcomeBars({ outcomes, targeted = [] }: Props) {
  const rows = [...outcomes].sort((a, b) => b.share - a.share)
  const max = Math.max(...rows.map((r) => r.share), 0.0001)

  // The headline percentage is the resolved share, so the outcomes that make it
  // up have to be among the visible bars -- otherwise the open chart reads as
  // all-failure and the number above it has nothing to stand on.
  const preview = new Set(rows.slice(0, PREVIEW_ROWS))
  for (const row of rows) {
    if (isResolved(row.outcome) && row.share > 0) preview.add(row)
  }

  const shown = rows.filter((r) => preview.has(r))
  const hidden = rows.filter((r) => !preview.has(r))

  function renderRow(row: OutcomeShare) {
    const group = outcomeGroup(row.outcome)
    return (
      <div
        key={row.outcome}
        className={`bar-row${targeted.includes(row.outcome) ? ' is-targeted' : ''}`}
      >
        <div className="bar-name" data-group={group}>
          {outcomeLabel(row.outcome)}
        </div>
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
            data-actionable={isActionableFailure(row.outcome)}
            style={{ width: `${(row.share / max) * 100}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="bars">{shown.map(renderRow)}</div>

      {hidden.length > 0 && (
        <Disclosure summary={`Show the other ${hidden.length} outcomes`}>
          <div className="bars">{hidden.map(renderRow)}</div>
        </Disclosure>
      )}

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
      </div>
    </div>
  )
}
