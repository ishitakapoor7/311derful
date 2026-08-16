import { useEffect, useRef, useState } from 'react'
import type { ConfigResponse, InputSource } from '../types/api'
import { isRecognitionSupported, startDictation, type DictationSession } from '../lib/speech'
import { startVapiDictation } from '../lib/vapi'

/**
 * The locale SpeechRecognition listens in.
 *
 * Web Speech cannot detect the spoken language -- it has to be told before it
 * listens -- and there is no picker any more, so dictation is English-only.
 * Typing is not: the request carries no language at all, and the backend detects
 * one from the text, so a complaint typed in any language still gets an answer
 * back in that language.
 */
const DICTATION_LANG = 'en-US'

interface Props {
  config: ConfigResponse | null
  busy: boolean
  /**
   * Seeds the fields once, at mount -- for a query that arrived in the URL from
   * a demo link or a shared permalink, so it can be edited and re-asked rather
   * than retyped. Later changes are ignored on purpose: after mount the fields
   * belong to whoever is typing in them. An example chip, which is an explicit
   * request to replace what is in the box, remounts this to reseed it.
   */
  initialText?: string
  initialAddress?: string
  /**
   * The backend asked a clarifying question and this is the answer to it.
   * Changes only the wording -- the input, the mic and the submit path are the
   * same ones the first complaint went through.
   */
  awaitingAnswer?: boolean
  onSubmit: (text: string, source: InputSource, address: string | null, lang: string | null) => void
}

/**
 * Text area and mic side by side — never mic-only.
 *
 * The mic is shown only when voice_mode allows it AND the browser supports
 * SpeechRecognition (state 6: never block on voice).
 */
