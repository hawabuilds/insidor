/**
 * A seeded pseudo-random generator, carried over from the previous build.
 *
 * WHY IT IS NOT `Math.random()`: every wave of the blind protocol must reproduce
 * from its seed, forever. The earlier, wronger waves being reproducible is what
 * made a sign flip visible across waves — `works_as_photo` was −15.8 points in
 * wave 2 and +10.9 in wave 3 — and that instability is the single most useful
 * thing the whole exercise produced. A sample you cannot regenerate is a result
 * you cannot check.
 *
 * mulberry32: 32-bit state, one multiply-xorshift round. Not cryptographic and
 * does not need to be — nothing here is a secret, only reproducible.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, seeded. Returns a new array; the input is not mutated, because
 * a shuffle that mutates its input makes the second call in a script return
 * something different from the first.
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
