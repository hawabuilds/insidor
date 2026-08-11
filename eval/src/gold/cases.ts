/**
 * THE FROZEN REGRESSION SET. Real failures the previous build actually produced.
 *
 * ★ THIS FILE IS APPEND-ONLY. Add cases; never change one to make a run go
 * green. Every case below is a thing that happened, with a Buy button one click
 * away from a real Jupiter swap signed by a real wallet, and the only reason a
 * threshold change cannot silently reintroduce it is that these run in CI.
 *
 * The defect they all share: `lib/token-lookup.js` searched a market vendor by
 * symbol string and picked the highest-liquidity exact match. **There was no
 * check that the coin was created after the post.** No confidence score, no age
 * floor. Of the 323 tickers that resolved, 189 — 59% — shared zero content words
 * between the coin name and the story.
 *
 * A coin that existed before the post cannot have come from it. That is not a
 * heuristic, it is arithmetic, and it is gate G2.
 *
 * Two of these cases are loud and two are quiet, and the quiet ones matter more.
 * Naming $PUMP makes the bug sound self-evident. It is not. `GYM` resolved to a
 * 65-day-old graduated token with $61k liquidity, which looks like a perfectly
 * reasonable match for a gym-day story. **A quiet, plausible, wrong answer is
 * much harder to detect than an absurd one**, and it is what a user's money gets
 * spent on.
 */

import type { Verdict } from '@insidor/contracts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';

/** Where a candidate symbol came from. Its absence is the root of the $KANG class. */
export const SYMBOL_PROVENANCE = ['cashtag', 'mint_in_post', 'llm'] as const;
export type SymbolProvenance = (typeof SYMBOL_PROVENANCE)[number];

export type MintTimeConfidence = 'exact' | 'bounded' | 'unknown';

export interface GoldStory {
  readonly storyId: string;
  /** The words a human would use for it. Never a retrieval key. */
  readonly title: string;
  /** ISO-8601, UTC. The earliest post in the story — the clock G2 measures from. */
  readonly earliestPostAt: string;
}

export interface GoldCandidate {
  /** OBSERVED, never an identifier. Symbols are not unique and never will be. */
  readonly symbol: string;
  readonly assetKey: string;
  /**
   * Days between the mint and the earliest post. NEGATIVE means the coin existed
   * BEFORE the post, which is the whole defect. Written as a day count rather
   * than a second timestamp because the arithmetic is the assertion, and a
   * reader must be able to check it without a calculator.
   */
  readonly mintedDaysFromPost: number;
  readonly mintedAtConf: MintTimeConfidence;
  readonly marketCapUsd: number | null;
  /**
   * NULL on a bonding curve — the venue has no two-sided reserve, so the vendor
   * returns no liquidity object at all. Absent is NOT zero and NOTHING GATES ON
   * THIS. Collapsing the two with `|| 0` is what turned a quality filter into a
   * survivorship filter that removed essentially the entire pre-graduation
   * population.
   */
  readonly liquidityUsd: number | null;
  readonly venueId: string;
  readonly symbolProvenance: SymbolProvenance;
}

export interface GoldCase {
  readonly id: string;
  /** What actually shipped, in one line, so the case is readable without the docs. */
  readonly incident: string;
  readonly story: GoldStory;
  readonly candidate: GoldCandidate;
  readonly expect: { readonly verdict: Verdict; readonly reason: ReasonCode | null };
  /** Why this case exists. Not what the code does — why the outcome is correct. */
  readonly why: string;
}

const DAY_MS = 86_400_000;

/** The neutral shape a resolver gate is handed. No vendor words anywhere in it. */
export interface GoldGateInput {
  readonly earliestPostAtMs: number;
  readonly mintedAtMs: number | null;
  readonly mintedAtConf: MintTimeConfidence;
  readonly marketCapUsd: number | null;
  readonly liquidityUsd: number | null;
  readonly venueId: string;
  readonly symbol: string;
  readonly symbolProvenance: SymbolProvenance;
}

