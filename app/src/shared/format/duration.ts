/**
 * Ages and durations.
 *
 * This file is the specific fix for the specific bug. The previous build rendered a story
 * with a missing timestamp as "0s old" — brand new — which on a product that sells
 * earliness promotes exactly the rows it knows least about. `formatAge` cannot do that,
 * because it takes an `Instant` and the unknown branch of an `Instant` carries no number to
 * subtract from `now`.
 *
 * The clock is a parameter, never a call. Two rows rendered in the same paint must agree on
 * what time it is, and a test must be able to state the time.
 */

import type { Instant, Millis } from './measure.ts';
import type { Rendered } from './rendered.ts';
import { pendingRendered, value } from './rendered.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "12s" "4m" "3h" "6d". One unit, never "3h 12m": this is a column, not a sentence. */
export function formatDuration(ms: number): string {
  const a = Math.abs(ms);
  if (a < MINUTE) return `${Math.floor(a / SECOND)}s`;
  if (a < HOUR) return `${Math.floor(a / MINUTE)}m`;
  if (a < DAY) return `${Math.floor(a / HOUR)}h`;
  return `${Math.floor(a / DAY)}d`;
}

/**
 * How long ago something began.
 *
 * Two rules that are not obvious:
 *   - An unknown origin renders as pending. NOT as 0, and not as the age of the moment we
 *     first happened to see the row, which is the same lie one step removed.
 *   - An origin in the future is `unreadable`, not a negative age. Clock skew between a
 *     platform's stated post time and ours is real and small; a row claiming to be from
 *     next week is a bad reading, and the honest render of a bad reading is a dash.
 */
export function formatAge(origin: Instant, now: Millis): Rendered {
  if (!origin.known) return pendingRendered(origin.pending);
  const elapsed = now - origin.at;
  if (elapsed < 0) return pendingRendered('unreadable');
  return value(formatDuration(elapsed));
}

/**
 * Time until something expires — a quote's blockhash, typically. Past expiry is not a
 * negative countdown; it is expired, and the caller must be made to handle that, so this
 * returns pending rather than "-3s".
 */
export function formatCountdown(deadline: Instant, now: Millis): Rendered {
  if (!deadline.known) return pendingRendered(deadline.pending);
  const remaining = deadline.at - now;
  if (remaining <= 0) return pendingRendered('unreadable');
  return value(formatDuration(remaining));
}
