import { useEffect, useRef, useState } from 'react'
import type { ConfigResponse, InputSource } from '../types/api'
import { isRecognitionSupported, startDictation, type DictationSession } from '../lib/speech'

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
   * Seeds the box once, at mount -- for a query that arrived in the URL from the
   * landing hero, a demo link or a shared permalink, so it can be edited and
   * re-asked rather than retyped. Later changes are ignored on purpose: after
   * mount the textarea belongs to whoever is typing in it.
   */
  initialText?: string
  onSubmit: (text: string, source: InputSource, address: string | null, lang: string | null) => void
}

/**
 * Text area and mic side by side — never mic-only.
 *
 * The mic is shown only when voice_mode allows it AND the browser supports
 * SpeechRecognition (state 6: never block on voice).
 */
export function AskInput({ config, busy, initialText, onSubmit }: Props) {
  const [text, setText] = useState(initialText ?? '')
  const [address, setAddress] = useState('')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const session = useRef<DictationSession | null>(null)

  const voiceMode = config?.voice_mode ?? 'off'
  // The mic renders only when dictation will actually work. A mic that appears
  // and then explains in an error box that it is not wired up is worse than no
  // mic at all -- especially on stage.
  const showMic = voiceMode === 'webspeech' && isRecognitionSupported()

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

  function toggleMic() {
    if (listening) {
      session.current?.stop()
      return
    }
    setVoiceError(null)
    setInterim('')
    const started = startDictation(DICTATION_LANG, {
      onInterim: (t) => setInterim(t),
      onFinal: (t) => setText(t),
      onError: (message) => {
        setVoiceError(message)
        setListening(false)
      },
      onEnd: () => {
        setListening(false)
        setInterim('')
      },
    })
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
          placeholder="Describe the problem in your own words — any language. e.g. my radiator has been cold for three days"
          aria-label="Describe the problem"
          disabled={busy}
        />
        <div className="field-bar">
          {showMic && (
            <button
              className="mic"
              onClick={toggleMic}
              data-listening={listening}
              aria-pressed={listening}
              aria-label={listening ? 'Stop dictation' : 'Start dictation'}
              title={listening ? 'Stop dictation' : 'Speak instead of typing'}
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
            {busy ? 'Checking…' : 'Check the odds'}
          </button>
        </div>
      </div>

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
