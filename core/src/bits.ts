/**
 * Bits, carried as hex characters. The arithmetic underneath both free carrier tiers.
 *
 * WHY this is a file rather than two private helpers: the perceptual image hash and
 * the near-duplicate text hash are the same problem at two widths — a fixed-width bit
 * vector spelled as a hex string, compared by counting the bits that differ. Written
 * twice it gets written twice differently, and a distance function that is subtly
 * wrong in one of two copies produces joins nobody can explain and nobody can find.
 *
 * It is also the only place in core where "four bits to a hex digit" and "radix
 * sixteen" appear, which is why one allowlist entry in tools/check-policy.mjs covers
 * both consumers instead of a scattering of per-line escapes. Nothing in this file is
 * a threshold: a nibble is four bits under every policy this system will ever ship.
 * The judgements — how far apart two hashes may be, how wide they are — stay in
 * Policy.group, where group/phash.ts and group/simhash.ts read them.
 *
 * Everything here THROWS on a malformed input rather than returning a plausible
 * number. A distance between hashes of different widths is not a large distance, it
 * is a category error, and the caller that wants to survive one (see group/
 * carriers.ts) must check first — which it can, with isHexHash.
 */

import { fnv1a } from './hash.ts';

/** Four bits to a hex digit. Not tunable in any universe. */
export const BITS_PER_HEX_DIGIT = 4;

/** The base a hash is written in here. The role DECIMAL_BASE plays in math.ts. */
export const HEX_RADIX = 16;

/**
 * Lowercase only, and deliberately so. `A1` and `a1` are the same bits but different
 * strings, and a carrier key is compared as a string in three places before it is
 * ever compared as bits — the store's exact index, the corpus lookup, and the
 * fingerprint intersection. One spelling, enforced at the door.
 */
const HEX_ONLY = /^[0-9a-f]+$/;

/** The index of the top bit of a 32-bit word. Structure, not a judgement. */
const TOP_BIT = 31;

/* ── decoding a hex digit without parseInt ────────────────────────────────
 *
 * ★ THIS IS THE HOTTEST LOOP IN GROUP AND IT IS WORTH THE FOUR CONSTANTS.
 *
 * The pair decision is O(candidates × item fingerprints × story carriers), and the
 * innermost operation is one nibble of one hamming distance. A 256-bit image hash is 64
 * nibbles; a block of 200 stories holding 100 carriers each, against an item carrying
 * eight fingerprints, is on the order of ten million nibbles for ONE item. Measured on
 * that shape, `parseInt(s.charAt(i), 16)` — which allocates a one-character string and
 * then runs a general-purpose radix parser, twice per nibble — plus a shift-and-test
 * loop for the popcount, cost 68 ms per decision. At 30,000 posts a day that is 34
 * minutes of CPU spent almost entirely inside `parseInt`.
 *
 * Neither of these is a threshold and neither is tunable: '0' is at 48 in ASCII under
 * every policy this system will ever ship, and the popcount identity below is
 * arithmetic. They are here rather than in a stage file for exactly that reason.
 */
const CODE_ZERO = '0'.charCodeAt(0);
const CODE_NINE = '9'.charCodeAt(0);
const CODE_LOWER_A = 'a'.charCodeAt(0);
/** What 'a' is worth as a digit. */
const A_VALUE = 10;

/**
 * The value of one lowercase hex digit, by character code.
 *
 * Callers MUST have validated with HEX_ONLY first — this returns nonsense rather than
 * throwing for anything else, which is the trade that makes it fast. Both public
 * entry points below validate.
 */
function nibbleAt(hash: string, index: number): number {
  const code = hash.charCodeAt(index);
  return code <= CODE_NINE ? code - CODE_ZERO : code - CODE_LOWER_A + A_VALUE;
}

/**
 * Population count of a four-bit value, as arithmetic rather than a loop or a table.
 *
 * The standard SWAR reduction, stopped after two rounds because four bits need no more:
 * the first pairs adjacent bits, the second sums the two pairs. A table would be a
 * bounds-checked array read; this is three ANDs, two shifts and a subtract.
 */
function popcount4(nibble: number): number {
  const pairs = nibble - ((nibble >> 1) & 0b0101);
  return (pairs & 0b0011) + ((pairs >> 2) & 0b0011);
}

/** How many bits a hex string carries. No validation: use isHexHash for that. */
export function hexWidthBits(hash: string): number {
  return hash.length * BITS_PER_HEX_DIGIT;
}

/**
 * True when `hash` is exactly `bits` bits of lowercase hex.
 *
 * The total, non-throwing spelling of the width rule, for callers that must degrade
 * rather than fail: an uncomparable fingerprint is not evidence of sameness, and one
 * malformed row from one adapter must not stop grouping for every item behind it.
 */
