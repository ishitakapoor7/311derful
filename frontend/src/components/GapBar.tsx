import { pct } from '../lib/format'

interface Props {
  resolvedShare: number
  label: string
  /** Rendered small under the bar. */
  caption?: string
}

/**
 * The gap, not the metric.
 *
 * A number in a bordered box reads as a statistic. The same number as a filled
 * bar with the unfixed remainder blocked out in dark red reads as a finding, and
 * it is the object the whole pitch rests on: everything closed, a quarter fixed.
 */
export function GapBar({ resolvedShare, label, caption }: Props) {
  const failedShare = 1 - resolvedShare

  return (
    <div className="gap">
      <div className="gap-head">
        <span className="gap-closed">100% closed</span>
        <span className="gap-rule" aria-hidden="true" />
      </div>

      <div
        className="gap-bar"
        role="img"
        aria-label={`${pct(resolvedShare)} of ${label} were actually addressed; ${pct(failedShare)} closed without the problem being fixed`}
      >
        <div className="gap-fixed" style={{ width: `${resolvedShare * 100}%` }}>
          <span className="gap-fixed-n">{pct(resolvedShare)}</span>
        </div>
        <div className="gap-failed" style={{ width: `${failedShare * 100}%` }}>
          <span className="gap-failed-n">{pct(failedShare)}</span>
        </div>
      </div>

      <div className="gap-legend">
        <span>
          <i className="gap-swatch gap-swatch-fixed" /> actually fixed
        </span>
        <span>
          <i className="gap-swatch gap-swatch-failed" /> closed, problem still there
        </span>
      </div>

      {caption && <div className="gap-caption">{caption}</div>}
    </div>
  )
}
