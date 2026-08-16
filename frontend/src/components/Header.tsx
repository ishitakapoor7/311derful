import { Logo } from './Logo'
import { navigate, type Route } from '../lib/router'
import { USE_MOCK } from '../api/client'

export function Header({ route }: { route: Route }) {
  return (
    <header className="header">
      <div className="header-in">
        <button
          onClick={() => navigate('landing')}
          style={{ background: 'none', border: 0, padding: 0 }}
          aria-label="311derful — home"
        >
          <Logo size={28} />
        </button>
        <div className="header-end">
          {/* Which data the screen is showing is a fact about the build, so it
              is stated in the chrome rather than left for someone to infer from
              numbers that never change. Absent entirely when the API is live. */}
          {USE_MOCK && (
            <span className="mode-badge" title="Serving the committed fixtures, not the API">
              Fixture_mode
            </span>
          )}

          <nav className="nav">
            <button onClick={() => navigate('explore')} aria-current={route === 'explore'}>
              Where_it_dies
            </button>
          </nav>

          {/* The single way into the tool, so it is not duplicated as a nav
              item. It never moves or disappears -- on /ask it drops to the
              quiet state and marks itself current, because a control that
              vanishes on the page it points at leaves the header with no
              indication of where you are. */}
          <button
            className={route === 'ask' ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
            onClick={() => navigate('ask')}
            aria-current={route === 'ask'}
          >
            Run_forecast
          </button>
        </div>
      </div>
    </header>
  )
}
