import type { AskResponse } from '../types/api'

/**
 * Full `/api/ask` responses, keyed by the history entry they produced.
 *
 * The reason this exists: the backend stores history denormalised — headline
 * share, sample size, tier, narrative, draft — but no `outcomes[]`, so a history
 * entry alone cannot redraw the bars. Without a cache, reopening a past complaint
 * means re-running `/api/ask`, which is two model calls and several seconds for
 * an answer we already had. Keeping the response here makes reopening a
 * localStorage read.
 *
 * Same trust boundary as history itself: this never leaves the browser, and it is
 * cleared alongside the entries it belongs to.
 */

const KEY = '311derful.results'

/** A session's worth of clicking, without crowding the storage quota. */
const LIMIT = 25

interface CachedResult {
  id: string
  response: AskResponse
}

function read(): CachedResult[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as CachedResult[]) : []
  } catch {
    return []
  }
}

function write(entries: CachedResult[]): void {
  const capped = entries.slice(0, LIMIT)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(capped))
  } catch {
    // Over quota: keep the newest few rather than losing the cache wholesale. A
    // miss only costs a re-run, so failing quietly here is safe.
    try {
      window.localStorage.setItem(KEY, JSON.stringify(capped.slice(0, 5)))
    } catch {
      // Storage unavailable entirely. History still works; opening an entry
      // falls back to what the entry itself stores.
    }
  }
}

export function cacheResult(entryId: string, response: AskResponse): void {
  write([{ id: entryId, response }, ...read().filter((e) => e.id !== entryId)])
}

export function readCachedResult(entryId: string): AskResponse | null {
  return read().find((e) => e.id === entryId)?.response ?? null
}

export function dropCachedResult(entryId: string): void {
  write(read().filter((e) => e.id !== entryId))
}

export function clearResultCache(): void {
  write([])
}
