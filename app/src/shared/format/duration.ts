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
import { pendingLabel, pendingRendered, value } from './rendered.ts';

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
 * ★ HOW OLD A MINT IS, AND WHETHER WE ARE ENTITLED TO STATE IT PRECISELY.
 *
 * This lives here, in the leaf, because TWO surfaces show a mint age — the launches rail and
 * the pairs screen — and mint time is the axis every ordering claim in this product hangs
 * on. Two spellings of this rule would agree on the day they were written, and the drift
 * would surface as an estimate rendered as a reading on whichever screen was edited second.
 *
 * ★ BOTH SURFACES GO THROUGH THIS ONE. `features/rail/launches.ts` used to spell the same
 * three branches inline in `launchAge`, from before there was a second caller; it now
 * delegates here and keeps only the wrapper that reads the two fields off a `Launch`, so no
 * call site can pass the instant without its bound. The duplication was named here as debt
 * rather than left to be noticed, because its failure mode is silent and asymmetric: the "~"
 * quietly stops appearing on whichever screen was edited second, and a bounded estimate is
 * then rendered as a reading.
 *
 * Three outcomes, and the middle one is the common one on a socket-fed pipeline:
 *
 *   - No mint time at all → the pending glyph with its reason. NOT "0s", which would read as
 *     brand new and promote the coins we know least about to the top of a list whose whole
 *     subject is earliness.
 *   - A bounded mint time → the age with a "~" in front of it and the bound spelled out in
 *     words. The tilde is doing real work: without it an interval whose half-width is twenty
 *     seconds displays identically to a chain-confirmed reading, and somebody downstream
 *     compares it against a post timestamp to the second.
 *   - An exact mint time → the age plain. Only a chain confirmation earns this, and the
 *     store's `exact_requires_real_source` constraint is what stops anything else claiming
 *     it.
 *
 * `formatAge` already refuses a future origin, so a clock-skewed row arrives as a dash and
 * not as "-4s".
 *
 * ★ THE BOUND IS ROUNDED UP, NEVER DOWN, and one second is its floor. `formatDuration`
 * floors — it is built for ages, where flooring is right — so a half-second bound would be
 * phrased "give or take 0s", which is the caveat deleted while the tilde stays on, and that
 * reads as an exact time wearing an apology. The projector already floors this at one second
 * so it cannot fire against our own server; it fires against one that does not.
 */
export function mintAge(
  mintedAt: Instant,
  boundS: number | null,
  now: Millis,
): { readonly age: Rendered; readonly label: string } {
  const age = formatAge(mintedAt, now);
  if (age.kind === 'pending') return { age, label: pendingLabel(age.reason) };
  if (boundS === null) return { age, label: `minted ${age.text} ago` };

  const bound = formatDuration(Math.max(SECOND, boundS * SECOND));
  return {
    age: value(`~${age.text}`),
    /* The bound is stated in words rather than only implied by the tilde, because a tilde is
       a hint and a user acting on the order of two events needs the number. */
    label: `minted about ${age.text} ago, give or take ${bound}`,
  };
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
