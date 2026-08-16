import { useEffect, useRef, useState } from 'react'
import type { ConfigResponse, InputSource } from '../types/api'
import { isRecognitionSupported, startDictation, type DictationSession } from '../lib/speech'

interface Props {
  config: ConfigResponse | null
  busy: boolean
  onSubmit: (text: string, source: InputSource, address: string | null, lang: string) => void
}

/**
 * Text area and mic side by side — never mic-only.
 *
 * The mic is shown only when voice_mode allows it AND the browser supports
 * SpeechRecognition (state 6: never block on voice). The language picker appears
 * only for webspeech, because Web Speech cannot auto-detect the spoken language
 * while Vapi's transcriber can.
 */
export function AskInput({ config, busy, onSubmit }: Props) {
  const [text, setText] = useState('')
  const [address, setAddress] = useState('')
  const [lang, setLang] = useState('en-US')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const session = useRef<DictationSession | null>(null)

  const voiceMode = config?.voice_mode ?? 'off'
  // The mic renders only when dictation will actually work. A mic that appears
  // and then explains in an error box that it is not wired up is worse than no
  // mic at all -- especially on stage.
  const canDictate = voiceMode === 'webspeech' && isRecognitionSupported()
  const showMic = canDictate
  const showLangPicker = canDictate

  useEffect(() => {
    if (config?.languages?.length) setLang(config.languages[0].tag)
  }, [config])

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
    const started = startDictation(lang, {
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
    onSubmit(value, listening ? 'voice' : 'text', address.trim() || null, lang)
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

          {showLangPicker && config && (
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Spoken language"
              disabled={busy}
            >
              {config.languages.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.label}
                </option>
              ))}
            </select>
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
