import type { Tip } from '../types/api'
import { outcomeLabel } from '../lib/outcomes'

/**
 * Tips come from a rules table keyed on outcome class, not from the model — the
 * model only translates and phrases them. Each one names the outcome it targets
 * so the advice is traceable back to the bar it is trying to move.
 */
export function Tips({ tips }: { tips: Tip[] }) {
  if (tips.length === 0) return null

  return (
    <div className="tips">
      {tips.map((tip, i) => (
        <div className="tip" key={`${tip.targets_outcome}-${i}`}>
          <div className="idx">{String(i + 1).padStart(2, '0')}</div>
          <div>
            <div style={{ fontWeight: 600 }}>{tip.text}</div>
            <div className="targets">Targets: {outcomeLabel(tip.targets_outcome)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
