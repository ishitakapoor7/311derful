import { navigate } from '../lib/router'
import { count } from '../lib/format'
import { DATA_RANGE, TOTAL_RECORDS } from '../lib/constants'
import { GapBar } from '../components/GapBar'

/**
 * One screen. Its only job is to make someone believe there is a real finding here
 * before they type anything — so the hero stat is verified, not illustrative.
 */
export function Landing() {
  // VERIFIED: full dataset. PLUMBING (HPD), n = 214,581, 24.2% addressed.
  const HERO = { type: 'PLUMBING', agency: 'HPD', n: 214_581, resolved: 0.242 }

  return (
    <div className="wrap" style={{ padding: '48px 20px 64px' }}>
      <div className="hero stack">
        <h1>New York closed 22 million complaints. Most were never fixed.</h1>
        <p className="lede">
          We read the agencies&apos; own resolution text on every one of{' '}
          {count(TOTAL_RECORDS)} records. Describe your problem in plain language and find out what
          actually happens to complaints like yours — what changes the odds, and a draft ready to
          submit.
        </p>

        <div>
          <div className="label" style={{ marginBottom: 10 }}>
            {HERO.type} · {HERO.agency} · {count(HERO.n)} complaints, all closed
          </div>
          <GapBar
            resolvedShare={HERO.resolved}
            label="plumbing complaints"
            caption={`${count(HERO.n)} complaints · citywide · ${DATA_RANGE} · computed from the dataset`}
          />
        </div>

        <div>
          <p className="label">How it works</p>
          <ol className="steps">
            <li>
              <span>Describe the problem</span>
              <sup>01</sup>
            </li>
            <li>
              <span>We check {count(TOTAL_RECORDS)} records</span>
              <sup>02</sup>
            </li>
            <li>
              <span>You get the odds and a draft</span>
              <sup>03</sup>
            </li>
          </ol>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('ask')}>
            Check your complaint
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('explore')}>
            See the citywide numbers
          </button>
        </div>

        <div className="trust">
          {count(TOTAL_RECORDS)} complaints, {DATA_RANGE}, from NYC Open Data. Updated daily.
          Closing is not the same as fixing — this tool exists to show the difference.
        </div>
      </div>
    </div>
  )
}
