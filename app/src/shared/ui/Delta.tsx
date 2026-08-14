/**
 * A signed change.
 *
 * Colours by SIGN ONLY. There is no numeric prop on this component and no way to pass one:
 * the magnitude cannot influence the colour, so "big move" cannot be encoded here. That
 * matters because a colour scale over a magnitude is a threshold, and a threshold in a
 * component is a product judgement made by whoever was styling that afternoon — which is
 * literally what `gain >= 150000 ? 'up' : 'down'` was in the build this replaces.
 *
 * This is the honest weak spot of the whole scheme and it is worth saying plainly: the
 * underlying delta is a legitimate fact, so the field stays on the wire. What is structural
 * is that no primitive accepts a numeric colour input. The rest is review.
 */

import type { Delta as DeltaValue } from '../format/measure.ts';
import { formatDelta, formatDeltaPercent } from '../format/number.ts';
import { Pending } from './Pending.tsx';
import styles from './primitives.module.css';

/**
 * What the number IS, so the right suffix is printed. Not a numeric prop, and it must
 * never become one: the two units differ by a factor of a hundred and a caller that got
 * this wrong would render a 7.9% fall as 790%. It changes the text and nothing else —
 * the tone below still reads only the sign, so no unit can smuggle a magnitude into the
 * colour.
 */
export type DeltaUnit = 'count' | 'percent';

export function Delta({
  value,
  unit = 'count',
  showWord = false,
}: {
  value: DeltaValue;
  unit?: DeltaUnit;
  /* Passed straight to `<Pending>`, the same way `<Num>` passes it. A list of figures
     where every other row spells its absence out and this one shows a bare dash reads
     as a rendering bug rather than as the honest answer it is. */
  showWord?: boolean;
}) {
  if (!value.known) return <Pending reason={value.pending} showWord={showWord} />;
  const rendered = unit === 'percent' ? formatDeltaPercent(value) : formatDelta(value);
  const tone = value.amount > 0 ? 'deltaUp' : value.amount < 0 ? 'deltaDown' : 'deltaFlat';
  return (
    <span className={`${styles['delta']} ${styles[tone]}`}>
      {rendered.kind === 'value' ? rendered.text : null}
    </span>
  );
}
