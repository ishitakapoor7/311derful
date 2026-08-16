import { useEffect, useState } from 'react'
import type { ExploreResponse, ExploreRow } from '../types/api'
import { getExplore } from '../api/client'
import { navigate } from '../lib/router'
import { asFraction, count } from '../lib/format'
import { DATA_RANGE, HERO_FALLBACK, TOTAL_RECORDS } from '../lib/constants'
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
function heroRow(rows: ExploreRow[]): Omit<ExploreRow, 'dominant_failure' | 'dominant_failure_share'> {
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
 * same data is the card beside it and the Explore table.
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
            rx={2}
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

  return (
    <div className="lp">
      <section className="lp-hero">
        <Skyline rows={data?.rows ?? []} />

        <div className="wrap lp-hero-in">
          <p className="lp-rail" aria-hidden="true">
            NYC Open Data · {DATA_RANGE}
          </p>

          <h1 className="lp-headline">
            New York closed {millions} million complaints.{' '}
            <em>Most were never fixed.</em>
          </h1>

          <div className="lp-copy">
            <p className="lede">
              We read the agencies&apos; own resolution text on every one of{' '}
              {count(totalRecords)} records. Describe your problem in plain language and find out
              what actually happens to complaints like yours — what changes the odds, and a draft
              ready to submit.
            </p>

            <div className="lp-actions">
              <button className="btn btn-primary" onClick={() => navigate('ask')}>
                Ask
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('explore')}>
                See the citywide numbers
              </button>
            </div>

            <p className="trust">
              {count(totalRecords)} complaints, {DATA_RANGE}, from NYC Open Data. Updated daily.
              Closing is not the same as fixing — this tool exists to show the difference.
            </p>
          </div>

          {/* The case file: the worst high-volume complaint type, as measured. */}
          <aside className="lp-case">
            <div className="lp-case-head">
              <span className="chip">
                311 · {hero.complaint_type} · {hero.agency}
              </span>
              <span className="lp-case-n">n = {count(hero.total)}</span>
            </div>

            <p className="lp-case-meta">
              citywide · recent years · classified records only
            </p>

            <GapBar
              resolvedShare={hero.resolved_share}
              label={`${hero.complaint_type.toLowerCase()} complaints`}
              // Explore rows are the trailing recent window, not all of history.
              // Captioning them with the full date range would overstate them.
              caption={`${count(hero.total)} complaints · citywide · recent years · computed from the dataset`}
            />

            <div className="lp-case-foot">
              <span className="lp-case-read">
                {asFraction(hero.resolved_share)} ends with the problem addressed.
              </span>
              <span className="lp-stamp" aria-hidden="true">
                Closed
              </span>
            </div>
          </aside>
        </div>
      </section>

      <div className="wrap lp-below stack">
        <div>
          <p className="label">How it works</p>
          <ol className="steps">
            <li>
              <span>Describe the problem</span>
              <sup>01</sup>
            </li>
            <li>
              <span>We check {count(totalRecords)} records</span>
              <sup>02</sup>
            </li>
            <li>
              <span>You get the odds and a draft</span>
              <sup>03</sup>
            </li>
          </ol>
        </div>

        <div className="cta-banner">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('ask')}>
              Ask
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('explore')}>
              See the citywide numbers
            </button>
          </div>

          <div className="trust">
            {count(totalRecords)} complaints, {DATA_RANGE}, from NYC Open Data. Updated daily.
            Closing is not the same as fixing — this tool exists to show the difference.
          </div>
        </div>
      </div>
    </div>
  )
}
