import { useEffect, useState } from 'react'
import type { AskResponse } from '../types/api'
import { isResolved, outcomeLabel } from '../lib/outcomes'
import { asFraction, count, pct } from '../lib/format'
import { cancelSpeech, isSynthesisSupported, speak } from '../lib/speech'
import { OutcomeBars } from './OutcomeBars'
import { ProvenanceChip, ScopeNote } from './ProvenanceChip'
import { Tips } from './Tips'
import { CloseTheLoop } from './CloseTheLoop'
import { FormFields } from './FormFields'
import { Disclosure } from './Disclosure'
import { ProvenanceFooter } from './Provenance'
import { ShareResult } from './ShareResult'

/**
 * The anti-chatbot presentation, and the one that should be on screen when judges
 * are watching. Big numbers, honest bars, everything traceable to a sample size.
 */
export function ReportView({ response }: { response: AskResponse }) {
  const { forecast, advice, intake, community_board, location_exact } = response
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => () => cancelSpeech(), [])

  if (!forecast || !advice) return null

  const low = forecast.confidence_tier === 'LOW'
  const resolvedCount = forecast.outcomes
    .filter((o) => isResolved(o.outcome))
    .reduce((sum, o) => sum + o.count, 0)

  const dominantFailure = [...forecast.outcomes]
    .filter((o) => !isResolved(o.outcome) && o.outcome !== 'PENDING')
    .sort((a, b) => b.share - a.share)[0]

  // A comparison only means something when the headline is a local number and it
  // actually differs from the citywide figure. Comparing a citywide number to
  // itself would read as a finding while saying nothing.
  const baseline = forecast.baseline_resolved_share
  const diff = baseline === null ? 0 : forecast.resolved_share - baseline
  const localVsCity =
    baseline === null || forecast.geo_level === 'CITYWIDE'
      ? null
      : Math.abs(diff) < 0.01
        ? `in line with the citywide average of ${pct(baseline)}`
        : diff > 0
          ? `better than the citywide average of ${pct(baseline)}`
          : `worse than the citywide average of ${pct(baseline)}`

  const targeted = advice.tips.map((t) => t.targets_outcome)

  function toggleSpeech() {
    if (!advice) return
    if (speaking) {
      cancelSpeech()
      setSpeaking(false)
      return
    }
    // The caveat is spoken first, never trailed — a thin-sample number presented
    // as a prediction is the worst thing this app can do.
    const script = [advice.caveat, advice.narrative].filter(Boolean).join(' ')
    setSpeaking(true)
    speak(script, intake.detected_lang || 'en-US', () => setSpeaking(false))
  }

  return (
    <div className="card card-outer report-card">
      {/* ---- identity ---- */}
      <p className="label">
        {intake.complaint_type}
        {intake.descriptor ? ` / ${intake.descriptor}` : ''} — handled by {intake.agency}
      </p>

      {/* ---- headline ---- */}
      {low ? (
        <div className="low-block">
          <p className="label" style={{ color: 'var(--failure)' }}>
            Not enough data to predict
          </p>
          <h2>
            Only {count(forecast.sample_size)} complaints like this exist on record. Of those,{' '}
            {resolvedCount} ended with the problem addressed.
          </h2>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            That is too few to forecast from. Treat everything below as directional only.
          </p>
          <ProvenanceChip
            forecast={forecast}
            communityBoard={community_board}
            locationExact={location_exact}
          />
        </div>
      ) : (
        <div className="headline">
          <span className="n">{pct(forecast.resolved_share)}</span>
          <div className="says">
            of complaints like yours end with the problem actually addressed —{' '}
            {asFraction(forecast.resolved_share)}
            {localVsCity ? `, ${localVsCity}` : ''}.
          </div>
          <ProvenanceChip
            forecast={forecast}
            communityBoard={community_board}
            locationExact={location_exact}
          />
        </div>
      )}

      {/* ---- caveat (state 2) ---- */}
      {advice.caveat && (
        <div className="caveat" style={{ marginTop: 16 }}>
          {advice.caveat}
        </div>
      )}

      {/* ---- scope honesty (states 3, 4, 5) ---- */}
      <div style={{ marginTop: 16 }}>
        <ScopeNote
          forecast={forecast}
          communityBoard={community_board}
          locationExact={location_exact}
        />
      </div>

      {/* ---- narrative + read aloud ---- */}
      <div className="section">
        <p className="label">What this means</p>
        <p className="lede">{advice.narrative}</p>
        {isSynthesisSupported() && (
          <button className="btn btn-sm btn-ghost" onClick={toggleSpeech}>
            {speaking ? '■ Stop' : '▶ Read this aloud'}
          </button>
        )}
      </div>

      {/* ---- the hero element ----
          The dominant failure used to get its own callout section below this,
          which restated a bar the reader had just looked at. It is one line
          above the chart now: it is the finding, not a second section. */}
      <div className="section">
        <p className="label">What actually happens</p>
        {dominantFailure && (
          <p className="bars-lead">
            Most end as <strong>{outcomeLabel(dominantFailure.outcome).toLowerCase()}</strong> —{' '}
            {pct(dominantFailure.share)}, {count(dominantFailure.count)} complaints, median{' '}
            {dominantFailure.median_days_to_close ?? '—'} days to close.
          </p>
        )}
        <OutcomeBars outcomes={forecast.outcomes} targeted={targeted} />
      </div>

      {/* ---- tips ---- */}
      {advice.tips.length > 0 && (
        <div className="section">
          <p className="label">What changes the odds</p>
          <Tips tips={advice.tips} />
        </div>
      )}

      {/* ---- what the form will ask ----
          Immediately before the draft: read the questions, gather the answers,
          then copy the draft and open 311. Hides itself when the complaint type
          is not in the recovered form map. */}
      {response.form_fields?.length > 0 && (
        <div className="section">
          <p className="label">What 311 will ask you</p>
          <FormFields fields={response.form_fields} />
        </div>
      )}

      {/* ---- close the loop ---- */}
      <div className="section">
        <p className="label">File it, then check back</p>
        <CloseTheLoop draftText={advice.draft_text} forecast={forecast} />
      </div>

      {/* ---- the supporting material ----
          Sharing and provenance are things people reach for, not things they
          read on the way down. The sample size and confidence tier are NOT in
          here -- those sit welded to the figure itself, where the project's
          first invariant requires them. */}
      <div className="section report-more">
        <Disclosure summary="Share this result">
          <ShareResult response={response} />
        </Disclosure>

        <Disclosure summary="Where this number comes from">
          <ProvenanceFooter
            verified={[
              'this outcome split and every count',
              'median days to close, per outcome',
              'sample size and confidence tier',
              ...(response.form_fields?.length
                ? ['the intake questions, recovered from column fill patterns']
                : []),
            ]}
            // The model phrases; it never produces a figure. Offline the prose
            // ships with the fixtures, live it is written per request in the
            // caller's language. Every number is a cube lookup either way.
            written={['the narrative, the tips and the draft complaint']}
          />
        </Disclosure>
      </div>
    </div>
  )
}
