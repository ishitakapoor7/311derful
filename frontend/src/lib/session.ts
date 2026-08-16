const KEY = '311derful.session_id'

/**
 * Stable per-browser id so /api/history can return this person's past complaints.
 * Deliberately not tied to any account -- there is no login in this product.
 */
export function getSessionId(): string {
  let id = ''
  try {
    id = window.localStorage.getItem(KEY) ?? ''
  } catch {
    // Private browsing with storage disabled: fall through to an ephemeral id.
  }
  if (!id) {
    id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    try {
      window.localStorage.setItem(KEY, id)
    } catch {
      // Non-fatal: history simply will not persist across reloads.
    }
  }
  return id
}