export function AskInput({
  config,
  busy,
  initialText,
  initialAddress,
  awaitingAnswer = false,
  onSubmit,
}: Props) {
  const [text, setText] = useState(initialText ?? '')
  const [address, setAddress] = useState(initialAddress ?? '')
  const [listening, setListening] = useState(false)
  // Vapi negotiates a call before it can hear anything, which takes a few
  // seconds. Saying "listening" during that window invites someone to start
  // talking into a mic that is not open yet.
  const [connecting, setConnecting] = useState(false)
  const [interim, setInterim] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const session = useRef<DictationSession | null>(null)

  const voiceMode = config?.voice_mode ?? 'off'
  // The mic renders only when dictation will actually work. A mic that appears
  // and then explains in an error box that it is not wired up is worse than no
  // mic at all -- especially on stage.
  //
  // Each mode has its own liveness test: Web Speech needs the browser API,
  // Vapi needs the keys the backend serves. Checking `voice_mode` alone would
  // put a dead mic on screen whenever either is missing.
  const canDictate = voiceMode === 'webspeech' && isRecognitionSupported()
  const canCall = voiceMode === 'vapi' && !!config?.vapi_public_key && !!config?.vapi_assistant_id
  const showMic = canDictate || canCall

  useEffect(() => () => session.current?.stop(), [])

  // Geolocation is requested only when the location button is pressed. Firing it
  // on mount drops a browser permission dialog over the first screen, which is
  // the last thing anyone wants during a demo. Declining is fine either way --
  // the forecast just answers citywide.

  function useMyLocation() {
    if (!('geolocation' in navigator)) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAddress(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`)
        setLocating(false)
      },
      () => setLocating(false),
      { timeout: 8000 },
    )
  }

  // Shared by both engines: each reports the whole utterance so far, never just
  // the newest fragment, so the textarea is always the full thought.
  const handlers = {
    onInterim: (t: string) => setInterim(t),
    onFinal: (t: string) => setText(t),
    onError: (message: string) => {
      setVoiceError(message)
      setConnecting(false)
      setListening(false)
    },
    onEnd: () => {
      setConnecting(false)
      setListening(false)
      setInterim('')
    },
  }

  async function toggleMic() {
    if (listening || connecting) {
      session.current?.stop()
      setConnecting(false)
      return
    }
    setVoiceError(null)
    setInterim('')

    if (canCall) {
      setConnecting(true)
      const call = await startVapiDictation(config!.vapi_public_key!, config!.vapi_assistant_id!, {
        ...handlers,
        // The call is up; only now can it hear.
        onListening: () => {
          setConnecting(false)
          setListening(true)
        },
      })
      if (call) {
        session.current = call
      } else {
        // startVapiDictation has already reported why through onError.
        setConnecting(false)
      }
      return
    }

    const started = startDictation(DICTATION_LANG, handlers)
    if (started) {
      session.current = started
      setListening(true)
    } else {
      setVoiceError('Voice input could not start. You can still type.')
    }
  }

  function submit() {
    const value = text.trim()
    if (!value || busy) return
    session.current?.stop()
    // No language is sent: the backend detects it from the text, which is more
    // reliable than a picker the person may never have touched.
    onSubmit(value, listening ? 'voice' : 'text', address.trim() || null, null)
    // Empty the box for the next turn. What was just said is not lost -- it is
    // in the transcript above, which is where the conversation lives now.
    setText('')
    setInterim('')
  }

  return (
    <div>
      <div className="field card card-outer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          placeholder={
            awaitingAnswer
              ? 'Answer in any language — speak it or type it'
              : 'Describe the problem in your own words — any language. e.g. my radiator has been cold for three days'
          }
          aria-label={awaitingAnswer ? 'Answer the question' : 'Describe the problem'}
          disabled={busy}
        />
        <div className="field-bar">
          {showMic && (
            <button
              className="mic"
              onClick={toggleMic}
              data-listening={listening}
              data-connecting={connecting}
              aria-pressed={listening}
              aria-busy={connecting}
              aria-label={
                connecting ? 'Connecting' : listening ? 'Stop dictation' : 'Start dictation'
              }
              title={
                connecting
                  ? 'Connecting…'
                  : listening
                    ? 'Stop dictation'
                    : 'Speak instead of typing'
              }
              disabled={busy}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
                  fill="currentColor"
                />
                <path
                  d="M19 11a7 7 0 0 1-14 0M12 18v3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}

          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address or ZIP (optional)"
            aria-label="Address or ZIP"
            disabled={busy}
            style={{ flex: '1 1 160px', minWidth: 0 }}
          />

          {/* A crosshair, not a map pin: this fills the field with where you
              are now, rather than marking a place on a map. aria-label carries
              the name because the glyph it replaces was not one. */}
          <button
            className="btn btn-sm btn-ghost locate"
            onClick={useMyLocation}
            disabled={busy || locating}
            aria-label={locating ? 'Finding your location' : 'Use my location'}
            title={locating ? 'Finding your location…' : 'Use my location'}
            data-locating={locating}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <path
                d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="spacer" />

          <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? 'Checking…' : awaitingAnswer ? 'Send' : 'Check the odds'}
          </button>
        </div>
      </div>

      {/* What is actually true depends on which engine is live, so the claim
          does too. Vapi's transcriber detects the spoken language; Web Speech
          cannot, and is pinned to DICTATION_LANG -- promising "speak any
          language" there would be a promise the mic cannot keep. Typing is
          multilingual either way: the backend detects the language from the
          text and answers in it. */}
      <p className="multilingual">
        <span aria-hidden="true">🌐</span>{' '}
        {canCall ? (
          <>
            <strong>Speak or type in any language</strong> — हिन्दी, Español, 中文, বাংলা, Kreyòl,
            العربية. You get the answer back in the language you asked in.
          </>
        ) : canDictate ? (
          <>
            <strong>Type in any language</strong> — हिन्दी, Español, 中文, বাংলা. The answer comes
            back in the language you asked in. Dictation listens in English.
          </>
        ) : (
          <>
            <strong>Type in any language</strong> — हिन्दी, Español, 中文, বাংলা. The answer comes
            back in the language you asked in.
          </>
        )}
      </p>

      {listening && interim && (
        <div className="interim" aria-live="polite">
          {interim}
        </div>
      )}
      {listening && !interim && (
        <div className="interim" aria-live="polite">
          Listening…
        </div>
      )}
      {voiceError && (
        <div className="interim" style={{ borderLeftColor: 'var(--warn)' }} role="status">
          {voiceError}
        </div>
      )}
    </div>
  )
}
