/**
 * The bit arithmetic under both free carrier tiers. Every claim here is algebra over
 * inputs constructed in this file — none of it needs a database, and none of it
 * pretends to.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { BITS_PER_HEX_DIGIT, bitsToHex, hashBit, hexHamming, hexWidthBits, isHexHash } from './bits.ts';

test('a hash is exactly as far from itself as it is from nothing', () => {
  assert.equal(hexHamming('0000', '0000'), 0);
  assert.equal(hexHamming('ffff', 'ffff'), 0);
  assert.equal(hexHamming('0000', 'ffff'), 16);
  assert.equal(hexHamming('0000', '0001'), 1);
  assert.equal(hexHamming('0000', '0007'), 3);
});

test('distance is symmetric, because "these two are the same thing" cannot depend on which arrived first', () => {
  const a = '9ad9d402ca1693f0';
  const b = '1258cb0a6e1411d0';
  assert.equal(hexHamming(a, b), hexHamming(b, a));
  assert.ok(hexHamming(a, b) > 0);
});

test('hashes of different lengths throw rather than return a plausible number', () => {
  /* The whole reason the primitive is strict: 3 out of 64 and 3 out of 256 are
     different claims, and a function that quietly compared the overlap would let the
     narrower bar be applied to the wider hash without anyone deciding to. */
  assert.throws(() => hexHamming('0000', '000000'), RangeError);
  assert.throws(() => hexHamming('000000', '0000'), RangeError);
});

test('a string that is not lowercase hex is not a hash', () => {
  assert.throws(() => hexHamming('zzzz', '0000'), TypeError);
  assert.throws(() => hexHamming('0000', 'zzzz'), TypeError);
  /* Uppercase is the same bits and a different string. One spelling, or the store's
     exact index and the bit comparison disagree about whether two carriers match. */
  assert.throws(() => hexHamming('ABCD', 'abcd'), TypeError);
  /* An empty string is not a zero-width hash. It is not a hash. */
  assert.throws(() => hexHamming('', ''), TypeError);
});

test('isHexHash is the total spelling of the same rule, for callers that must degrade', () => {
  assert.equal(isHexHash('abcd', 16), true);
  assert.equal(isHexHash('abcd', 32), false); // right characters, wrong width
  assert.equal(isHexHash('ABCD', 16), false); // wrong spelling
  assert.equal(isHexHash('my nana learns the dance', 64), false); // the live adapter defect
  assert.equal(isHexHash('abcd', 0), false);
  assert.equal(isHexHash('abcd', -16), false);
  assert.equal(isHexHash('abcd', 17), false); // not a whole number of hex digits
  assert.equal(isHexHash('', 16), false);
});

test('width is read off the string, four bits to a character', () => {
  assert.equal(BITS_PER_HEX_DIGIT, 4);
  assert.equal(hexWidthBits('abcd'), 16);
  assert.equal(hexWidthBits('0'.repeat(64)), 256);
});

test('bits pack big-endian, so the hex reads the way the vector was written', () => {
  assert.equal(bitsToHex([true, false, false, false]), '8');
  assert.equal(bitsToHex([false, false, false, true]), '1');
  assert.equal(bitsToHex([true, true, true, true]), 'f');
  assert.equal(bitsToHex([false, true, false, true, true, false, true, false]), '5a');
});

test('a bit vector that is not a whole number of hex digits has no spelling', () => {
  assert.throws(() => bitsToHex([]), RangeError);
  assert.throws(() => bitsToHex([true, false, true]), RangeError);
});

test('a derived bit is a function of its index and its token, and of nothing else', () => {
  /* Determinism across restarts is the property the whole replay guarantee rests on:
     a carrier key computed today has to be the same key when the same text arrives
     again tomorrow, or the join silently stops firing. */
  for (let b = 0; b < 8; b++) {
    assert.equal(hashBit(b, 'hipposeason'), hashBit(b, 'hipposeason'));
  }
});

test('★ a token changed in its LAST character produces different bits', () => {
  /* THIS TEST FOUND A REAL DEFECT AND IS THE REASON bits.ts HAS A FINALIZER. Written
     against a first implementation that took the top bit of FNV-1a directly, it failed
     at 64 agreements out of 64: `hipposeason` and `hipposeasoo` produced an identical
     bit vector. FNV-1a spreads a difference forward by multiplying, so a change in the
     last character reaches the final word as one multiple of the prime and almost never
     moves the top bit.

     What that would have cost, had it shipped: two shingles differing only in their last
     word are the same shingle as far as the text carrier is concerned. Plural and
     singular. A name and its possessive. Two coin names differing in one trailing
     character — which the real corpus is full of, because the source truncates names at
     thirty-two characters and the truncations differ only at the end.

     A good hash sends about half the bits the other way. Anything near 64 here is the
     old bug coming back. */
  let agreements = 0;
  for (let b = 0; b < 64; b++) {
    if (hashBit(b, 'hipposeason') === hashBit(b, 'hipposeasoo')) agreements++;
  }
  assert.ok(
    agreements > 20 && agreements < 44,
    `a one-character edit should flip about half the bits; ${agreements} of 64 agreed`,
  );
});

test('derived bits are balanced, not stuck on one value', () => {
  /* A hashBit that leaned heavily one way would push every item's hash toward the same
     string, and every item would be a near-duplicate of every other. */
  const token = 'the ferry refuses to dock again';
  let ones = 0;
  for (let b = 0; b < 64; b++) if (hashBit(b, token)) ones++;
  assert.ok(ones > 16 && ones < 48, `expected a balanced spread, got ${ones} ones of 64`);
});

test('the fast nibble arithmetic agrees with the obvious spelling, on every input', () => {
  /* hexHamming decodes hex with charCode arithmetic and counts bits with a two-round
     SWAR reduction, because it is the innermost loop of the pair decision and the
     obvious spelling — `parseInt` per nibble, then shift-and-test — measured four times
     slower over a realistic candidate block. Speed bought with arithmetic is only worth
     having if the arithmetic is right, so the obvious spelling lives on here as the
     oracle. Exhaustive over single digits; random over widths up to a 256-bit hash. */
  const DIGITS = '0123456789abcdef';
  const obvious = (a: string, b: string): number => {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      let x = parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16);
      while (x !== 0) {
        d += x & 1;
        x >>>= 1;
      }
    }
    return d;
  };

  for (const p of DIGITS) {
    for (const q of DIGITS) assert.equal(hexHamming(p, q), obvious(p, q), `${p} vs ${q}`);
  }

  // A fixed seed, so a failure is reproducible rather than a flake somebody reruns.
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const digit = (): string => DIGITS[Math.floor(next() * 16)] ?? '0';

  for (let trial = 0; trial < 5000; trial++) {
    const width = 1 + Math.floor(next() * 64);
    let a = '';
    let b = '';
    for (let i = 0; i < width; i++) {
      a += digit();
      b += digit();
    }
    assert.equal(hexHamming(a, b), obvious(a, b), `${a} vs ${b}`);
    // And the bound the signature promises.
    assert.ok(hexHamming(a, b) >= 0 && hexHamming(a, b) <= width * 4);
  }
});
