/**
 * Community-district geometry, shared by the Explore choropleth and the landing
 * locator map.
 *
 * The projection lives here rather than in either component because both draw
 * the same 71 polygons at different sizes, and two copies of a projection is two
 * chances for them to disagree about where Staten Island is.
 */

export interface GeoFeature {
  /** `park: 1` marks a joint interest area — parkland, airports, cemeteries. */
  properties: { board: string; boro: string; cd: number; park?: number }
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] }
}

export interface ProjectedPath {
  board: string
  boro: string
  d: string
  park: boolean
}

/**
 * Geometry is fetched at runtime rather than imported, so 100KB of coordinates
 * stays out of the bundle. Cached because two components on one page would
 * otherwise pull it twice.
 */
let cached: Promise<GeoFeature[]> | null = null

export function loadDistricts(): Promise<GeoFeature[]> {
  if (!cached) {
    cached = fetch('community-districts.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((g: { features: GeoFeature[] }) => g.features)
      .catch((err) => {
        // A failed load must not poison every later attempt.
        cached = null
        throw err
      })
  }
  return cached
}

/** Every ring of every polygon, flattened -- a MultiPolygon's parts draw the
    same way a Polygon's holes do, so nothing downstream needs to tell them
    apart. */
function rings(f: GeoFeature): number[][][] {
  return f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat()
}

/**
 * Equirectangular with a cosine correction at the centre latitude -- across five
 * miles of city that is indistinguishable from a proper projection, and it costs
 * nothing to compute.
 */
export function projectFeatures(features: GeoFeature[], w: number, h: number): ProjectedPath[] {
  let minX = 180
  let minY = 90
  let maxX = -180
  let maxY = -90
  for (const f of features)
    for (const ring of rings(f))
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }

  const midLat = ((minY + maxY) / 2) * (Math.PI / 180)
  const lonScale = Math.cos(midLat)
  const spanX = (maxX - minX) * lonScale
  const spanY = maxY - minY
  const scale = Math.min(w / spanX, h / spanY) * 0.96
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2

  return features.map((f) => {
    let d = ''
    for (const ring of rings(f)) {
      d += ring
        .map((pt, i) => {
          const x = offX + (pt[0] - minX) * lonScale * scale
          const y = offY + (maxY - pt[1]) * scale
          return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
        })
        .join('')
      d += 'Z'
    }
    return {
      board: f.properties.board,
      boro: f.properties.boro,
      d,
      park: Boolean(f.properties.park),
    }
  })
}
