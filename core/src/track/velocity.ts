/**
 * The earlier build's snapshot tiers: rank tracked posts by how fast their views are
 * rising, and put the fastest on the most frequent re-read.
 *
 * Its own file because ranking is a statement about the whole set being tracked, which no
 * single TRACK decision can see. The runner computes each post's view rate, hands the set
 * here, and passes each post its rank as an input — the same way the lineage lookup
 * arrives at GROUP as data.
 *
 * What breaks if changed carelessly: a post with no rate yet is ranked null, not cold.
 * Ranking it as a zero would put every brand-new post on the slowest re-read exactly when
 * its views move fastest.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

export const VELOCITY_RANKS = ['hot', 'warm', 'cold'] as const;
export type VelocityRank = (typeof VELOCITY_RANKS)[number];

/** Ranks parallel to `rates`. A null rate is a null rank. */
export function rankByVelocity(rates: readonly (number | null)[], p: Policy): readonly (VelocityRank | null)[] {
  const known = rates
    .map((rate, index) => ({ rate, index }))
    .filter((r): r is { rate: number; index: number } => r.rate !== null && Number.isFinite(r.rate))
    .sort((a, b) => b.rate - a.rate || a.index - b.index);
  const n = known.length;
  const hotCut = Math.max(Math.min(n, 1), Math.ceil(n * p.track.velocityShares.hot));
  /* The two products summed rather than the shares: 10 × (0.2 + 0.4) is 6.000000000000001,
     which would round a sixth post into warm. */
  const warmCut = Math.max(hotCut, Math.ceil(n * p.track.velocityShares.hot + n * p.track.velocityShares.warm));
  const out: (VelocityRank | null)[] = rates.map(() => null);
  known.forEach((r, position) => {
    out[r.index] = position < hotCut ? 'hot' : position < warmCut ? 'warm' : 'cold';
  });
  return out;
}
