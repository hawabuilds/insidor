/**
 * ★ THE CENSORING RULE. Fifteen lines, no source named, and the single most
 * expensive bug in the build this replaces.
 *
 * The old `deltaPerMinute` published `0` when a counter had not visibly moved.
 * Downstream, `0` means "cooling", and cooling demotes. So the one case where the
 * source has told us nothing — a rounded counter whose change is smaller than the
 * rounding — was being read as positive evidence of decline, on exactly the items
 * that were accelerating. A zero looks like data, which is why nobody found it.
 *
 * The repair is a type, not a convention: this returns a `Rate`, which is either
 * measured or censored, so a caller cannot read `.perMin` without having handled
 * the censored branch. The compiler names the file and the line.
 *
 * The order of the tests below is deliberate and matches the design:
 *   unusable fidelity → no prior → no elapsed → below step → stale → non-monotonic.
 * Below-step is checked before staleness and before monotonicity because on a
 * rounded counter both of those are indistinguishable from rounding, and claiming
 * the more specific reason would be claiming to know something we do not.
 *
 * A censored reading also carries the last trustworthy LEVEL forward. Levels remain
 * usable when differences do not — "how big is this" survives rounding, "how fast
 * is it growing" does not.
 */

import type { KineticsPolicy } from '@insidor/contracts/policy.ts';
import type { Counter, Rate } from '@insidor/contracts/vocabulary.ts';
import { censoredRate, measuredRate } from '@insidor/contracts/vocabulary.ts';

import { isBelowStep } from './fidelity.ts';
import { MS_PER_MINUTE } from '../math.ts';


/**
 * @param prev        the previous reading of THIS counter, or null on first sight
 * @param curr        the reading just taken
 * @param siblingRose whether another counter on the same item rose over the same
 *                    interval. That is what separates "nothing happened" from "this
 *                    counter has gone stale while the item is plainly still moving",
 *                    and only the caller — which holds the whole CounterSet — knows.
 * @param k           the kinetics thresholds. There is no number in this file that
 *                    is not either a unit conversion or one of these.
 */
export function emitRate(
  prev: Counter | null,
  curr: Counter,
  siblingRose: boolean,
  k: KineticsPolicy,
): Rate {
  // A fuzzed or absent counter cannot support a difference at any interval. Its
  // level is not trustworthy either, so nothing is carried forward.
  if (curr.fidelity.kind === 'absent' || curr.fidelity.kind === 'fuzzed') {
    return censoredRate('unusable_fidelity', null);
  }
  // Not read this time. The previous level is still the best we know.
  if (curr.value === null) {
    return censoredRate('unusable_fidelity', prev?.value ?? null);
  }
  if (prev === null || prev.value === null) {
    return censoredRate('no_prior', curr.value);
  }
  if (prev.fidelity.kind === 'absent' || prev.fidelity.kind === 'fuzzed') {
    return censoredRate('unusable_fidelity', curr.value);
  }

  // Two readings too close together cannot support a difference: the numerator is
  // noise and the denominator is small, so the quotient is whatever it likes.
  const overMs = curr.observedAt - prev.observedAt;
  if (overMs <= 0 || overMs < k.minElapsedMs) {
    return censoredRate('no_elapsed', curr.value);
  }

  const delta = curr.value - prev.value;

  if (
    curr.fidelity.kind === 'quantized' &&
    isBelowStep(delta, curr.value, curr.fidelity.significantDigits, k.stepSafetyFactor)
  ) {
    return censoredRate('below_step', curr.value);
  }

  if (delta === 0 && siblingRose) {
    return censoredRate('stale_counter', curr.value);
  }

  // Counters in this system are cumulative. Going backwards means a correction, a
  // deletion, or a different shard answering — never a measurable negative rate.
  // Within tolerance we keep believing the older, larger level; beyond it the source
  // has restated itself and the new level is the one to carry forward.
  if (delta < 0) {
    const withinTolerance = Math.abs(delta) <= Math.abs(prev.value) * k.nonMonotonicTolerance;
    return censoredRate('non_monotonic', withinTolerance ? prev.value : curr.value);
  }

  return measuredRate(delta / (overMs / MS_PER_MINUTE), overMs, curr.value);
}
