/**
 * The text tier: a weighted hash over shingles, and the distance over it.
 *
 * ★ WHAT THESE TESTS PROVE AND WHAT THEY DO NOT. Everything below is algebra over
 * strings written in this file, so it proves the hash is deterministic, order-carrying,
 * weight-respecting and refuses what it says it refuses. It proves nothing about recall
 * or precision on the real corpus, because there are no labelled near-duplicate pairs
 * anywhere in this system to measure against.
 *
 * ★ AND ONE MEASURED FINDING, RECORDED HERE BECAUSE IT IS CHEAPER TO READ THAN TO
 * REDISCOVER: at the shipped bar of 3 out of 64, this tier joins IDENTICAL text and
 * essentially nothing else. Measured in the last test below — a nineteen-shingle
 * sentence against itself is 0, the same sentence with one word appended is 8, the same
 * sentence with one word swapped is 7 to 13, and unrelated text is 30. The bar sits
 * under every one of those except equality.
 *
 * That is not a defect in the hash; it is what a simhash does with nineteen features.
 * The 3-of-64 figure is the number the near-duplicate literature uses for documents with
 * HUNDREDS of features, where one changed feature moves a fraction of a percent of the
 * mass. Here one changed shingle is five percent of it. The corpus makes this worse in
 * the same direction: items run 4 to 20 words, so half of them cannot even reach
 * minShingles, and coin names top out at six words, which is two shingles.
 *
 * So this tier as configured is an exact-duplicate detector wearing a near-duplicate
 * bar. Fixing it is a calibration exercise against labelled pairs, and there are no
 * labelled pairs — which is the finding, and why the number is asserted here rather than
 * quietly adjusted to something that looks better.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { hammingHex, simhash } from './simhash.ts';

const SHINGLE_WORDS = 5;
const BAR = DEFAULT_POLICY.group.textHashMaxDistance; // 3 of 64
const HEX_CHARS = DEFAULT_POLICY.group.textHashBits / 4; // 16

/** Overlapping word n-grams, in document order. What an adapter hands us. */
function shinglesOf(text: string): readonly string[] {
  const words = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    out.push(words.slice(i, i + SHINGLE_WORDS).join(' '));
  }
  return out;
}

/** Unit weights: what an empty corpus produces, which is the day-one state. */
function unit(shingles: readonly string[]): readonly number[] {
  return shingles.map(() => 1);
}

/** simhash where a refusal would itself be the bug. Throws so the failure names itself. */
function mustHash(
  shingles: readonly string[],
  weights: readonly number[],
  p: Policy = DEFAULT_POLICY,
): string {
  const h = simhash(shingles, weights, p);
  if (h === null) throw new Error(`expected a hash for ${shingles.length} shingles`);
  return h;
}

function hashOf(text: string, p: Policy = DEFAULT_POLICY): string {
  const shingles = shinglesOf(text);
  return mustHash(shingles, unit(shingles), p);
}

const LONG =
  'the ferry refuses to dock again today and nobody on the pier knows why it keeps circling back out to the open water';

/* ── shape ────────────────────────────────────────────────────────────── */

test('the hash is exactly as wide as the policy says, in lowercase hex', () => {
  const h = hashOf(LONG);
  assert.equal(h.length, HEX_CHARS);
  assert.match(h, /^[0-9a-f]+$/);
});

test('the hash follows the configured width, not a constant', () => {
  const wide: Policy = {
    ...DEFAULT_POLICY,
    group: { ...DEFAULT_POLICY.group, textHashBits: 128 },
  };
  assert.equal(hashOf(LONG, wide).length, 32);
});

test('a width that is not a whole number of hex digits is refused', () => {
  const odd: Policy = { ...DEFAULT_POLICY, group: { ...DEFAULT_POLICY.group, textHashBits: 65 } };
  const shingles = shinglesOf(LONG);
  assert.throws(() => simhash(shingles, unit(shingles), odd), RangeError);
});

/* ── the refusals ─────────────────────────────────────────────────────── */

test('empty text produces no hash at all, rather than a hash of nothing', () => {
  assert.equal(simhash([], [], DEFAULT_POLICY), null);
});

