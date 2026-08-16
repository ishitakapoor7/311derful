import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardShare } from '../types/api'
import { pctShort, count } from '../lib/format'

interface GeoFeature {
  /** `park: 1` marks a joint interest area — parkland, airports, cemeteries. */
  properties: { board: string; boro: string; cd: number; park?: number }
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] }
}

interface Props {
  shares: BoardShare[]
  selected: string | null
  onSelect: (board: string | null) => void
}

const W = 760
const H = 720

/**
 * Community-board choropleth of resolved share. Dark where complaints do not get
 * fixed -- the whole point of the project rendered as one object.
 *
 * Deliberately hand-rolled SVG rather than a mapping library: 62 static polygons
 * with no panning, tiles, or projection switching do not justify the dependency,
 * and geometry loads from /community-districts.geojson at runtime so the bundle
 * stays small.
 */
export function BoardMap({ shares, selected, onSelect }: Props) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('community-districts.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((g: { features: GeoFeature[] }) => {
        if (!cancelled) setFeatures(g.features)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const shareByBoard = useMemo(() => {
    const m = new Map<string, BoardShare>()
    for (const s of shares) m.set(s.board, s)
    return m
  }, [shares])

  const paths = useMemo(() => {
    if (!features) return []

    let minX = 180
    let minY = 90
    let maxX = -180
    let maxY = -90
    for (const f of features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      for (const rings of polys)
        for (const ring of rings)
          for (const [x, y] of ring) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
    }

    // Equirectangular with a cosine correction at the centre latitude -- across
    // five miles of city that is indistinguishable from a proper projection.
    const midLat = ((minY + maxY) / 2) * (Math.PI / 180)
    const lonScale = Math.cos(midLat)
    const spanX = (maxX - minX) * lonScale
    const spanY = maxY - minY
    const scale = Math.min(W / spanX, H / spanY) * 0.96
    const offX = (W - spanX * scale) / 2
    const offY = (H - spanY * scale) / 2

    const project = ([lon, lat]: number[]) => [
      offX + (lon - minX) * lonScale * scale,
      offY + (maxY - lat) * scale,
    ]

    return features.map((f) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      let d = ''
      for (const rings of polys) {
        for (const ring of rings) {
          d += ring
            .map((pt, i) => {
              const [x, y] = project(pt)
              return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
            })
            .join('')
          d += 'Z'
        }
      }
      return { board: f.properties.board, d, park: Boolean(f.properties.park) }
    })
  }, [features])

  if (failed) {
    return (
      <div className="note">
        Map geometry didn&apos;t load. Check that{' '}
        <code>frontend/public/community-districts.geojson</code> is being served.
      </div>
    )
  }

  if (!features) {
    return <div className="map-skeleton" aria-label="Loading map" />
  }

  const active = hover ?? selected
  const activeShare = active ? shareByBoard.get(active) : null

  return (
    <div className="map-wrap" ref={wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="map"
        role="img"
        aria-label="Resolved share by community board"
      >
        {paths.map((p) => {
          // Parkland keeps the map whole but is never coloured as if it had a
          // resolved share — nobody lives there and 311 reports nothing for it.
          if (p.park) {
            return (
              <path key={p.board} d={p.d} className="board-park" fill="var(--neutral-soft)">
                <title>Parkland — not a community district</title>
              </path>
            )
          }
          const s = shareByBoard.get(p.board)
          const isSelected = selected === p.board
          return (
            <path
              key={p.board}
              d={p.d}
              className="board"
              fill={s ? rampColor(s.resolved_share) : 'var(--paper-3)'}
              stroke={isSelected ? 'var(--ink)' : 'var(--paper)'}
              strokeWidth={isSelected ? 2.5 : 0.8}
              data-selected={isSelected}
              onMouseEnter={() => setHover(p.board)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(isSelected ? null : p.board)}
            >
              <title>
                {p.board} — {s ? `${pctShort(s.resolved_share)} addressed` : 'no data'}
              </title>
            </path>
          )
        })}
      </svg>

      <div className="map-readout" aria-live="polite">
        {activeShare ? (
          <>
            <div className="map-readout-board">{active}</div>
            <div className="map-readout-n">
              <strong>{pctShort(activeShare.resolved_share)}</strong> addressed ·{' '}
              {count(activeShare.total)} complaints
            </div>
          </>
        ) : (
          <div className="map-readout-hint">
            Hover a board. Click to filter the table below.
          </div>
        )}
      </div>

      <div className="map-legend">
        <span className="mono muted">Not fixed</span>
        {RAMP.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
        <span className="mono muted">Fixed</span>
      </div>
    </div>
  )
}

/** Dark where complaints do not get fixed. */
const RAMP = ['#6d2818', '#9a3d22', '#c06239', '#d9946b', '#e9c3a6', '#dbe7de', '#9cc9b0', '#3f8f6b']

function rampColor(share: number): string {
  // Most boards land between 10% and 60%; stretching that range is what makes the
  // map readable rather than uniformly mid-tone.
  const t = Math.min(1, Math.max(0, (share - 0.1) / 0.5))
  return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]
}
