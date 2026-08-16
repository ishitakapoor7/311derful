import { useEffect, useState } from 'react'
import type { ConfigResponse } from '../types/api'
import { getConfig } from '../api/client'
import { isRecognitionSupported } from './speech'
import { FALLBACK_LANGUAGES } from './constants'

/**
 * `/api/config`, with the fallback every screen that renders an input needs.
 *
 * Voice is optional, so a missing config must not block the text path. `off`
 * would be the wrong default, though: it is the backend's way of saying "do not
 * offer voice", and a failed call is not the backend saying anything -- while
 * Web Speech runs entirely in the browser and needs no API at all. So an
 * unreachable backend hides the mic only when the browser could not have done
 * it anyway.
 */
export function useConfig(): ConfigResponse | null {
  const [config, setConfig] = useState<ConfigResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    getConfig()
      .catch(
        (): ConfigResponse => ({
          voice_mode: isRecognitionSupported() ? 'webspeech' : 'off',
          languages: FALLBACK_LANGUAGES,
          llm_configured: true,
        }),
      )
      .then((c) => {
        if (!cancelled) setConfig(c)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return config
}