export function toGateInput(c: GoldCase): GoldGateInput {
  const post = Date.parse(c.story.earliestPostAt);
  return {
    earliestPostAtMs: post,
    mintedAtMs: c.candidate.mintedAtConf === 'unknown' ? null : post + c.candidate.mintedDaysFromPost * DAY_MS,
    mintedAtConf: c.candidate.mintedAtConf,
    marketCapUsd: c.candidate.marketCapUsd,
    liquidityUsd: c.candidate.liquidityUsd,
    venueId: c.candidate.venueId,
    symbol: c.candidate.symbol,
    symbolProvenance: c.candidate.symbolProvenance,
  };
}

export const GOLD_CASES: readonly GoldCase[] = [
  {
    id: 'gold-001-pump',
    incident:
      'A "gym day" post resolved to $PUMP — $1.84B market cap, minted 375 days before the post — ' +
      'and rendered a live market-cap cell with a Buy affordance.',
    story: {
      storyId: 'story_gymday',
      title: 'gym day',
      earliestPostAt: '2026-08-01T09:14:00.000Z',
    },
    candidate: {
      symbol: 'PUMP',
      assetKey: 'solana:pump-1111111111111111111111111111111111',
      mintedDaysFromPost: -375,
      mintedAtConf: 'exact',
      marketCapUsd: 1_840_000_000,
      liquidityUsd: 4_100_000,
      venueId: 'solana:amm',
      symbolProvenance: 'llm',
    },
    expect: { verdict: 'drop', reason: 'G2_predates_post' as ReasonCode },
    why:
      'A coin that existed 375 days before the post cannot have come from it. The temporal ' +
      'ordering is the gate; market cap and liquidity are not evidence of anything here and ' +
      'in this case actively argued the wrong way, because the biggest match won.',
  },
  {
    id: 'gold-002-grass',
    incident:
      'A "stefan back on the grass" post resolved to $GRASS — $225M, minted 633 days before the post.',
    story: {
      storyId: 'story_stefan_grass',
      title: 'stefan back on the grass',
      earliestPostAt: '2026-07-19T17:02:00.000Z',
    },
    candidate: {
      symbol: 'GRASS',
      assetKey: 'solana:grass-222222222222222222222222222222222',
      mintedDaysFromPost: -633,
      mintedAtConf: 'exact',
      marketCapUsd: 225_000_000,
      liquidityUsd: 980_000,
      venueId: 'solana:amm',
      symbolProvenance: 'llm',
    },
    expect: { verdict: 'drop', reason: 'G2_predates_post' as ReasonCode },
    why:
      'Same defect as gold-001. Kept as a separate case because it is a different word class — ' +
      'a common noun lifted out of a sentence rather than a topic word — and a fix that special-' +
      'cases one would not catch the other.',
  },
  {
    id: 'gold-003-gym-showdown',
    incident:
      'The same "gym day" story also resolved to "Gym Showdown": a 65-day-old graduated token ' +
      'with $61k liquidity. Nothing about it looks wrong.',
    story: {
      storyId: 'story_gymday',
      title: 'gym day',
      earliestPostAt: '2026-08-01T09:14:00.000Z',
    },
    candidate: {
      symbol: 'GYM',
      assetKey: 'solana:gymshowdown-3333333333333333333333333333',
      mintedDaysFromPost: -65,
      mintedAtConf: 'exact',
      marketCapUsd: 340_000,
      liquidityUsd: 61_000,
      venueId: 'solana:amm',
      symbolProvenance: 'llm',
    },
    expect: { verdict: 'drop', reason: 'G2_predates_post' as ReasonCode },
    why:
      '★ THE MOST IMPORTANT CASE IN THIS FILE. Plausible name, plausible size, plausible age, ' +
      'real liquidity. Every sanity check a human would run passes. Only the temporal ordering ' +
      'catches it — which is exactly why removing the liquidity filter was necessary but not ' +
      'sufficient: with the filter gone, a fresh curve still loses to an established pair on ' +
      'volume, and this token comes back.',
  },
  {
    id: 'gold-004-kang-invented-ticker',
    incident:
      'A ticker invented by the language model became canonical, reached enrichment, matched a ' +
      'coin of the same name and rendered a Buy button.',
    story: {
      storyId: 'story_kang',
      title: 'the KANG story',
      earliestPostAt: '2026-06-11T22:40:00.000Z',
    },
    candidate: {
      symbol: 'KANG',
      assetKey: 'solana:kang-44444444444444444444444444444444444',
      mintedDaysFromPost: 0.004, // ~5 minutes after the post: the temporal gate passes
      mintedAtConf: 'exact',
      marketCapUsd: 48_000,
      liquidityUsd: null,
      venueId: 'solana:pumpfun',
      symbolProvenance: 'llm',
    },
    expect: { verdict: 'abstain', reason: 'R_symbol_provenance_invented' as ReasonCode },
    why:
      'Not a temporal failure — this coin really was minted after the post. The defect is ' +
      'provenance: a suggested ticker is a suggestion, and it must never become a retrieval key ' +
      'or a canonical row. An invented symbol may prefill the mint form and nothing else. ' +
      'ABSTAIN rather than DROP: the coin may be genuine, we simply have no evidence tying it ' +
      'to this story, and abstain never means hide.',
  },
  {
    id: 'gold-005-live-curve-no-liquidity-object',
    incident:
      'A real, live, tradeable bonding-curve token minted four minutes after the post returned ' +
      '`found: false`, because the vendor emits no liquidity object for a curve and `|| 0` ' +
      'turned "this venue has no reserve concept" into "this pool was drained".',
    story: {
      storyId: 'story_livecurve',
      title: 'a story that really did produce a coin',
      earliestPostAt: '2026-08-04T11:00:00.000Z',
    },
    candidate: {
      symbol: 'SPROUT',
      assetKey: 'solana:sprout-5555555555555555555555555555555555',
      mintedDaysFromPost: 0.0028, // four minutes; the measured median post-to-mint lag is 3.8
      mintedAtConf: 'exact',
      marketCapUsd: 14_000,
      liquidityUsd: null,
      venueId: 'solana:pumpfun',
      symbolProvenance: 'cashtag',
    },
    expect: { verdict: 'pass', reason: null },
    why:
      '★ THE NEGATIVE CONTROL, and the case a tightening change is most likely to break. Every ' +
      'other case here asks the resolver to say no; this one asks it to say yes to the exact ' +
      'population the previous build excluded — pre-graduation curves with no liquidity object. ' +
      'A gold set of only rejections silently rewards a resolver that rejects everything.',
  },
  {
    id: 'gold-006-mint-time-unknown',
    incident:
      'The vendor `pairCreatedAt` field, when present, had a median lag of +22 minutes against ' +
      'the launchpad\'s own timestamp, with a tail running to +9,743 hours — because the ' +
      'original bonding-curve pair is dropped after migration and the earliest surviving pool ' +
      'is the migration pool.',
    story: {
      storyId: 'story_unknown_mint',
      title: 'a story whose candidate has no trustworthy mint time',
      earliestPostAt: '2026-08-06T14:30:00.000Z',
    },
    candidate: {
      symbol: 'HAZE',
      assetKey: 'solana:haze-66666666666666666666666666666666666',
      mintedDaysFromPost: 0.01,
      mintedAtConf: 'unknown',
      marketCapUsd: 90_000,
      liquidityUsd: 12_000,
      venueId: 'solana:amm',
      symbolProvenance: 'cashtag',
    },
    expect: { verdict: 'abstain', reason: 'G1_mint_time_unknown' as ReasonCode },
    why:
      'Against a 3.8-minute median post-to-mint lag, a mint time off by 22 minutes silently ' +
      'REVERSES the ordering G2 exists to enforce. Failing closed on null cannot catch that, ' +
      'because the failure mode is a confident wrong number rather than a null — so confidence ' +
      'is carried as its own field and "unknown" is a first-class outcome, not a missing value.',
  },
];
