import type { ReactNode } from 'react'

/**
 * A supporting detail, folded away until asked for.
 *
 * Native <details> rather than a state hook: it is keyboard-operable, it is
 * findable by the browser's own in-page search even while collapsed, and it
 * needs no JavaScript to open. That last part matters here -- everything behind
 * one of these is a provenance or honesty detail, and a disclosure that fails
 * closed would quietly hide the sample size the whole product rests on.
 */
export function Disclosure({
  summary,
  children,
  className = '',
}: {
  summary: string
  children: ReactNode
  className?: string
}) {
  return (
    <details className={`disclosure ${className}`.trim()}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
