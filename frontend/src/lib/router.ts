import { useEffect, useState } from 'react'

/**
 * Hash routing, hand-rolled. Three views and no nested routes does not justify a
 * router dependency, and hash URLs survive being served from StaticFiles without
 * any backend catch-all route.
 */
export type Route = 'landing' | 'ask' | 'explore'

const ROUTES: Route[] = ['landing', 'ask', 'explore']

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'landing'
}

export function navigate(route: Route): void {
  window.location.hash = route === 'landing' ? '/' : `/${route}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)

  useEffect(() => {
    const onChange = () => {
      setRoute(parse())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}
