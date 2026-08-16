import { useEffect, useState } from 'react'
import type { ExploreResponse, ExploreRow } from '../types/api'
import { getExplore } from '../api/client'
import { navigate } from '../lib/router'
import { asFraction, count, pct, pctShort } from '../lib/format'
import { outcomeLabel } from '../lib/outcomes'
import {
  CLASSIFIER_COVERAGE,
  DATA_RANGE,
  DATA_WINDOW,
  HERO_FALLBACK,
  TOTAL_RECORDS,
} from '../lib/constants'
import { GapBar } from '../components/GapBar'
import { CityMap } from '../components/CityMap'

/**
 * One screen. Its only job is to make someone believe there is a real finding
 * here before they type anything -- so the intake field lives on the Ask screen,
 * not here, and this page carries the argument for going there.
 *
 * The hero stat is not written into this file. It comes from /api/explore, the
 * same query the Explore table runs, and moves when the ingest does.
 * `constants.ts` holds the last measured figures and carries the page until the
 * call lands (or if it never does).
 */

/**
 * The worst-performing of the complaint types people actually file. Restricted
 * to the high-volume end because "the single lowest resolved share citywide"
 * would reliably surface some 40-record category, which is a sampling artifact
 * rather than a finding.
 */
function heroRow(rows: ExploreRow[]): ExploreRow {
  const common = [...rows].sort((a, b) => b.total - a.total).slice(0, 12)
  if (common.length === 0) return HERO_FALLBACK
  return common.reduce((worst, r) => (r.resolved_share < worst.resolved_share ? r : worst))
}

/**
 * One tap into a real forecast, for the large majority of people who will not
 * type anything into a box they have never used before. They land on the Ask
 * screen with the query already running.
 *
 * These are phrased the way somebody actually describes the problem, not the way
 * 311 files it -- mapping "my radiator has been cold" onto HEAT/HOT WATER →
 * ENTIRE BUILDING is the thing being demonstrated. One is in Spanish because a
 * chip in another language proves the multilingual claim faster than a sentence
 * saying so, and it is the shortest path to a non-English demo on stage.
 */
const EXAMPLES: { label: string; text: string; address: string | null }[] = [
  {
    label: 'Cold radiator',
    text: 'my radiator has been cold for three days',
    address: '10457',
  },
  {
    label: 'Ceiling leak',
    text: 'water is leaking from my bathroom ceiling',
    address: null,
  },
  {
    label: 'Basura en la acera',
    text: 'hay basura acumulada en la acera frente a mi edificio',
    address: null,
  },
  {
    label: 'Blocked hydrant',
    text: 'a car has been parked in front of the fire hydrant on my block for days',
    address: null,
  },
]

