/**
 * Perceptual image hashing — comparison only. The hash itself is computed in the
 * media pipeline, where the decoding happens; core never touches an image.
 *
 * WHY THIS IS THE SINGLE HIGHEST-LEVERAGE CARRIER: a perceptual hash has no language
 * and no source. The same image posted on two platforms, captioned in two languages,
 * produces the same bits. Every other tier of grouping is trying to recover what this
 * one knows for free.
 *
 * The adapters must never invent one. An item with no computed hash carries no image
 * fingerprint at all — absent is honest, and a fabricated hash silently poisons the
 * carrier join, which is the grouper's whole basis.
 */

import { hexHamming, hexWidthBits, isHexHash } from '../bits.ts';

/**
 * Distance between two hashes of the same width, and a refusal when the widths differ.
 * Comparing across widths is meaningless and must throw rather than return a plausible
 * number.
 *
 * `bits` is not decoration and is not recoverable from the strings alone: the bar this
 * feeds — Policy.group.imageHashMaxDistance, 31 — is calibrated against
 * Policy.group.imageHashBits, 256. Thirty-one bits of slack out of 256 is a tolerant
 * near-match; the same 31 out of 64 is "these two images have nothing in common".
 * Passing the width in forces the caller to name the calibration it is standing on,
 * and a hash of the wrong width fails here instead of quietly borrowing a bar that was
 * never tuned for it.
 *
 * This function is deliberately NOT total. group/carriers.ts is the total one: it asks
 * isHexHash first and treats an uncomparable fingerprint as no evidence, so a single
 * malformed row cannot stop grouping for every item behind it. The primitive stays
 * strict so that a caller which forgets to check finds out immediately.
 *
 * @returns the Hamming distance, in [0, bits].
 * @throws RangeError when `bits` is not a positive whole number of hex digits.
 * @throws TypeError when either hash is not exactly `bits` bits of lowercase hex.
 */
export function imageHashDistance(a: string, b: string, bits: number): number {
  if (!Number.isInteger(bits) || bits <= 0) {
    throw new RangeError(`imageHashDistance: width ${bits} is not a positive bit count`);
  }
  if (!isHexHash(a, bits)) {
    throw new TypeError(
      `imageHashDistance: expected ${bits} bits of lowercase hex, got ${hexWidthBits(a)} bits`,
    );
  }
  if (!isHexHash(b, bits)) {
    throw new TypeError(
      `imageHashDistance: expected ${bits} bits of lowercase hex, got ${hexWidthBits(b)} bits`,
    );
  }
  return hexHamming(a, b);
}
