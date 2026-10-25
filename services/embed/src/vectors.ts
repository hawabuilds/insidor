/**
 * The two pieces of arithmetic the replies rest on: unit length, and a post's words and picture
 * as one vector.
 *
 * Separate so they are tested without a model: every consumer downstream treats a cosine as a dot
 * product, which is only true if every vector leaving here is unit length.
 *
 * What breaks if changed carelessly: the combination is part of POST_SPACE's meaning (space.ts). A
 * plain mean instead of the weighted one, or forgetting to re-normalise after adding, changes
 * every post vector's neighbours without changing the space id. The same holds for `beside` and
 * E5_POST_SPACE: the square roots are what make a cosine equal the measured w·words + (1−w)·picture.
 */

export function unit(values: Float32Array): Float32Array | null {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) return null;
  return values.map((v) => v / norm);
}

/** `weight`·words + (1 − weight)·picture, both unit length, then unit length again. */
export function combine(text: Float32Array, picture: Float32Array, weight: number): Float32Array | null {
  if (text.length !== picture.length) return null;
  const out = new Float32Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = weight * (text[i] ?? 0) + (1 - weight) * (picture[i] ?? 0);
  return unit(out);
}

/**
 * Two models' unit vectors side by side, [√weight·words, √(1−weight)·picture]: unit length, and the
 * dot product of two such vectors is weight·(words cosine) + (1 − weight)·(picture cosine). Words
 * alone are [words, 0] and a picture alone [0, picture], each unit length. Null with neither.
 */
export function beside(words: Float32Array | null, picture: Float32Array | null, wordsWidth: number, pictureWidth: number, weight: number): Float32Array | null {
  if ((words !== null && words.length !== wordsWidth) || (picture !== null && picture.length !== pictureWidth)) return null;
  if (words === null && picture === null) return null;
  const out = new Float32Array(wordsWidth + pictureWidth);
  const [a, b] = words !== null && picture !== null ? [Math.sqrt(weight), Math.sqrt(1 - weight)] : [1, 1];
  if (words !== null) for (let i = 0; i < wordsWidth; i += 1) out[i] = a * (words[i] ?? 0);
  if (picture !== null) for (let i = 0; i < pictureWidth; i += 1) out[wordsWidth + i] = b * (picture[i] ?? 0);
  return out;
}
