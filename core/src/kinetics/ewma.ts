/**
 * Continuous-time exponential moving average.
 *
 * WHY not the textbook `α·x + (1−α)·S`: that form assumes a fixed sampling
 * interval, and this system's sampling grid is irregular BY DESIGN — a hot item is
 * read every four minutes, a cold one every seventy-eight. Under the discrete form
 * the frequently-sampled item's average tracks its recent values more closely for
 * purely mechanical reasons, so the items we look at most appear to move most. That
 * is a ranking signal manufactured by the scheduler.
 *
 * The continuous form weights by elapsed time instead: w = exp(−Δt/τ). Two reads
 * four minutes apart and two reads forty minutes apart produce the same average
 * from the same underlying behaviour, which is the property that makes a fast/slow
 * pair comparable at all.
 *
 * The pair is what buys the earliness: burst = fast/slow is available at the SECOND
 * observation, where a three-point acceleration estimate needs a third read —
 * roughly five minutes earlier on a product that sells earliness.
 */

import type { Millis } from '@insidor/contracts/vocabulary.ts';

/**
 * An average AND the instant it is current as of. The second field is what makes this a
 * continuous-time average rather than a discrete one: decay is computed from the elapsed
 * gap, so an irregular sampling grid does not bias the result.
 *
 * Store the value without the timestamp and the only thing left to decay by is "one
 * step", which silently reweights an item read every minute against one read every hour
 * — mechanically favouring whatever the scheduler happened to sample most.
 */
export interface Ewma {
  readonly value: number;
  /** The instant of the most recent sample folded in. Decay is measured from here. */
  readonly at: Millis;
}

/** The weight the existing average keeps after Δt has passed. */
export function decayWeight(elapsedMs: number, tauMs: number): number {
  if (!(tauMs > 0)) throw new RangeError(`decayWeight: tau must be positive, got ${tauMs}`);
  if (elapsedMs <= 0) return 1;
  return Math.exp(-elapsedMs / tauMs);
}

/**
 * Folds one sample into the average.
 *
 * @param prev null on the first sample, which the average then equals exactly —
 *             seeding with zero would make every series start by claiming a decline.
 * @param at   the instant the sample was taken. Out-of-order samples are ignored
 *             rather than folded in backwards; the caller decides whether that is
 *             worth a log line.
 */
export function ewmaUpdate(prev: Ewma | null, sample: number, at: Millis, tauMs: number): Ewma {
  if (prev === null) return { value: sample, at };
  if (at <= prev.at) return prev;
  const w = decayWeight(at - prev.at, tauMs);
  return { value: w * prev.value + (1 - w) * sample, at };
}

/**
 * The average as of a later instant with no new sample: it decays toward zero.
 *
 * This matters for the slow leg of a burst ratio. An item nobody has read in an
 * hour has not held its rate for that hour, and reading the stored value as though
 * it had is how a dead item keeps a high burst score.
 */
export function ewmaDecayTo(prev: Ewma, at: Millis, tauMs: number): Ewma {
  if (at <= prev.at) return prev;
  return { value: prev.value * decayWeight(at - prev.at, tauMs), at };
}
