/**
 * The two pieces of arithmetic the replies rest on: unit length, and a post's words and picture
 * as one vector.
 *
 * Separate so they are tested without a model: every consumer downstream treats a cosine as a dot
 * product, which is only true if every vector leaving here is unit length.
 *
 * What breaks if changed carelessly: the combination is part of POST_SPACE's meaning (space.ts). A
 * plain mean instead of the weighted one, or forgetting to re-normalise after adding, changes
 * every post vector's neighbours without changing the space id.
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
