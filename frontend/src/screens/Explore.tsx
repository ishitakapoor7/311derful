import { useEffect, useMemo, useState } from 'react'
import type { BoardsResponse, ExploreResponse, ExploreRow } from '../types/api'
import { getBoards, getExplore } from '../api/client'
import { count, pct, pctShort } from '../lib/format'
import { outcomeLabel } from '../lib/outcomes'
import { ErrorState, Loading } from '../components/States'
import { BoardMap } from '../components/BoardMap'
import { ProvenanceFooter } from '../components/Provenance'

type SortKey = 'complaint_type' | 'agency' | 'total' | 'resolved_share'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function Explore() {
  const [data, setData] = useState<ExploreResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Default: worst first. This view is literally "where complaints go to die".
  const [sortKey, setSortKey] = useState<SortKey>('resolved_share')
  const [asc, setAsc] = useState(true)
  const [query, setQuery] = useState('')

  const [mapType, setMapType] = useState('Noise - Residential')
  const [boardData, setBoardData] = useState<BoardsResponse | null>(null)
  const [boardsLoading, setBoardsLoading] = useState(true)
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null)

  useEffect(() => {
    getExplore()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the data.'))
  }, [])

  useEffect(() => {
    // Until /api/explore/boards exists the map is one forecast per district, so
    // switching type mid-flight has to stop the previous fan-out rather than
    // just ignore it -- and the districts already answered are painted as they
    // arrive instead of held back behind a spinner.
    const controller = new AbortController()
    setBoardData(null)
    setBoardsLoading(true)
    getBoards(mapType, {
      signal: controller.signal,
      onPartial: (partial) => {
        if (!controller.signal.aborted) setBoardData(partial)
      },
    })
      .then((r) => {
        if (!controller.signal.aborted) setBoardData(r)
      })
      .catch(() => {
        // An empty result and a failed one read the same to the user: no map.
        if (!controller.signal.aborted) setBoardData({ complaint_type: mapType, rows: [] })
      })
      .finally(() => {
        if (!controller.signal.aborted) setBoardsLoading(false)
      })
    return () => controller.abort()
  }, [mapType])

  const boards = boardData?.rows ?? []

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
      <p className="label">Citywide outcomes</p>
      <h1
        style={{
          fontSize: 'clamp(32px, 5.6vw, 52px)',
          letterSpacing: '-0.035em',
          maxWidth: '18ch',
        }}
      >
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
                Resolved share by community board
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

            {boards.length === 0 ? (
              boardsLoading ? (
                <div className="map-skeleton" aria-label="Loading the map" />
              ) : (
                <div className="note">
                  No per-board figures for {mapType}. The map is one real forecast per community
                  district, so it needs the API running — offline, or with the backend down, there
                  is nothing honest to draw here.
                </div>
              )
            ) : (
              <>
                <BoardMap shares={boards} selected={selectedBoard} onSelect={setSelectedBoard} />
                <p className="mono muted" style={{ marginTop: 10, fontSize: 12 }}>
                  {boardsLoading
                    ? `${boards.length} of 59 community districts…`
                    : `${boards.length} of 59 community districts`}
                  {boardData?.month ? ` · ${MONTHS[boardData.month - 1]} complaints` : ''} ·{' '}
                  districts with fewer than {boardData?.min_sample ?? 30} classified records are
                  left blank rather than coloured from noise.
                </p>
              </>
            )}
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
                      <td style={{ fontWeight: 700 }}>{row.complaint_type}</td>
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
            totalRecords={data.total_records}
            verified={[
              `${data.rows.length} complaint types`,
              `${pct(data.classified_share, 0)} classifier coverage`,
              ...(boards.length ? [`${boards.length} community districts on the map`] : []),
            ]}
          />
        </>
      )}
    </div>
  )
}
