/**
 * Term weighting for the grouper: persistence, not raw document frequency.
 *
 * This is counter-intuitive and it is the point. Raw IDF treats a term appearing in
 * many documents as ambience and down-weights it — so a genuinely new name climbing
 * from one document to eighty inside a day gets down-weighted EXACTLY when it starts
 * mattering. That is the opposite of what a detector of new things needs.
 *
 * Persistence separates the two cases by asking a different question: not "how common
 * is this term today" but "how many of the last fourteen days has it been common in".
 * A term that is always around scores near one and is weighted to nothing. A term
 * that spiked in the last two days scores near zero and keeps almost its whole
 * weight, however common it is right now.
 *
 *   persistence(t) = buckets where df(t) ≥ floor  /  buckets
 *   w(t)           = idf24h(t) × (1 − persistence(t))
 *   w(t)           = 0  if t is a generic symbol
 *
 * THE HISTORY ACCRUES FORWARD ONLY. The daily bucket table has to start being written
 * on day one; there is no way to reconstruct it later, and without fourteen days of
 * it this function is a slightly worse IDF.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { clamp01 } from '../math.ts';
import { isGenericTicker } from '../qualify/generic-tickers.ts';

/**
 * @param dfByBucket document frequency per daily bucket, oldest first. Shorter than
 *                   Policy.group.persistenceBuckets while the history is still
 *                   accruing, which is honest: a term cannot be shown to persist over
 *                   days that were never observed.
 */
export function persistence(dfByBucket: readonly number[], p: Policy): number {
  const buckets = Math.max(dfByBucket.length, p.group.persistenceBuckets);
  if (buckets === 0) return 0;
  let present = 0;
  for (const df of dfByBucket) {
    if (df >= p.group.persistenceDfFloor) present++;
  }
  return clamp01(present / buckets);
}

/**
 * The weight a shared term contributes as evidence that two items are the same thing.
 * Zero for a generic symbol, whatever its frequency: one story in the previous build
 * accreted thirty-nine unrelated posts because they all mentioned the same one.
 */
export function carrierWeight(
  term: string,
  idf24h: number,
  dfByBucket: readonly number[],
  p: Policy,
): number {
  if (isGenericTicker(term)) return 0;
  return idf24h * (1 - persistence(dfByBucket, p));
}
