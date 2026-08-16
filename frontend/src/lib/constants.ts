/**
 * Last measured figures for the dataset itself.
 *
 * These are not placeholders: every one was computed over the full ingest and is
 * published in the repo README. They exist so the landing page renders a real
 * finding before /api/explore answers — and still renders one if it never does.
 * Whenever the live call lands, the screen switches to what the backend just
 * measured, so these only ever go stale in the offline case.
 */

/** VERIFIED: full dataset, NYC Open Data, Jan 2020 – Aug 2026. */
export const TOTAL_RECORDS = 22_145_244

export const DATA_RANGE = '2020–2026'

/**
 * What the UI assumes the backend supports when /api/config cannot be reached.
 *
 * Nothing renders these any more -- there is no language picker, dictation runs
 * in one fixed locale, and the backend detects the language from the text. They
 * stay because `ConfigResponse.languages` is part of the API contract and the
 * offline fallback has to satisfy it.
 */
export const FALLBACK_LANGUAGES = [
  { tag: 'en-US', label: 'English' },
  { tag: 'es-ES', label: 'Español' },
  { tag: 'zh-CN', label: '中文' },
  { tag: 'bn-BD', label: 'বাংলা' },
  { tag: 'ru-RU', label: 'Русский' },
  { tag: 'ht-HT', label: 'Kreyòl Ayisyen' },
  { tag: 'ar-SA', label: 'العربية' },
  { tag: 'fr-FR', label: 'Français' },
]

/** The same window in the machine voice the landing telemetry block speaks in. */
export const DATA_WINDOW = 'JAN 2020 — AUG 2026'

/**
 * VERIFIED: reported per year, never as a single average, because one number
 * can hide a collapse on retired templates. The range is the honest form.
 */
export const CLASSIFIER_COVERAGE = '92.9–94.4%'

/**
 * VERIFIED: PLUMBING (HPD), citywide, trailing three years, classified records
 * only. The worst of the six complaint types measured in the README, and what
 * the landing page shows until /api/explore names the current worst itself.
 */
export const HERO_FALLBACK = {
  complaint_type: 'PLUMBING',
  agency: 'HPD',
  total: 214_581,
  resolved_share: 0.242,
  dominant_failure: 'NOTHING_FOUND' as const,
  dominant_failure_share: 0.34,
}
