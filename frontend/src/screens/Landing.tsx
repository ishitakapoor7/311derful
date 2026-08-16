import { useEffect, useState } from 'react'
import type { ExploreResponse, ExploreRow } from '../types/api'
import { getExplore } from '../api/client'
import { navigate } from '../lib/router'
import { count, pct, pctShort } from '../lib/format'
import { outcomeLabel } from '../lib/outcomes'
import {
  CLASSIFIER_COVERAGE,
  DATA_RANGE,
  DATA_WINDOW,
  HERO_FALLBACK,
  TOTAL_RECORDS,
} from '../lib/constants'
import { GapBar } from '../components/GapBar'

/**
 * One screen. Its only job is to make someone believe there is a real finding
 * here before they type anything -- so the hero stat is not written into this
 * file. It comes from /api/explore, the same query the Explore table runs, and
 * moves when the ingest does. `constants.ts` holds the last measured figures and
 * carries the page until the call lands (or if it never does).
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

const SKYLINE_W = 1200
const SKYLINE_H = 340

/**
 * The silhouette behind the headline is not ornament: one bar per complaint
 * type, height proportional to how often that type actually ends fixed. So the
 * shape of the skyline *is* the finding -- short bars everywhere.
 *
 * It renders only once /api/explore answers. With no data there is no drawing,
 * because a skyline of invented heights is exactly the kind of decoration this
 * project refuses. Hidden from assistive tech: the readable version of this
 * same data is the telemetry block beside it and the Explore table.
 */
function Skyline({ rows }: { rows: ExploreRow[] }) {
  if (rows.length === 0) return null

  const bars = [...rows].sort((a, b) => b.total - a.total).slice(0, 24)
  const slot = SKYLINE_W / bars.length

  return (
    <svg
      className="lp-skyline"
      viewBox={`0 0 ${SKYLINE_W} ${SKYLINE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((r, i) => {
        // Floored so a near-zero share still reads as a building, not a gap.
        const h = Math.max(28, r.resolved_share * SKYLINE_H)
        return (
          <rect
            key={`${r.complaint_type}-${r.agency}`}
            x={i * slot + slot * 0.14}
            y={SKYLINE_H - h}
            width={slot * 0.72}
            height={h}
          />
        )
      })}
    </svg>
  )
}

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

  return (
    <div className="lp">
      <section className="lp-hero">
        <Skyline rows={data?.rows ?? []} />

        <div className="wrap lp-hero-in">
          <p className="lp-eyebrow">Service_outcomes — not complaint_volume</p>

          <h1 className="lp-headline">
            Fix your city <em>scientifically.</em>
          </h1>

          <div className="lp-copy">
            <p className="lede">
              Describe a problem in any language. Find out what actually happens to complaints like
              yours — what changes the odds, and a draft ready to submit.
            </p>

            <div className="lp-actions">
              <button className="btn btn-primary" onClick={() => navigate('ask')}>
                Run_forecast
              </button>
              <span className="lp-or">
                Or browse{' '}
                <button className="linklike" onClick={() => navigate('explore')}>
                  Where_complaints_die
                </button>
              </span>
            </div>
          </div>

          {/* The instrument panel: what was read, over what window, and how much
              of it the classifier could actually account for. */}
          <aside className="lp-telemetry">
            <div className="lp-tel-row">
              <span className="lp-tel-key">RECORDS:</span>
              <span className="lp-tel-val">{count(totalRecords)}</span>
            </div>
            <div className="lp-tel-row">
              <span className="lp-tel-key">WINDOW:</span>
              <span className="lp-tel-val">{DATA_WINDOW}</span>
            </div>
            <div className="lp-tel-foot">CLASSIFIER_COVERAGE {coverage}</div>
          </aside>
        </div>
      </section>

      <div className="wrap lp-below stack">
        {/* ---- the finding ---- */}
        <section>
          <p className="label">The_finding</p>

          <div className="lp-finding">
            <p className="lp-finding-claim">
              <span className="lp-finding-n">{pctShort(hero.resolved_share)}</span> of{' '}
              {hero.agency} {hero.complaint_type.toLowerCase()} complaints end with the problem
              addressed. Three of every four do not.
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

        {/* ---- how it works ---- */}
        <section>
          <p className="label">How_it_works</p>
          <ol className="steps">
            <li>
              <sup>01</sup>
              <span>
                <strong>Describe it</strong>
                <em>Speak or type the problem in your own words, in any language.</em>
              </span>
            </li>
            <li>
              <sup>02</sup>
              <span>
                <strong>We check {millions}M records</strong>
                <em>
                  Your words are mapped onto the 311 taxonomy, then matched against classified
                  outcomes for your area.
                </em>
              </span>
            </li>
            <li>
              <sup>03</sup>
              <span>
                <strong>You get the odds and a draft</strong>
                <em>
                  The outcome distribution, what makes complaints like yours fail, and a complaint
                  you can submit.
                </em>
              </span>
            </li>
          </ol>
        </section>

        <div className="cta-banner">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('ask')}>
              Run_forecast
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('explore')}>
              Where_complaints_die
            </button>
          </div>

          <div className="trust">
            {count(totalRecords)} complaints · {DATA_RANGE} · NYC Open Data · updated daily
          </div>
        </div>

        {/* We cannot file anything. That has to stay on the landing page, not
            only in the small print under a result. */}
        <p className="lp-cannot">
          We do not file complaints — you submit the draft. NYC has no public 311 write API.
        </p>
      </div>
    </div>
  )
}
