/**
 * The image-hash tier. Comparison only — nothing here decodes an image, and nothing
 * here could: the hash arrives already computed.
 *
 * ★ SAY IT OUT LOUD: every hash in this file is invented. No adapter in this repository
 * produces an imageHash today — hashing needs the bytes, the bytes need a download, and
 * a download is a second call an adapter is not allowed to make — and there is no media
 * pipeline behind them. So these tests prove that the comparison is correct arithmetic
 * with the bars the policy names. They prove NOTHING about recall or precision on real
 * images, because there are no real images to be right or wrong about yet.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { imageHashDistance } from './phash.ts';

const BITS = DEFAULT_POLICY.group.imageHashBits; // 256
const HEX_CHARS = BITS / 4; // 64

const ZERO = '0'.repeat(HEX_CHARS);
/** f×7 is 28 set bits, 7 is three more: 31, which is exactly the shipped bar. */
const AT_THE_BAR = `fffffff7${'0'.repeat(HEX_CHARS - 8)}`;
/** One bit further out. The first hash that must not join. */
const OVER_THE_BAR = `ffffffff${'0'.repeat(HEX_CHARS - 8)}`;

test('the same image is at distance zero from itself', () => {
  assert.equal(imageHashDistance(ZERO, ZERO, BITS), 0);
  assert.equal(imageHashDistance(AT_THE_BAR, AT_THE_BAR, BITS), 0);
});

test('distance is symmetric', () => {
  assert.equal(
    imageHashDistance(ZERO, AT_THE_BAR, BITS),
    imageHashDistance(AT_THE_BAR, ZERO, BITS),
  );
});

test('the shipped bar of 31 out of 256 is a bar, not a suggestion', () => {
  assert.equal(imageHashDistance(ZERO, AT_THE_BAR, BITS), DEFAULT_POLICY.group.imageHashMaxDistance);
  assert.equal(imageHashDistance(ZERO, OVER_THE_BAR, BITS), 32);
  assert.ok(imageHashDistance(ZERO, OVER_THE_BAR, BITS) > DEFAULT_POLICY.group.imageHashMaxDistance);
});

test('distance never leaves [0, bits]', () => {
  assert.equal(imageHashDistance(ZERO, 'f'.repeat(HEX_CHARS), BITS), BITS);
  assert.equal(imageHashDistance('f'.repeat(HEX_CHARS), 'f'.repeat(HEX_CHARS), BITS), 0);
});

test('the high bits are counted, which a whole-string parse would silently lose', () => {
  /* A 256-bit hash is well past what a double can hold, so any implementation that
     parsed the whole string at once would lose precision — in the HIGH bits, which is
     where a perceptual hash puts its strongest structure. One set bit at the very top
     must still count as one. */
  const topBitOnly = `8${'0'.repeat(HEX_CHARS - 1)}`;
  assert.equal(imageHashDistance(ZERO, topBitOnly, BITS), 1);
});

test('hashes of different lengths throw rather than return a plausible number', () => {
  const short = '0'.repeat(HEX_CHARS / 2); // a 128-bit hash
  assert.throws(() => imageHashDistance(ZERO, short, BITS), TypeError);
  assert.throws(() => imageHashDistance(short, ZERO, BITS), TypeError);
  /* Both are 128 bits and agree with each other — and still throw, because the BAR
     being applied was calibrated for 256. Agreeing with each other is not enough. */
  assert.throws(() => imageHashDistance(short, short, BITS), TypeError);
});

test('a hash of the wrong width for the declared bits is refused even when it is hex', () => {
  assert.throws(() => imageHashDistance('abcd', 'abcd', BITS), TypeError);
  assert.doesNotThrow(() => imageHashDistance('abcd', 'abcd', 16));
});

test('a string that is not lowercase hex is not a hash', () => {
  const notHex = `z${'0'.repeat(HEX_CHARS - 1)}`;
  const upper = `A${'0'.repeat(HEX_CHARS - 1)}`;
  assert.throws(() => imageHashDistance(ZERO, notHex, BITS), TypeError);
  assert.throws(() => imageHashDistance(ZERO, upper, BITS), TypeError);
  assert.throws(() => imageHashDistance('', '', BITS), TypeError);
});

test('a nonsense width is refused before either hash is looked at', () => {
  assert.throws(() => imageHashDistance(ZERO, ZERO, 0), RangeError);
  assert.throws(() => imageHashDistance(ZERO, ZERO, -256), RangeError);
  assert.throws(() => imageHashDistance(ZERO, ZERO, 2.5), RangeError);
});
