/**
 * One tap into a real forecast, for the large majority of people who will not
 * type anything into a box they have never used before. Also what keeps the
 * demo alive when the mic, the wifi or a nervous hand misbehaves.
 *
 * These are phrased the way somebody actually describes the problem, not the way
 * 311 files it -- mapping "my radiator has been cold" onto HEAT/HOT WATER →
 * ENTIRE BUILDING is the thing being demonstrated. One is in Spanish because a
 * chip in another language proves the multilingual claim faster than a sentence
 * saying so, and it is the shortest path to a non-English demo on stage.
 */
const EXAMPLES: { label: string; text: string; address: string | null }[] = [
  {
    label: 'Cold radiator',
    text: 'my radiator has been cold for three days',
    address: '10457',
  },
  {
    label: 'Ceiling leak',
    text: 'water is leaking from my bathroom ceiling',
    address: null,
  },
  {
    label: 'Basura en la acera',
    text: 'hay basura acumulada en la acera frente a mi edificio',
    address: null,
  },
  {
    label: 'Blocked hydrant',
    text: 'a car has been parked in front of the fire hydrant on my block for days',
    address: null,
  },
]

interface Props {
  disabled: boolean
  onPick: (text: string, address: string | null) => void
}

export function ExampleChips({ disabled, onPick }: Props) {
  return (
    <div className="examples" role="group" aria-label="Example complaints">
      <span className="examples-key">TRY:</span>
      {EXAMPLES.map((e) => (
        <button
          key={e.label}
          className="example"
          /* The short label is the accessible name; the sentence that will
             actually be submitted is on hover, so nobody is surprised by what
             the chip asked on their behalf. */
          title={e.text}
          disabled={disabled}
          onClick={() => onPick(e.text, e.address)}
        >
          {e.label}
        </button>
      ))}
    </div>
  )
}
