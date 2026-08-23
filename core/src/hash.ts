/**
 * FNV-1a, 32-bit. Fifteen lines so that core needs no dependency at all.
 *
 * WHY not a cryptographic hash: core may not import `node:crypto` — a builtin is
 * still an import, and the purity check treats it as one. Everything core hashes is
 * a bucketing decision (which holdout lane, which shard), never a secret and never
 * a commitment, so collision resistance is not the property being bought.
 *
 * WHY it must be deterministic across processes and restarts: holdout membership is
 * derived from it. If the assignment moved when the process restarted, the holdout
 * would stop being a fixed sample of arrivals and start being a sample of uptime.
 */

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

/**
 * The hash itself, as an unsigned 32-bit number.
 *
 * `charCodeAt` means this hashes UTF-16 code units, not bytes — so it is not the FNV-1a
 * a reference implementation elsewhere would produce for a non-ASCII string. That is
 * fine and must stay fine: nothing here is interoperable with anything, and the only
 * property being bought is that the same input gives the same number in this process and
 * every future one. Changing the encoding to match a reference would reassign every
 * holdout lane in the system at once, which is not a bug fix — it is discarding the
 * unbiased sample.
 */
export function fnv1a(input: string): number {
  let h = OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, PRIME);
  }
  return h >>> 0;
}

/** Eight lowercase hex characters. Stable spelling, for log lines and keys. */
export function fnv1aHex(input: string): string {
  return fnv1a(input).toString(16).padStart(8, '0');
}

/**
 * The hash as a number in [0,1). This is the only randomness core has, and it is
 * not random: it is a pure function of the subject key, which is exactly what makes
 * a sampled lane reproducible six months later during a replay.
 */
export function fnv1aUnit(input: string): number {
  return fnv1a(input) / 0x100000000;
}
