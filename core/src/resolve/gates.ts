/**
 * ★ THE RESOLVE GATES, in the order they cost money.
 *
 * This is the stage where being wrong costs a user money, so it has the most hard
 * rules and the fewest opinions. Every gate is cheaper than the one after it, and
 * the first one is free: an asset that existed BEFORE the earliest post in the story
 * cannot have been minted from it, and no amount of symbol similarity, semantic
 * similarity or image similarity can make it so. Checking that before spending a
 * paid, rate-limited quote call is not an optimisation, it is the ordering the
 * evidence has.
 *
 * WHY THIS FILE IS PURE, given that four of the gates read a venue: it does not read
 * one. The service performs the reads and hands the results in as data —
 * `market` and `quote` on the candidate. A null is not a failure to be retried here;
 * it is a fact with a reason code, and the two null reasons are kept apart
 * deliberately: "this cannot be traded" and "our quote vendor is down" produce
 * different codes, because failing to distinguish them is exactly what made the last
 * outage invisible. Failing open would pass every candidate during an incident.
 *
 * G2 does not mean "wrong". It means the asset predates the story and was ADOPTED by
 * it rather than minted from it, which is a different product surface and a different
 * claim. It is recorded as such rather than as a mismatch.
 */

import type { Asset, MarketState, TradeQuote } from '@insidor/contracts/asset.ts';
import { assetKey } from '@insidor/contracts/ids.ts';
import type { CandidateId, VenueId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import type { CandidateSignals } from './score.ts';
import { MS_PER_SECOND } from '../math.ts';


/**
 * One (story, asset) pairing, with every external read already performed and
 * attached. Retrieval is time-first — the candidate set is everything minted inside
 * the story's window — and the symbol is a scoring channel over that set, never the
 * key used to find it. Searching by symbol and then filtering by time is the inverse,
 * and it is how a story gets matched to whichever asset a vendor's search happened
 * to return.
 */
export interface ResolveCandidate {
  readonly candidateId: CandidateId;
  readonly asset: Asset;
  readonly venue: VenueId;
  /** The venue read, or null when it failed or was never attempted. */
  readonly market: MarketState | null;
  /** The probe quote at Policy.resolve.probeNotionalUsd, or null. */
  readonly quote: TradeQuote | null;
  /** true when the quote is null because OUR vendor failed, not because of the asset. */
  readonly quoteFailed: boolean;
  readonly signals: CandidateSignals;
}

/**
 * The gate order, cheapest first. Exported because the stage reports the reason of
 * the candidate that got FURTHEST, and "furthest" is an index into this array —
 * which makes the most informative single reason a lookup rather than a judgement.
 */
export const GATE_ORDER: readonly ReasonCode[] = [
  'G1_mint_time_unknown',
  'G2_predates_post',
  'G3_too_late',
  'G4_major',
  'G5_transfer_rules_unread',
  'G6_nonstandard_transfer',
  'G7_vendor_unavailable',
  'G7_unquotable',
  'G8_cost_absurd',
];

/** Returns the blocking reason, or null when the candidate survived every gate. */
export function runGates(
  candidate: ResolveCandidate,
  story: Story,
  p: Policy,
): ReasonCode | null {
  const mintedAt = candidate.asset.mintedAt;

  /* ── free, local, and the only ordering that is physically meaningful ── */

  if (mintedAt.at === null || mintedAt.confidence === 'unknown') {
    return 'G1_mint_time_unknown';
  }

  const lagMs = mintedAt.at - story.earliestPostAt;

  // A bounded origin time is usable only when the bound is narrower than the lag it
  // is being used to establish. Against a post-to-mint lag measured in single-digit
  // minutes, an origin time from a second-hand source ran a median twenty-two
  // minutes late — which does not blur the ordering, it REVERSES it, and a null
  // check cannot catch a confident wrong number.
  if (mintedAt.confidence === 'bounded') {
    const boundMs = (mintedAt.boundS ?? Number.POSITIVE_INFINITY) * MS_PER_SECOND;
    if (!(boundMs < Math.abs(lagMs))) return 'G1_mint_time_unknown';
  }

  if (lagMs < p.resolve.minLagMs) return 'G2_predates_post';
  if (lagMs > p.resolve.maxLagMs) return 'G3_too_late';
  if (p.resolve.majors.includes(assetKey(candidate.asset.ref))) return 'G4_major';

  /* ── one cheap read ──────────────────────────────────────────────────── */

  const rules = candidate.market?.transferRules ?? null;
  // An unread rule is not a passed rule.
  if (rules === null || !rules.complete) return 'G5_transfer_rules_unread';
  if (rules.hasTransferFee || rules.hasTransferHook) return 'G6_nonstandard_transfer';

  /* ── quotability, which is the only gate that costs a paid call ──────── */

  // NOT liquidity. A bonding curve has no two-sided reserve, so a vendor returns no
  // reserve at all; the build this replaces read that absence as zero and rejected
  // it, which removed essentially the entire pre-graduation population — the only
  // population this product serves. "Can a real order be filled at the probe size"
  // is the question, and it works identically on a curve and on a pool.
  if (candidate.quote === null) {
    return candidate.quoteFailed ? 'G7_vendor_unavailable' : 'G7_unquotable';
  }
  if (candidate.quote.allInBps > p.resolve.maxAllInBps) return 'G8_cost_absurd';

  return null;
}

/** How far through the gates a candidate got. Higher is further; -1 is not gated. */
export function gateDepth(reason: ReasonCode | null): number {
  return reason === null ? GATE_ORDER.length : GATE_ORDER.indexOf(reason);
}

/** The lag a surviving candidate was judged on, for the feature vector. */
export function candidateLagMs(candidate: ResolveCandidate, story: Story): Millis | null {
  const at = candidate.asset.mintedAt.at;
  return at === null ? null : at - story.earliestPostAt;
}
