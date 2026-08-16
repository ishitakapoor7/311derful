/**
 * Vapi dictation, shaped exactly like the Web Speech path in `speech.ts`.
 *
 * `voice_mode` is a backend decision, so the component that renders the mic
 * should not care which engine is behind it. This exports the same
 * `DictationSession` that `startDictation` returns and drives the same
 * `DictationHandlers`, which keeps the branching in AskInput down to picking a
 * starter rather than running two parallel implementations of the input.
 *
 * We use Vapi purely as a transcriber. The assistant's own LLM is muted the
 * moment the call connects: it would otherwise answer in its own words,
 * ungrounded in the cube, alongside the answer we compute. Every number this
 * app says has to come from the data.
 */

import type { DictationHandlers, DictationSession } from './speech'

/** Hang up a silent call. An open call bills by the minute. */
const IDLE_HANGUP_MS = 30_000

export interface VapiDictationHandlers extends DictationHandlers {
  /**
   * The call is connected and the mic can actually hear.
   *
   * Vapi takes several seconds to negotiate, and a button that says "listening"
   * before then is lying at the exact moment someone is speaking into it.
   */
  onListening: () => void
}

/** A stored "Block" for the microphone on this origin. */
async function micBlocked(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    return status.state === 'denied'
  } catch {
    // Firefox and Safari do not expose this query. Let the call try.
    return false
  }
}

export const MIC_BLOCKED_MESSAGE =
  'Microphone is blocked for this site. Click the icon at the left of the address ' +
  'bar → Microphone → Allow, then reload. You can still type.'

/**
 * Vapi's user-transcript messages. Narrower than the SDK's union, which covers
 * every server event; this is the only shape we act on.
 */
interface TranscriptMessage {
  type?: string
  role?: string
  transcriptType?: 'partial' | 'final'
  transcript?: string
}

export async function startVapiDictation(
  publicKey: string,
  assistantId: string,
  handlers: VapiDictationHandlers,
): Promise<DictationSession | null> {
  if (await micBlocked()) {
    handlers.onError(MIC_BLOCKED_MESSAGE)
    return null
  }

  // Loaded on demand so the SDK stays out of the bundle for everyone running
  // the webspeech path, which is most people.
  let Vapi: typeof import('@vapi-ai/web').default
  try {
    Vapi = (await import('@vapi-ai/web')).default
  } catch {
    handlers.onError('Voice failed to load. You can still type.')
    return null
  }

  const vapi = new Vapi(publicKey)

  /**
   * Ending a call ejects us from the underlying Daily room, which surfaces as
   * an error immediately afterwards. That is the call working, not failing, and
   * it must not overwrite what is on screen.
   */
  let endingByUs = false

  /**
   * A `final` transcript does NOT mean the speaker is done -- the transcriber
   * emits one at every endpoint, so a single sentence arrives as several
   * ("Okay. Um." / "He." / "Do."). Accumulate them and always report the whole
   * utterance, which is the contract `startDictation` follows too.
   */
  const settled: string[] = []
  const joined = () => settled.join(' ').replace(/\s+/g, ' ').trim()

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      endingByUs = true
      vapi.stop()
    }, IDLE_HANGUP_MS)
  }

  vapi.on('call-start', () => {
    endingByUs = false
    vapi.send({ type: 'control', control: 'mute-assistant' })
    handlers.onListening()
    resetIdle()
  })

  vapi.on('speech-start', resetIdle)

  vapi.on('message', (message: TranscriptMessage) => {
    if (message?.type !== 'transcript' || message.role !== 'user') return
    const text = message.transcript
    if (!text) return

    if (message.transcriptType === 'partial') {
      handlers.onInterim([...settled, text].join(' ').replace(/\s+/g, ' ').trim())
      return
    }
    settled.push(text)
    handlers.onFinal(joined())
  })

  vapi.on('error', (error: unknown) => {
    if (endingByUs) return
    const detail =
      error instanceof Error ? error.message : typeof error === 'string' ? error : null
    handlers.onError(
      detail ? `Voice input failed (${detail}). You can still type.` : 'Voice input failed. You can still type.',
    )
  })

  vapi.on('call-end', () => {
    if (idleTimer) clearTimeout(idleTimer)
    handlers.onEnd()
  })

  try {
    await vapi.start(assistantId)
  } catch {
    if (idleTimer) clearTimeout(idleTimer)
    handlers.onError('Could not start voice. You can still type.')
    return null
  }

  return {
    // Stop means stop, not discard: the words already recognised stay in the
    // textarea to be read, corrected, and sent with the Ask button.
    stop: () => {
      endingByUs = true
      if (idleTimer) clearTimeout(idleTimer)
      try {
        vapi.stop()
      } catch {
        // Already stopped.
      }
    },
  }
}
