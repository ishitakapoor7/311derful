/**
 * Web Speech wrappers.
 *
 * Two hard rules from the frontend plan:
 *  - Never block on voice. If SpeechRecognition is missing, the mic is hidden and
 *    everything else keeps working (state 6).
 *  - Web Speech cannot auto-detect the spoken language, so the caller must supply
 *    a BCP-47 tag. That is why voice_mode 'webspeech' shows a language picker and
 *    'vapi' does not.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
  length: number
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null
}

export function isSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export interface DictationHandlers {
  /** Fires continuously while speaking -- this is what makes the wait feel like nothing. */
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}

export interface DictationSession {
  stop: () => void
}

export function startDictation(lang: string, handlers: DictationHandlers): DictationSession | null {
  const Ctor = getRecognitionCtor()
  if (!Ctor) return null

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let finalText = ''

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const transcript = result[0].transcript
      if (result.isFinal) {
        finalText += transcript
      } else {
        interim += transcript
      }
    }
    if (interim) handlers.onInterim((finalText + interim).trim())
    if (finalText) handlers.onFinal(finalText.trim())
  }

  recognition.onerror = (event) => {
    const message =
      event.error === 'not-allowed'
        ? 'Microphone permission was denied. You can still type.'
        : event.error === 'no-speech'
          ? "Didn't catch that — try again."
          : `Voice input failed (${event.error}). You can still type.`
    handlers.onError(message)
  }

  recognition.onend = () => handlers.onEnd()

  try {
    recognition.start()
  } catch {
    return null
  }

  return {
    stop: () => {
      try {
        recognition.stop()
      } catch {
        // Already stopped.
      }
    },
  }
}

let currentUtterance: SpeechSynthesisUtterance | null = null

/**
 * Reads text aloud. The caveat on a LOW-confidence forecast is spoken first, not
 * trailed, because a thin-sample number presented as a prediction is the worst
 * thing this app can do.
 */
export function speak(text: string, lang: string, onDone?: () => void): void {
  if (!isSynthesisSupported() || !text.trim()) {
    onDone?.()
    return
  }
  cancelSpeech()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 1.0

  const match = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()))
  if (match) utterance.voice = match

  utterance.onend = () => {
    currentUtterance = null
    onDone?.()
  }
  utterance.onerror = () => {
    currentUtterance = null
    onDone?.()
  }

  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
}

export function cancelSpeech(): void {
  if (!isSynthesisSupported()) return
  window.speechSynthesis.cancel()
  currentUtterance = null
}

export function isSpeaking(): boolean {
  return currentUtterance !== null
}
