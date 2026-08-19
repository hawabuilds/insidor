/**
 * The wide (story, asset) feature set.
 *
 * This is the vector RESOLVE's abstains are logged with, and those abstains are the
 * training set: every time the system says "unsure", it writes down exactly what it
 * saw, and a human adjudicating it later produces a label against that frozen vector.
 * That is how a venue clears its cold start — the read-only first month is not a
 * limitation, it is the data collection.
 *
 * Nothing here may be recomputed at training time. The market moves, the symbol
 * collision statistic moves, and the asset's own metadata is editable by whoever
 * issued it — so a feature recovered later is a feature about a different world.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THE ABSENCE RULE IS STRICTER HERE THAN ANYWHERE ELSE, and it differs from the
 * rule one file over in a way that looks like an inconsistency and is not.
 *
 * `resolve/score.ts` scores an unmeasured channel as ZERO and deliberately does not
 * renormalise, so that a candidate with one measurable channel cannot look as
 * convincing as one with five. That is the SCORE's rule and it is correct: a score is
 * a decision and a decision has to be made with what it has.
 *
 * This is the VECTOR, and its rule is the opposite: an unmeasured channel is `null`.
 * `CandidateSignals` says so in as many words — "null means 'not measured', which is
 * a distinct state from 'measured and zero' and is kept distinct all the way into the
 * frozen feature vector". Do not copy the `?? 0` out of score.ts. A zero here says
 * "we looked at the image and it did not match", the model learns that, and every
 * candidate whose image pipeline was merely down is taught to it as a mismatch.
 *
 * The same distinction is the whole reason `quoteFailed` is a field and not an
 * inference: `G7_vendor_unavailable` and `G7_unquotable` are two different rows, one
 * of them about the asset and one of them about us, and an outage that reads as
 * illiquidity is exactly what made the last one invisible.
 */

import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';

import { MS_PER_MINUTE, MS_PER_SECOND, safeRatio } from '../math.ts';
import { candidateLagMs, gateDepth, runGates, type ResolveCandidate } from '../resolve/gates.ts';
import { temporalScore } from '../resolve/score.ts';

export const FEATURE_SET: FeatureSetId = 'candidate.wide.v1';

const PRESENT = 1;
const ABSENT = 0;

/**
 * The wide candidate vector over the SIX channels and the gate outcomes.
 *
 * ★ THE SIGNATURE GAINED TWO ARGUMENTS AND COULD NOT HAVE BEEN WRITTEN WITHOUT THEM.
 * The stub took a candidate alone, and neither half of what its own doc promises is
 * reachable from one:
 *
 *   · the temporal channel is `temporalScore(candidateLagMs(candidate, story), p)` —
 *     the lag is measured against the STORY's earliest post, and the decay is scaled
 *     by the policy window. A candidate does not know which story it is a candidate
 *     for, which is the entire question RESOLVE is asking.
 *   · "the gate outcomes" are `runGates(candidate, story, p)`, and four of the eight
 *     gates are comparisons against a policy bar.
 *
 * The doc says five channels; there are six. Five live on `CandidateSignals` and the
 * sixth — time — is computed rather than supplied, because it is the only one that is
 * a fact about the PAIR rather than about the asset. It is also the one that carries
 * the largest weight in the score, so a vector that omitted it would be a vector the
 * model could not use to explain the decision it is being trained on.
 */
