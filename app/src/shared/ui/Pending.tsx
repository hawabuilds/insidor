/**
 * The pending state, given a real treatment.
 *
 * Absent data is the common case on this product — most of what is on screen is minutes old
 * — so "no number yet" needs to look deliberate rather than broken. A dim em dash in the
 * mono column keeps the table aligned; the reason is on hover and in the accessible name, so
 * "no coin yet" and "not reported" are distinguishable without adding a column.
 *
 * This component is the only way a pending value reaches the screen. There is no branch in
 * the design system that renders an absence as a zero.
 */

import type { PendingReason } from '../format/measure.ts';
import { pendingLabel, PENDING_GLYPH } from '../format/rendered.ts';
import styles from './primitives.module.css';

export function Pending({ reason, showWord = false }: { reason: PendingReason; showWord?: boolean }) {
  const label = pendingLabel(reason);
  return (
    <span className={styles['pending']} title={label} aria-label={label}>
      {PENDING_GLYPH}
      {showWord ? <span className={styles['pendingWord']}>{label}</span> : null}
    </span>
  );
}
