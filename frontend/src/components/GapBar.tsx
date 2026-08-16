import { pct } from '../lib/format'

interface Props {
  resolvedShare: number
  label: string
  /** Rendered small under the bar. */
  caption?: string
}

/**
 * Below this share a segment is too thin to hold its own percentage at the
 * sizes this bar uses, so the label is allowed to cross the divide.
 */
const NARROW = 0.3

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
        {/* A share small enough that its own segment cannot hold the number
            lets the number run past the divide instead of being crushed or
            clipped. Both segments are dark and the text is white, so it stays
            legible either side, and .gap-bar's overflow keeps it in the bar. */}
        <div
          className="gap-fixed"
          data-narrow={resolvedShare < NARROW}
          style={{ width: `${resolvedShare * 100}%` }}
        >
          <span className="gap-fixed-n">{pct(resolvedShare)}</span>
        </div>
        <div
          className="gap-failed"
          data-narrow={failedShare < NARROW}
          style={{ width: `${failedShare * 100}%` }}
        >
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
