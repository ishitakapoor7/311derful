import { useEffect, useMemo, useState } from 'react'
import { loadDistricts, projectFeatures, type GeoFeature } from '../lib/geo'

/* Square: with the cosine correction applied, the city's east-west span and its
   north-south span come out within a percent of each other, so a taller box
   would only letterbox the drawing. */
const W = 520
const H = 520

/**
 * The city, drawn from the real community-district boundaries, as a locator on
 * the landing page.
 *
 * Deliberately **not** a choropleth. The Explore map colours each district by
 * its resolved share, which costs one forecast call per district -- 59 requests
 * is not something a landing page should fire, and a landing page must render
 * with the backend down anyway. So this one carries no per-district figure and
 * uses no colour ramp: every district is the same ink, and the caption says
 * what it is, so nobody reads a number out of a shade that does not encode one.
 *
 * What it does assert is true and worth asserting: all 59 districts are in the
 * cube. Parkland is drawn in outline only, because nobody lives there and 311
 * reports nothing against it.
 */
export function CityMap() {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDistricts()
      .then((f) => {
        if (!cancelled) setFeatures(f)
      })
      // The hero must survive missing geometry: no map, no error, no gap.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const paths = useMemo(() => (features ? projectFeatures(features, W, H) : []), [features])

  if (paths.length === 0) return null

  const districts = paths.filter((p) => !p.park).length

  return (
    <figure className="citymap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="citymap-svg"
        role="img"
        aria-label={`Map of New York City's ${districts} community districts`}
      >
        {paths.map((p) => (
          <path
            key={p.board}
            d={p.d}
            className={p.park ? 'citymap-park' : 'citymap-district'}
          />
        ))}
      </svg>

      <figcaption className="citymap-caption">
        {districts} community districts — every one of them in the cube
      </figcaption>
    </figure>
  )
}
