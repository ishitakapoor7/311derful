import type { FormField } from '../types/api'
import { pctShort } from '../lib/format'

/**
 * "What 311 will ask you" — the intake questions, beside the draft that answers
 * them. The draft is what you say; this is what you will be asked, so someone
 * can gather the answers before opening the form instead of bailing halfway
 * through it.
 *
 * None of this was scraped. NYC has no Open311 API and the portal is a Dynamics
 * app with hundreds of branching flows, so the form was measured instead: which
 * dataset columns a complaint type populates is a fingerprint of the questions
 * it was asked, and the distinct values of each categorical column are the
 * options. That is why the copy says "usually filed" and never "official".
 */
export function FormFields({ fields }: { fields: FormField[] | undefined }) {
  // Empty means the complaint type is not among the 60 mapped, NOT that 311 asks
  // nothing. There is no honest way to render that, so the panel does not appear.
  // (Undefined too: a result cached before this field existed.)
  if (!fields || fields.length === 0) return null

  return (
    <div className="ff">
      <p className="ff-basis">
        From how these complaints are usually filed — not an official form.
      </p>

      <ol className="ff-list">
        {fields.map((field, i) => (
          <li key={field.column} className="ff-row">
            <span className="ff-n">{String(i + 1).padStart(2, '0')}</span>

            <div className="ff-body">
              <p className="ff-q">
                {field.question}
                {/* Conditional on an earlier answer, so it is "may ask" rather
                    than something to have ready. */}
                {!field.always && <span className="ff-may">MAY ASK</span>}
              </p>

              {/* The fill rate, as text rather than a tooltip: it is the honest
                  measure of how often the question actually comes up, and a
                  title attribute is invisible on a phone. */}
              {!field.always && (
                <p className="ff-when">
                  Asked on {pctShort(field.fill_rate)} of these complaints.
                </p>
              )}

              {field.options && field.options.length > 0 ? (
                <ul className="ff-options">
                  {field.options.map((o) => (
                    <li key={o.value} className="ff-option">
                      <span className="ff-option-v">{o.value}</span>
                      <span className="ff-option-s">{pctShort(o.share)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                /* No options is not an empty dropdown -- it is free text, or a
                   field with one real value. Either way the useful thing to say
                   is that it has to be answered, not that there is nothing to
                   pick. */
                <p className="ff-freetext">You'll need this ready.</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="ff-foot">
        Percentages are how often filers picked each answer — what's typical, not what works.
      </p>
    </div>
  )
}