export function Landing() {
  const [data, setData] = useState<ExploreResponse | null>(null)

  useEffect(() => {
    // The landing page must render with or without the API, so a failure here is
    // silent: the committed figures below are the fallback, not a placeholder.
    getExplore(40)
      .then(setData)
      .catch(() => undefined)
  }, [])

  const totalRecords = data?.total_records ?? TOTAL_RECORDS
  const millions = Math.round(totalRecords / 1_000_000)
  const hero = data ? heroRow(data.rows) : HERO_FALLBACK
  // Coverage is a live figure when the API answers and a per-year range when it
  // does not. The range is never presented as a single average either way.
  const coverage = data ? pct(data.classified_share, 1) : CLASSIFIER_COVERAGE

  /**
   * The landing page never runs a forecast itself -- it hands the query to the
   * Ask screen, which owns the intake field, history, the result views and every
   * failure state, and auto-fires whatever arrives in the URL.
   */
  function runExample(text: string, address: string | null) {
    const params = new URLSearchParams({ q: text })
    if (address) params.set('addr', address)
    navigate('ask', params.toString())
  }

  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="wrap lp-hero-in">
          {/* Each column is one grid item. Letting the blocks be grid items in
              their own right makes the taller column stretch the other's rows,
              which opens a hole the height of the map between the headline and
              the copy. */}
          <div className="lp-left">
            <p className="lp-eyebrow">FREE · NO_SIGN_IN · ANY_LANGUAGE</p>

            <h1 className="lp-headline">
              Before you file a 311 complaint, see <em>what usually happens</em> to it.
            </h1>

            <p className="lede">
              Describe the problem in your own words — any language. You'll get the real odds for
              your area, why complaints like yours usually fail, and a draft ready to submit.
            </p>

            <div className="lp-actions">
              <button className="btn btn-primary" onClick={() => navigate('ask')}>
                Run forecast
              </button>
              <span className="lp-or">
                Or browse{' '}
                <button className="linklike" onClick={() => navigate('explore')}>
                  Citywide_data
                </button>
              </span>
            </div>

            {/* Zero-typing entry. Also what keeps the demo alive when the mic,
                the wifi or a nervous hand misbehaves. */}
            <div className="lp-examples" role="group" aria-label="Example complaints">
              <span className="lp-examples-key">TRY:</span>
              {EXAMPLES.map((e) => (
                <button
                  key={e.label}
                  className="lp-example"
                  /* The short label is the accessible name; the sentence that
                     will actually be submitted is on hover, so nobody is
                     surprised by what the chip asked on their behalf. */
                  title={e.text}
                  onClick={() => runExample(e.text, e.address)}
                >
                  {e.label}
                </button>
              ))}
            </div>

            {/* Said before the tool is used, not in the small print under a
                result: NYC has no public write API for 311, and the product's
                output is a draft. */}
            <p className="lp-hero-note">
              We can't file it for you — NYC has no public write API for 311. What you get is a
              draft to submit yourself.
            </p>
          </div>

          <aside className="lp-right">
            <CityMap />

            {/* The instrument panel: what was read, over what window, and how
                much of it the classifier could actually account for. */}
            <div className="lp-telemetry">
              <div className="lp-tel-row">
                <span className="lp-tel-key">RECORDS:</span>
                <span className="lp-tel-val">{count(totalRecords)}</span>
              </div>
              <div className="lp-tel-row">
                <span className="lp-tel-key">WINDOW:</span>
                <span className="lp-tel-val">{DATA_WINDOW}</span>
              </div>
              <div className="lp-tel-foot">CLASSIFIER_COVERAGE {coverage}</div>
            </div>
          </aside>
        </div>
      </section>

      <div className="wrap lp-below stack">
        {/* ---- the finding ---- */}
        <section>
          <p className="label">Service_outcomes — not complaint_volume</p>

          <div className="lp-finding">
            <p className="lp-finding-claim">
              <span className="lp-finding-n">{pctShort(hero.resolved_share)}</span> of{' '}
              {hero.agency} {hero.complaint_type.toLowerCase()} complaints end with the problem
              addressed — {asFraction(hero.resolved_share)}. The rest are closed anyway.
            </p>

            {/* The number restated as the gap it describes. Everything below
                closed; only the left segment was actually fixed. */}
            <div className="lp-finding-bar">
              <GapBar
                resolvedShare={hero.resolved_share}
                label={`${hero.complaint_type.toLowerCase()} complaints`}
                caption="citywide · recent years · classified records only"
              />
            </div>

            <p className="lp-finding-meta">
              n = <strong>{count(hero.total)}</strong>
              {hero.dominant_failure && (
                <>
                  {' '}
                  · most common failure:{' '}
                  <span className="lp-finding-fail">{outcomeLabel(hero.dominant_failure)}</span>
                  {hero.dominant_failure_share !== null && (
                    <> {pctShort(hero.dominant_failure_share)}</>
                  )}
                </>
              )}
            </p>
          </div>

          <p className="lp-prose">
            <code>resolution_description</code> is a templated field in the 311 data that almost
            nobody parses. Classified, it shows that a complaint being <strong>closed</strong> is
            not the same as the problem being <strong>fixed</strong>.
          </p>

          <p className="lp-prose muted">
            Average closure time hides this. Heat complaints in Bronx CB7 in January pool to a
            reassuring 1.5 days — but the fastest closures, at 0.4 days, are the ones that report no
            outcome at all. Closure time is stored and reported per outcome, never pooled.
          </p>
        </section>

        {/* ---- what comes back ---- */}
        <section>
          <p className="label">What_you_get</p>
          <ol className="steps">
            <li>
              <sup>01</sup>
              <span>
                <strong>The odds for your area</strong>
                <em>
                  The full outcome breakdown for your complaint type in your community district,
                  with the sample size and a confidence tier on every figure.
                </em>
              </span>
            </li>
            <li>
              <sup>02</sup>
              <span>
                <strong>Why complaints like yours fail</strong>
                <em>
                  The failure mode that closes them — nobody could get access, nothing was found,
                  filed as a duplicate — and what changes those odds.
                </em>
              </span>
            </li>
            <li>
              <sup>03</sup>
              <span>
                <strong>A draft ready to submit</strong>
                <em>
                  Written in your language, in 311's own vocabulary, answering the failure mode
                  before it happens. You file it — we can't.
                </em>
              </span>
            </li>
          </ol>
        </section>

        {/* ---- why the number can be trusted ---- */}
        <section>
          <p className="label">Why_trust_the_number</p>
          <dl className="lp-why">
            <div className="lp-why-row">
              <dt>NO_MODEL_NUMBERS</dt>
              <dd>
                The model has two jobs: mapping your words onto the 311 taxonomy, and phrasing the
                answer in your language. Every statistic is a precomputed aggregate over{' '}
                {millions}M records, interpolated in as a finished figure.
              </dd>
            </div>
            <div className="lp-why-row">
              <dt>THIN_SAMPLES_LABELLED</dt>
              <dd>
                Eight records is noise. A forecast widens from your district to your borough to
                citywide until it has enough data, and every answer reports the sample size, the
                level it reached, and a confidence tier.
              </dd>
            </div>
            <div className="lp-why-row">
              <dt>COVERAGE_REPORTED</dt>
              <dd>
                {coverage} of records classify. The rest are counted and shown, never quietly folded
                into an outcome — and coverage is reported per year, because one average can hide a
                collapse on retired templates.
              </dd>
            </div>
          </dl>
        </section>

        <div className="cta-banner">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('ask')}>
              Check the odds
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('explore')}>
              See the citywide numbers
            </button>
          </div>

          <div className="trust">
            {count(totalRecords)} complaints · {DATA_RANGE} · NYC Open Data · updated daily
          </div>
        </div>
      </div>
    </div>
  )
}
