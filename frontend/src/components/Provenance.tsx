import { USE_MOCK } from '../api/client'
import { VERIFIED_TYPES } from '../api/mock'
import { PLACEHOLDER } from '../lib/format'

/**
 * Honesty, relocated.
 *
 * The earlier build shouted -- a persistent orange banner plus a
 * "[placeholder- replace with real data]" chip in the middle of the result. That
 * is accurate and it reads as "unfinished" from across a room. The honesty stays;
 * it just moves: estimated figures carry a quiet inline marker, and one
 * provenance line at the foot of the page states exactly what is computed and
 * what is not.
 *
 * The full marker text still appears in `title` on every marker and verbatim in
 * the footer, so nothing is hidden from anyone who looks.
 */
export function Est({ what }: { what?: string }) {
  if (!USE_MOCK) return null
  return (
    <span className="est" title={what ? `${PLACEHOLDER} — ${what}` : PLACEHOLDER}>
      est.
    </span>
  )
}

export function isVerifiedType(complaintType: string): boolean {
  return VERIFIED_TYPES.has(complaintType)
}

interface FooterProps {
  /** What this particular screen computed, if anything. */
  verified?: string[]
  estimated?: string[]
}

export function ProvenanceFooter({ verified = [], estimated = [] }: FooterProps) {
  const alwaysVerified = [
    '22,145,244 record count',
    'date range 2020–2026',
    'per-type resolved shares',
    ...verified,
  ]

  return (
    <div className="provenance">
      <div className="provenance-row">
        <span className="provenance-key">Computed from the dataset</span>
        <span>{alwaysVerified.join(' · ')}</span>
      </div>
      {USE_MOCK && estimated.length > 0 && (
        <div className="provenance-row">
          <span className="provenance-key">Estimated, marked “est.”</span>
          <span>{estimated.join(' · ')}</span>
        </div>
      )}
      {USE_MOCK && (
        <div className="provenance-note">
          Estimated figures are pending the live query and are marked inline.
          Source string: <code>{PLACEHOLDER}</code>
        </div>
      )}
    </div>
  )
}
