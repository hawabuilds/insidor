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
import { formatDelta } from '../format/number.ts';
import { Pending } from './Pending.tsx';
import styles from './primitives.module.css';

export function Delta({ value }: { value: DeltaValue }) {
  if (!value.known) return <Pending reason={value.pending} />;
  const rendered = formatDelta(value);
  const tone = value.amount > 0 ? 'deltaUp' : value.amount < 0 ? 'deltaDown' : 'deltaFlat';
  return (
    <span className={`${styles['delta']} ${styles[tone]}`}>
      {rendered.kind === 'value' ? rendered.text : null}
    </span>
  );
}
