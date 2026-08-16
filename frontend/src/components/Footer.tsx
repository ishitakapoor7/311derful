/**
 * The standing footnote: what this thing measures, where the data came from,
 * and the one promise it must never overstate.
 *
 * The "we do not file complaints" column is not boilerplate. NYC has no public
 * write API for 311, so the product's output is a draft the user submits
 * themselves -- and that has to be legible on every screen, not only in the
 * small print under a result.
 */

const SOURCES = [
  {
    label: '311_SERVICE_REQUESTS',
    href: 'https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9',
  },
  {
    label: 'COMMUNITY_DISTRICTS',
    href: 'https://data.cityofnewyork.us/City-Government/Community-Districts/5crt-au7u',
  },
]

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div className="footer-brand">
          {/* A footer-specific lockup rather than the header's <Logo>: that mark
              paints its field with --ink, which is this footer's background. */}
          <p className="footer-mark">
            <i className="footer-mark-sq" aria-hidden="true" />
            <span>
              <span className="footer-mark-311">311</span>derful
            </span>
          </p>

          <p className="footer-blurb">
            We classify the 311 <code>resolution_description</code> field to measure service
            outcomes, not complaint volume.
          </p>
        </div>

        <nav className="footer-col" aria-label="Data sources">
          <p className="footer-head">SOURCES</p>
          {SOURCES.map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noreferrer noopener">
              {s.label}
            </a>
          ))}
        </nav>

        <div className="footer-col footer-cannot">
          <p className="footer-head footer-head-accent">WE DO NOT FILE COMPLAINTS</p>
          <p>THE DRAFT IS YOURS TO SUBMIT</p>
        </div>
      </div>
    </footer>
  )
}
