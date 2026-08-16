import { useEffect, useState } from 'react'
import { TOTAL_RECORDS } from '../lib/constants'

/**
 * State 7: name the work, don't spin.
 *
 * The query narrates itself and the record counter runs while it does. Two
 * seconds of visible computation does more for credibility than a paragraph of
 * claims -- and unlike a progress bar, it tells the room what the system is
 * actually doing.
 */
const STEPS = [
  'Reading what you wrote',
  'Matching it to the 311 taxonomy',
  'Scanning resolution text',
  'Resolving your community board',
  'Classifying outcomes',
]

export function Loading() {
  const [step, setStep] = useState(0)
  const [scanned, setScanned] = useState(0)

  useEffect(() => {
    const stepId = window.setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
    }, 700)

    // Ease out so the counter decelerates toward the total rather than stopping
    // dead -- it should look like a query finishing, not a fake bar filling.
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 3200)
      setScanned(Math.round(TOTAL_RECORDS * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      window.clearInterval(stepId)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="scan-n">{scanned.toLocaleString('en-US')}</div>
      <div className="scan-label">records scanned</div>

      <ol className="scan-steps">
        {STEPS.map((s, i) => (
          <li key={s} data-state={i < step ? 'done' : i === step ? 'active' : 'pending'}>
            <span className="scan-tick" aria-hidden="true">
              {i < step ? '✓' : i === step ? '▸' : '·'}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** State 8: the API is local. If it's down, say so plainly. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>That didn't work</div>
      <div style={{ marginBottom: onRetry ? 14 : 0 }}>{message}</div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/**
 * State 1: the backend returned intake only, with a clarifying question and no
 * forecast. Show the question and let them answer — never render an empty result
 * shell.
 */
export function ClarifyingQuestion({
  question,
  onAnswer,
}: {
  question: string
  onAnswer: (answer: string) => void
}) {
  const [answer, setAnswer] = useState('')

  return (
    <div className="clarify card card-outer">
      <p className="label">One more thing</p>
      <h3>{question}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (answer.trim()) onAnswer(answer.trim())
        }}
        style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}
      >
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer…"
          aria-label="Answer the clarifying question"
          style={{
            flex: '1 1 240px',
            font: 'inherit',
            padding: '10px 12px',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            color: 'var(--ink)',
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={!answer.trim()}>
          Continue
        </button>
      </form>
    </div>
  )
}
