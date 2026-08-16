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
        <nav className="nav">
          <button onClick={() => navigate('ask')} aria-current={route === 'ask'}>
            Ask
          </button>
          <button onClick={() => navigate('explore')} aria-current={route === 'explore'}>
            Explore
          </button>
        </nav>
      </div>
    </header>
  )
}
