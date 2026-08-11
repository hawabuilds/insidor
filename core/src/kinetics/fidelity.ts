/**
 * What a source's rounding actually costs you, in units of the counter.
 *
 * A source that reports significant digits rather than exact values is telling you
 * that a whole interval of true values maps to the number you were handed. The
 * width of that interval is the smallest change you could ever detect, and it grows
 * with the magnitude of the value — which is why the adapter declares
 * `significantDigits` and this file derives the step. An adapter that declared a
 * fixed step would be wrong at every magnitude but one.
 *
 * This is the arithmetic the censoring rule in rate.ts stands on.
 */

import { DECIMAL_BASE } from '../math.ts';

/**
 * The rounding step of `value` when reported to `significantDigits`.
 *
 * A value rounded to 4 significant digits reports 12,340 for anything in
 * [12,335, 12,345) — so the step is 10, and a difference of 8 is not evidence of
 * anything. Below the base the step is 1: a small integer cannot be reported to
 * more precision than it has.
 */
export function quantizationStep(value: number, significantDigits: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude) || magnitude < 1) return 1;
  if (!Number.isFinite(significantDigits) || significantDigits < 1) return magnitude;
  const exponent = Math.floor(Math.log10(magnitude)) - (significantDigits - 1);
  return Math.pow(DECIMAL_BASE, exponent);
}

/**
 * Whether a difference is too small to have survived the source's rounding. A
 * difference of exactly one step is admitted — that one is resolvable; anything
 * under it could have been produced by a true change of zero.
 *
 * @param safetyFactor Policy.kinetics.stepSafetyFactor. One trusts the arithmetic
 *                     exactly; above one demands the change clear the rounding by a
 *                     margin, which is the knob to turn if a source turns out to
 *                     round less honestly than it claims.
 */
export function isBelowStep(
  delta: number,
  value: number,
  significantDigits: number,
  safetyFactor: number,
): boolean {
  return Math.abs(delta) < quantizationStep(value, significantDigits) * safetyFactor;
}
