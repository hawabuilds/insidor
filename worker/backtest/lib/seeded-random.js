'use strict';

/** Mulberry32 — deterministic PRNG from 32-bit seed. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, seed) {
  const rng = mulberry32(Number(seed) || 1);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function randomSample(items, n, seed) {
  const shuffled = seededShuffle(items, seed);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

module.exports = { mulberry32, seededShuffle, randomSample };
