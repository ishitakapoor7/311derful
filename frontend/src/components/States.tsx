/**
 * State 7: say we are working, and nothing more.
 *
 * This used to narrate a five-step query and run a counter up to the full 22M
 * corpus. It was the one place the UI asserted something it could not support:
 * a request that comes back with a clarifying question never touches the cube,
 * so the counter was claiming a scan that had not happened. The numbers belong
 * in the result, where they are measured, not in the wait.
 */
export function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="thinking">Analyzing</span>
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

/*
 * `ClarifyingQuestion` used to live here: a text-only box that appeared under
 * the result and took the answer. It is gone on purpose. A follow-up is a turn
 * in the conversation, so it belongs in the transcript with every other turn,
 * and it is answered through the same composer -- which is what gives a
 * follow-up the microphone it never had as a separate widget.
 */