test('one shingle is refused, and so is anything under the minimum', () => {
  /* A short item's hash is dominated by a handful of terms and matches everything else
     that is short. Refusing is the cheapest defence there is against a false positive
     aimed at the cheapest items to produce. */
  const one = ['the ferry refuses to dock'];
  assert.equal(simhash(one, [1], DEFAULT_POLICY), null);

  for (let n = 0; n < DEFAULT_POLICY.group.minShingles; n++) {
    const some = shinglesOf(LONG).slice(0, n);
    assert.equal(simhash(some, unit(some), DEFAULT_POLICY), null, `${n} shingles must refuse`);
  }
  const enough = shinglesOf(LONG).slice(0, DEFAULT_POLICY.group.minShingles);
  assert.notEqual(simhash(enough, unit(enough), DEFAULT_POLICY), null);
});

test('shingles that carry no weight do not count toward the minimum', () => {
  /* Ten shingles of which nine weigh nothing is a one-shingle hash wearing a
     ten-shingle coat, and it will match every other item built the same way. The bar
     is applied to what actually enters the hash. */
  const shingles = shinglesOf(LONG).slice(0, 10);
  const mostlyWorthless = shingles.map((_, i) => (i < 2 ? 1 : 0));
  assert.equal(simhash(shingles, mostlyWorthless, DEFAULT_POLICY), null);

  const allWorthless = shingles.map(() => 0);
  assert.equal(simhash(shingles, allWorthless, DEFAULT_POLICY), null);

  const enoughWeighted = shingles.map((_, i) => (i < DEFAULT_POLICY.group.minShingles ? 1 : 0));
  assert.notEqual(simhash(shingles, enoughWeighted, DEFAULT_POLICY), null);
});

test('null is not an error and never becomes an all-zero hash', () => {
  /* The failure this forecloses: every weightless item hashing to 0000000000000000,
     which is distance 0 from every other weightless item — one story that swallows
     every short post in the stream. */
  const shingles = shinglesOf(LONG).slice(0, 8);
  assert.equal(simhash(shingles, shingles.map(() => 0), DEFAULT_POLICY), null);
});

/* ── the arguments ────────────────────────────────────────────────────── */

test('a length mismatch throws instead of zipping shortest', () => {
  const shingles = shinglesOf(LONG);
  assert.throws(() => simhash(shingles, [1, 2, 3], DEFAULT_POLICY), RangeError);
  assert.throws(() => simhash(shingles.slice(0, 6), unit(shingles), DEFAULT_POLICY), RangeError);
});

test('a negative or non-finite weight throws — there is no such thing as anti-evidence', () => {
  const shingles = shinglesOf(LONG).slice(0, 8);
  const weights = shingles.map(() => 1);
  assert.throws(() => simhash(shingles, weights.map((w, i) => (i === 3 ? -w : w)), DEFAULT_POLICY), RangeError);
  assert.throws(() => simhash(shingles, weights.map((w, i) => (i === 3 ? Number.NaN : w)), DEFAULT_POLICY), RangeError);
  assert.throws(() => simhash(shingles, weights.map((w, i) => (i === 3 ? Infinity : w)), DEFAULT_POLICY), RangeError);
});

/* ── determinism, which the stored key depends on ─────────────────────── */

test('the same shingles and weights produce the same hash, forever', () => {
  /* ★ A GOLDEN VALUE ON PURPOSE. The emitted hash is written to the store and compared
     against keys written weeks earlier. If a change to the bit derivation moves this
     string, every carrier already in the database becomes uncomparable to everything
     written after it — silently, because both sides still look like hashes. Breaking
     this test is allowed; breaking it by accident is not. */
  const shingles = [
    'the ferry refuses to dock again',
    'ferry refuses to dock again today',
    'refuses to dock again today and',
    'to dock again today and nobody',
    'dock again today and nobody knows',
    'again today and nobody knows why',
  ];
  assert.equal(simhash(shingles, [1, 2, 3, 4, 5, 6], DEFAULT_POLICY), '7ee21a4c26a16075');
});

test('identical items hash identically and sit at distance zero', () => {
  assert.equal(hashOf(LONG), hashOf(LONG));
  assert.equal(hammingHex(hashOf(LONG), hashOf(LONG)), 0);
  assert.ok(hammingHex(hashOf(LONG), hashOf(LONG)) <= BAR);
});

test('the order the shingles arrive in does not change the hash', () => {
  /* The hash is over the multiset of shingles. Word order is carried INSIDE each
     shingle, so it does not also need to be carried by the list — and an adapter that
     emitted them in a different order must not produce a different carrier. */
  const shingles = shinglesOf(LONG);
  const weights = shingles.map((_, i) => i + 1);
  const forward = simhash(shingles, weights, DEFAULT_POLICY);
  const backward = simhash([...shingles].reverse(), [...weights].reverse(), DEFAULT_POLICY);
  assert.equal(forward, backward);
});

