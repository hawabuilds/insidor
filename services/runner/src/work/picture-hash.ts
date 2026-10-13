/**
 * A PICTURE'S PERCEPTUAL HASH: 64 bits that stay the same when a picture is resized, recompressed
 * or lightly recoloured, and change when it is a different picture.
 *
 * The coin-matching signals compare a coin's logo with a post's picture two ways: the image
 * embedding (a vendor call, which says "the same subject") and this hash (free, which says "the
 * same picture"). A launch that took the post's own picture as its logo is the commonest way a
 * coin is made from a post, and the hash finds that copy across the whole universe without paying
 * to embed every logo the mint stream sees.
 *
 * The method is the standard DCT hash: the picture grey and squeezed to 32×32, a 2-D cosine
 * transform, the 8×8 lowest frequencies kept (the very first, the average brightness, dropped
 * from the median), and one bit per frequency: above the median or not. Two pictures' distance
 * is the number of bits that differ, 0 to 64.
 *
 * Why here and not in core: it decodes picture files (any format a logo comes in, through the
 * image library) and its constants are the algorithm, not a judgement. Core receives only the
 * distance and holds the bar it is judged against (Policy.match.postCoin).
 *
 * What breaks if changed carelessly: every stored hash (internal.image_hash, 0070) was made with
 * these constants. Changing the size, the kept block or the bit order makes new hashes
 * incomparable with old ones, and every distance silently becomes noise; bump HASH_VERSION and
 * re-hash instead.
 */

import sharp from 'sharp';

/** Stored next to each hash; a hash of another version is never compared with this one. */
export const HASH_VERSION = 'dct64-1';
const SIZE = 32;
const KEEP = 8;
/** A picture larger than this is not decoded: a logo or a post picture is far smaller. */
const MAX_BYTES = 8 * 1024 * 1024;

const COS: readonly (readonly number[])[] = Array.from({ length: KEEP }, (_, u) =>
  Array.from({ length: SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE))),
);

/** The hash of a 32×32 grey picture, one byte a pixel, row by row; 16 hex characters. */
export function hashGrey(grey: Uint8Array | readonly number[]): string {
  if (grey.length !== SIZE * SIZE) throw new RangeError(`a ${SIZE}×${SIZE} grey picture is ${SIZE * SIZE} bytes, not ${grey.length}`);
  const coef: number[] = [];
  for (let u = 0; u < KEEP; u++) {
    for (let v = 0; v < KEEP; v++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        const cu = COS[u]![y]!;
        for (let x = 0; x < SIZE; x++) sum += cu * COS[v]![x]! * (grey[y * SIZE + x] ?? 0);
      }
      coef.push(sum);
    }
  }
  const sorted = coef.slice(1).sort((a, b) => a - b);
  const median = ((sorted[(sorted.length >> 1) - 1] ?? 0) + (sorted[sorted.length >> 1] ?? 0)) / 2;
  let bits = 0n;
  for (const c of coef) bits = (bits << 1n) | (c > median ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

/** Bits that differ between two hashes: 0 is the same picture, 32 is unrelated on average. */
export function hashDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** The hash of a picture file's bytes, in any format the image library reads; null when it reads none. */
export async function hashBytes(bytes: Uint8Array): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  try {
    const grey = await sharp(bytes, { animated: false, limitInputPixels: 64_000_000 }).flatten({ background: '#ffffff' }).greyscale().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer();
    return hashGrey(grey);
  } catch {
    return null;
  }
}

/** Fetch a picture and hash it; null when it cannot be read (an unknown, never "different"). */
export async function hashPicture(uri: string, fetchFn: typeof fetch, timeoutMs: number): Promise<string | null> {
  if (!/^https:\/\//i.test(uri)) return null;
  try {
    const r = await fetchFn(uri, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!r.ok) return null;
    const declared = Number(r.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return null;
    return await hashBytes(new Uint8Array(await r.arrayBuffer()));
  } catch {
    return null;
  }
}