export function candidateFeatures(
  candidate: ResolveCandidate,
  story: Story,
  p: Policy,
): FeatureVector {
  const { asset, market, signals } = candidate;
  const tradeQuote = candidate.quote; // vocab-allow: quote — the executable price at the probe size, which is RESOLVE's sense of the word and the thing gate G7 turns on. Bound to a name carrying the `tradeQuote` stem so the rest of this file needs no escape.

  const lagMs = candidateLagMs(candidate, story);
  const blocked = runGates(candidate, story, p);

  const mintedAt = asset.mintedAt;
  const rules = market?.transferRules ?? null;
  const depth = market?.depth ?? null;

  // Measured, not scored: how many of the five supplied channels carried a number at
  // all. It is the denominator a reader needs to know how much any of them is worth,
  // and it is the feature that separates "thin evidence" from "evidence against".
  const measured = [
    signals.symbol,
    signals.collisionIdf,
    signals.semantic,
    signals.image,
    signals.declared,
  ].filter((value) => value !== null).length;

  return {
    /* ── the sixth channel: time, which is the only ordering that is
          physically meaningful and the only one computed from the pair ─── */
    temporal: temporalScore(lagMs, p),
    lagMin: lagMs === null ? null : lagMs / MS_PER_MINUTE,
    lagKnown: lagMs === null ? ABSENT : PRESENT,
    /**
     * How the origin time was known, as two flags rather than one number, because
     * the three confidences are not ordered on a scale anybody can average. A
     * `bounded` origin whose bound is wider than the lag it is establishing is worth
     * exactly as much as an unknown one — that is gate G1's own rule — and a model
     * given a single 0/1/2 would have to rediscover it.
     */
    mintTimeExact: mintedAt.confidence === 'exact' ? PRESENT : ABSENT,
    mintTimeBounded: mintedAt.confidence === 'bounded' ? PRESENT : ABSENT,
    /** Null unless bounded: an unbounded time has no half-width, it has no width. */
    mintTimeBoundS: mintedAt.confidence === 'bounded' ? mintedAt.boundS : null,
    /** The bound as a fraction of the lag it is being used to order. G1's actual test. */
    mintTimeBoundShare:
      mintedAt.confidence === 'bounded' && mintedAt.boundS !== null && lagMs !== null
        ? safeRatio(mintedAt.boundS * MS_PER_SECOND, Math.abs(lagMs))
        : null,

    /* ── the five supplied channels, NULL where unmeasured ─────────────── */
    symbol: signals.symbol,
    collisionIdf: signals.collisionIdf,
    /**
     * ★ Symbol agreement TIMES its collision statistic, and null when EITHER half is
     * unmeasured. A symbol is an observation about an asset and never an identifier:
     * agreeing on one that everything carries is worth nothing, agreeing on a rare
     * one is worth a lot, and multiplying is how that gets said. Logging the product
     * as well as the halves costs one key and means a model does not have to learn
     * the multiplication from data it will never have enough of.
     */
    symbolChannel:
      signals.symbol === null || signals.collisionIdf === null
        ? null
        : signals.symbol * signals.collisionIdf,
    semantic: signals.semantic,
    image: signals.image,
    /** The issuer's own claim that it points at this story. Attacker-controlled. */
    declared: signals.declared,
    measuredChannels: measured,

    /* ── the gate outcomes ─────────────────────────────────────────────── */
    /**
     * How far the candidate got, as an index into `GATE_ORDER` — which is the order
     * the gates cost money in, so the number is also a spend curve. `gateDepth`
     * returns the array length for a candidate that survived everything, so "passed"
     * is the largest value rather than a separate encoding.
     */
    gateDepth: gateDepth(blocked),
    gatePassed: blocked === null ? PRESENT : ABSENT,

    /* ── what the venue reads said, kept apart from what they failed to say ─ */
    marketRead: market === null ? ABSENT : PRESENT,
    transferRulesComplete: rules === null ? null : rules.complete ? PRESENT : ABSENT,
    /** Null when the rules were never read: unread is not the same as clean. */
    hasTransferFee: rules === null ? null : rules.hasTransferFee ? PRESENT : ABSENT,
    hasTransferHook: rules === null ? null : rules.hasTransferHook ? PRESENT : ABSENT,
    /** Already `boolean | null` on the contract. The null is carried, not collapsed. */
    issuanceRevoked: rules?.issuanceRevoked === undefined || rules.issuanceRevoked === null
      ? null
      : rules.issuanceRevoked
        ? PRESENT
        : ABSENT,
    freezeRevoked: rules?.freezeRevoked === undefined || rules.freezeRevoked === null
      ? null
      : rules.freezeRevoked
        ? PRESENT
        : ABSENT,
    /**
     * The share of this venue's required checks that failed. A share and not a count,
     * because a chain that requires three checks and a chain that requires eight are
     * not comparable on "two failed" — which is exactly why `requiredChecks` is
     * carried per venue rather than assumed.
     */
    failedCheckShare:
      rules === null ? null : safeRatio(rules.failedChecks.length, rules.requiredChecks.length),

    /* ── cost, which is the only gate that spends a paid call ──────────── */
    /**
     * ★ TWO FLAGS, NEVER ONE. A missing price is `costKnown: 0`, and `quoteFailed`
     * says whether it is missing because the asset cannot be traded or because OUR
     * vendor was down. Collapsing them makes an incident indistinguishable from an
     * illiquid market, and during an incident that reads as the whole population
     * turning illiquid at once — which looks like a market event and is not one.
     */
    costKnown: tradeQuote === null ? ABSENT : PRESENT,
    quoteFailed: candidate.quoteFailed ? PRESENT : ABSENT,
    /** Basis points: a ratio, so it is comparable across chains and across sizes. */
    allInBps: tradeQuote?.allInBps ?? null,
    slippageBps: tradeQuote?.slippageBps ?? null,
    routeHops: tradeQuote === null ? null : tradeQuote.route.length,

    /* ── what backs the price, without flattening the two market shapes ── */
    depthRead: depth === null ? ABSENT : PRESENT,
    depthIsPool: depth === null ? null : depth.kind === 'pool' ? PRESENT : ABSENT,
    /**
     * Progress along the issuance curve, in [0,1], or null. NOTHING gates on this and
     * nothing may: the pre-graduation population is the only population this product
     * serves, and a filter on depth is a survivorship filter that removes it.
     */
    curveProgress: depth === null || depth.kind === 'pool' ? null : depth.progress,
    /** Signed percent over the trailing day. Null on an asset with no trailing day. */
    priceChangeDayPct: market?.priceChange24hPct ?? null,

    /* ── what the asset says about itself, all of it editable by its issuer ─ */
    assetSymbolKnown: asset.symbol === null ? ABSENT : PRESENT,
    assetNameKnown: asset.name === null ? ABSENT : PRESENT,
    assetImageKnown: asset.imageUri === null ? ABSENT : PRESENT,
    declaredLinkCount: Object.keys(asset.declaredSocial).length,

    /* ── the story half of the pair, so a row explains its own denominator ─ */
    storyMembers: story.memberCount,
    storyDistinctAuthors: story.distinctAuthors,
    storyDistinctSources: story.distinctSources,
  };
}
