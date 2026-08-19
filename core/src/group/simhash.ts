/**
 * Near-duplicate text, as a fixed-width hash plus a distance.
 *
 * Two properties this must have, both of which the previous implementation lacked:
 * it must be a hash of SHINGLES rather than of a token bag, so word order carries,
 * and it must weight terms by persistence rather than by raw document frequency, so
 * a new name is not suppressed exactly as it starts spreading.
 *
 * It must also refuse to emit for items with fewer than Policy.group.minShingles
 * shingles. A short item's hash is dominated by a handful of terms and matches
 * everything else that is short, which is a false-positive generator aimed at the
 * cheapest items to produce.
 *
 * ── TWO NOTES FOR WHOEVER TOUCHES THIS NEXT ──────────────────────────────────
 *
 * 1. THE SIGNATURE GREW A POLICY, and it had to. The header above demands a refusal
 *    below Policy.group.minShingles and the output has to be Policy.group.textHashBits
 *    wide; neither is expressible in a function that cannot see the Policy. The
 *    alternative — leaving the refusal to every caller — is the shape where one caller
 *    eventually forgets and the false positives arrive with no single place to fix
 *    them. Everything else about the signature is unchanged.
 *
 * 2. THE WEIGHTS MAKE THIS A FUNCTION OF THE CORPUS, NOT ONLY OF THE ITEM. Two items
 *    with identical text hash identically only while their terms weigh the same, and
 *    term weights move as the fourteen-day buckets roll. That is why the store keeps
 *    the emitted key rather than recomputing it on read: a recomputed hash is a hash
 *    from a different day, and the join it reproduces is not the join that was made.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { bitsToHex, hashBit, hexHamming, BITS_PER_HEX_DIGIT } from '../bits.ts';

/**
 * A weighted SimHash over the item's shingles, returned as a hex string of
 * `p.group.textHashBits / 4` characters — or null when the item has too little to say.
 *
 * THE WEIGHTS ARE THE WHOLE POINT, and they must come from group/persistence.ts:
 * `carrierWeight(term, idf24h, dfByBucket, p)`, which is idf24h × (1 − persistence).
 * Passing raw document frequency here reintroduces the exact bug this stage exists to
 * avoid — a term climbing from one document to eighty inside a day gets down-weighted
 * precisely as it starts mattering, so the story that is spreading is the one the
 * hash stops being able to see. Persistence asks the other question: not "how common
 * is this term today" but "how many of the last fourteen days has it been common in".
 * Background is weighted away; a two-day spike keeps almost all of its weight.
 *
 * Bucket statistics arrive as an argument because core cannot fetch them. Computing a
 * document frequency is a store query (CarrierRepo.dailyFrequency), and a hash that
 * read one would not be replayable.
 *
 * TWO REFUSALS, both returning null rather than a hash nobody should act on:
 *
 *   - fewer than `p.group.minShingles` shingles at all. Short text, per the header.
 *   - fewer than `p.group.minShingles` shingles that carry any weight. This is the
 *     same fear stated against the quantity it is actually about: a ten-shingle item
 *     whose nine common shingles weigh nothing is a one-shingle hash wearing a
 *     ten-shingle coat, and it will match every other item built the same way.
 *
 * Null is not an error and must not be treated as one. It means this item contributes
 * no text carrier — the image and format tiers are untouched, and grouping continues
 * without it. An item with nothing to fingerprint is common and is not a failure.
 *
 * @param shingles overlapping word n-grams, in document order. Order carries because
 *                 each shingle is itself an ordered phrase; the hash of the SET of
 *                 shingles is therefore already order-sensitive, which a token bag is
 *                 not. Duplicates are kept: a phrase repeated is a phrase weighted.
 * @param weights  parallel to `shingles`. Non-negative; zero means "no evidence".
 * @throws RangeError on a length mismatch, a negative or non-finite weight, or a
 *         configured width that is not a whole number of hex digits.
 */
export function simhash(
  shingles: readonly string[],
  weights: readonly number[],
  p: Policy,
): string | null {
  /* Zip-shortest would silently drop the tail of the longer array, and the tail of a
     shingle list is the end of the sentence. A caller that has mismatched these has a
     bug upstream and needs to hear about it here, not in a join six weeks later. */
  if (shingles.length !== weights.length) {
    throw new RangeError(
      `simhash: ${shingles.length} shingles against ${weights.length} weights`,
    );
  }

  const width = p.group.textHashBits;
  if (!Number.isInteger(width) || width <= 0 || width % BITS_PER_HEX_DIGIT !== 0) {
    throw new RangeError(`simhash: textHashBits ${width} is not a whole number of hex digits`);
  }

  if (shingles.length < p.group.minShingles) return null;

  /* One accumulator per output bit. A shingle pushes each bit toward 1 or toward 0 by
     its own weight, and the sign of the total decides. That is what makes the hash
     robust to a single edit: changing one shingle moves every bit by that shingle's
     weight and flips only the bits it was close to deciding. */
  const pull = new Array<number>(width).fill(0);
  let contributing = 0;

  for (let s = 0; s < shingles.length; s++) {
    const shingle = shingles[s] ?? '';
    const weight = weights[s] ?? 0;

    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`simhash: weight ${weight} at index ${s} is not a non-negative number`);
    }
    /* A zero-weight shingle is not evidence, so it does not get a vote. Skipping is
       not an optimisation — it is what makes `contributing` mean something. */
    if (weight === 0) continue;
    contributing++;

    for (let b = 0; b < width; b++) {
      const current = pull[b] ?? 0;
      pull[b] = current + (hashBit(b, shingle) ? weight : -weight);
    }
  }

  if (contributing < p.group.minShingles) return null;

  /* A tied bit resolves to 0. Ties happen when opposing shingles weigh the same, which
     is common once weights are coarse, and the tie has to break the SAME way every
     time or the hash stops being a function of its input. */
  return bitsToHex(pull.map((total) => total > 0));
}

/**
 * Hamming distance between two same-width hex hashes, in [0, width].
 *
 * Throws on differing widths for the same reason group/phash.ts does: a bar is
 * calibrated against a width — 3 out of 64 here — and the same 3 out of 256 is a
 * different claim entirely. There is no honest number to return when the widths
 * disagree, so there is no number returned.
 *
 * @throws RangeError when the widths differ.
 * @throws TypeError when either argument is not non-empty lowercase hex.
 */
export function hammingHex(a: string, b: string): number {
  return hexHamming(a, b);
}