export function isHexHash(hash: string, bits: number): boolean {
  if (!Number.isInteger(bits) || bits <= 0) return false;
  if (bits % BITS_PER_HEX_DIGIT !== 0) return false;
  if (hash.length !== bits / BITS_PER_HEX_DIGIT) return false;
  return HEX_ONLY.test(hash);
}

/**
 * Hamming distance between two hex strings of the same width, in [0, width].
 *
 * Throws on differing widths and on anything that is not hex. Both are refusals on
 * purpose: comparing a 64-bit hash against a 256-bit one has no meaning, and the
 * plausible number it would otherwise return is exactly the kind of confident
 * nonsense this codebase is being rebuilt to remove.
 */
export function hexHamming(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `hexHamming: widths differ — ${hexWidthBits(a)} bits against ${hexWidthBits(b)} bits`,
    );
  }
  if (!HEX_ONLY.test(a) || !HEX_ONLY.test(b)) {
    throw new TypeError('hexHamming: both hashes must be non-empty lowercase hex');
  }

  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    /* Nibble at a time. A whole-string parseInt loses precision past 53 bits, which
       is under a third of the way through a 256-bit image hash — and it would lose it
       silently, in the high bits, which are the ones a perceptual hash puts its
       strongest structure in.

       The decode and the popcount are both branch-free arithmetic rather than
       `parseInt` and a shift loop; see the note above nibbleAt for the measurement that
       says why this loop in particular earns it. The two spellings agree on every input
       HEX_ONLY admits, which is what bits.test.ts checks. */
    distance += popcount4(nibbleAt(a, i) ^ nibbleAt(b, i));
  }
  return distance;
}

/**
 * A 32-bit avalanche finalizer, so that one changed input bit changes about half the
 * output bits.
 *
 * ★ WHY FNV-1a ALONE IS NOT ENOUGH HERE, measured rather than assumed: the test in
 * bits.test.ts that catches this was written before this function existed and failed
 * immediately. FNV-1a spreads a difference forward by multiplying, so a change near the
 * END of a string has almost no room left to propagate — the last character's delta
 * reaches the final word as a single multiple of the prime, roughly sixteen million out
 * of four billion, which moves the top bit about once in every two hundred and fifty
 * tries. `hipposeason` and `hipposeasoo` agreed on all sixty-four derived bits. Two
 * shingles differing only in their last word would have been the same shingle as far as
 * the text carrier could tell, which is a false-positive generator with no visible cause.
 *
 * FNV-1a remains the right hash for what hash.ts uses it for — bucketing a whole key,
 * where the difference is rarely one trailing bit. It is not sufficient for deriving
 * INDEPENDENT bits from near-identical tokens, which is exactly what a simhash does. The
 * two xorshift-multiply rounds below are the standard fix and cost nothing.
 *
 * The four constants are the finalizer, not a choice. Changing any of them changes every
 * carrier key this system has ever written, and silently: both spellings still look like
 * hashes, so nothing fails — the old keys simply stop matching the new ones.
 */
function avalanche(word: number): number {
  let x = word >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * One unbiased bit derived from a token, indexed so a single token can supply as many
 * bits as a hash needs.
 *
 * The index goes on the END, so the token's own characters are the ones furthest from
 * the finalizer and get the most mixing. The separator is a space, which cannot make two
 * different (token, index) pairs collide: the index contains no space, so it is read off
 * the tail unambiguously.
 *
 * WHY NOT SIMPLY TAKE A LOW BIT of fnv1a: its prime is odd, so the multiply cannot change
 * bit zero, and the hash's low bit collapses to the parity of the low bits of the input
 * characters. A simhash built on that agrees between any two strings whose letters happen
 * to share a parity. The top bit of the finalized word depends on all of them.
 */
export function hashBit(bitIndex: number, token: string): boolean {
  return avalanche(fnv1a(`${token} ${bitIndex}`)) >>> TOP_BIT === 1;
}

/**
 * Pack a big-endian bit vector into lowercase hex. Length must be a whole number of
 * hex digits, because a hash of thirteen bits has no spelling anyone can index on.
 */
export function bitsToHex(vector: readonly boolean[]): string {
  if (vector.length === 0 || vector.length % BITS_PER_HEX_DIGIT !== 0) {
    throw new RangeError(
      `bitsToHex: ${vector.length} bits is not a whole number of hex digits`,
    );
  }

  let out = '';
  for (let i = 0; i < vector.length; i += BITS_PER_HEX_DIGIT) {
    let nibble = 0;
    for (let k = 0; k < BITS_PER_HEX_DIGIT; k++) {
      nibble = (nibble << 1) | (vector[i + k] === true ? 1 : 0);
    }
    out += nibble.toString(HEX_RADIX);
  }
  return out;
}
