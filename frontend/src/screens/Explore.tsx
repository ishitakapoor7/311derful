import { useEffect, useMemo, useState } from 'react'
import type { BoardShare, ExploreResponse, ExploreRow } from '../types/api'
import { getBoards, getExplore } from '../api/client'
import { count, pct, pctShort } from '../lib/format'
import { outcomeLabel } from '../lib/outcomes'
import { ErrorState, Loading } from '../components/States'
import { BoardMap } from '../components/BoardMap'
import { Est, ProvenanceFooter, isVerifiedType } from '../components/Provenance'

type SortKey = 'complaint_type' | 'agency' | 'total' | 'resolved_share'

export function Explore() {
  const [data, setData] = useState<ExploreResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Default: worst first. This view is literally "where complaints go to die".
  const [sortKey, setSortKey] = useState<SortKey>('resolved_share')
  const [asc, setAsc] = useState(true)
  const [query, setQuery] = useState('')

  const [mapType, setMapType] = useState('Noise - Residential')
  const [boards, setBoards] = useState<BoardShare[]>([])
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null)

  useEffect(() => {
    getExplore()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the data.'))
  }, [])

  useEffect(() => {
    let cancelled = false
    getBoards(mapType)
      .then((r) => {
        if (!cancelled) setBoards(r.rows)
      })
      .catch(() => {
        if (!cancelled) setBoards([])
      })
    return () => {
      cancelled = true
    }
  }, [mapType])

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? data.rows.filter(
          (r) =>
            r.complaint_type.toLowerCase().includes(q) || r.agency.toLowerCase().includes(q),
        )
      : data.rows
    const sorted = [...filtered].sort((a, b) => {
      const x = a[sortKey]
      const y = b[sortKey]
      if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y)
      return Number(x) - Number(y)
    })
    return asc ? sorted : sorted.reverse()
  }, [data, sortKey, asc, query])

  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v)
    } else {
      setSortKey(key)
      setAsc(key === 'resolved_share')
    }
  }

  function header(key: SortKey, label: string, numeric = false) {
    const active = sortKey === key
    return (
      <th
        style={numeric ? { textAlign: 'right' } : undefined}
        aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
      >
        <button onClick={() => sortBy(key)}>
          {label} {active ? (asc ? '↑' : '↓') : ''}
        </button>
      </th>
    )
  }

  const selectedShare = selectedBoard ? boards.find((b) => b.board === selectedBoard) : null

  return (
    <div className="wrap" style={{ padding: '36px 20px 80px' }}>
      <p className="label">Citywide</p>
      <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', maxWidth: '18ch' }}>
        Where complaints go to die
      </h1>

      {error && <ErrorState message={error} />}
      {!data && !error && (
        <div style={{ marginTop: 24 }}>
          <Loading />
        </div>
      )}

      {data && (
        <>
          <p className="lede" style={{ marginTop: 16 }}>
            Every complaint below closed. Only the share on the left had the problem actually
            addressed.
          </p>

          <div className="chip" style={{ marginBottom: 24 }}>
            {count(data.total_records)} records · {data.rows.length} complaint types ·{' '}
            {pct(data.classified_share, 0)} classified from the agencies&apos; own resolution text
          </div>

          {/* ---- map ---- */}
          <div className="section">
            <div className="map-head">
              <p className="label" style={{ margin: 0 }}>
                Resolved share by community board <Est what="per-board shares" />
              </p>
              <select
                value={mapType}
                onChange={(e) => {
                  setMapType(e.target.value)
                  setSelectedBoard(null)
                }}
                aria-label="Complaint type shown on the map"
              >
                {data.rows.map((r) => (
                  <option key={`${r.complaint_type}-${r.agency}`} value={r.complaint_type}>
                    {r.complaint_type}
                  </option>
                ))}
              </select>
            </div>

            <BoardMap shares={boards} selected={selectedBoard} onSelect={setSelectedBoard} />
          </div>

          {/* ---- table ---- */}
          <div className="section">
            <div className="table-head">
              <p className="label" style={{ margin: 0 }}>
                All complaint types
              </p>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search type or agency…"
                aria-label="Search complaint types"
                className="search"
              />
            </div>

            {selectedShare && (
              <div className="note" style={{ marginBottom: 12 }}>
                <strong>{selectedShare.board}</strong> — {pctShort(selectedShare.resolved_share)} of{' '}
                {mapType} complaints addressed, from {count(selectedShare.total)} records.{' '}
                <button className="linklike" onClick={() => setSelectedBoard(null)}>
                  Clear
                </button>
              </div>
            )}

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {header('complaint_type', 'Complaint type')}
                    {header('agency', 'Agency')}
                    {header('total', 'Complaints', true)}
                    {header('resolved_share', 'Problem addressed', true)}
                    <th>Most common failure</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: ExploreRow) => (
                    <tr key={`${row.complaint_type}-${row.agency}`}>
                      <td style={{ fontWeight: 700 }}>
                        {row.complaint_type}{' '}
                        {!isVerifiedType(row.complaint_type) && <Est what="this row" />}
                      </td>
                      <td className="muted">{row.agency}</td>
                      <td className="num">{count(row.total)}</td>
                      <td className="num">
                        <span className="minibar" aria-hidden="true">
                          <i style={{ width: `${row.resolved_share * 100}%` }} />
                        </span>
                        {pctShort(row.resolved_share)}
                      </td>
                      <td>
                        {row.dominant_failure ? (
                          <>
                            {outcomeLabel(row.dominant_failure)}
                            {row.dominant_failure_share !== null && (
                              <span className="muted mono">
                                {' '}
                                {pctShort(row.dominant_failure_share)}
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        Nothing matches “{query}”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <ProvenanceFooter
            verified={['4 complaint types fully computed']}
            estimated={['per-board map shares', 'the remaining complaint-type rows']}
          />
        </>
      )}
    </div>
  )
}
