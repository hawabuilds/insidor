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

import { notImplemented } from '../not-implemented.ts';

/**
 * TO BUILD: distance between two hashes of the same width, and a refusal when the
 * widths differ. Comparing across widths is meaningless and must throw rather than
 * return a plausible number.
 */
export function imageHashDistance(_a: string, _b: string, _bits: number): number {
  return notImplemented('group/phash.ts: perceptual hash distance');
}
