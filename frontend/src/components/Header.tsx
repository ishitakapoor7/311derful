import { Logo } from './Logo'
import { navigate, type Route } from '../lib/router'

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
          <nav className="nav">
            <button onClick={() => navigate('explore')} aria-current={route === 'explore'}>
              Explore
            </button>
          </nav>

          {/* The single way into the tool. The nav is for reading about it, so
              this is not duplicated as a nav item -- and it drops away on the
              one screen where it would point at the page you are already on. */}
          {route !== 'ask' && (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('ask')}>
              Ask
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