test('word order carries, which a bag of tokens would lose entirely', () => {
  /* The same words, reversed. A term-frequency map cannot tell these apart at all —
     which is precisely what the build this replaces used as its similarity function. */
  const reversed = LONG.split(' ').reverse().join(' ');
  assert.notEqual(hashOf(LONG), hashOf(reversed));
  assert.ok(
    hammingHex(hashOf(LONG), hashOf(reversed)) > BAR,
    'a sentence and its reverse must not be near-duplicates',
  );
});

/* ── what the distance actually says ──────────────────────────────────── */

test('an edit is nearer than an unrelated item, by a wide margin', () => {
  /* The ordering the hash has to get right, whatever the bar is set to: a one-word edit
     is much closer than a different sentence, and a different sentence is out near the
     random-pair distance of 32. Everything the bar can be tuned to lives inside this. */
  const appended = `${LONG} again`;
  const swapped = LONG.replace('circling', 'drifting');
  const unrelated =
    'a pigeon rode the number nine bus for three stops this morning and got off before anyone could take a picture of it';

  const near = hammingHex(hashOf(LONG), hashOf(appended));
  const edited = hammingHex(hashOf(LONG), hashOf(swapped));
  const far = hammingHex(hashOf(LONG), hashOf(unrelated));

  assert.ok(near < far, `appended ${near} should be nearer than unrelated ${far}`);
  assert.ok(edited < far, `swapped ${edited} should be nearer than unrelated ${far}`);
  assert.ok(far > 25, `unrelated text should be far apart, got ${far}`);
});

test('★ the shipped bar joins identical text and nothing else — measured, not assumed', () => {
  /* These are the numbers behind the finding in this file's header, asserted rather than
     described so that a change to the weighting or the bar has to come here and edit
     them. That is the only way a shift in what this tier accepts becomes visible to
     anybody; a threshold whose effect nobody has written down is how the previous build
     became unauditable.

     Read the four assertions together: 0 joins, and 8, 13 and 30 do not. There is
     nothing between "the same text" and "not joined" at a bar of 3. */
  const identical = hammingHex(hashOf(LONG), hashOf(LONG));
  assert.equal(identical, 0);
  assert.ok(identical <= BAR, 'identical text must join');

  const appended = hammingHex(hashOf(LONG), hashOf(`${LONG} again`));
  assert.equal(appended, 8);
  assert.ok(appended > BAR, 'one appended word already falls outside the shipped bar');

  const swaps = [
    ['circling', 'drifting', 12],
    ['pier', 'dock', 13],
    ['ferry', 'boat', 7],
  ] as const;
  for (const [from, to, expected] of swaps) {
    const d = hammingHex(hashOf(LONG), hashOf(LONG.replace(from, to)));
    assert.equal(d, expected, `swapping ${from} for ${to}`);
    assert.ok(d > BAR, `swapping ${from} for ${to} landed at ${d}, inside the bar`);
  }

  const unrelated =
    'a pigeon rode the number nine bus for three stops this morning and got off before anyone could take a picture of it';
  assert.equal(hammingHex(hashOf(LONG), hashOf(unrelated)), 30);
});

test('weight decides how much a shingle is allowed to move the hash', () => {
  /* This is the whole reason weights exist. The same extra shingle, weighted to almost
     nothing, leaves the hash alone; weighted heavily, it takes the hash over. A term
     that is background must not be able to drag an item into someone else's story. */
  const base = shinglesOf(LONG);
  const anchor = mustHash(base, unit(base));

  const extended = [...base, 'a completely unrelated closing phrase here'];
  const light = mustHash(extended, [...unit(base), 0.01]);
  const heavy = mustHash(extended, [...unit(base), 500]);

  assert.equal(hammingHex(anchor, light), 0);
  assert.ok(
    hammingHex(anchor, heavy) > BAR,
    'a shingle weighted above everything else must dominate the hash',
  );
});

test('a term weighted to nothing contributes nothing, exactly as if it were absent', () => {
  /* The bridge to persistence.ts: carrierWeight returns 0 for a generic symbol and for
     a term present in almost every bucket. A zero here has to mean silence, not a
     half-vote — otherwise the by-nature list would only be a discount. */
  const base = shinglesOf(LONG);
  const withNoise = [...base, 'buy the token now moon'];

  const withoutIt = mustHash(base, unit(base));
  const silenced = mustHash(withNoise, [...unit(base), 0]);
  assert.equal(withoutIt, silenced);
});
