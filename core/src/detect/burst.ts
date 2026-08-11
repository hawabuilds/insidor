/**
 * burst = fast / slow. A scale-free statement that something is bending upward.
 *
 * WHY a ratio of two averages rather than a second difference: a second difference
 * needs three readings, which is fourteen minutes at the top of the read grid. The
 * ratio of a fast average to a slow one is available at the SECOND reading, and
 * `burst − 1` is a curvature proxy — five minutes earlier, on a product that sells
 * earliness.
 *
 * WHY it is a ratio at all: the numerator and the denominator are in the same units,
 * so the units cancel. That is what makes the number comparable between one source's
 * autoplay-driven counter and another's impression-driven one, without a table of
 * per-source constants that has to be re-derived every time a vendor changes.
 *
 * Both legs decay to the instant being asked about, so an item nobody has read in an
 * hour cannot keep a high burst score by sitting still.
 */

import type { KineticsPolicy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { MS_PER_MINUTE, safeRatio } from '../math.ts';
import { ewmaDecayTo, type Ewma } from '../kinetics/ewma.ts';


/** null — never 1 — when either leg is missing or the slow leg has decayed to nothing. */
export function burst(
  fast: Ewma | null,
  slow: Ewma | null,
  at: Millis,
  k: KineticsPolicy,
): number | null {
  if (fast === null || slow === null) return null;
  const f = ewmaDecayTo(fast, at, k.fastTauMin * MS_PER_MINUTE);
  const s = ewmaDecayTo(slow, at, k.slowTauMin * MS_PER_MINUTE);
  return safeRatio(f.value, s.value);
}
