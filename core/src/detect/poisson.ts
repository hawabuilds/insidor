/**
 * eta — how atypical is this count, given what we expected?
 *
 *   eta = −log10 P(X ≥ n | expectation)
 *
 * WHY this shape and not a threshold on the count: eta is a ratio to an expectation,
 * so it is comparable across sources, across hours of the day and across accounts of
 * wildly different sizes, without a per-source constant that has to be re-derived
 * every time a vendor changes. A count of forty is extraordinary for one account and
 * a quiet afternoon for another; eta says which.
 *
 * TWO CORRECTIONS THAT MUST SURVIVE INTO THE IMPLEMENTATION, both measured:
 *
 *   - The variance axis is the EXPECTED COUNT, not the item's age. Under Poisson-ish
 *     noise the spread goes as 1/√μ, and μ spans two to three orders of magnitude
 *     across accounts at a single age. A table of standard deviations indexed by age
 *     cannot flatten that and will systematically over-alert on small accounts.
 *   - log1p on small counts biases the account baseline downward, which inflates the
 *     score for low-baseline accounts — a false-positive generator aimed precisely at
 *     the accounts an adversary can cheaply create. Fit a negative binomial, which
 *     handles zeros natively.
 */

import { notImplemented } from '../not-implemented.ts';

/**
 * TO BUILD: the upper-tail probability of a count under a fitted expectation,
 * returned as −log10 so that bigger is more surprising and the scale is readable.
 *
 * @param count       the arrivals observed in the window
 * @param expectation the fitted mean for this subject in this window
 * @param dispersion  the negative-binomial dispersion. Poisson is the limit as this
 *                    goes to infinity; real counts are always more spread than that,
 *                    and assuming they are not is what produces confident nonsense.
 */
export function eta(_count: number, _expectation: number, _dispersion: number): number {
  return notImplemented('detect/poisson.ts: −log10 of the negative-binomial upper tail');
}
