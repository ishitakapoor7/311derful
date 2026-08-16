import type { OutcomeClass } from '../types/api'
import { isActionableFailure, isResolved } from '../types/api'

/**
 * Visual grouping for outcome bars. The plan calls for "one accent colour plus a
 * clear resolved/failure pair", so colour carries only the resolved/failure
 * distinction. Everything else -- including the actionable-vs-not split -- is
 * carried by label and bar treatment, so the chart survives greyscale and the
 * common forms of colour blindness.
 */
export type OutcomeGroup = 'resolved' | 'failure' | 'neutral'

interface OutcomeMeta {
  label: string
  /** Plain-language gloss shown under the label. */
  blurb: string
  group: OutcomeGroup
}

const META: Record<OutcomeClass, OutcomeMeta> = {
  VERIFIED_FIXED: {
    label: 'Verified fixed',
    blurb: 'condition confirmed corrected',
    group: 'resolved',
  },
  ACTION_TAKEN: {
    label: 'Action taken',
    blurb: 'agency acted — summons or repair',
    group: 'resolved',
  },
  GONE_ON_ARRIVAL: {
    label: 'Gone on arrival',
    blurb: 'responsible party had left before anyone came',
    group: 'failure',
  },
  NO_ACCESS: {
    label: 'No access',
    blurb: 'inspector could not get in',
    group: 'failure',
  },
  NOTHING_FOUND: {
    label: 'Nothing found',
    blurb: 'responded, saw no violation',
    group: 'failure',
  },
  NO_ACTION_NEEDED: {
    label: 'No action needed',
    blurb: 'responded, judged no action required',
    group: 'failure',
  },
  DUPLICATE: {
    label: 'Duplicate',
    blurb: "closed against someone else's report",
    group: 'failure',
  },
  REFERRED: {
    label: 'Referred',
    blurb: 'handed to another agency',
    group: 'failure',
  },
  NO_OUTCOME_GIVEN: {
    label: 'No outcome given',
    blurb: 'closed, but the agency never said what happened',
    group: 'failure',
  },
  PENDING: {
    label: 'Still open',
    blurb: 'no outcome recorded yet',
    group: 'neutral',
  },
  UNCLASSIFIED: {
    label: 'Unclassified',
    blurb: 'no rule matched this resolution text',
    group: 'neutral',
  },
}

export function outcomeLabel(outcome: OutcomeClass): string {
  return META[outcome]?.label ?? outcome
}

export function outcomeBlurb(outcome: OutcomeClass): string {
  return META[outcome]?.blurb ?? ''
}

export function outcomeGroup(outcome: OutcomeClass): OutcomeGroup {
  return META[outcome]?.group ?? 'neutral'
}

/** Re-exported so components import one module rather than two. */
export { isResolved, isActionableFailure }
