/**
 * Ages.
 *
 * The rule this file holds is the desktop app's (`app/src/shared/format/duration.ts`): an
 * unknown instant renders as the pending glyph, never as "0s" — which would read as brand
 * new on a product whose whole subject is earliness. The clock is a parameter, never a call,
 * so two rows in one paint agree on the time and a test can state it.
 *
 * Kept to the two functions the phone app uses; the mint-age and countdown helpers belong to
 * desktop surfaces this app does not have.
 */

import type { Instant, Millis } from './measure.ts';
import type { Rendered } from './rendered.ts';
import { pendingRendered, value } from './rendered.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "12s" "4m" "3h" "6d". One unit, never "3h 12m". */
export function formatDuration(ms: number): string {
  const a = Math.abs(ms);
  if (a < MINUTE) return `${Math.floor(a / SECOND)}s`;
  if (a < HOUR) return `${Math.floor(a / MINUTE)}m`;
  if (a < DAY) return `${Math.floor(a / HOUR)}h`;
  return `${Math.floor(a / DAY)}d`;
}

/** How long ago something began. A future origin is a bad reading, not a negative age. */
export function formatAge(origin: Instant, now: Millis): Rendered {
  if (!origin.known) return pendingRendered(origin.pending);
  const elapsed = now - origin.at;
  if (elapsed < 0) return pendingRendered('unreadable');
  return value(formatDuration(elapsed));
}
